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
import { kitOps } from "@/kit/ops.server";
import { readKit, readKitAt, saveTexts } from "@/kit/store.server";
import { maxTextsBytes, teamTexts } from "@/kit/texts";
import type { TextsPatch } from "@/kit/texts";

import { frame } from "./kit/fixture";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

async function until(ok: () => boolean) {
  for (let i = 0; i < 150 && !ok(); i++) await tick();
  expect(ok()).toBe(true);
}

const seed = {
  "ui.close": { en: "Close", vi: "Đóng" },
  "ui.empty": { en: "Nothing here yet", vi: "Chưa có gì" },
};

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

const list = (agent: Scope.Handle) => agent.run(kit.api["texts.list"], { input: {} });

const set = (agent: Scope.Handle, texts: TextsPatch, base?: number) =>
  agent.run(kit.api["texts.set"], { input: base === undefined ? { texts } : { texts, base } });

test("rule 7: kit version 1 holds the texts of the pieces of ui, in en and vi, at revision 1; texts.list names no text key with no vi", async () => {
  const { agent } = await easel();

  expect(await list(agent)).toEqual({ kind: "found", kit: 1, rev: 1, texts: seed, noVi: [] });
});

test("texts.set writes a new text key as a new kit version: texts.list has it, names it with no vi, and the board kit of each canvas carries the texts", async () => {
  const { srv, token, agent } = await easel();
  const tab = await client(srv.server, token);
  const cell = tab.resolve(frames.board.kit.of({ canvas: "flow" }));
  closers.push(cell.watch(() => undefined));
  await until(() => cell.get()?.kit === 1);
  expect(cell.get()?.texts).toEqual(seed);

  expect(await set(agent, { "trial.start": { en: "Start the trial" } }, 1)).toEqual({
    kind: "updated",
    rev: 2,
    kit: 2,
  });
  expect(await list(agent)).toEqual({
    kind: "found",
    kit: 2,
    rev: 2,
    texts: { ...seed, "trial.start": { en: "Start the trial" } },
    noVi: ["trial.start"],
  });
  await until(() => cell.get()?.kit === 2);
  expect(cell.get()?.texts["trial.start"]).toEqual({ en: "Start the trial" });

  expect(await set(agent, { "trial.start": { vi: "Bắt đầu dùng thử" } })).toEqual({
    kind: "updated",
    rev: 3,
    kit: 3,
  });
  expect(await list(agent)).toMatchObject({
    texts: { "trial.start": { en: "Start the trial", vi: "Bắt đầu dùng thử" } },
    noVi: [],
  });
});

test("texts.set with the texts that are there is unchanged, with a base or with none, and writes no kit version", async () => {
  const { srv, agent } = await easel();

  expect(await set(agent, { "ui.close": { en: "Close" } }, 1)).toEqual({
    kind: "unchanged",
    rev: 1,
    kit: 1,
  });
  expect(await set(agent, { "ui.empty": { vi: "Chưa có gì" } })).toEqual({
    kind: "unchanged",
    rev: 1,
    kit: 1,
  });
  expect(await set(agent, {})).toEqual({ kind: "unchanged", rev: 1, kit: 1 });
  expect((await srv.server.run(readKit))?.version).toBe(1);
});

test("texts.set on an old revision is stale with the current one (K14), and writes nothing", async () => {
  const { srv, agent } = await easel();
  await set(agent, { "ui.close": { en: "Close it" } }, 1);

  expect(await set(agent, { "ui.close": { en: "Shut" } }, 1)).toEqual({
    kind: "stale",
    rev: 2,
    kit: 2,
  });
  expect((await srv.server.run(readKit))?.texts["ui.close"]?.en).toBe("Close it");
  expect(
    await srv.server.run(saveTexts, {
      input: { texts: { "a.b": { en: "A" } }, base: 1 },
    }),
  ).toEqual({ kind: "stale", rev: 2, kit: 2 });
});

test("fact rule 4: a new text key with no en text is invalid, with its fix; a vi text with other parameters or another form is invalid; nothing is written", async () => {
  const { srv, agent } = await easel();
  await set(agent, { "people.count": { en: { one: "{count} person", other: "{count} people" } } });

  const answer = await set(agent, {
    "trial.start": { vi: "Bắt đầu" },
    "trial.left": { en: "{days} days left", vi: "Còn {ngay} ngày" },
    "people.count": { vi: "{count} người" },
  });
  expect(answer).toEqual({
    kind: "invalid",
    findings: [
      {
        key: "people.count",
        what: "the en text is a plural { one, other }, and the vi text is a string",
        fix: "give each locale the same form: a string, or a plural { one, other }",
      },
      {
        key: "trial.left",
        what: "the vi text has the parameters {ngay}, and the en text has {days}",
        fix: "use the parameters {days} in each locale",
      },
      {
        key: "trial.start",
        what: "a new text key has no en text",
        fix: 'give its en text: easel texts set trial.start "<text>"',
      },
    ],
  });
  const now = await srv.server.run(readKit);
  expect(now?.version).toBe(2);
  expect(Object.keys(now?.texts ?? {})).toEqual(["people.count", "ui.close", "ui.empty"]);
  for (const text of Object.values(now?.texts ?? {})) expect(text.en).toBeDefined();
  expect(teamTexts.safeParse({ "a.b": { vi: "B" } }).success).toBe(false);
});

test("texts.set: texts over 64 KiB are tooBig, and nothing is written; a bad text key is refused at the door", async () => {
  const { srv, agent } = await easel();

  expect(await set(agent, { "big.text": { en: "x".repeat(maxTextsBytes) } })).toEqual({
    kind: "tooBig",
    maxBytes: 65536,
  });
  expect((await srv.server.run(readKit))?.version).toBe(1);

  const bad = await Promise.try(() =>
    agent.run(kit.api["texts.set"], { input: { texts: { Trial: { en: "Start" } } } }),
  ).then(
    () => null,
    (error: unknown) => isError(error, "DataValidationFailed"),
  );
  expect(bad).toBe(true);
});

test("fact rule 1: a kit version never changes, so kit version 1 keeps its texts after texts.set", async () => {
  const { srv, agent } = await easel();
  await set(agent, { "ui.close": { en: "Close it" } });

  expect((await srv.server.run(readKitAt, { input: 1 }))?.texts).toEqual(seed);
  expect((await srv.server.run(readKitAt, { input: 2 }))?.texts["ui.close"]).toEqual({
    en: "Close it",
    vi: "Đóng",
  });
});

test("fact rules 2 and 3: look.set and look.undo keep the texts; a put keeps them; texts.set writes no frame and no frame version", async () => {
  const { srv, agent } = await easel();
  const put = await agent.run(frames.api["frame.put"], {
    input: { canvas: "flow", html: await frame("form") },
  });
  if (put.kind !== "created") throw new Error("not created");
  await set(agent, { "trial.start": { en: "Start" } });
  const texts = (await srv.server.run(readKit))?.texts;

  const look = {
    color: { primary: { $value: { colorSpace: "srgb", components: [0.2, 0.2, 0.8] } } },
  };
  expect(await agent.run(kit.api["look.set"], { input: { look, base: 1 } })).toMatchObject({
    kind: "updated",
    kit: 3,
  });
  expect(await srv.server.run(readKit)).toMatchObject({ version: 3, textsRev: 2, texts });
  expect(await agent.run(kit.api["look.undo"], { input: { base: 2 } })).toMatchObject({
    kind: "updated",
    kit: 4,
  });
  expect(await srv.server.run(readKit)).toMatchObject({ version: 4, textsRev: 2, texts });

  await agent.run(frames.api["frame.put"], {
    input: { canvas: "flow", id: put.id, base: 1, html: `${await frame("form")}\n` },
  });
  expect((await srv.server.run(readKit))?.version).toBe(4);

  await set(agent, { "trial.start": { en: "Start now" } });
  expect(await agent.run(frames.api["frame.list"], { input: { canvas: "flow" } })).toMatchObject({
    kind: "found",
    frames: [{ id: put.id, version: 2 }],
  });
  expect(await list(agent)).toMatchObject({ kit: 5, rev: 3 });
});

test("an easel made before the texts gets the seed texts at revision 1 in each kit version at its start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-kit-texts-"));
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
  db.query(
    "INSERT INTO kit_versions VALUES (?, 2, '{}', '{}', ':root {}', '', '', '[]', 0, NULL)",
  ).run(2);
  db.close();

  const { server } = await boot(file);
  for (const at of [1, 2]) {
    expect(await server.run(readKitAt, { input: at })).toMatchObject({
      version: at,
      textsRev: 1,
      texts: seed,
    });
  }
}, 30_000);
