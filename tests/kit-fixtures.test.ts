import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, isError, operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { kit } from "@/kit";
import { maxFixturesBytes } from "@/kit/fixtures";
import { kitOps } from "@/kit/ops.server";
import { readKit, readKitAt, saveFixtures } from "@/kit/store.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

async function until(ok: () => boolean) {
  for (let i = 0; i < 150 && !ok(); i++) await tick();
  expect(ok()).toBe(true);
}

async function boot(file = ":memory:") {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, frames.board, kit.api];
  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      kit.api({ implement: kitOps, onStart: [user] }),
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
      kit.api({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return scope;
}

async function easel() {
  const srv = await boot();
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await client(srv.server);
  await login.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  const agent = await client(srv.server, text);
  await agent.run(frames.api["canvas.create"], { input: { name: "flow" } });

  return { srv, token: text, agent };
}

const list = (agent: Scope.Handle) => agent.run(kit.api["fixtures.list"], { input: {} });

const set = (agent: Scope.Handle, cell: string, fixtures: Record<string, unknown>, base?: number) =>
  agent.run(kit.api["fixtures.set"], {
    input: base === undefined ? { cell, fixtures } : { cell, fixtures, base },
  });

const people = { empty: [], one: [{ id: "a", name: "Ann" }] };

test("X10 fixtures: a new easel has no fixtures at revision 1; fixtures.set writes a new kit version, fixtures.list has it, and the board kit of each canvas carries it", async () => {
  const { srv, token, agent } = await easel();
  expect(await list(agent)).toEqual({ kind: "found", kit: 1, rev: 1, cells: [], fixtures: {} });
  const tab = await client(srv.server, token);
  const cell = tab.resolve(frames.board.kit.of({ canvas: "flow" }));
  closers.push(cell.watch(() => undefined));
  await until(() => cell.get()?.kit === 1);

  expect(await set(agent, "people.list", people, 1)).toEqual({ kind: "updated", rev: 2, kit: 2 });
  expect(await list(agent)).toEqual({
    kind: "found",
    kit: 2,
    rev: 2,
    cells: [{ label: "people.list", names: ["empty", "one"] }],
    fixtures: { "people.list": people },
  });
  await until(() => cell.get()?.kit === 2);
  expect(cell.get()?.fixtures).toEqual({ "people.list": people });

  expect(await set(agent, "people.list", { many: [1, 2, 3], empty: null })).toEqual({
    kind: "updated",
    rev: 3,
    kit: 3,
  });
  expect((await list(agent)).fixtures).toEqual({
    "people.list": { one: people.one, many: [1, 2, 3] },
  });
  expect(await set(agent, "people.list", { one: null, many: null })).toMatchObject({ rev: 4 });
  expect(await list(agent)).toMatchObject({ cells: [], fixtures: {} });
});

test("X10 fixtures: the same fixtures again are unchanged and write no kit version; an old base is stale, and nothing is written", async () => {
  const { srv, agent } = await easel();
  await set(agent, "people.list", people);

  expect(await set(agent, "people.list", { one: people.one }, 2)).toEqual({
    kind: "unchanged",
    rev: 2,
    kit: 2,
  });
  expect(await set(agent, "people.list", { empty: [1] }, 1)).toEqual({
    kind: "stale",
    rev: 2,
    kit: 2,
  });
  expect(await srv.server.run(saveFixtures, { input: { fixtures: {}, base: 1 } })).toEqual({
    kind: "stale",
    rev: 2,
    kit: 2,
  });
  expect((await srv.server.run(readKit))?.fixtures).toEqual({ "people.list": people });
});

test("X10 fixtures: fixtures over 256 KiB are tooBig, and nothing is written; a bad name or cell label is refused at the door", async () => {
  const { srv, agent } = await easel();
  const big = "x".repeat(maxFixturesBytes);

  expect(await set(agent, "people.list", { many: big })).toEqual({
    kind: "tooBig",
    maxBytes: maxFixturesBytes,
  });
  expect((await srv.server.run(readKit))?.version).toBe(1);
  const bad = await Promise.try(() =>
    agent.run(kit.api["fixtures.set"], { input: { cell: "people.list", fixtures: { Many: [] } } }),
  ).then(
    () => null,
    (error: unknown) => isError(error, "DataValidationFailed"),
  );
  expect(bad).toBe(true);
});

test("X10 fixtures: a kit version never changes, and look.set and texts.set keep the fixtures", async () => {
  const { srv, agent } = await easel();
  await set(agent, "people.list", people);
  await agent.run(kit.api["texts.set"], { input: { texts: { "a.b": { en: "A" } } } });

  expect(await srv.server.run(readKitAt, { input: 1 })).toMatchObject({
    fixtures: {},
    fixturesRev: 1,
  });
  expect(await srv.server.run(readKit)).toMatchObject({
    version: 3,
    fixturesRev: 2,
    fixtures: { "people.list": people },
  });
});

test("X10 fixtures: an easel made before the fixtures gets no fixtures at revision 1 in each kit version at its start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-kit-fixtures-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "easel.db");
  const db = new Database(file);
  db.exec(`CREATE TABLE kit_versions (
    version INTEGER PRIMARY KEY NOT NULL, look_rev INTEGER NOT NULL, look TEXT NOT NULL,
    look_values TEXT NOT NULL, root TEXT NOT NULL, source TEXT NOT NULL, css TEXT NOT NULL,
    pieces TEXT NOT NULL, made INTEGER NOT NULL, runtime TEXT)`);
  db.query(
    "INSERT INTO kit_versions VALUES (?, 1, '{}', '{}', ':root {}', '', '', '[]', 0, NULL)",
  ).run(1);
  db.close();

  const { server } = await boot(file);
  expect(await server.run(readKitAt, { input: 1 })).toMatchObject({
    version: 1,
    fixturesRev: 1,
    fixtures: {},
  });
}, 30_000);
