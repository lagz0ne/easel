import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Observe, Scope } from "@tinkered/core";
import { makeTestClock, memory, preset } from "@tinkered/core/testing";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { routes } from "~/components/requests/index.server";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { frames as frameCells } from "@/frames/contract";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { passwordMatches } from "@/frames/password.server";
import { drawPage, pictureRoute, picturesServer } from "@/frames/pictures.server";
import { shareOps, shareServer } from "@/frames/share.server";
import { framesServer } from "@/frames/store.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 30) => new Promise((done) => setTimeout(done, ms));

async function until(ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) await tick(20);
  expect(ok()).toBe(true);
}

async function boot(
  file = ":memory:",
  pictures = false,
  presets: Array<ReturnType<typeof preset>> = [],
) {
  const out: string[] = [];
  const spans: Observe.Span[] = [];
  const logs: Observe.Log[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, frames.board, frames.viewer];
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const stop = new AbortController();
  const table = { "GET /api/pictures/{canvas}/{id}/{version}": pictureRoute };
  const scope = createScope({
    clock,
    presets: [preset(drawPage, async () => new TextEncoder().encode("drawn")), ...presets],
    observe: { export: (span) => void spans.push(span), log: (line) => void logs.push(line) },
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file }),
      ...(pictures ? [picturesServer({ chromium: process.execPath, database: file })] : []),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      shareServer(),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      frames.viewer({ implement: shareOps }),
      memory.server({ services }),
      routes({ stop: stop.signal, table }),
    ],
  });
  const server = await scope.ready;
  closers.push(() => (stop.abort(), server.close()));
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";
  const fetch = server.resolve(routes).fetch;
  const get = async (path: string) => {
    const answer = await fetch(new Request(`http://easel.test${path}`), server);
    if (!answer) throw new Error("no route answers the picture");
    return answer.status;
  };

  return { server, clock, out, spans, logs, setupCode, get };
}

type Server = Awaited<ReturnType<typeof boot>>;

async function client(
  server: Scope.Handle,
  held: { token?: string; pass?: string } = {},
  peer = "198.51.100.1",
) {
  const meta = operation({
    label: "test.meta",
    run: async (): Promise<Record<string, string>> => ({
      ...(held.token ? { authorization: `Bearer ${held.token}` } : {}),
      ...(held.pass ? { pass: held.pass } : {}),
    }),
  });
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: server, headers: { "x-easel-peer": peer }, meta }),
      access.login({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      frames.board({ read: memory.client }),
      frames.viewer({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return {
    scope,
    held,
    newCanvas: (name: string) => scope.run(frames.api["canvas.create"], { input: { name } }),
    canvases: () => scope.run(frames.api["canvas.list"], { input: null }),
    share: (canvas: string, password?: string | null) =>
      scope.run(frames.api["canvas.share"], {
        input: password === undefined ? { canvas } : { canvas, password },
      }),
    unshare: (canvas: string) => scope.run(frames.api["canvas.unshare"], { input: { canvas } }),
    put: (canvas: string, html: string, name: string) =>
      scope.run(frames.api["frame.put"], { input: { canvas, html, name } }),
    open: (link: string, password?: string) =>
      scope.run(frames.viewer["share.open"], {
        input: password === undefined ? { link } : { link, password },
      }),
  };
}

type Client = Awaited<ReturnType<typeof client>>;

async function ann(srv: Server) {
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await client(srv.server);
  const answer = await login.scope.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  expect(answer.kind).toBe("granted");
  await login.scope.close();

  return client(srv.server, { token: text });
}

const linkOf = (answer: { kind: string; path?: string }) =>
  answer.kind === "shared" && answer.path ? answer.path.slice("/s/".length) : "";

async function sharedFlow(srv: Server, password?: string) {
  const a = await ann(srv);
  await a.newCanvas("flow");
  await a.put("flow", "<p>1</p>", "Home");
  const shared = await a.share("flow", password);
  if (shared.kind !== "shared") throw new Error(`flow was not shared: ${shared.kind}`);

  return { a, path: shared.path, link: linkOf(shared) };
}

const faultOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: unknown) =>
      frames.api.fault.is(error) || frames.viewer.fault.is(error)
        ? { fault: error.fault, payload: error.payload }
        : { fault: "other", payload: String(error) },
  );

function watchFrames(tab: Client, canvas = "flow") {
  const list = tab.scope.resolve(frames.board.frames.where({ canvas }));
  closers.push(list.watch(() => undefined));
  const fault = () => {
    const error = tab.scope.resolve(frames.board.faults).get().frames;
    return frames.board.fault.is(error) ? { fault: error.fault, payload: error.payload } : null;
  };

  return { names: () => list.get().map((f) => f.name), fault };
}

async function openTab(srv: Server, link: string, password?: string, peer?: string) {
  const tab = await client(srv.server, {}, peer);
  const opened = await tab.open(link, password);
  expect(opened.kind).toBe("open");
  tab.held.pass = opened.kind === "open" ? opened.pass : "";
  const read = watchFrames(tab);
  await until(() => read.names().length === 1);

  return { tab, read, pass: tab.held.pass };
}

async function readWith(srv: Server, pass: string) {
  const tab = await client(srv.server, { pass });
  const read = watchFrames(tab);
  await until(() => read.names().length > 0 || read.fault() !== null);

  return read.fault() ?? read.names();
}

const pw1 = "correct horse";
const pw2 = "battery staple";
const wrongPw = "not the password";
const locked = { fault: "refused", payload: { locked: true } };
const ended = { fault: "refused", payload: { ended: true } };

const boardMember = operation({
  label: "test.boardMember",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { cells: frameCells.atScope.controller },
  run: ({ cells }, { input }) => cells.where(input).get()[0],
});

test("a password set or changed, and an unshare, end the old picture links: the picture key changes and its old address answers 404; the same password, no field and --no-password keep them", async () => {
  const srv = await boot(":memory:", true);
  const a = await ann(srv);
  await a.newCanvas("flow");
  const made = await a.put("flow", "<p>1</p>", "Home");
  if (made.kind !== "created") throw new Error(made.kind);
  const address = () => {
    const member = srv.server.run(boardMember, { input: { canvas: "flow", id: made.id } });
    return `/api/pictures/flow/${made.id}/${member?.version}?s=0.5&k=${member?.k}&kit=1`;
  };
  const before = address();
  expect(await srv.get(before)).toBe(200);

  await a.share("flow", pw1);
  const first = address();
  expect(first).not.toBe(before);
  expect(await srv.get(before)).toBe(404);
  expect(await srv.get(first)).toBe(200);

  for (const same of [pw1, undefined]) {
    await a.share("flow", same);
    expect(address()).toBe(first);
  }

  await a.share("flow", pw2);
  const second = address();
  expect(second).not.toBe(first);
  expect(await srv.get(first)).toBe(404);

  await a.share("flow", null);
  expect(address()).toBe(second);
  expect(await srv.get(second)).toBe(200);

  await a.unshare("flow");
  expect(address()).not.toBe(second);
  expect(await srv.get(second)).toBe(404);
});

test("the viewer opens a password link with no password: locked, the password page; it is no try, and never slowed (OpenWithoutPasswordIsNeverSlow)", async () => {
  const srv = await boot();
  const { link } = await sharedFlow(srv, pw1);
  const tab = await client(srv.server);

  for (let i = 0; i < 6; i++) expect(await tab.open(link)).toEqual({ kind: "locked" });
  expect((await tab.open(link, pw1)).kind).toBe("open");
});

test("the viewer types the right password: open, and the pass reads the canvas; a wrong one answers wrong", async () => {
  const srv = await boot();
  const { link } = await sharedFlow(srv, pw1);
  const tab = await client(srv.server);

  expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
  expect(await tab.open(link, `${pw1} `)).toEqual({ kind: "wrong" });
  const { read } = await openTab(srv, link, pw1);
  expect(read.names()).toEqual(["Home"]);
  expect(read.fault()).toBeNull();
});

test("a password typed on a link with none opens it: only a password link asks one", async () => {
  const srv = await boot();
  const { link } = await sharedFlow(srv);
  const tab = await client(srv.server);

  expect((await tab.open(link, wrongPw)).kind).toBe("open");
  expect((await tab.open(link)).kind).toBe("open");
});

test(
  "tries 1 to 5 that are wrong answer wrong; any try after 5 wrong ones answers slow, even the right password, until a minute from the 5th wrong one (NoMoreThan5WrongTriesAMinute, SlowEvenWithTheRightPassword)",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const { link } = await sharedFlow(srv, pw1);
    const tab = await client(srv.server);

    expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
    srv.clock.advance(10_000);
    for (let i = 2; i <= 5; i++) expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
    expect(await tab.open(link, pw1)).toEqual({ kind: "slow", retryIn: 60_000 });
    expect(await tab.open(link, wrongPw)).toEqual({ kind: "slow", retryIn: 60_000 });
    expect(await tab.open(link)).toEqual({ kind: "locked" });

    srv.clock.advance(59_999);
    expect(await tab.open(link, pw1)).toEqual({ kind: "slow", retryIn: 1 });
    srv.clock.advance(1);
    expect((await tab.open(link, pw1)).kind).toBe("open");
    for (let i = 1; i <= 5; i++) expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
    expect((await tab.open(link, wrongPw)).kind).toBe("slow");
  },
);

test(
  "5 wrong tries spread over 50 s lock the link for a minute from the 5th: the right password 20 s later is slow, with 40 s left; after the lock the count starts again (TheLockLastsAMinute)",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const { link } = await sharedFlow(srv, pw1);
    const tab = await client(srv.server);

    expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
    for (let i = 2; i <= 5; i++) {
      srv.clock.advance(12_500);
      expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
    }
    srv.clock.advance(20_000);
    expect(await tab.open(link, pw1)).toEqual({ kind: "slow", retryIn: 40_000 });
    srv.clock.advance(10_000);
    expect(await tab.open(link, wrongPw)).toEqual({ kind: "slow", retryIn: 30_000 });

    srv.clock.advance(29_999);
    expect(await tab.open(link, pw1)).toEqual({ kind: "slow", retryIn: 1 });
    srv.clock.advance(1);
    expect((await tab.open(link, pw1)).kind).toBe("open");
    for (let i = 1; i <= 4; i++) expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
    expect((await tab.open(link, pw1)).kind).toBe("open");
    expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
    expect(await tab.open(link, pw1)).toEqual({ kind: "slow", retryIn: 60_000 });
  },
);

test(
  "5 wrong tries over more than a minute do not lock: the count runs a minute from the first wrong try",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const { link } = await sharedFlow(srv, pw1);
    const tab = await client(srv.server);

    for (let i = 1; i <= 4; i++) expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
    srv.clock.advance(60_000);
    expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
    expect((await tab.open(link, pw1)).kind).toBe("open");
  },
);

test(
  "a right password checked while 29 wrong ones are checked too waits, once 5 of them count: 30 tries at once, the right one last, do not open (SlowEvenWithTheRightPassword)",
  { timeout: 30_000 },
  async () => {
    const seen = { entered: 0, answered: 0 };
    const held = preset(passwordMatches, async (_, { input }) => {
      seen.entered += 1;
      const right = await Bun.password.verify(input.password, input.hash, "argon2id");
      for (let i = 0; i < 500; i++) {
        if (seen.entered === 30 && (!right || seen.answered === 29)) break;

        await tick(20);
      }
      return right;
    });
    const srv = await boot(":memory:", false, [held]);
    const { link } = await sharedFlow(srv, pw1);
    const tab = await client(srv.server);

    const wrong = Array.from({ length: 29 }, () =>
      tab.open(link, wrongPw).then((answer) => {
        seen.answered += 1;
        return answer.kind;
      }),
    );
    const right = await tab.open(link, pw1);
    const kinds = await Promise.all(wrong);

    expect(seen.entered).toBe(30);
    expect(kinds.filter((kind) => kind === "wrong")).toHaveLength(5);
    expect(kinds.filter((kind) => kind === "slow")).toHaveLength(24);
    expect(right).toEqual({ kind: "slow", retryIn: 60_000 });
  },
);

test(
  "a lockout that starts mid-minute still holds after the next sweep of old tries: the lock runs a minute from its own 5th wrong try",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const { link } = await sharedFlow(srv, pw1);
    const other = await client(srv.server, {}, "203.0.113.7");
    const tab = await client(srv.server);

    expect(await other.open(link, wrongPw)).toEqual({ kind: "wrong" });
    srv.clock.advance(30_000);
    for (let i = 1; i <= 5; i++) expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
    srv.clock.advance(30_000);
    expect(await tab.open(link, pw1)).toEqual({ kind: "slow", retryIn: 30_000 });
    srv.clock.advance(30_000);
    expect((await tab.open(link, pw1)).kind).toBe("open");
  },
);

test(
  "a right password does not clear the wrong tries before it: 5 wrong ones in the minute still slow the next",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const { link } = await sharedFlow(srv, pw1);
    const tab = await client(srv.server);

    for (let i = 1; i <= 4; i++) expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
    expect((await tab.open(link, pw1)).kind).toBe("open");
    expect(await tab.open(link, wrongPw)).toEqual({ kind: "wrong" });
    expect((await tab.open(link, pw1)).kind).toBe("slow");
  },
);

test(
  "wrong tries from another address, or on another link, do not slow the viewer (AnotherAddressCannotLockTheViewerOut)",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const { a, link } = await sharedFlow(srv, pw1);
    await a.newCanvas("side");
    const side = linkOf(await a.share("side", pw2));
    const other = await client(srv.server, {}, "203.0.113.9");
    const viewer = await client(srv.server, {}, "198.51.100.1");

    for (let i = 1; i <= 5; i++) expect(await other.open(link, wrongPw)).toEqual({ kind: "wrong" });
    expect((await other.open(link, pw1)).kind).toBe("slow");
    expect((await viewer.open(link, pw1)).kind).toBe("open");
    expect((await other.open(side, pw2)).kind).toBe("open");
    expect(await viewer.open(link, wrongPw)).toEqual({ kind: "wrong" });
  },
);

test(
  "tries count an IPv6 address by its /64, as the flood limit does",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const { link } = await sharedFlow(srv, pw1);
    const one = await client(srv.server, {}, "2001:db8:1:2::1");
    const sameBlock = await client(srv.server, {}, "2001:db8:1:2::beef");

    for (let i = 1; i <= 5; i++) expect(await one.open(link, wrongPw)).toEqual({ kind: "wrong" });
    expect((await sameBlock.open(link, pw1)).kind).toBe("slow");
  },
);

test("a user shares it again with a new password: the same link; each live read gets locked at once; a new open needs the new password (ATabShowsTheCanvasOnlyUnderTheCurrentPassword, LockPushedAtOnce)", async () => {
  const srv = await boot();
  const { a, path, link } = await sharedFlow(srv, pw1);
  const first = await openTab(srv, link, pw1);
  const second = await openTab(srv, link, pw1, "203.0.113.9");

  expect(await a.share("flow", pw2)).toEqual({ kind: "shared", path });
  await until(() => first.read.fault() !== null && second.read.fault() !== null);
  expect([first.read.fault(), second.read.fault()]).toEqual([locked, locked]);
  expect(await readWith(srv, first.pass)).toEqual(locked);

  const tab = await client(srv.server);
  expect(await tab.open(link)).toEqual({ kind: "locked" });
  expect(await tab.open(link, pw1)).toEqual({ kind: "wrong" });
  const again = await openTab(srv, link, pw2);
  expect(again.read.names()).toEqual(["Home"]);
});

test("a user shares it again with a password where it had none: the same link, and every pass given before ends, locked", async () => {
  const srv = await boot();
  const { a, path, link } = await sharedFlow(srv);
  const open = await openTab(srv, link);

  expect(await a.share("flow", pw1)).toEqual({ kind: "shared", path });
  await until(() => open.read.fault() !== null);
  expect(open.read.fault()).toEqual(locked);
  expect(await readWith(srv, open.pass)).toEqual(locked);
});

test("setting the same password again is no change: no pass ends, and its live read goes on", async () => {
  const srv = await boot();
  const { a, path, link } = await sharedFlow(srv, pw1);
  const open = await openTab(srv, link, pw1);

  expect(await a.share("flow", pw1)).toEqual({ kind: "shared", path });
  expect(await a.share("flow")).toEqual({ kind: "shared", path });
  await a.put("flow", "<p>2</p>", "Checkout");
  await until(() => open.read.names().length === 2);
  expect(open.read.fault()).toBeNull();
  expect(await readWith(srv, open.pass)).toEqual(["Home", "Checkout"]);
  expect((await (await client(srv.server)).open(link, pw1)).kind).toBe("open");
});

test("--no-password removes the password, and the passes stay; the link opens with no password; a share with no field keeps it so", async () => {
  const srv = await boot();
  const { a, path, link } = await sharedFlow(srv, pw1);
  const open = await openTab(srv, link, pw1);

  expect(await a.share("flow", null)).toEqual({ kind: "shared", path });
  await a.put("flow", "<p>2</p>", "Checkout");
  await until(() => open.read.names().length === 2);
  expect(open.read.fault()).toBeNull();
  expect(await readWith(srv, open.pass)).toEqual(["Home", "Checkout"]);

  const tab = await client(srv.server);
  expect((await tab.open(link)).kind).toBe("open");
  expect(await a.share("flow")).toEqual({ kind: "shared", path });
  expect((await tab.open(link)).kind).toBe("open");

  expect(await a.share("flow", pw2)).toEqual({ kind: "shared", path });
  await until(() => open.read.fault() !== null);
  expect(open.read.fault()).toEqual(locked);
});

test("two shares with passwords at once make one link: the second reads the link the first wrote, plans again, and its password is the link's", async () => {
  const srv = await boot();
  const a = await ann(srv);
  await a.newCanvas("flow");
  await a.put("flow", "<p>1</p>", "Home");

  const [one, two] = await Promise.all([a.share("flow", pw1), a.share("flow", pw2)]);
  expect(one.kind).toBe("shared");
  expect(linkOf(two)).toBe(linkOf(one));

  const tab = await client(srv.server);
  const opened = [await tab.open(linkOf(one), pw1), await tab.open(linkOf(one), pw2)];
  expect(opened.map((answer) => answer.kind).toSorted()).toEqual(["open", "wrong"]);
});

test("a share with no password field keeps the password: the link still asks it, and no pass ends", async () => {
  const srv = await boot();
  const { a, path, link } = await sharedFlow(srv, pw1);
  const open = await openTab(srv, link, pw1);

  expect(await a.share("flow")).toEqual({ kind: "shared", path });
  expect(await (await client(srv.server)).open(link)).toEqual({ kind: "locked" });
  expect(await readWith(srv, open.pass)).toEqual(["Home"]);
});

test("a user unshares it: each live read gets ended at once, and the link answers gone, a password too (ATabShowsTheCanvasOnlyWhileItsLinkIsLive, EndPushedAtOnce)", async () => {
  const srv = await boot();
  const { a, link } = await sharedFlow(srv, pw1);
  const open = await openTab(srv, link, pw1);
  const tab = await client(srv.server);
  const [frame] = open.tab.scope.resolve(frames.board.frames.where({ canvas: "flow" })).get();
  const doc = open.tab.scope.resolve(frames.board.docs.of({ canvas: "flow", id: frame?.id ?? "" }));
  closers.push(doc.watch(() => undefined));
  const docFault = () => {
    const error = open.tab.scope.resolve(frames.board.faults).get().docs;
    return frames.board.fault.is(error) ? { fault: error.fault, payload: error.payload } : null;
  };
  await until(() => doc.get() !== undefined);

  expect(await a.unshare("flow")).toEqual({ kind: "unshared" });
  await until(() => open.read.fault() !== null && docFault() !== null);
  expect(open.read.fault()).toEqual(ended);
  expect(docFault()).toEqual(ended);
  expect(await readWith(srv, open.pass)).toEqual(ended);
  expect(await tab.open(link)).toEqual({ kind: "gone" });
  expect(await tab.open(link, pw1)).toEqual({ kind: "gone" });
  expect((await a.canvases()).canvases).toMatchObject([{ key: "flow", shared: false }]);
});

test("an ended link stays ended: sharing again makes a new link, and the old one answers gone (AnEndedLinkStaysEnded)", async () => {
  const srv = await boot();
  const { a, path, link } = await sharedFlow(srv);
  const open = await openTab(srv, link);

  expect(await a.unshare("flow")).toEqual({ kind: "unshared" });
  expect(await a.unshare("flow")).toEqual({ kind: "unshared" });
  const again = await a.share("flow", pw1);
  expect(again.kind).toBe("shared");
  expect(again).not.toEqual({ kind: "shared", path });
  const tab = await client(srv.server);
  expect(await tab.open(link)).toEqual({ kind: "gone" });
  expect(await readWith(srv, open.pass)).toEqual(ended);
  expect(await tab.open(linkOf(again))).toEqual({ kind: "locked" });
  expect((await tab.open(linkOf(again), pw1)).kind).toBe("open");
  expect((await a.canvases()).canvases).toMatchObject([{ key: "flow", shared: true }]);
});

test("unshare on a canvas that is not there answers gone; a guest's unshare is refused, sign in", async () => {
  const srv = await boot();
  const { a, link } = await sharedFlow(srv);
  const guest = await client(srv.server);

  expect(await a.unshare("nope")).toEqual({ kind: "gone" });
  expect(await faultOf(guest.unshare("flow"))).toEqual({
    fault: "refused",
    payload: { signIn: true },
  });
  expect((await guest.open(link)).kind).toBe("open");
});

test(
  "a password is kept only as its argon2id hash; it, and a locked pass, survive a restart",
  { timeout: 30_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "easel-share-pw-"));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "easel.db");
    const first = await boot(file);
    const stored = () => {
      const db = new Database(file, { readonly: true });
      const rows = db.query("SELECT hash FROM frames_links").all();
      const dump = JSON.stringify(db.query("SELECT * FROM frames_links").all());
      db.close();

      expect(rows).toEqual([{ hash: expect.stringMatching(/^\$argon2id\$/) }]);
      for (const password of [pw1, pw2]) expect(dump).not.toContain(password);
    };
    const { a, link } = await sharedFlow(first, pw1);
    stored();
    const before = await openTab(first, link, pw1);
    await a.share("flow", pw2);
    const after = await openTab(first, link, pw2);
    await first.server.close();
    stored();

    const second = await boot(file);
    expect(await readWith(second, before.pass)).toEqual(locked);
    expect(await readWith(second, after.pass)).toEqual(["Home"]);
    const tab = await client(second.server);
    expect(await tab.open(link)).toEqual({ kind: "locked" });
    expect(await tab.open(link, pw1)).toEqual({ kind: "wrong" });
    expect((await tab.open(link, pw2)).kind).toBe("open");
  },
);

test(
  "a file from before passwords opens: its links ask none, its passes still read, and a pass with no name is kept",
  { timeout: 30_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "easel-share-pw-"));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "easel.db");
    const old = new Database(file);
    const link = "ab".repeat(16);
    const pass = "cd".repeat(16);
    old.exec(`
CREATE TABLE frames_canvases (key TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE frames_links (link TEXT PRIMARY KEY NOT NULL, canvas TEXT NOT NULL, made INTEGER NOT NULL, ended INTEGER);
CREATE TABLE frames_passes (digest TEXT PRIMARY KEY NOT NULL, link TEXT NOT NULL, name TEXT NOT NULL, made INTEGER NOT NULL);`);
    old.query("INSERT INTO frames_canvases VALUES ('flow', 'flow', 1)").run();
    old.query("INSERT INTO frames_links VALUES (?, 'flow', 1, NULL)").run(link);
    old
      .query("INSERT INTO frames_passes VALUES (?, ?, 'Bo', 1)")
      .run(createHash("sha256").update(pass).digest("hex"), link);
    old.close();

    const srv = await boot(file);
    const tab = await client(srv.server, { pass });
    const read = watchFrames(tab);
    await tick(200);
    expect(read.fault()).toBeNull();
    expect((await tab.open(link)).kind).toBe("open");
  },
);

test("no password, hash, link or pass reaches a span, a log record, the console, or an invalid fault", async () => {
  const printed: unknown[] = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args) => void printed.push(args));
  }
  const srv = await boot();
  const { a, link } = await sharedFlow(srv, pw1);
  const tab = await client(srv.server);
  await tab.open(link, wrongPw);
  const opened = await tab.open(link, pw1);
  const pass = opened.kind === "open" ? opened.pass : "";
  await a.share("flow", pw2);
  await a.share("flow", pw2);
  const short = "short12";
  const bad = await Promise.try(() => a.share("flow", short)).then(
    () => null,
    (error: unknown) => error,
  );
  const seen = `${JSON.stringify([srv.spans, srv.logs, bad])} ${String(bad)} ${srv.out.join("")} ${JSON.stringify(printed)}`;
  vi.restoreAllMocks();

  expect(String(bad)).toContain("DataValidationFailed");
  expect(srv.spans.length).toBeGreaterThan(0);
  for (const secret of [pw1, pw2, wrongPw, short, link, pass, "$argon2id$"]) {
    expect(seen).not.toContain(secret);
  }
});

test("a share password has 8 characters or more: a shorter one stops on the client, and the link stays as it was", async () => {
  const srv = await boot();
  const { a, link } = await sharedFlow(srv);
  const sent = (password: string) =>
    Promise.try(() => a.share("flow", password)).then(
      () => "sent",
      (error: unknown) => String(error),
    );

  expect(await sent("1234567")).toContain("DataValidationFailed");
  expect(await sent("")).toContain("DataValidationFailed");
  expect((await (await client(srv.server)).open(link)).kind).toBe("open");
  expect((await a.share("flow", "12345678")).kind).toBe("shared");
  expect(await (await client(srv.server)).open(link)).toEqual({ kind: "locked" });
});
