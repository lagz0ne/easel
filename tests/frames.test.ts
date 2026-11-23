import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { maxDocBytes, socketMaxPayload } from "@/frames/contract";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";

import { listen, wsClient, wsServer } from "./support/ws";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 30) => new Promise((done) => setTimeout(done, ms));

async function until(ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) await tick(20);
  expect(ok()).toBe(true);
}

type Boot = { file?: string; clock?: ReturnType<typeof makeTestClock> };

async function boot(options: Boot = {}) {
  const clock = options.clock ?? makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, frames.board];
  const transport = wsServer.server({ path: "/rpc", services, maxPayload: socketMaxPayload });
  const scope = createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: options.file ?? ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      transport,
      memory.server({ services }),
    ],
  });
  const server = await scope.ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, out, transport, setupCode };
}

type Server = Awaited<ReturnType<typeof boot>>;

async function agent(server: Scope.Handle, token?: string) {
  const meta = operation({
    label: "test.meta",
    run: async (): Promise<Record<string, string>> =>
      token ? { authorization: `Bearer ${token}` } : {},
  });
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: server, headers: { "x-easel-peer": "198.51.100.1" }, meta }),
      access.login({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      frames.board({ read: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return { scope, ...calls(scope) };
}

function calls(scope: Scope.Handle) {
  return {
    newCanvas: (name: string) => scope.run(frames.api["canvas.create"], { input: { name } }),
    canvases: () => scope.run(frames.api["canvas.list"], { input: null }),
    put: (input: PutInput) => scope.run(frames.api["frame.put"], { input }),
    list: (canvas: string) => scope.run(frames.api["frame.list"], { input: { canvas } }),
    get: (canvas: string, id: string) =>
      scope.run(frames.api["frame.get"], { input: { canvas, id } }),
    rm: (canvas: string, id: string) =>
      scope.run(frames.api["frame.delete"], { input: { canvas, id } }),
  };
}

type PutInput =
  | { canvas: string; html: string; name?: string; size?: { w: number; h: number } }
  | { canvas: string; html: string; id: string; base: number };

async function signedIn(srv: Server) {
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await agent(srv.server);
  const answer = await login.scope.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  expect(answer.kind).toBe("granted");
  await login.scope.close();

  return text;
}

async function twoAgents(options: Boot = {}) {
  const srv = await boot(options);
  const token = await signedIn(srv);
  const a = await agent(srv.server, token);
  const b = await agent(srv.server, token);

  return { srv, token, a, b };
}

const faultOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: unknown) =>
      frames.api.fault.is(error)
        ? { fault: error.fault, payload: error.payload }
        : { fault: "other", payload: String(error) },
  );

const notSent = (call: () => Promise<unknown>) =>
  Promise.resolve()
    .then(call)
    .then(
      () => "sent",
      (error: unknown) =>
        String(error).includes("DataValidationFailed") ? "not sent" : String(error),
    );

async function newFrame(a: Awaited<ReturnType<typeof agent>>, canvas: string, html: string) {
  const made = await a.put({ canvas, html });
  if (made.kind !== "created") throw new Error(`not created: ${made.kind}`);

  return made.id;
}

test("an agent makes the canvas: its key is the name's slug, and canvas ls lists it", async () => {
  const { srv, a } = await twoAgents();

  expect(await a.newCanvas("  Checkout Flow!! v2 ")).toEqual({
    kind: "created",
    key: "checkout-flow-v2",
  });
  expect(await a.canvases()).toEqual({
    canvases: [
      {
        key: "checkout-flow-v2",
        name: "Checkout Flow!! v2",
        created: srv.clock.currentTimeMillis(),
        shared: false,
      },
    ],
  });
  expect(await a.list("checkout-flow-v2")).toEqual({ kind: "found", frames: [] });
});

test("a second canvas with the same key answers taken, and changes nothing", async () => {
  const { srv, a, b } = await twoAgents();
  await a.newCanvas("Checkout");
  const before = await a.canvases();
  srv.clock.advance(1000);

  expect(await b.newCanvas("checkout")).toEqual({ kind: "taken" });
  expect(await a.canvases()).toEqual(before);
});

test("a name with no letter or digit is invalid and is not sent, and a key is cut at 40 with no dash at its end", async () => {
  const { a } = await twoAgents();

  expect(await notSent(() => a.newCanvas("!!! ---"))).toBe("not sent");
  expect(await notSent(() => a.newCanvas("   "))).toBe("not sent");
  expect(await a.canvases()).toEqual({ canvases: [] });
  expect(await a.newCanvas(`${"a".repeat(39)} b`)).toEqual({
    kind: "created",
    key: "a".repeat(39),
  });
  expect(await a.canvases()).toMatchObject({ canvases: [{ key: "a".repeat(39) }] });
});

test("an agent puts a new frame: version 1, the first at 0,0, each next right of the rightmost by 80", async () => {
  const { a } = await twoAgents();
  await a.newCanvas("flow");
  const first = await a.put({
    canvas: "flow",
    html: "<p>1</p>",
    name: "home",
    size: { w: 390, h: 844 },
  });
  expect(first).toMatchObject({ kind: "created", version: 1 });
  const second = await a.put({ canvas: "flow", html: "<p>2</p>" });
  const third = await a.put({ canvas: "flow", html: "<p>3</p>", size: { w: 100, h: 100 } });

  expect(await a.list("flow")).toEqual({
    kind: "found",
    frames: [
      {
        id: first.kind === "created" ? first.id : "",
        name: "home",
        page: "page-1",
        x: 0,
        y: 0,
        w: 390,
        h: 844,
        version: 1,
        status: "exploring",
      },
      {
        id: second.kind === "created" ? second.id : "",
        name: "untitled",
        page: "page-1",
        x: 470,
        y: 0,
        w: 1440,
        h: 900,
        version: 1,
        status: "exploring",
      },
      {
        id: third.kind === "created" ? third.id : "",
        name: "untitled",
        page: "page-1",
        x: 1990,
        y: 0,
        w: 100,
        h: 100,
        version: 1,
        status: "exploring",
      },
    ],
  });
});

test("a new frame on a canvas that is not there answers gone, and makes nothing", async () => {
  const { a } = await twoAgents();
  expect(await a.put({ canvas: "nowhere", html: "<p/>" })).toEqual({ kind: "gone" });
  expect(await a.list("nowhere")).toEqual({ kind: "gone" });
});

test("a put on the current version saves a new document, and raises the version by one", async () => {
  const { a } = await twoAgents();
  await a.newCanvas("flow");
  const id = await newFrame(a, "flow", "<p>1</p>");

  expect(await a.put({ canvas: "flow", id, base: 1, html: "<p>2</p>" })).toEqual({
    kind: "updated",
    id,
    version: 2,
    findings: [],
    more: 0,
  });
  expect(await a.put({ canvas: "flow", id, base: 2, html: "<p>3</p>" })).toEqual({
    kind: "updated",
    id,
    version: 3,
    findings: [],
    more: 0,
  });
  expect(await a.get("flow", id)).toEqual({
    kind: "found",
    frame: {
      id,
      name: "untitled",
      page: "page-1",
      x: 0,
      y: 0,
      w: 1440,
      h: 900,
      version: 3,
      status: "exploring",
      html: "<p>3</p>",
    },
  });
});

test("TheVersionGoesUpOnlyWhenTheDocumentChanges: the same document answers unchanged, and the version stays", async () => {
  const { a } = await twoAgents();
  await a.newCanvas("flow");
  const id = await newFrame(a, "flow", "<p>1</p>");

  expect(await a.put({ canvas: "flow", id, base: 1, html: "<p>1</p>" })).toEqual({
    kind: "unchanged",
    id,
    version: 1,
    findings: [],
    more: 0,
  });
  expect(await a.get("flow", id)).toMatchObject({ frame: { version: 1, html: "<p>1</p>" } });
});

test("a put on an old version answers stale, nothing written", async () => {
  const { a, b } = await twoAgents();
  await a.newCanvas("flow");
  const id = await newFrame(a, "flow", "<p>1</p>");
  await a.put({ canvas: "flow", id, base: 1, html: "<p>a</p>" });

  expect(await b.put({ canvas: "flow", id, base: 1, html: "<p>b</p>" })).toEqual({
    kind: "stale",
    id,
    version: 2,
  });
  expect(await b.put({ canvas: "flow", id, base: 1, html: "<p>a</p>" })).toEqual({
    kind: "stale",
    id,
    version: 2,
  });
  expect(await a.get("flow", id)).toMatchObject({ frame: { version: 2, html: "<p>a</p>" } });
  expect(await a.list("flow")).toMatchObject({ frames: [{ id, version: 2 }] });
});

test("AWriteOnAnOldVersionIsNeverSaved: of two puts on one version at once, one saves and one answers stale", async () => {
  const { a, b } = await twoAgents();
  await a.newCanvas("flow");
  const id = await newFrame(a, "flow", "<p>1</p>");

  for (let round = 1; round <= 5; round++) {
    const [one, two] = await Promise.all([
      a.put({ canvas: "flow", id, base: round, html: `<p>a${round}</p>` }),
      b.put({ canvas: "flow", id, base: round, html: `<p>b${round}</p>` }),
    ]);
    const kinds = [one.kind, two.kind].toSorted();
    expect(kinds).toEqual(["stale", "updated"]);
    const won = one.kind === "updated" ? `<p>a${round}</p>` : `<p>b${round}</p>`;
    expect(await a.get("flow", id)).toMatchObject({ frame: { version: round + 1, html: won } });
  }
});

test("the agent gets the frame again, and a put on that version saves", async () => {
  const { a, b } = await twoAgents();
  await a.newCanvas("flow");
  const id = await newFrame(a, "flow", "<p>1</p>");
  await a.put({ canvas: "flow", id, base: 1, html: "<p>a</p>" });
  const got = await b.get("flow", id);
  if (got.kind !== "found") throw new Error("not found");

  if (!("html" in got.frame)) throw new Error("not an HTML frame");
  expect(
    await b.put({ canvas: "flow", id, base: got.frame.version, html: `${got.frame.html}<p>b</p>` }),
  ).toEqual({ kind: "updated", id, version: 3, findings: [], more: 0 });
});

test("APutOnAnIdNeverMakesAFrame: a put on an id that is not there answers gone", async () => {
  const { a } = await twoAgents();
  await a.newCanvas("flow");

  expect(await a.put({ canvas: "flow", id: "0123456789ab", base: 1, html: "<p/>" })).toEqual({
    kind: "gone",
  });
  expect(await a.get("flow", "0123456789ab")).toEqual({ kind: "gone" });
  expect(await a.list("flow")).toEqual({ kind: "found", frames: [] });
});

test("an id without base, base without an id, or name or size with an id is invalid, and is not sent (C5)", async () => {
  const { a } = await twoAgents();
  await a.newCanvas("flow");
  const id = await newFrame(a, "flow", "<p>1</p>");
  const noBase = { canvas: "flow", html: "x", id };
  const noId = { canvas: "flow", html: "x", base: 1 };
  const named = { canvas: "flow", html: "x", id, base: 1, name: "n" };
  const sized = { canvas: "flow", html: "x", id, base: 1, size: { w: 1, h: 1 } };
  for (const input of [noBase, noId, named, sized]) {
    expect(await notSent(() => a.put(input))).toBe("not sent");
  }

  expect(await a.get("flow", id)).toMatchObject({ frame: { version: 1, html: "<p>1</p>" } });
});

test("an agent deletes the frame: it stays deleted, and a later put or get answers gone", async () => {
  const { a, b } = await twoAgents();
  await a.newCanvas("flow");
  const id = await newFrame(a, "flow", "<p>1</p>");
  const keep = await newFrame(a, "flow", "<p>2</p>");

  expect(await a.rm("flow", id)).toEqual({ kind: "deleted" });
  expect(await b.rm("flow", id)).toEqual({ kind: "gone" });
  expect(await b.get("flow", id)).toEqual({ kind: "gone" });
  expect(await b.put({ canvas: "flow", id, base: 1, html: "<p>back</p>" })).toEqual({
    kind: "gone",
  });
  expect(await b.get("flow", id)).toEqual({ kind: "gone" });
  expect(await a.list("flow")).toMatchObject({ kind: "found", frames: [{ id: keep }] });
});

test("frame.get and frame.list answer gone for a canvas or frame that is not there", async () => {
  const { a } = await twoAgents();
  expect(await a.get("nowhere", "0123456789ab")).toEqual({ kind: "gone" });
  expect(await a.list("nowhere")).toEqual({ kind: "gone" });
  expect(await a.rm("nowhere", "0123456789ab")).toEqual({ kind: "gone" });
});

const sql = (srv: Server, text: string) =>
  srv.server.run(
    operation({
      label: "test.sql",
      depends: { connection: bunSqlite.connection },
      run: async ({ connection }) => connection.db.$client.run(text),
    }),
  );

test("a write the database aborts faults the call, and the row and the cell stay as they were", async () => {
  const { srv, a } = await twoAgents();
  await a.newCanvas("flow");
  const id = await newFrame(a, "flow", "<p>1</p>");
  await sql(
    srv,
    "CREATE TRIGGER no_write BEFORE UPDATE ON frames_frames BEGIN SELECT RAISE(ABORT, 'no'); END",
  );

  expect(await faultOf(a.put({ canvas: "flow", id, base: 1, html: "<p>2</p>" }))).toMatchObject({
    fault: "failed",
  });
  expect(await a.list("flow")).toMatchObject({ frames: [{ id, version: 1 }] });
  expect(await a.get("flow", id)).toMatchObject({ frame: { version: 1, html: "<p>1</p>" } });
});

test("a row that does not parse after its write rolls the write back, and the call faults, not stale", async () => {
  const { srv, a } = await twoAgents();
  await a.newCanvas("flow");
  const id = await newFrame(a, "flow", "<p>1</p>");
  await sql(srv, `UPDATE frames_frames SET x = 'left' WHERE id = '${id}'`);

  expect(await faultOf(a.put({ canvas: "flow", id, base: 1, html: "<p>2</p>" }))).toMatchObject({
    fault: "failed",
  });
  const [kept] = await srv.server.run(
    operation({
      label: "test.row",
      depends: { connection: bunSqlite.connection },
      run: async ({ connection }) =>
        connection.db.$client.query("SELECT version, html FROM frames_frames").all(),
    }),
  );
  expect(kept).toEqual({ version: 1, html: "<p>1</p>" });
  expect(await a.list("flow")).toMatchObject({ frames: [{ id, version: 1 }] });
});

test("a document over 1 MiB of UTF-8 answers tooBig and writes nothing; 1 MiB itself saves", async () => {
  const { a } = await twoAgents();
  await a.newCanvas("flow");
  const wide = "é".repeat(600_000);
  expect(wide.length).toBeLessThan(maxDocBytes);
  expect(await a.put({ canvas: "flow", html: wide })).toEqual({
    kind: "tooBig",
    maxBytes: maxDocBytes,
  });
  expect(await a.list("flow")).toEqual({ kind: "found", frames: [] });

  const id = await newFrame(a, "flow", "x".repeat(maxDocBytes));
  expect(await a.put({ canvas: "flow", id, base: 1, html: wide })).toEqual({
    kind: "tooBig",
    maxBytes: maxDocBytes,
  });
  expect(await a.get("flow", id)).toMatchObject({ frame: { version: 1 } });
});

test("the board shows the stored version, never goes back, and drops a deleted frame", async () => {
  const { srv, token, a, b } = await twoAgents();
  await a.newCanvas("flow");
  const id = await newFrame(a, "flow", "<p>1</p>");
  const tab = await agent(srv.server, token);
  const doc = tab.scope.resolve(frames.board.docs.of({ canvas: "flow", id }));
  const list = tab.scope.resolve(frames.board.frames.where({ canvas: "flow" }));
  const seen: number[] = [];
  const stops = [
    doc.watch(() => {
      const version = doc.get()?.version;
      if (version !== undefined) seen.push(version);
    }),
    list.watch(() => undefined),
  ];
  closers.push(() => stops.forEach((stop) => stop()));

  await until(() => doc.get()?.html === "<p>1</p>");
  expect(list.get()).toMatchObject([{ id, version: 1 }]);

  await a.put({ canvas: "flow", id, base: 1, html: "<p>2</p>" });
  await b.put({ canvas: "flow", id, base: 1, html: "<p>stale</p>" });
  await b.put({ canvas: "flow", id, base: 2, html: "<p>3</p>" });
  await until(() => doc.get()?.version === 3);
  expect(doc.get()).toMatchObject({ canvas: "flow", id, version: 3, html: "<p>3</p>" });
  expect(list.get()).toMatchObject([{ id, version: 3 }]);
  expect(seen).toEqual(seen.toSorted((x, y) => x - y));
  expect(seen).not.toContain(4);

  await a.rm("flow", id);
  await until(() => doc.get() === undefined && list.get().length === 0);
});

test("a call or a board read with no user token is refused, sign in", async () => {
  const srv = await boot();
  await signedIn(srv);
  const guest = await agent(srv.server);
  const forged = await agent(srv.server, "not-a-token");

  expect(await faultOf(guest.newCanvas("flow"))).toEqual({
    fault: "refused",
    payload: { signIn: true },
  });
  expect(await faultOf(forged.canvases())).toEqual({ fault: "refused", payload: { signIn: true } });

  const list = guest.scope.resolve(frames.board.frames.where({ canvas: "flow" }));
  const stop = list.watch(() => undefined);
  closers.push(stop);
  await until(() => guest.scope.resolve(frames.board.faults).get().frames !== undefined);
  const error = guest.scope.resolve(frames.board.faults).get().frames;
  expect(frames.board.fault.is(error) && error.fault).toBe("refused");
  expect(list.get()).toEqual([]);
});

test("after a restart, canvases, frames and versions are as stored, synchronous is FULL, and a bad row is skipped", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-frames-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "easel.db");
  const first = await twoAgents({ file });
  await first.a.newCanvas("flow");
  const id = await newFrame(first.a, "flow", "<p>1</p>");
  await first.a.put({ canvas: "flow", id, base: 1, html: "<p>2</p>" });
  await first.a.scope.close();
  await first.b.scope.close();
  await first.srv.server.close();

  const raw = new Database(file);
  raw.run(
    "INSERT INTO frames_frames (canvas, id, name, x, y, w, h, version, html, made) VALUES ('flow', 'bad', 'b', 'x', 0, 1, 1, 1, '', 0)",
  );
  raw.close();

  const second = await boot({ file });
  expect(second.out.join("")).toContain("frames: skipped 1 rows that do not parse");
  const pragma = await second.server.run(
    operation({
      label: "test.synchronous",
      depends: { connection: bunSqlite.connection },
      run: async ({ connection }) => connection.db.$client.query("PRAGMA synchronous").get(),
    }),
  );
  expect(pragma).toEqual({ synchronous: 2 });
  const a = await agent(second.server, first.token);
  expect(await a.canvases()).toMatchObject({ canvases: [{ key: "flow" }] });
  expect(await a.list("flow")).toMatchObject({ kind: "found", frames: [{ id, version: 2 }] });
  expect(await a.get("flow", id)).toMatchObject({ frame: { version: 2, html: "<p>2</p>" } });
  expect(await a.put({ canvas: "flow", id, base: 1, html: "<p>old</p>" })).toEqual({
    kind: "stale",
    id,
    version: 2,
  });
}, 60_000);

test("over a real socket, a document a little over 1 MiB answers tooBig, not a closed socket", async () => {
  const srv = await boot();
  const token = await signedIn(srv);
  const { bun, url } = listen(srv.server, [srv.transport]);
  closers.push(() => bun.stop(true));
  const meta = operation({
    label: "test.bearer",
    run: async (): Promise<Record<string, string>> => ({ authorization: `Bearer ${token}` }),
  });
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      wsClient.client({ url: `${url}/rpc`, meta }),
      frames.api({ remote: wsClient.client }),
    ],
  }).ready;
  closers.push(() => scope.close());
  const ws = calls(scope);

  await ws.newCanvas("flow");
  expect(await ws.put({ canvas: "flow", html: "x".repeat(maxDocBytes + 4096) })).toEqual({
    kind: "tooBig",
    maxBytes: maxDocBytes,
  });
  const id = await (async () => {
    const made = await ws.put({ canvas: "flow", html: "x".repeat(maxDocBytes) });
    return made.kind === "created" ? made.id : "";
  })();
  expect(await ws.get("flow", id)).toMatchObject({ kind: "found", frame: { version: 1 } });
});
