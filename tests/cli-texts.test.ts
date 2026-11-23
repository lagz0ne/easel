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
import { stdinText } from "@/cli/frames";
import { textsRun } from "@/cli/texts";
import type { TextsCommand } from "@/cli/texts";
import { frames } from "@/frames";
import { framesOps } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { kit } from "@/kit";
import { kitApi } from "@/kit/contract";
import { kitOps } from "@/kit/ops.server";
import { maxTextsBytes } from "@/kit/texts";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

const brokenList = operation({
  label: "test.brokenTextsList",
  input: kitApi["texts.list"].input,
  run: () => {
    throw new Error("a bug on the server");
  },
});

const brokenSet = operation({
  label: "test.brokenTextsSet",
  input: kitApi["texts.set"].input,
  run: () => {
    throw new Error("a bug on the server");
  },
});

async function boot(options: { broken?: boolean } = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const broken = { "texts.list": brokenList, "texts.set": brokenSet };
  const implement = { ...kitOps, ...(options.broken ? broken : {}) };
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
      frames.api({ implement: framesOps, onStart: [user] }),
      kit.api({ implement, onStart: [user] }),
      memory.server({ services: [access.login, access.user, access.owner, frames.api, kit.api] }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, setupCode };
}

type Srv = Awaited<ReturnType<typeof boot>>;

type Options = { json?: boolean; stdin?: string; dir?: string };

async function easel(srv: Srv, options: Options = {}) {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "easel-cli-texts-"));
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
    file: (name: string, text: string) => {
      const path = join(dir, name);
      writeFileSync(path, text);
      return path;
    },
    path: (name: string) => join(dir, name),
    run: (command: TextsCommand) => scope.run(textsRun, { input: command }),
    viaCli: (command: TextsCommand) =>
      scope.run(cli.run, { input: { kind: "texts", act: command } }),
    login: () =>
      scope.run(cli.run, {
        input: { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false },
      }),
    lines: () =>
      out
        .splice(0)
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

async function ann(srv: Srv, options: Options = {}) {
  const a = await easel(srv, options);
  expect(await a.login()).toBe(0);
  a.out.splice(0);
  a.err.splice(0);

  return a;
}

const seed = {
  "ui.close": { en: "Close", vi: "Đóng" },
  "ui.empty": { en: "Nothing here yet", vi: "Chưa có gì" },
};

test("texts ls prints one line for each text key with its en and vi text, the text keys with no vi, and the revision (exit 0)", async () => {
  const srv = await boot();
  const text = await ann(srv, { json: false });

  expect(await text.viaCli({ kind: "ls" })).toBe(0);
  expect(text.out.splice(0).join("")).toBe(
    [
      'ui.close  en: "Close"  vi: "Đóng"',
      'ui.empty  en: "Nothing here yet"  vi: "Chưa có gì"',
      "each text key has a vi text",
      "texts revision 1, kit version 1",
      "",
    ].join("\n"),
  );

  expect(await text.run({ kind: "set", key: "trial.start", text: "Start the trial" })).toBe(0);
  expect(text.out.splice(0).join("")).toBe("updated: texts revision 2, kit version 2\n");
  expect(await text.run({ kind: "ls" })).toBe(0);
  const lines = text.out.splice(0).join("").split("\n");
  expect(lines).toContain('trial.start  en: "Start the trial"');
  expect(lines).toContain("no vi text: trial.start");

  const json = await easel(srv, { dir: text.dir });
  expect(await json.run({ kind: "ls" })).toBe(0);
  expect(json.lines()).toEqual([
    {
      kind: "found",
      kit: 2,
      rev: 2,
      texts: { ...seed, "trial.start": { en: "Start the trial" } },
      noVi: ["trial.start"],
    },
  ]);
});

test("texts set: --locale vi gives a vi text; the same text again is unchanged (0); an old --base is stale (1)", async () => {
  const srv = await boot();
  const a = await ann(srv);

  expect(await a.run({ kind: "set", key: "trial.start", text: "Start", base: "1" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "updated", rev: 2, kit: 2 }]);
  expect(
    await a.run({ kind: "set", key: "trial.start", text: "Bắt đầu", locale: "vi", base: "2" }),
  ).toBe(0);
  expect(a.lines()).toEqual([{ kind: "updated", rev: 3, kit: 3 }]);
  expect(await a.run({ kind: "set", key: "trial.start", text: "Bắt đầu", locale: "vi" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "unchanged", rev: 3, kit: 3 }]);

  const text = await easel(srv, { json: false, dir: a.dir });
  expect(await text.run({ kind: "set", key: "trial.start", text: "Go", base: "1" })).toBe(1);
  expect(text.err.splice(0).join("")).toBe(
    "stale: the texts are at revision 3 (kit version 3): get them again with `easel texts ls`, and make the change on them\n",
  );
});

test("texts set: a new text key with only vi is invalid (1) with its fix; texts over 64 KiB are tooBig (1)", async () => {
  const srv = await boot();
  const text = await ann(srv, { json: false });

  expect(await text.run({ kind: "set", key: "trial.start", text: "Bắt đầu", locale: "vi" })).toBe(
    1,
  );
  expect(text.err.splice(0).join("")).toBe(
    'invalid: nothing is saved\ntrial.start: a new text key has no en text. Fix: give its en text: easel texts set trial.start "<text>"\n',
  );

  const big = "x".repeat(maxTextsBytes);
  expect(await text.run({ kind: "set", key: "big.text", text: big })).toBe(1);
  expect(text.err.splice(0).join("")).toBe(
    "tooBig: the texts of the team would be over 65536 bytes; nothing is saved\n",
  );
});

test("texts set: a bad text key exits 65, a bad --locale or --base exits 64, and nothing is sent", async () => {
  const srv = await boot();
  const a = await ann(srv);

  expect(await a.run({ kind: "set", key: "Trial", text: "Start" })).toBe(65);
  expect(a.lines()).toEqual([
    { invalid: [{ path: "", message: expect.stringContaining("not a text key") }] },
  ]);
  expect(await a.run({ kind: "set", key: "trial.start", text: "Start", locale: "fr" })).toBe(64);
  expect(a.lines()).toEqual([{ usage: "--locale takes en or vi" }]);
  expect(await a.run({ kind: "set", key: "trial.start", text: "Start", base: "x" })).toBe(64);
  expect(a.lines()).toMatchObject([{ usage: expect.stringContaining("--base") }]);
  expect(await a.run({ kind: "ls" })).toBe(0);
  expect(a.lines()).toMatchObject([{ kind: "found", rev: 1, kit: 1 }]);
});

test("texts set -f writes each text of a JSON file, or of stdin with -; a file that cannot be read or is not JSON exits 64; one that is not texts exits 65", async () => {
  const srv = await boot();
  const a = await ann(srv, { stdin: JSON.stringify({ "ui.close": { vi: "Đóng lại" } }) });
  const texts = {
    "trial.start": { en: "Start", vi: "Bắt đầu" },
    "people.count": { en: { one: "{count} person", other: "{count} people" } },
  };

  const file = a.file("texts.json", JSON.stringify(texts));
  expect(await a.run({ kind: "setFile", file, base: "1" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "updated", rev: 2, kit: 2 }]);
  expect(await a.run({ kind: "setFile", file: "-" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "updated", rev: 3, kit: 3 }]);

  expect(await a.run({ kind: "setFile", file: a.path("none.json") })).toBe(64);
  expect(a.lines()).toMatchObject([{ usage: expect.stringContaining("cannot read") }]);
  expect(await a.run({ kind: "setFile", file: a.file("bad.json", "{") })).toBe(64);
  expect(a.lines()).toMatchObject([{ usage: expect.stringContaining("is not JSON") }]);
  const wrong = a.file("wrong.json", JSON.stringify({ "trial.start": { en: 1 } }));
  expect(await a.run({ kind: "setFile", file: wrong })).toBe(65);
  expect(a.lines()).toEqual([
    { invalid: [{ path: "trial.start.en", message: expect.any(String) }] },
  ]);
});

test("texts with no sign-in are refused (2); a server that throws exits 70 with its trace", async () => {
  const srv = await boot({ broken: true });
  const stranger = await easel(srv);
  expect(await stranger.run({ kind: "ls" })).toBe(2);
  expect(stranger.lines()).toEqual([{ refused: { signIn: true } }]);

  const a = await ann(srv, { json: false });
  expect(await a.run({ kind: "ls" })).toBe(70);
  expect(a.err.splice(0).join("")).toMatch(/^the server failed \(trace /);
  expect(await a.run({ kind: "set", key: "trial.start", text: "Start" })).toBe(70);
  expect(a.err.splice(0).join("")).toMatch(/^the server failed \(trace /);
});

type Cmd = typeof import("../cmds/easel");

const easelCmd: Cmd = await import(new URL("../cmds/easel.ts", import.meta.url).href);

async function main(args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-texts-main-"));
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

test("the easel command reads texts ls, texts set <text key> <text> with --locale and --base, and texts set -f; --help names them", async () => {
  const noServer = `${JSON.stringify({ usage: "no server: run `easel login <server> --name <name>`, or pass --server" })}\n`;
  const read = [
    ["texts", "ls"],
    ["texts", "set", "trial.start", "Bắt đầu", "--locale", "vi", "--base", "2"],
    ["texts", "set", "-f", "texts.json", "--base", "2"],
    ["texts", "set", "--file", "-"],
  ];
  for (const args of read) {
    expect(await main([...args, "--json"])).toEqual({ code: 64, out: noServer });
  }

  for (const args of [["texts"], ["texts", "set"], ["texts", "set", "trial.start"]]) {
    expect(await main([...args, "--json"])).toEqual({
      code: 64,
      out: expect.stringMatching(/^\{"usage":"(?!no server)/),
    });
  }

  const help = (await main(["--help"])).out;
  expect(help).toContain("  easel texts ls ");
  expect(help).toContain('  easel texts set <text key> "<text>" [--locale vi] [--base <rev>]\n');
  expect(help).toContain("  easel texts set -f <file.json> [--base <rev>] ");
});
