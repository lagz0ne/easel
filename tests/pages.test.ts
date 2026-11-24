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
import { userOps } from "@/access/users.server";
import { frames } from "@/frames";
import type { PutInput } from "@/frames/contract";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

async function until(ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) await tick();
  expect(ok()).toBe(true);
}

async function boot(file = ":memory:") {
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, frames.board];

  const server = await createScope({
    clock: makeTestClock({ now: 1_800_000_000_000 }),
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      memory.server({ services }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";
  return { server, setupCode };
}

async function client(server: Scope.Handle, token?: string) {
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
  return scope;
}

async function signedIn(srv: Awaited<ReturnType<typeof boot>>) {
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await client(srv.server);
  await login.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  return text;
}

function agentOn(scope: Scope.Handle) {
  const api = frames.api;
  return {
    scope,
    canvas: (name: string) => scope.run(api["canvas.create"], { input: { name } }),
    pages: (canvas = "flow") => scope.run(api["page.list"], { input: { canvas } }),
    newPage: (name: string, canvas = "flow") =>
      scope.run(api["page.create"], { input: { canvas, name } }),
    rename: (page: string, name: string, canvas = "flow") =>
      scope.run(api["page.rename"], { input: { canvas, page, name } }),
    order: (pages: string[], canvas = "flow") =>
      scope.run(api["page.order"], { input: { canvas, pages } }),
    dropPage: (page: string, canvas = "flow") =>
      scope.run(api["page.delete"], { input: { canvas, page } }),
    put: (input: PutInput) => scope.run(api["frame.put"], { input }),
    move: (input: { id: string; x: number; y: number; page?: string; canvas?: string }) =>
      scope.run(api["frame.move"], { input: { canvas: "flow", ...input } }),
    list: () => scope.run(api["frame.list"], { input: { canvas: "flow" } }),
    get: (id: string) => scope.run(api["frame.get"], { input: { canvas: "flow", id } }),
    rm: (id: string) => scope.run(api["frame.delete"], { input: { canvas: "flow", id } }),
  };
}

type Agent = ReturnType<typeof agentOn>;

async function easel(file?: string) {
  const srv = await boot(file);
  const token = await signedIn(srv);
  const agent = agentOn(await client(srv.server, token));
  return { srv, token, agent };
}

async function made(agent: Agent, more: Partial<{ page: string; x: number; y: number }> = {}) {
  const answer = await agent.put({
    canvas: "flow",
    html: "<p>a</p>",
    size: { w: 100, h: 50 },
    ...more,
  });
  if (answer.kind !== "created") throw new Error(`not created: ${answer.kind}`);
  return answer.id;
}

const notSent = (call: () => Promise<unknown>) =>
  Promise.resolve()
    .then(call)
    .then(
      () => "sent",
      (error: unknown) =>
        String(error).includes("DataValidationFailed") ? "not sent" : String(error),
    );

test("a new canvas has one page, Page 1, with no frames; a canvas that is not there is gone", async () => {
  const { agent } = await easel();
  await agent.canvas("flow");

  expect(await agent.pages()).toEqual({
    kind: "found",
    pages: [{ key: "page-1", name: "Page 1", frames: 0 }],
  });
  expect(await agent.pages("none")).toEqual({ kind: "gone" });
});

test("page.create adds a page at the end with the slug of its name as key; taken, full and gone", async () => {
  const { agent } = await easel();
  await agent.canvas("flow");

  expect(await agent.newPage("Foundations & Tokens")).toEqual({
    kind: "created",
    key: "foundations-tokens",
  });
  expect(await agent.newPage("foundations tokens")).toEqual({ kind: "taken" });
  expect(await agent.newPage("Page 2", "none")).toEqual({ kind: "gone" });
  expect(await agent.rename("page-1", "Read me")).toEqual({ kind: "renamed" });
  expect(await agent.newPage("READ ME")).toEqual({ kind: "taken" });
  expect(await agent.newPage("Page 1")).toEqual({ kind: "taken" });

  for (let n = 3; n <= 50; n++) {
    expect(await agent.newPage(`Page ${n}`)).toMatchObject({ kind: "created" });
  }
  expect(await agent.newPage("One more")).toEqual({ kind: "full" });
  const listed = await agent.pages();
  expect(listed.kind === "found" && listed.pages.length).toBe(50);
  expect(listed.kind === "found" && listed.pages.slice(0, 3).map((p) => p.key)).toEqual([
    "page-1",
    "foundations-tokens",
    "page-3",
  ]);
  expect(await notSent(() => agent.newPage("--"))).toBe("not sent");
  expect(await notSent(() => agent.newPage("x".repeat(81)))).toBe("not sent");
});

test("page.rename changes the name only: the key stays; a name of another page is taken", async () => {
  const { agent } = await easel();
  await agent.canvas("flow");
  await agent.newPage("Patterns");

  expect(await agent.rename("page-1", "Read me")).toEqual({ kind: "renamed" });
  expect(await agent.rename("page-1", "READ ME")).toEqual({ kind: "renamed" });
  expect(await agent.rename("page-1", "patterns")).toEqual({ kind: "taken" });
  expect(await agent.rename("nope", "Other")).toEqual({ kind: "gone" });
  expect(await agent.pages()).toEqual({
    kind: "found",
    pages: [
      { key: "page-1", name: "READ ME", frames: 0 },
      { key: "patterns", name: "Patterns", frames: 0 },
    ],
  });
});

test("page.order puts the named pages first, in that order, and the others after them as they were; a key not there is gone", async () => {
  const { agent } = await easel();
  await agent.canvas("flow");
  for (const name of ["B", "C", "D"]) await agent.newPage(name);

  expect(await agent.order(["d", "b"])).toEqual({ kind: "ordered" });
  const keys = async () => {
    const listed = await agent.pages();
    return listed.kind === "found" ? listed.pages.map((p) => p.key) : [];
  };
  expect(await keys()).toEqual(["d", "b", "page-1", "c"]);
  expect(await agent.order(["c", "x"])).toEqual({ kind: "gone" });
  expect(await agent.order(["c"], "none")).toEqual({ kind: "gone" });
  expect(await keys()).toEqual(["d", "b", "page-1", "c"]);
});

test("page.delete removes an empty page; a page with frames is notEmpty with the count, the last page is last, and a page not there is gone", async () => {
  const { agent } = await easel();
  await agent.canvas("flow");

  expect(await agent.dropPage("page-1")).toEqual({ kind: "last" });
  await agent.newPage("Two");
  await made(agent, { page: "two" });
  await made(agent, { page: "two" });
  expect(await agent.dropPage("two")).toEqual({ kind: "notEmpty", frames: 2 });
  expect(await agent.dropPage("page-1")).toEqual({ kind: "deleted" });
  expect(await agent.dropPage("page-1")).toEqual({ kind: "gone" });
  expect(await agent.pages()).toEqual({
    kind: "found",
    pages: [{ key: "two", name: "Two", frames: 2 }],
  });
});

test("a put places a new frame on its page at x, y; with no place, right of the frames of its page at y 0; a page not there is gone", async () => {
  const { agent } = await easel();
  await agent.canvas("flow");
  await agent.newPage("Two");

  const a = await made(agent);
  const b = await made(agent, { page: "two", x: 500, y: 700 });
  const c = await made(agent, { page: "two" });
  const d = await made(agent, { page: "two", y: 40 });
  const e = await made(agent);
  expect(await agent.put({ canvas: "flow", html: "<p>x</p>", page: "nope" })).toEqual({
    kind: "gone",
  });
  expect(await notSent(() => made(agent, { x: 100_001 }))).toBe("not sent");
  expect(await notSent(() => made(agent, { x: 1.5 }))).toBe("not sent");

  const listed = await agent.list();
  const at = (id: string) =>
    listed.kind === "found" ? listed.frames.find((f) => f.id === id) : undefined;
  expect(at(a)).toMatchObject({ page: "page-1", x: 0, y: 0 });
  expect(at(b)).toMatchObject({ page: "two", x: 500, y: 700 });
  expect(at(c)).toMatchObject({ page: "two", x: 680, y: 0 });
  expect(at(d)).toMatchObject({ page: "two", x: 860, y: 40 });
  expect(at(e)).toMatchObject({ page: "page-1", x: 180, y: 0 });
  expect(await agent.get(b)).toMatchObject({ frame: { page: "two", x: 500, y: 700 } });
});

test("a move changes the place and the page and writes no version; the same place is unchanged; a frame, a page or a canvas not there is gone", async () => {
  const { agent } = await easel();
  await agent.canvas("flow");
  await agent.newPage("Two");
  const id = await made(agent);

  expect(await agent.move({ id, x: 40, y: 60 })).toEqual({
    kind: "moved",
    layout: expect.any(Object),
  });
  expect(await agent.move({ id, x: 40, y: 60 })).toEqual({
    kind: "unchanged",
    layout: expect.any(Object),
  });
  expect(await agent.move({ id, x: 40, y: 60, page: "page-1" })).toEqual({
    kind: "unchanged",
    layout: expect.any(Object),
  });
  expect(await agent.move({ id, x: 0, y: 0, page: "two" })).toEqual({
    kind: "moved",
    layout: expect.any(Object),
  });
  expect(await agent.move({ id, x: 0, y: 0, page: "nope" })).toEqual({ kind: "gone" });
  expect(await agent.move({ id: "0123456789ab", x: 0, y: 0 })).toEqual({ kind: "gone" });
  expect(await agent.move({ id, x: 0, y: 0, canvas: "none" })).toEqual({ kind: "gone" });
  expect(await notSent(() => agent.move({ id, x: -1, y: 0 }))).toBe("not sent");

  expect(await agent.get(id)).toMatchObject({ frame: { page: "two", x: 0, y: 0, version: 1 } });
  expect(await agent.pages()).toEqual({
    kind: "found",
    pages: [
      { key: "page-1", name: "Page 1", frames: 0 },
      { key: "two", name: "Two", frames: 1 },
    ],
  });
});

test("the board: a tab reads the frames of one page; a move to another page leaves one part and comes in the other; the pages cell has the counts", async () => {
  const { srv, token, agent } = await easel();
  await agent.canvas("flow");
  await agent.newPage("Two");
  const id = await made(agent);
  const stays = await made(agent, { page: "two" });

  const tab = await client(srv.server, token);
  const one = tab.resolve(frames.board.frames.where({ canvas: "flow", page: "page-1" }));
  const two = tab.resolve(frames.board.frames.where({ canvas: "flow", page: "two" }));
  const list = tab.resolve(frames.board.pages.where({ canvas: "flow" }));
  const stops = [one.watch(() => {}), two.watch(() => {}), list.watch(() => {})];
  closers.push(() => stops.forEach((stop) => stop()));
  const counts = () =>
    list
      .get()
      .toSorted((a, b) => a.order - b.order)
      .map((p) => `${p.key}:${p.frames}`);

  await until(() => one.get().length === 1 && two.get().length === 1 && list.get().length === 2);
  expect(one.get()).toMatchObject([{ id, page: "page-1", x: 0, version: 1 }]);
  expect(counts()).toEqual(["page-1:1", "two:1"]);

  await agent.move({ id, x: 300, y: 20 });
  await until(() => one.get()[0]?.x === 300);
  expect(one.get()).toMatchObject([{ id, x: 300, y: 20, version: 1 }]);

  await agent.move({ id, x: 0, y: 900, page: "two" });
  await until(() => one.get().length === 0 && two.get().length === 2);
  expect(
    two
      .get()
      .map((f) => f.id)
      .toSorted(),
  ).toEqual([id, stays].toSorted());
  await until(() => counts().join() === "page-1:0,two:2");

  await agent.rm(stays);
  await until(() => two.get().length === 1 && counts().join() === "page-1:0,two:1");
  await agent.rename("two", "Second");
  await until(() => list.get().some((p) => p.name === "Second"));
  await agent.newPage("Three");
  await until(() => list.get().length === 3);
  await agent.dropPage("three");
  await until(() => list.get().length === 2);
});

test("fact rules 1 and 3: after puts, moves and deletes, each frame is on exactly one page of its canvas, and the canvas has a page", async () => {
  const { srv, agent } = await easel();
  await agent.canvas("flow");
  for (const name of ["Two", "Three"]) await agent.newPage(name);
  const ids = [await made(agent), await made(agent, { page: "two" }), await made(agent)];
  await agent.move({ id: ids[0] ?? "", x: 1, y: 1, page: "three" });
  await agent.move({ id: ids[1] ?? "", x: 2, y: 2, page: "page-1" });
  await agent.rm(ids[2] ?? "");
  await agent.dropPage("two");

  const rows = await srv.server.run(
    operation({
      label: "test.pageRows",
      depends: { connection: bunSqlite.connection },
      run: async ({ connection }) => ({
        frames: connection.db.$client
          .query(
            `SELECT f.id, (SELECT COUNT(*) FROM frames_pages p WHERE p.canvas = f.canvas AND p.key = f.page) AS n
             FROM frames_frames f`,
          )
          .all(),
        pages: connection.db.$client
          .query(
            "SELECT c.key, (SELECT COUNT(*) FROM frames_pages p WHERE p.canvas = c.key) AS n FROM frames_canvases c",
          )
          .all(),
      }),
    }),
  );
  expect(rows.frames).toHaveLength(2);
  expect(rows.frames.every((row) => JSON.stringify(row).endsWith('"n":1}'))).toBe(true);
  expect(rows.pages).toEqual([{ key: "flow", n: 2 }]);
});

test("a canvas and its frames made before pages are on the first page after a restart, and each frame stays", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-pages-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "easel.db");
  const first = await easel(file);
  await first.agent.canvas("flow");
  const kept = [await made(first.agent), await made(first.agent)];
  const dropped = await made(first.agent);
  await first.agent.rm(dropped);
  for (const close of closers.splice(1).reverse()) await close();

  const db = new Database(file);
  db.exec("DROP TABLE frames_pages");
  db.exec("DROP INDEX IF EXISTS frames_frames_page");
  db.exec("ALTER TABLE frames_frames DROP COLUMN page");
  db.exec("ALTER TABLE frames_removed DROP COLUMN page");
  db.close();

  const srv = await boot(file);
  const agent = agentOn(await client(srv.server, first.token));
  expect(await agent.pages()).toEqual({
    kind: "found",
    pages: [{ key: "page-1", name: "Page 1", frames: 2 }],
  });
  const listed = await agent.list();
  expect(listed.kind === "found" && listed.frames.map((f) => [f.id, f.page])).toEqual(
    kept.map((id) => [id, "page-1"]),
  );
  const tab = await client(srv.server, first.token);
  const gone = tab.resolve(frames.board.removed.of({ canvas: "flow", id: dropped }));
  const stop = gone.watch(() => {});
  closers.push(stop);
  await until(() => gone.get() !== undefined);
  expect(gone.get()).toMatchObject({ page: "page-1" });
}, 60_000);
