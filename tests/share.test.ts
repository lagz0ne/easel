import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Observe, Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { shareOps, shareServer } from "@/frames/share.server";
import { framesServer } from "@/frames/store.server";

// Share without a password, over the memory transport, against the frames-share and
// viewer-gate-password charts (docs/statecharts) and SPEC-frames' share rules. Each test that
// follows an arrow or a rule is named by its wording. Passwords and unshare, with
// AnEndedLinkStaysEnded and EndPushedAtOnce, are tests/share-password.test.ts's.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 30) => new Promise((done) => setTimeout(done, ms));

/** Waits until `ok` holds, a tick at a time, up to 2 s. */
async function until(ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) await tick(20);
  expect(ok()).toBe(true);
}

/** One server as cmds/server.ts wires frames and share, with its spans and log lines kept. */
async function boot(file = ":memory:") {
  const out: string[] = [];
  const spans: Observe.Span[] = [];
  const logs: Observe.Log[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, frames.board, frames.viewer];
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const scope = createScope({
    clock,
    observe: { export: (span) => void spans.push(span), log: (line) => void logs.push(line) },
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file }),
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
    ],
  });
  const server = await scope.ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, out, spans, logs, setupCode };
}

type Server = Awaited<ReturnType<typeof boot>>;

/** A client: an agent with a token, or a viewer's tab whose meta carries `held.pass`. */
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
    share: (canvas: string) => scope.run(frames.api["canvas.share"], { input: { canvas } }),
    put: (canvas: string, html: string, name: string) =>
      scope.run(frames.api["frame.put"], { input: { canvas, html, name } }),
    open: (link: string, name = "Bo") =>
      scope.run(frames.viewer["share.open"], { input: { link, name } }),
  };
}

/** Ann, the first owner, signed in, and her agent's client. */
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

/** A shared canvas `flow`: its link, from the path `canvas.share` answered. */
async function sharedFlow(srv: Server) {
  const a = await ann(srv);
  await a.newCanvas("flow");
  const shared = await a.share("flow");
  if (shared.kind !== "shared") throw new Error(`flow was not shared: ${shared.kind}`);

  return { a, path: shared.path, link: shared.path.slice("/s/".length) };
}

/** The fault a call ended in, and its payload; null when it answered. */
const faultOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: unknown) =>
      frames.api.fault.is(error) || frames.viewer.fault.is(error)
        ? { fault: error.fault, payload: error.payload }
        : { fault: "other", payload: String(error) },
  );

/** A tab's read of a canvas's frames, watched; its list and its last fault. */
function watchFrames(tab: Awaited<ReturnType<typeof client>>, canvas: string) {
  const list = tab.scope.resolve(frames.board.frames.where({ canvas }));
  closers.push(list.watch(() => undefined));
  const fault = () => {
    const error = tab.scope.resolve(frames.board.faults).get().frames;
    return frames.board.fault.is(error) ? { fault: error.fault, payload: error.payload } : null;
  };

  return { names: () => list.get().map((f) => f.name), fault };
}

const unknownLink = "0123456789abcdef0123456789abcdef";

// ---- Share a canvas (frames-share-open: "a user shares it (a new link)"; judged rules 11-12)

test("a user shares a canvas: a new link at /s/<link>; sharing it again keeps the link (SharingAgainKeepsTheLink)", async () => {
  const srv = await boot();
  const { a, path, link } = await sharedFlow(srv);
  await a.newCanvas("other");

  expect(path).toMatch(/^\/s\/[0-9a-f]{32}$/);
  expect(await a.share("flow")).toEqual({ kind: "shared", path });
  expect(await a.share("other")).not.toEqual({ kind: "shared", path });
  expect((await a.canvases()).canvases.map((c) => [c.key, c.shared])).toEqual([
    ["flow", true],
    ["other", true],
  ]);
  expect(link).not.toBe(path);
});

test("share on a canvas that is not there answers gone; a guest's share is refused, sign in", async () => {
  const srv = await boot();
  const a = await ann(srv);
  await a.newCanvas("flow");
  const guest = await client(srv.server);

  expect(await a.share("nope")).toEqual({ kind: "gone" });
  expect(await faultOf(guest.share("flow"))).toEqual({
    fault: "refused",
    payload: { signIn: true },
  });
  expect((await a.canvases()).canvases).toMatchObject([{ key: "flow", shared: false }]);
});

// ---- Open a share link (frames-share-open: "the viewer opens the live link"; viewer-gate-open)

test("the viewer opens the live link: open, with the canvas and a pass; an unknown link answers gone", async () => {
  const srv = await boot();
  const { link } = await sharedFlow(srv);
  const tab = await client(srv.server);

  const opened = await tab.open(link);
  expect(opened).toEqual({
    kind: "open",
    canvas: "flow",
    pass: expect.stringMatching(/^[0-9a-f]{32}$/),
  });
  expect(opened.kind === "open" && opened.pass).not.toBe(link);
  expect(await tab.open(unknownLink)).toEqual({ kind: "gone" });
  // Each open is its own pass.
  const again = await tab.open(link, "Cy");
  expect(again.kind === "open" && opened.kind === "open" && again.pass !== opened.pass).toBe(true);
});

test("a tab shows the canvas only while its link is live: a pass reads its canvas's frames, live (ATabShowsTheCanvasOnlyWhileItsLinkIsLive)", async () => {
  const srv = await boot();
  const { a, link } = await sharedFlow(srv);
  await a.put("flow", "<p>1</p>", "Home");
  const tab = await client(srv.server);
  const opened = await tab.open(link);
  tab.held.pass = opened.kind === "open" ? opened.pass : "";

  const read = watchFrames(tab, "flow");
  await until(() => read.names().length === 1);
  expect(read.names()).toEqual(["Home"]);

  await a.put("flow", "<p>2</p>", "Checkout");
  await until(() => read.names().length === 2);
  expect(read.names()).toEqual(["Home", "Checkout"]);
  expect(read.fault()).toBeNull();
});

test("mayRead: a pass reads only its own canvas; a made-up pass is refused ended; no pass and no token, sign in", async () => {
  const srv = await boot();
  const { a, link } = await sharedFlow(srv);
  await a.newCanvas("other");
  const tab = await client(srv.server);
  const opened = await tab.open(link);
  tab.held.pass = opened.kind === "open" ? opened.pass : "";
  const forged = await client(srv.server, { pass: "f".repeat(32) });
  const guest = await client(srv.server);

  const reads = [
    watchFrames(tab, "other"),
    watchFrames(forged, "flow"),
    watchFrames(guest, "flow"),
  ];
  await until(() => reads.every((read) => read.fault() !== null));
  expect(reads.map((read) => read.fault())).toEqual([
    { fault: "refused", payload: { ended: true } },
    { fault: "refused", payload: { ended: true } },
    { fault: "refused", payload: { signIn: true } },
  ]);
});

// ---- Bounds (SPEC-frames § Inputs, judged rule 14): the flood limit and the passes a link keeps

test("past 30 opens a minute from one address, any link, share.open answers slow until the minute has passed; another address opens", async () => {
  const srv = await boot();
  const { link } = await sharedFlow(srv);
  const flood = await client(srv.server, {}, "2001:db8:1:2::1");
  const sameBlock = await client(srv.server, {}, "2001:db8:1:2::beef");
  const other = await client(srv.server, {}, "203.0.113.9");

  for (let i = 0; i < 30; i++) {
    expect((await flood.open(unknownLink)).kind).toBe("gone");
  }
  // Any link counts, and the open has no password: it is still slowed, never locked out.
  expect(await flood.open(link)).toEqual({ kind: "slow", retryIn: 60_000 });
  // An IPv6 address is counted by its /64 (decision A8).
  expect(await sameBlock.open(link)).toEqual({ kind: "slow", retryIn: 60_000 });
  expect((await other.open(link)).kind).toBe("open");

  srv.clock.advance(59_999);
  expect(await flood.open(link)).toEqual({ kind: "slow", retryIn: 1 });
  srv.clock.advance(1);
  expect((await flood.open(link)).kind).toBe("open");
});

test(
  "a link keeps its 1000 newest passes: the next open ends the oldest, which is refused ended",
  { timeout: 30_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "easel-share-"));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "easel.db");
    const srv = await boot(file);
    const { a, link } = await sharedFlow(srv);
    await a.put("flow", "<p>1</p>", "Home");
    const oldest = await client(srv.server);
    const first = await oldest.open(link);
    oldest.held.pass = first.kind === "open" ? first.pass : "";
    // Another canvas's link, with one pass older than all of flow's: the trim leaves it.
    await a.newCanvas("side");
    await a.put("side", "<p>2</p>", "Side");
    const side = await a.share("side");
    const sideLink = side.kind === "shared" ? side.path.slice("/s/".length) : "";
    const sider = await client(srv.server);
    const sideOpen = await sider.open(sideLink);
    sider.held.pass = sideOpen.kind === "open" ? sideOpen.pass : "";

    // 999 later viewers, written straight into the table: the link now holds 1000 passes.
    const db = new Database(file);
    closers.push(() => db.close());
    const insert = db.query(
      "INSERT INTO frames_passes (digest, link, name, made) VALUES (?, ?, ?, ?)",
    );
    db.transaction(() => {
      for (let i = 1; i < 1000; i++) {
        insert.run(
          createHash("sha256").update(`later ${i}`).digest("hex"),
          link,
          "Cy",
          1_800_000_000_000 + i,
        );
      }
    })();
    const count = (of = link) =>
      db.query("SELECT count(*) AS n FROM frames_passes WHERE link = ?").get(of);
    expect(count()).toEqual({ n: 1000 });

    srv.clock.advance(60_000);
    const newest = await client(srv.server);
    const next = await newest.open(link);
    newest.held.pass = next.kind === "open" ? next.pass : "";
    expect(count()).toEqual({ n: 1000 });

    expect(count(sideLink)).toEqual({ n: 1 });

    const reads = [
      watchFrames(oldest, "flow"),
      watchFrames(newest, "flow"),
      watchFrames(sider, "side"),
    ];
    await until(
      () =>
        reads[0]?.fault() !== null &&
        reads[1]?.names().length === 1 &&
        reads[2]?.names().length === 1,
    );
    expect(reads[0]?.fault()).toEqual({ fault: "refused", payload: { ended: true } });
    expect(reads[1]?.names()).toEqual(["Home"]);
    expect(reads[2]?.names()).toEqual(["Side"]);
  },
);

// ---- Restart (decision C8; judged rule 11)

// Each write is fsynced (synchronous=FULL, decision C6): on a loaded disk, ~0.5 s.
test(
  "the link is kept readable, the pass only as its digest with the name; both survive a restart",
  { timeout: 30_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "easel-share-"));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "easel.db");
    const first = await boot(file);
    const { a, path, link } = await sharedFlow(first);
    await a.put("flow", "<p>1</p>", "Home");
    const tab = await client(first.server);
    const opened = await tab.open(link, "Bo");
    const pass = opened.kind === "open" ? opened.pass : "";
    await first.server.close();

    const db = new Database(file, { readonly: true });
    const passes = db.query("SELECT digest, link, name FROM frames_passes").all();
    const rows = JSON.stringify([passes, db.query("SELECT * FROM frames_links").all()]);
    db.close();
    expect(passes).toEqual([
      { digest: createHash("sha256").update(pass).digest("hex"), link, name: "Bo" },
    ]);
    expect(rows).toContain(link);
    expect(rows).not.toContain(pass);

    const second = await boot(file);
    const back = await client(second.server, { pass });
    const read = watchFrames(back, "flow");
    await until(() => read.names().length === 1);
    expect(read.names()).toEqual(["Home"]);

    const agent = await client(second.server, { token: a.held.token });
    expect((await agent.canvases()).canvases).toMatchObject([{ key: "flow", shared: true }]);
    expect(await agent.share("flow")).toEqual({ kind: "shared", path });
  },
);

// ---- Secrets (judged rule 15)

test("no link, pass or pass digest reaches a span, a log record, the console, or an invalid fault", async () => {
  const printed: unknown[] = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args) => void printed.push(args));
  }
  const srv = await boot();
  const { a, link } = await sharedFlow(srv);
  await a.put("flow", "<p>1</p>", "Home");
  const tab = await client(srv.server);
  const opened = await tab.open(link);
  const pass = opened.kind === "open" ? opened.pass : "";
  tab.held.pass = pass;
  const read = watchFrames(tab, "flow");
  await until(() => read.names().length === 1);
  await tab.open(unknownLink);
  // The client checks the input before it sends: its error names the field, not the value.
  const bad = await Promise.try(() => tab.open(`${link.slice(0, 31)}g`)).then(
    () => null,
    (error: unknown) => error,
  );
  const seen = `${JSON.stringify([srv.spans, srv.logs, bad])} ${String(bad)} ${srv.out.join("")} ${JSON.stringify(printed)}`;
  vi.restoreAllMocks();

  expect(String(bad)).toContain("DataValidationFailed");
  expect(srv.spans.length).toBeGreaterThan(0);
  for (const secret of [link, pass, createHash("sha256").update(pass).digest("hex"), unknownLink]) {
    expect(seen).not.toContain(secret);
  }
  expect(seen).not.toContain(link.slice(0, 31));
});

// ---- Inputs (SPEC-frames § Inputs; judged rule 11)

test("a viewer's name is 1 to 40 characters, trimmed; any other stops on the client", async () => {
  const srv = await boot();
  const { link } = await sharedFlow(srv);
  const tab = await client(srv.server);

  expect((await tab.open(link, "B")).kind).toBe("open");
  expect((await tab.open(link, "x".repeat(40))).kind).toBe("open");
  expect((await tab.open(link, ` ${"x".repeat(40)} `)).kind).toBe("open");
  for (const name of ["", "   ", "x".repeat(41)]) {
    const sent = await Promise.try(() => tab.open(link, name)).then(
      () => "sent",
      (error: unknown) => String(error),
    );
    expect(sent).toContain("DataValidationFailed");
  }
});

/** Each is 32 hex digits, and no digit is the same in all: fewer random bits, padded, would be. */
const expectRandom128 = (secrets: readonly string[]) => {
  for (const secret of secrets) expect(secret).toMatch(/^[0-9a-f]{32}$/);
  for (let digit = 0; digit < 32; digit++) {
    expect(new Set(secrets.map((x) => x[digit])).size, `digit ${digit}`).toBeGreaterThan(1);
  }
};

test("a link and a pass are each 128 random bits: 32 hex digits, every one of which varies", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const links: string[] = [];
  for (let i = 0; i < 10; i++) {
    await a.newCanvas(`c${i}`);
    const shared = await a.share(`c${i}`);
    links.push(shared.kind === "shared" ? shared.path.slice("/s/".length) : "");
  }
  const tab = await client(srv.server);
  const passes: string[] = [];
  for (const link of [...links, ...links]) {
    const opened = await tab.open(link);
    passes.push(opened.kind === "open" ? opened.pass : "");
  }

  expectRandom128(links);
  expectRandom128(passes);
});
