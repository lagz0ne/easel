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
import { framesLoads, framesOps, loadDocs, markReady, mayRead } from "@/frames/ops.server";
import { framesServer, markFrame } from "@/frames/store.server";
import { kit } from "@/kit";
import { kitOps } from "@/kit/ops.server";
import { runtimeNames } from "@/kit/runtime";
import type { BuiltRuntime } from "@/kit/runtime.server";
import { settleRules } from "@/kit/schema";
import type { TextsPatch } from "@/kit/texts";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

function fakeRuntime(): BuiltRuntime {
  const imports = Object.fromEntries(
    runtimeNames.map((name) => [name, `${name.replace(/^@/, "").replaceAll("/", "__")}.js`]),
  );
  const files = Object.fromEntries(Object.values(imports).map((file) => [file, "export {};"]));
  return { sha: createHash("sha256").update("fake").digest("hex"), imports, files };
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
      framesServer({ stdout, runtime: fakeRuntime() }),
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
      kit.api({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());
  return scope;
}

async function easel(file?: string, token?: string) {
  const srv = await boot(file);
  if (token) return { srv, ...agentOn(await client(srv.server, token)), token };

  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  await (
    await client(srv.server)
  ).run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  const scope = await client(srv.server, text);
  await scope.run(frames.api["canvas.create"], { input: { name: "flow" } });
  return { srv, ...agentOn(scope), token: text };
}

function agentOn(scope: Scope.Handle) {
  const one = (id: string) => ({ canvas: "flow", id });
  return {
    put: (input: PutInput) => scope.run(frames.api["frame.put"], { input }),
    get: (id: string) => scope.run(frames.api["frame.get"], { input: one(id) }),
    list: () => scope.run(frames.api["frame.list"], { input: { canvas: "flow" } }),
    ready: (id: string) => scope.run(frames.api["frame.ready"], { input: one(id) }),
    explore: (id: string) => scope.run(frames.api["frame.explore"], { input: one(id) }),
    texts: (texts: TextsPatch) => scope.run(kit.api["texts.set"], { input: { texts } }),
    check: (tsx: string) => scope.run(kit.api["kit.check"], { input: { tsx } }),
    look: (base: number) =>
      scope.run(kit.api["look.set"], {
        input: {
          look: {
            color: { primary: { $value: { colorSpace: "srgb", components: [0.2, 0.2, 0.8] } } },
          },
          base,
        },
      }),
  };
}

const app = (lines: { texts: string; className?: string; style?: string }) =>
  [
    'import { copy } from "@easel/kit";',
    'import { resource } from "@tinkered/core";',
    "",
    lines.texts,
    "",
    "const text = resource({",
    '  label: "trial.text",',
    "  depends: { say: copy.say },",
    "  factory: ({ say }) => say(texts),",
    "});",
    "",
    "export function View() {",
    `  return <button className="${lines.className ?? "bg-primary p-4"}"${lines.style ?? ""}>Start</button>;`,
    "}",
    "",
  ].join("\n");

const ownText = app({
  texts: 'const texts = { en: { "trial.start": "Start now" }, vi: { "trial.start": "Bắt đầu" } };',
  className: "bg-[#f00] p-4",
});

const teamOnly = app({ texts: 'const texts = ["trial.start"] as const;' });

const usesKey = (key: string) => app({ texts: `const texts = ["${key}"];` });

const at = (findings: Array<{ line: number; col: number; rule: string }>) =>
  findings.map((f) => `${f.line}:${f.col} ${f.rule}`);

type Put = (input: PutInput) => ReturnType<ReturnType<typeof agentOn>["put"]>;

async function make(put: Put, input: PutInput) {
  const answer = await put(input);
  if (answer.kind !== "created") throw new Error(`not created: ${JSON.stringify(answer)}`);
  return answer;
}

test("SC5: an exploring frame with its own text and bg-[#f00] is created as written and shows both; frame.ready answers unsettled with the same findings; after the agent settles them, ready", async () => {
  const { srv, put, get, ready, list, texts } = await easel();

  const made = await make(put, { canvas: "flow", tsx: ownText, name: "Trial" });
  expect(at(made.findings)).toEqual([
    "4:23 copy/text",
    "4:23 copy/own",
    "4:59 copy/own",
    "13:29 look/color",
  ]);
  expect(made.findings.map((f) => f.fix)).toEqual([
    'give the team its text: easel texts set trial.start "Start now"; then remove the text from the part',
    'remove the text from the part, and use the text of the team; to keep this text, easel texts set trial.start "Start now"',
    'remove the text from the part, and use the text of the team; to keep this text, easel texts set trial.start "Bắt đầu" --locale vi',
    "use bg-destructive",
  ]);

  expect(await get(made.id)).toMatchObject({
    kind: "found",
    frame: { version: 1, status: "exploring", tsx: ownText },
  });
  const [doc] = await srv.server.run(loadDocs, { input: { canvas: "flow", id: made.id } });
  if (!doc?.app) throw new Error("no app frame");
  expect(doc.css).toContain(".bg-\\[\\#f00\\]");
  expect(doc.app.js).toContain("bg-[#f00] p-4");
  expect(doc.app.js).toContain("Start now");

  const refused = await ready(made.id);
  expect(refused).toEqual({ kind: "unsettled", findings: made.findings, more: 0 });
  expect(await list()).toMatchObject({ frames: [{ id: made.id, status: "exploring" }] });

  expect(await texts({ "trial.start": { en: "Start now" } })).toMatchObject({ kind: "updated" });
  const settled = await put({ canvas: "flow", tsx: teamOnly, id: made.id, base: 1 });
  expect(settled).toMatchObject({ kind: "updated", version: 2, findings: [] });
  expect(await ready(made.id)).toEqual({ kind: "ready", version: 2 });
  expect(await ready(made.id)).toEqual({ kind: "unchanged", version: 2 });
  expect(await list()).toMatchObject({ frames: [{ id: made.id, status: "ready", version: 2 }] });
});

test("each settle rule on an exploring put is a note: copy/text, copy/own, copy/key, look/color and look/size, each with its place and its fix", async () => {
  const { put } = await easel();

  const missing = await make(put, { canvas: "flow", tsx: usesKey("trial.gone") });
  expect(at(missing.findings)).toEqual(["4:16 copy/text"]);
  expect(missing.findings[0]).toMatchObject({
    what: 'the text key "trial.gone" is not in the texts of the team',
    fix: 'give the team its text: easel texts set trial.gone "<text>"',
  });

  const loose = app({ texts: 'const key = "trial.start";\nconst texts = [key];' });
  const variable = await make(put, { canvas: "flow", tsx: loose });
  expect(at(variable.findings)).toEqual(["5:16 copy/key"]);
  expect(variable.findings[0]?.fix).toContain('say(["trial.start", "people.empty"])');

  const named = app({ texts: 'const key = "trial.start";\nconst texts = key;' });
  expect(at((await make(put, { canvas: "flow", tsx: named })).findings)).toEqual([
    "10:29 copy/key",
  ]);

  const plural = app({
    texts:
      'const texts = { en: { "people.count": { one: "{count} person", other: "{count} people" } } };',
  });
  const many = await make(put, { canvas: "flow", tsx: plural });
  expect(at(many.findings)).toEqual(["4:23 copy/text", "4:23 copy/own"]);
  expect(many.findings[0]?.fix).toContain(
    'easel texts set -f <file.json> with {"people.count":{"en":{"one":"{count} person","other":"{count} people"}}}',
  );

  const sized = app({ texts: 'const texts = ["ui.close"];', className: "text-[13px] p-4" });
  const size = await make(put, { canvas: "flow", tsx: sized });
  expect(at(size.findings)).toEqual(["13:29 look/size"]);

  const same = app({ texts: 'const texts = { en: { "ui.close": "Close" } };' });
  const kept = await make(put, { canvas: "flow", tsx: same });
  expect(at(kept.findings)).toEqual(["4:23 copy/own"]);
  expect(kept.findings[0]?.fix).toBe("remove the text from the part: the team has the same text");
});

test("SC6: a put on a ready frame with a copy finding is refused unsettled, and the frame stays as it was; a color off the look is fixed", async () => {
  const { put, get, ready, texts } = await easel();
  await texts({ "trial.start": { en: "Start now" } });
  const made = await make(put, { canvas: "flow", tsx: teamOnly, ready: true });
  expect(made.findings).toEqual([]);
  expect(await get(made.id)).toMatchObject({ frame: { status: "ready", version: 1 } });

  for (const tsx of [ownText, usesKey("trial.gone"), app({ texts: "const texts = [key];" })]) {
    const refused = await put({ canvas: "flow", tsx, id: made.id, base: 1 });
    expect(refused.kind).toBe("unsettled");
    if (refused.kind !== "unsettled") return;
    expect(refused.findings.every((f) => f.rule.startsWith("copy/"))).toBe(true);
    expect(refused.more).toBe(0);
  }
  expect(await get(made.id)).toMatchObject({
    frame: { status: "ready", version: 1, tsx: teamOnly },
  });

  const styled = app({
    texts: 'const texts = ["trial.start"];',
    style: ' style={{ color: "#f00" }}',
  });
  const painted = await put({ canvas: "flow", tsx: styled, id: made.id, base: 1 });
  expect(painted.kind === "unsettled" && at(painted.findings)).toEqual(["13:62 look/color"]);

  const red = app({ texts: 'const texts = ["trial.start"];', className: "bg-red-500 p-4" });
  const fixed = await put({ canvas: "flow", tsx: red, id: made.id, base: 1 });
  expect(fixed).toMatchObject({ kind: "updated", version: 2 });
  expect(fixed.kind === "updated" && at(fixed.findings)).toEqual(["13:29 look/color"]);
  expect(await get(made.id)).toMatchObject({
    frame: { status: "ready", version: 2, tsx: red.replace("bg-red-500", "bg-destructive") },
  });
  expect(await ready(made.id)).toEqual({ kind: "unchanged", version: 2 });

  const many = Array.from({ length: 23 }, (_, i) => `"own.k${i}": "x"`).join(", ");
  const lots = await put({
    canvas: "flow",
    tsx: app({ texts: `const texts = { en: { ${many} } };` }),
    id: made.id,
    base: 2,
  });
  expect(lots.kind === "unsettled" && [lots.findings.length, lots.more]).toEqual([20, 26]);
});

test("a put with ready marks an exploring frame ready in one call: a new frame, a new version, or the same TSX", async () => {
  const { put, get, ready, explore, texts } = await easel();
  await texts({ "trial.start": { en: "Start now" } });

  const refused = await put({ canvas: "flow", tsx: ownText, ready: true });
  expect(refused.kind === "unsettled" && at(refused.findings)).toEqual([
    "4:23 copy/own",
    "4:59 copy/own",
  ]);
  expect(await ready("0123456789ab")).toEqual({ kind: "gone" });

  const made = await make(put, { canvas: "flow", tsx: teamOnly });
  expect(await get(made.id)).toMatchObject({ frame: { status: "exploring" } });
  expect(await put({ canvas: "flow", tsx: teamOnly, id: made.id, base: 1, ready: true })).toEqual({
    kind: "unchanged",
    id: made.id,
    version: 1,
    findings: [],
    more: 0,
    layout: expect.any(Object),
  });
  expect(await get(made.id)).toMatchObject({ frame: { status: "ready", version: 1 } });

  expect(await explore(made.id)).toEqual({ kind: "exploring" });
  expect(await explore(made.id)).toEqual({ kind: "unchanged" });
  expect(await explore("0123456789ab")).toEqual({ kind: "gone" });
  const red = app({ texts: 'const texts = ["trial.start"];', className: "bg-red-500 p-4" });
  expect(await put({ canvas: "flow", tsx: red, id: made.id, base: 1 })).toMatchObject({
    kind: "updated",
    version: 2,
  });
  expect(await get(made.id)).toMatchObject({ frame: { status: "exploring", tsx: red } });
  expect(await put({ canvas: "flow", tsx: red, id: made.id, base: 2, ready: true })).toMatchObject({
    kind: "updated",
    version: 3,
  });
  expect(await get(made.id)).toMatchObject({
    frame: { status: "ready", version: 3, tsx: red.replace("bg-red-500", "bg-destructive") },
  });
});

test("an HTML frame stays exploring: frame.ready answers unsettled with one kit/shape finding, and frame.explore answers unchanged", async () => {
  const { put, ready, explore, list, texts } = await easel();
  const made = await make(put, { canvas: "flow", html: "<p>a</p>" });

  const refused = await ready(made.id);
  expect(refused.kind === "unsettled" && refused.findings).toEqual([
    {
      line: 1,
      col: 1,
      rule: "kit/shape",
      what: "only an app frame can be ready: this frame is HTML",
      fix: "put the frame again as TSX (a .tsx file or a folder), then mark it ready",
    },
  ]);
  expect(await explore(made.id)).toEqual({ kind: "unchanged" });
  expect(await list()).toMatchObject({ frames: [{ id: made.id, status: "exploring" }] });

  await texts({ "trial.start": { en: "Start now" } });
  const app = await make(put, { canvas: "flow", tsx: teamOnly, ready: true });
  expect(await put({ canvas: "flow", html: "<p>b</p>", id: app.id, base: 1 })).toMatchObject({
    kind: "updated",
    version: 2,
  });
  expect(await list()).toMatchObject({
    frames: [{ status: "exploring" }, { id: app.id, status: "exploring" }],
  });
});

test("a mark of a frame on a version that is not its current one changes nothing; a mark of a ready or a deleted frame answers unchanged or gone", async () => {
  const { srv, put, texts } = await easel();
  const made = await make(put, { canvas: "flow", tsx: teamOnly });

  const input = { canvas: "flow", id: made.id, status: "ready" as const, version: 9 };
  expect(await srv.server.run(markFrame, { input })).toEqual({ kind: "moved", version: 1 });
  await expect(
    srv.server.run(markReady, { input: { canvas: "flow", id: made.id, version: 9 } }),
  ).rejects.toThrow("changed while it was checked");

  await texts({ "trial.start": { en: "Start now" } });
  const marked = await make(put, { canvas: "flow", tsx: teamOnly, ready: true });
  const again = { canvas: "flow", id: marked.id, version: 1 };
  expect(await srv.server.run(markReady, { input: again })).toEqual({
    kind: "unchanged",
    version: 1,
  });
  const lost = { canvas: "flow", id: "0123456789ab", version: 1 };
  expect(await srv.server.run(markReady, { input: lost })).toEqual({ kind: "gone" });
});

test("fact rule 5: a ready frame has no finding of the settle rules in its current version, after a change of the texts and of the look", async () => {
  const { put, get, ready, explore, texts, check, look } = await easel();
  await texts({ "trial.start": { en: "Start now" } });
  const red = app({
    texts: 'const texts = ["trial.start"];',
    className: "bg-red-500 text-[13px] p-4",
  });
  const made = await make(put, { canvas: "flow", tsx: red, ready: true });

  const settled = async () => {
    const got = await get(made.id);
    const tsx = got.kind === "found" && "tsx" in got.frame ? got.frame.tsx : "";
    const checked = await check(tsx);
    return checked.kind === "checked"
      ? checked.findings.filter((f) => settleRules.has(f.rule))
      : null;
  };
  expect(await settled()).toEqual([]);

  expect(await texts({ "trial.start": { en: "Begin", vi: "Bắt đầu" } })).toMatchObject({
    kind: "updated",
  });
  expect(await look(1)).toMatchObject({ kind: "updated" });
  expect(await settled()).toEqual([]);
  expect(await explore(made.id)).toEqual({ kind: "exploring" });
  expect(await ready(made.id)).toEqual({ kind: "ready", version: 1 });
});

test("a frame made before the status is exploring after a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-ready-"));
  const file = join(dir, "easel.db");
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const first = await easel(file);
  await first.texts({ "trial.start": { en: "Start now" } });
  const made = await make(first.put, { canvas: "flow", tsx: teamOnly, ready: true });
  for (const close of closers.splice(1).reverse()) await close();

  const db = new Database(file);
  db.exec("ALTER TABLE frames_frames DROP COLUMN status");
  db.close();

  const again = await easel(file, first.token);
  expect(await again.list()).toMatchObject({ frames: [{ id: made.id, status: "exploring" }] });
}, 30_000);
