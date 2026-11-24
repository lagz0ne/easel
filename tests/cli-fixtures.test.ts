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
import { fixturesRun } from "@/cli/fixtures";
import type { FixturesCommand } from "@/cli/fixtures";
import { stdinText } from "@/cli/frames";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { kit } from "@/kit";
import { kitApi } from "@/kit/contract";
import { maxFixturesBytes } from "@/kit/fixtures";
import { kitOps } from "@/kit/ops.server";
import { words } from "@/words";
import { wordsApi } from "@/words/contract";
import { wordsOps } from "@/words/ops.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

const brokenList = operation({
  label: "test.brokenFixturesList",
  input: kitApi["fixtures.list"].input,
  run: () => {
    throw new Error("a bug on the server");
  },
});

const brokenSet = operation({
  label: "test.brokenFixturesSet",
  input: kitApi["fixtures.set"].input,
  run: () => {
    throw new Error("a bug on the server");
  },
});

async function boot(options: { broken?: boolean } = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const broken = { "fixtures.list": brokenList, "fixtures.set": brokenSet };
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
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      kit.api({ implement, onStart: [user] }),
      words.api({
        implement: wordsOps,
        onStart: [user],
      }),
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
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), "easel-cli-fixtures-"));
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
    file: (name: string, text: string) => {
      const path = join(dir, name);
      writeFileSync(path, text);
      return path;
    },
    path: (name: string) => join(dir, name),
    run: (command: FixturesCommand) => scope.run(fixturesRun, { input: command }),
    put: (html: string) =>
      scope.run(frames.api["frame.put"], { input: { canvas: "shop", html, name: "Hero" } }),
    canvas: () => scope.run(frames.api["canvas.create"], { input: { name: "shop" } }),
    viaCli: (command: FixturesCommand) =>
      scope.run(cli.run, { input: { kind: "fixtures", act: command } }),
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

const people = { empty: [], one: [{ id: "a", name: "Ann" }] };

test("X10 fixtures ls prints each cell with the names of its fixtures and the revision (exit 0); --json gives the answer", async () => {
  const srv = await boot();
  const a = await ann(srv, { json: false });

  expect(await a.viaCli({ kind: "ls" })).toBe(0);
  expect(a.out.splice(0).join("")).toBe(
    "no fixtures: `easel fixtures set` writes one\nfixtures revision 1, kit version 1\n",
  );

  const file = a.file("empty.json", "[]");
  expect(await a.run({ kind: "set", cell: "people.list", name: "empty", file })).toBe(0);
  expect(a.out.splice(0).join("")).toBe("updated: fixtures revision 2, kit version 2\n");
  const one = a.file("one.json", JSON.stringify(people.one));
  expect(await a.run({ kind: "set", cell: "people.list", name: "one", file: one })).toBe(0);
  a.out.splice(0);
  expect(await a.run({ kind: "ls" })).toBe(0);
  expect(a.out.splice(0).join("")).toBe(
    "people.list  empty, one\nfixtures revision 3, kit version 3\n",
  );

  const json = await easel(srv, { dir: a.dir });
  expect(await json.run({ kind: "ls" })).toBe(0);
  expect(json.lines()).toEqual([
    {
      kind: "found",
      kit: 3,
      rev: 3,
      cells: [{ label: "people.list", names: ["empty", "one"] }],
      fixtures: { "people.list": people },
    },
  ]);
});

test("X10 fixtures get prints the fixtures of a cell, or one; a name that the cell does not have exits 1", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const file = a.file("one.json", JSON.stringify(people.one));
  await a.run({ kind: "set", cell: "people.list", name: "one", file });
  a.out.splice(0);

  expect(await a.run({ kind: "get", cell: "people.list" })).toBe(0);
  expect(a.lines()).toEqual([{ one: people.one }]);
  expect(await a.run({ kind: "get", cell: "people.list", name: "one" })).toBe(0);
  expect(a.lines()).toEqual([people.one]);
  expect(await a.run({ kind: "get", cell: "people.list", name: "many" })).toBe(1);
  expect(a.lines()).toEqual([{ missing: { kind: "get", cell: "people.list", name: "many" } }]);
});

test("X10 fixtures set: the same value is unchanged (0); an old --base is stale (1); over 256 KiB is tooBig (1); stdin with - works; null removes it", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const file = a.file("one.json", JSON.stringify(people.one));
  const one = { kind: "set" as const, cell: "people.list", name: "one", file };
  expect(await a.run(one)).toBe(0);
  expect(await a.run({ ...one, base: "2" })).toBe(0);
  expect(await a.run({ ...one, base: "1" })).toBe(1);
  const big = a.file("big.json", JSON.stringify("x".repeat(maxFixturesBytes)));
  expect(await a.run({ ...one, file: big })).toBe(1);
  expect(a.lines()).toEqual([
    { kind: "updated", rev: 2, kit: 2 },
    { kind: "unchanged", rev: 2, kit: 2 },
    { kind: "stale", rev: 2, kit: 2 },
    { kind: "tooBig", maxBytes: maxFixturesBytes },
  ]);

  const piped = await easel(srv, { dir: a.dir, stdin: "null" });
  expect(await piped.run({ ...one, file: "-" })).toBe(0);
  expect(piped.lines()).toEqual([{ kind: "updated", rev: 3, kit: 3 }]);

  const text = await easel(srv, { dir: a.dir, json: false });
  expect(await text.run({ ...one, base: "1" })).toBe(1);
  expect(await text.run({ ...one, file: big })).toBe(1);
  expect(text.err.splice(0).join("")).toMatch(/^stale: [^\n]+\ntooBig: /);
});

test("X10 fixtures set: a bad --base, cell label or fixture name, and a file that cannot be read or is not JSON, exit 64 and send nothing", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const file = a.file("one.json", "[]");
  const one = { kind: "set" as const, cell: "people.list", name: "one", file };
  const bad = a.file("bad.json", "{ not json");

  expect(await a.run({ ...one, base: "x" })).toBe(64);
  expect(await a.run({ ...one, cell: "9 people" })).toBe(64);
  expect(await a.run({ ...one, name: "Many" })).toBe(64);
  expect(await a.run({ ...one, file: a.path("none.json") })).toBe(64);
  expect(await a.run({ ...one, file: bad })).toBe(64);
  expect(a.lines().map((line) => Object.keys(line))).toEqual([
    ["usage"],
    ["usage"],
    ["usage"],
    ["usage"],
    ["usage"],
  ]);
  expect(await a.run({ kind: "ls" })).toBe(0);
  expect(a.lines()).toMatchObject([{ rev: 1 }]);
});

test("X10 fixtures with no sign-in are refused (2); a server that throws exits 70 with its trace", async () => {
  const srv = await boot({ broken: true });
  const stranger = await easel(srv);
  expect(await stranger.run({ kind: "ls" })).toBe(2);
  expect(stranger.lines()).toEqual([{ refused: { signIn: true } }]);

  const a = await ann(srv, { json: false });
  const file = a.file("one.json", "[]");
  expect(await a.run({ kind: "ls" })).toBe(70);
  expect(a.err.splice(0).join("")).toMatch(/^the server failed \(trace /);
  expect(await a.run({ kind: "get", cell: "people.list" })).toBe(70);
  expect(a.err.splice(0).join("")).toMatch(/^the server failed \(trace /);
  expect(await a.run({ kind: "set", cell: "people.list", name: "one", file })).toBe(70);
  expect(a.err.splice(0).join("")).toMatch(/^the server failed \(trace /);
});

type Cmd = typeof import("../cmds/easel");

const easelCmd: Cmd = await import(new URL("../cmds/easel.ts", import.meta.url).href);

async function main(args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-fixtures-main-"));
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

test("the easel command reads fixtures ls, fixtures get <cell> [<name>] and fixtures set <cell> <name> <file> --base; --help names them", async () => {
  const noServer = `${JSON.stringify({ usage: "no server: run `easel login <server> --name <name>`, or pass --server" })}\n`;
  const read = [
    ["fixtures", "ls"],
    ["fixtures", "get", "people.list"],
    ["fixtures", "get", "people.list", "one"],
    ["fixtures", "set", "people.list", "one", "one.json", "--base", "2"],
  ];
  for (const args of read) {
    expect(await main([...args, "--json"])).toEqual({ code: 64, out: noServer });
  }

  for (const args of [["fixtures"], ["fixtures", "set", "people.list"]]) {
    expect(await main([...args, "--json"])).toEqual({
      code: 64,
      out: expect.stringMatching(/^\{"usage":"(?!no server)/),
    });
  }

  const help = (await main(["--help"])).out;
  expect(help).toContain("  easel fixtures ls ");
  expect(help).toContain("  easel fixtures get <cell> [<name>] ");
  expect(help).toContain("  easel fixtures set <cell> <name> <file.json|-> [--base <rev>]\n");
});
