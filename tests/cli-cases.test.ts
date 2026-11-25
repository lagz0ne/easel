import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { cli } from "@/cli";
import { casesRun } from "@/cli/cases";
import type { CasesCommand } from "@/cli/cases";
import { stdinText } from "@/cli/frames";
import { frames } from "@/frames";
import { maxCases } from "@/frames/cases";
import type { FrameCase } from "@/frames/cases";
import { framesContracts } from "@/frames/contract";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { kit } from "@/kit";
import { kitOps } from "@/kit/ops.server";
import { words } from "@/words";
import { wordsOps } from "@/words/ops.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

const brokenList = operation({
  label: "test.brokenCasesList",
  input: framesContracts["cases.list"].input,
  run: () => {
    throw new Error("a bug on the server");
  },
});

const brokenSet = operation({
  label: "test.brokenCasesSet",
  input: framesContracts["cases.set"].input,
  run: () => {
    throw new Error("a bug on the server");
  },
});

async function boot(options: { broken?: boolean } = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const broken = { "cases.list": brokenList, "cases.set": brokenSet };
  const implement = { ...framesOps, ...(options.broken ? broken : {}) };
  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user] }),
      frames.api({ implement, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      kit.api({ implement: kitOps, onStart: [user] }),
      words.api({ implement: wordsOps, onStart: [user] }),
      memory.server({
        services: [access.login, access.user, access.owner, frames.api, kit.api, words.api],
      }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, setupCode };
}

type Srv = Awaited<ReturnType<typeof boot>>;

type Options = { json?: boolean; stdin?: string; dir?: string };

async function easel(srv: Srv, options: Options = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "easel-cli-cases-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const out: string[] = [];
  const err: string[] = [];
  const stdin = options.stdin;
  const scope = await createScope({
    clock: srv.clock,
    tags: stdin === undefined ? [] : [stdinText(async () => stdin)],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({
        peer: srv.server,
        headers: { "x-easel-peer": "198.51.100.1" },
        meta: cli.bearer,
      }),
      access.login({ remote: memory.client }),
      access.user({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      kit.api({ remote: memory.client }),
      words.api({ remote: memory.client }),
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => err.push(chunk) },
        json: options.json ?? true,
        server: origin,
        hosts: join(dir, "hosts.json"),
      }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return {
    dir,
    out,
    err,
    scope,
    file: (name: string, text: string) => {
      const path = join(dir, name);
      writeFileSync(path, text);
      return path;
    },
    path: (name: string) => join(dir, name),
    run: (command: CasesCommand) => scope.run(casesRun, { input: command }),
    viaCli: (command: CasesCommand) =>
      scope.run(cli.run, { input: { kind: "cases", act: command } }),
    login: () =>
      scope.run(cli.run, {
        input: { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false },
      }),
    text: () => out.splice(0).join(""),
    errText: () => err.splice(0).join(""),
    lines: () =>
      out
        .splice(0)
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

const people = {
  empty: [],
  few: [{ name: "Ana" }, { name: "Ben" }],
  many: Array.from({ length: 40 }, (_, n) => ({ name: `Person ${n + 1}` })),
};

const dataCases: FrameCase[] = [
  { name: "empty", fixture: "empty" },
  { name: "few", fixture: "few" },
  { name: "many", fixture: "many", switches: { theme: "dark" } },
];

async function ann(options: { broken?: boolean } = {}) {
  const srv = await boot(options);
  const a = await easel(srv);
  expect(await a.login()).toBe(0);
  a.out.splice(0);
  a.err.splice(0);
  await a.scope.run(frames.api["canvas.create"], { input: { name: "flow" } });
  await a.scope.run(kit.api["fixtures.set"], { input: { cell: "people.list", fixtures: people } });
  const source = await a.scope.run(frames.api["frame.put"], {
    input: {
      canvas: "flow",
      html: "<p>users list</p>",
      name: "users list",
      size: { w: 880, h: 600 },
    },
  });
  if (source.kind !== "created") throw new Error(source.kind);

  return { srv, a, frame: source.id };
}

type Ann = Awaited<ReturnType<typeof ann>>;

const writeCases = (e: Ann, cases: unknown, name = "cases.json") =>
  e.a.file(name, JSON.stringify(cases));

async function setOk(e: Ann) {
  const file = writeCases(e, dataCases);
  expect(await e.a.run({ kind: "set", canvas: "flow", frame: e.frame, file })).toBe(0);
  const [answer] = e.a.lines();
  return answer;
}

test("X12 cases ls prints each case, each case frame, the revision and the section (exit 0); --json gives the same answer as cases.list", async () => {
  const e = await ann();
  const text = await easel(e.srv, { dir: e.a.dir, json: false });

  expect(await text.viaCli({ kind: "ls", canvas: "flow", frame: e.frame })).toBe(0);
  expect(text.text()).toBe(
    `no cases: write them with \`easel cases set flow ${e.frame} <file.json>\`\ncases revision 0, no section\n`,
  );

  const set = await setOk(e);
  const ids = new Map<string, string>(
    set.frames.map((one: { name: string; id: string }) => [one.name, one.id]),
  );
  expect(await text.run({ kind: "ls", canvas: "flow", frame: e.frame })).toBe(0);
  expect(text.text()).toBe(
    [
      "case empty  fixture empty",
      "case few  fixture few",
      "case many  fixture many  switches theme=dark",
      `frame empty  ${ids.get("empty")}`,
      `frame few  ${ids.get("few")}`,
      `frame many  ${ids.get("many")}`,
      "cases revision 1, section users list · cases",
      "",
    ].join("\n"),
  );

  expect(await e.a.run({ kind: "ls", canvas: "flow", frame: e.frame })).toBe(0);
  const listed = await e.a.scope.run(frames.api["cases.list"], {
    input: { canvas: "flow", frame: e.frame },
  });
  expect(e.a.lines()).toEqual([listed]);
  expect(listed).toMatchObject({ kind: "found", rev: 1, cases: dataCases });
});

test("X12 cases ls: a frame that is not there is gone (1); a case frame says CaseFrame and names its source (1); each is one line with its fix", async () => {
  const e = await ann();
  const set = await setOk(e);
  const caseId = set.frames[0].id;
  const text = await easel(e.srv, { dir: e.a.dir, json: false });

  expect(await text.run({ kind: "ls", canvas: "flow", frame: "000000000000" })).toBe(1);
  expect(await text.run({ kind: "ls", canvas: "flow", frame: caseId })).toBe(1);
  expect(text.errText()).toBe(
    [
      "gone: no frame 000000000000 on the canvas flow. Find the id with `easel ls flow`",
      `CaseFrame: ${caseId} shows a case of the frame ${e.frame}. List the cases of that frame with \`easel cases ls flow ${e.frame}\``,
      "",
    ].join("\n"),
  );

  expect(await e.a.run({ kind: "ls", canvas: "flow", frame: caseId })).toBe(1);
  expect(e.a.lines()).toEqual([{ kind: "CaseFrame", source: e.frame }]);
});

test("X12 cases set prints the revision and each case frame (exit 0); stdin with - works; an empty list removes the case frames", async () => {
  const e = await ann();
  const text = await easel(e.srv, { dir: e.a.dir, json: false });
  const file = writeCases(e, dataCases);

  expect(await text.viaCli({ kind: "set", canvas: "flow", frame: e.frame, file, base: "0" })).toBe(
    0,
  );
  const listed = await e.a.scope.run(frames.api["cases.list"], {
    input: { canvas: "flow", frame: e.frame },
  });
  if (listed.kind !== "found") throw new Error(listed.kind);
  expect(text.text()).toBe(
    [
      "set: cases revision 1",
      ...listed.frames.map((one) => `frame ${one.name}  ${one.id}`),
      "",
    ].join("\n"),
  );

  const piped = await easel(e.srv, { dir: e.a.dir, stdin: "[]" });
  expect(
    await piped.run({ kind: "set", canvas: "flow", frame: e.frame, file: "-", base: "1" }),
  ).toBe(0);
  expect(piped.lines()).toMatchObject([{ kind: "set", rev: 2, frames: [] }]);
});

test("X12 cases set: each refusal writes nothing and is one line with its fix: changed, gone, CaseInvalid, CasesTooMany, CaseFrame (exit 1)", async () => {
  const e = await ann();
  const set = await setOk(e);
  const caseId = set.frames[0].id;
  const text = await easel(e.srv, { dir: e.a.dir, json: false });
  const good = writeCases(e, dataCases, "good.json");
  const lost = writeCases(e, [{ name: "lost", fixture: "nowhere" }], "lost.json");
  const twice = writeCases(e, [{ name: "few" }, { name: "few", fixture: "few" }], "twice.json");
  const lots = writeCases(
    e,
    Array.from({ length: maxCases + 1 }, (_, n) => ({ name: `case-${n}` })),
    "lots.json",
  );
  const one = { kind: "set" as const, canvas: "flow", frame: e.frame };

  expect(await text.run({ ...one, file: good, base: "0" })).toBe(1);
  expect(await text.run({ ...one, frame: "000000000000", file: good })).toBe(1);
  expect(await text.run({ ...one, file: lost })).toBe(1);
  expect(await text.run({ ...one, file: twice })).toBe(1);
  expect(await text.run({ ...one, file: lots })).toBe(1);
  expect(await text.run({ ...one, frame: caseId, file: good })).toBe(1);
  expect(text.errText()).toBe(
    [
      `changed: the cases are at revision 1 now, and nothing was written. Read them again with \`easel cases ls flow ${e.frame}\`, then set them with --base 1`,
      "gone: no frame 000000000000 on the canvas flow, and nothing was written. Find the id with `easel ls flow`",
      'CaseInvalid: the case lost has a bad fixture (no cell has the fixture "nowhere" (fixtures.list)), and nothing was written. Use a fixture that `easel fixtures ls` lists, then set the cases again',
      "CaseInvalid: the case few has a bad name (a case before it has this name), and nothing was written. Give each case its own name, then set the cases again",
      `CasesTooMany: the list has ${maxCases + 1} cases, and a frame has ${maxCases} at most, so nothing was written. Remove cases from the file, then set them again`,
      `CaseFrame: nothing was written; ${caseId} shows a case of the frame ${e.frame}. Set the cases of that frame with \`easel cases set flow ${e.frame} <file.json>\``,
      "",
    ].join("\n"),
  );

  expect(await e.a.run({ ...one, file: lots })).toBe(1);
  expect(await e.a.run({ ...one, file: lost })).toBe(1);
  expect(e.a.lines()).toEqual([
    { kind: "CasesTooMany", cases: maxCases + 1, max: maxCases },
    {
      kind: "CaseInvalid",
      case: "lost",
      field: "fixture",
      reason: 'no cell has the fixture "nowhere" (fixtures.list)',
    },
  ]);
  expect(await e.a.run({ kind: "ls", canvas: "flow", frame: e.frame })).toBe(0);
  expect(e.a.lines()).toMatchObject([{ rev: 1, cases: dataCases }]);
});

test("X12 cases set: a bad canvas key, frame id or --base, and a file that cannot be read, is not JSON or is not a list of cases, exit 64 and send nothing", async () => {
  const e = await ann();
  const good = writeCases(e, dataCases);
  const bad = e.a.file("bad.json", "{ not json");
  const shape = writeCases(e, [{ name: "Big Name" }], "shape.json");
  const one = { kind: "set" as const, canvas: "flow", frame: e.frame, file: good };

  expect(await e.a.run({ ...one, base: "x" })).toBe(64);
  expect(await e.a.run({ ...one, canvas: "Flow!" })).toBe(64);
  expect(await e.a.run({ ...one, frame: "users" })).toBe(64);
  expect(await e.a.run({ kind: "ls", canvas: "flow", frame: "users" })).toBe(64);
  expect(await e.a.run({ ...one, file: e.a.path("none.json") })).toBe(64);
  expect(await e.a.run({ ...one, file: bad })).toBe(64);
  expect(await e.a.run({ ...one, file: shape })).toBe(64);
  const usages = e.a.lines();
  expect(usages.map((line) => Object.keys(line))).toEqual(
    Array.from({ length: 7 }, () => ["usage"]),
  );
  expect(usages[5]).toEqual({ usage: `${bad} is not JSON` });
  expect(usages[6].usage).toMatch(/^\S+shape\.json is not a list of cases: 0\.name: /);

  expect(await e.a.run({ kind: "ls", canvas: "flow", frame: e.frame })).toBe(0);
  expect(e.a.lines()).toMatchObject([{ rev: 0, cases: [] }]);
});

test("X12 cases with no sign-in are refused (2); a server that throws exits 70 with its trace", async () => {
  const e = await ann({ broken: true });
  const stranger = await easel(e.srv);
  expect(await stranger.run({ kind: "ls", canvas: "flow", frame: e.frame })).toBe(2);
  expect(stranger.lines()).toEqual([{ refused: { signIn: true } }]);

  const text = await easel(e.srv, { dir: e.a.dir, json: false });
  const file = writeCases(e, dataCases);
  expect(await text.run({ kind: "ls", canvas: "flow", frame: e.frame })).toBe(70);
  expect(text.errText()).toMatch(/^the server failed \(trace /);
  expect(await text.run({ kind: "set", canvas: "flow", frame: e.frame, file })).toBe(70);
  expect(text.errText()).toMatch(/^the server failed \(trace /);
});

type Cmd = typeof import("../cmds/easel");

const easelCmd: Cmd = await import(new URL("../cmds/easel.ts", import.meta.url).href);

async function main(args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-cases-main-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const out: string[] = [];
  const codes: number[] = [];
  const stop = new AbortController();
  const app = await easelCmd.default({
    env: { HOME: dir },
    args,
    cwd: dir,
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: (code) => (codes.push(code), stop.abort()),
  });
  await app.closed;

  return { code: codes[0], out: out.join("") };
}

test("the easel command reads cases ls <canvas> <frame> and cases set <canvas> <frame> <file> --base; --help names them", async () => {
  const noServer = `${JSON.stringify({ usage: "no server: run `easel login <server> --name <name>`, or pass --server" })}\n`;
  const read = [
    ["cases", "ls", "flow", "0123456789ab"],
    ["cases", "set", "flow", "0123456789ab", "cases.json"],
    ["cases", "set", "flow", "0123456789ab", "-", "--base", "2"],
  ];
  for (const args of read) {
    expect(await main([...args, "--json"])).toEqual({ code: 64, out: noServer });
  }

  for (const args of [
    ["cases"],
    ["cases", "ls", "flow"],
    ["cases", "set", "flow", "0123456789ab"],
  ]) {
    expect(await main([...args, "--json"])).toEqual({
      code: 64,
      out: expect.stringMatching(/^\{"usage":"(?!no server)/),
    });
  }

  const help = (await main(["--help"])).out;
  expect(help).toContain("  easel cases ls <canvas> <frame> ");
  expect(help).toContain("  easel cases set <canvas> <frame> <file.json|-> [--base <rev>]\n");
});
