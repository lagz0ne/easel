import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { cli } from "@/cli";
import { framesRun } from "@/cli/frames";
import type { FramesCommand } from "@/cli/frames";
import { pagesRun } from "@/cli/pages";
import type { PagesCommand } from "@/cli/pages";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";

type Cmd = typeof import("../cmds/easel");

const easelCmd: Cmd = await import(new URL("../cmds/easel.ts", import.meta.url).href);

const root = new URL("..", import.meta.url).pathname;

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function boot() {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
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
      memory.server({ services: [access.login, access.user, access.owner, frames.api] }),
    ],
  }).ready;
  closers.push(() => server.close());

  return { server, clock, setupCode: () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "" };
}

async function ann(json = true) {
  const srv = await boot();
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-pages-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const out: string[] = [];
  const err: string[] = [];
  const scope = await createScope({
    clock: srv.clock,
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
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => err.push(chunk) },
        json,
        server: "https://easel.test",
        hosts: join(dir, "hosts.json"),
      }),
    ],
  }).ready;
  closers.push(() => scope.close());
  const login = { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false } as const;
  await scope.run(cli.run, { input: login });
  await scope.run(framesRun, { input: { kind: "canvas new", name: "Flow" } });
  out.splice(0);

  const file = join(dir, "one.html");
  writeFileSync(file, "<p>1</p>");
  return {
    file,
    out,
    err,
    frames: (command: FramesCommand) => scope.run(framesRun, { input: command }),
    pages: (command: PagesCommand) => scope.run(pagesRun, { input: command }),
    lines: () =>
      out
        .splice(0)
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    said: () => [...out.splice(0), ...err.splice(0)].join(""),
  };
}

const canvas = "flow";

test("put --page --at makes the frame on that page at that place; a page not there exits 1; --at that is not x,y is usage", async () => {
  const a = await ann();
  expect(await a.pages({ kind: "page new", canvas, name: "Patterns" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "created", key: "patterns" }]);

  const put = { kind: "put", canvas, file: a.file } as const;
  expect(await a.frames({ ...put, page: "patterns", at: "40,1200" })).toBe(0);
  const [made] = a.lines();
  expect(await a.frames({ kind: "ls", canvas })).toBe(0);
  expect(a.lines()).toMatchObject([
    { frames: [{ id: made.id, page: "patterns", x: 40, y: 1200 }] },
  ]);

  expect(await a.frames({ ...put, page: "nope" })).toBe(1);
  expect(a.lines()).toEqual([{ kind: "gone" }]);
  expect(await a.frames({ ...put, at: "1,-2" })).toBe(64);
  expect(await a.frames({ ...put, at: "100001,0" })).toBe(64);
  expect(a.lines()).toEqual([
    { usage: "--at takes x,y in CSS pixels, each a whole number from 0 to 100000, as 0,1200" },
    { usage: "--at takes x,y in CSS pixels, each a whole number from 0 to 100000, as 0,1200" },
  ]);
  expect(await a.frames({ ...put, id: String(made.id), base: "1", page: "patterns" })).toBe(64);
  expect(a.lines()[0].usage).toContain("--page and --at do not go with --id");
});

test("move: moved exits 0, the same place exits 0 with unchanged, a frame or a page not there exits 1, a bad --at is usage", async () => {
  const a = await ann(false);
  await a.pages({ kind: "page new", canvas, name: "Two" });
  await a.frames({ kind: "put", canvas, file: a.file });
  const id = /created ([0-9a-f]{12})/.exec(a.said())?.[1] ?? "";

  expect(await a.pages({ kind: "move", canvas, id, at: "10,20", page: "two" })).toBe(0);
  expect(a.said()).toBe(`moved ${id} to 10,20 on two\n`);
  expect(await a.pages({ kind: "move", canvas, id, at: "10,20" })).toBe(0);
  expect(a.said()).toBe(`${id} is at 10,20 already\n`);
  expect(await a.pages({ kind: "move", canvas, id, at: "0,0", page: "nope" })).toBe(1);
  expect(a.said()).toContain(`no frame ${id} on flow, or no page nope`);
  expect(await a.pages({ kind: "move", canvas, id: "0123456789ab", at: "0,0" })).toBe(1);
  expect(a.said()).toContain("no frame 0123456789ab on flow:");
  expect(await a.pages({ kind: "move", canvas, id, at: "x" })).toBe(64);
  expect(a.said()).toContain("--at takes x,y");
  expect(await a.frames({ kind: "ls", canvas })).toBe(0);
  expect(a.said()).toContain(`${id}\tuntitled\ttwo\t10,20 1440x900\tv1\texploring`);
});

test("pages lists each page with its count; page new, rename, rm and order with each answer", async () => {
  const a = await ann(false);
  await a.frames({ kind: "put", canvas, file: a.file });
  a.said();

  expect(await a.pages({ kind: "pages", canvas })).toBe(0);
  expect(a.said()).toBe("page-1\tPage 1\t1 frame\n");
  expect(await a.pages({ kind: "pages", canvas: "none" })).toBe(1);
  expect(a.said()).toBe("no canvas none\n");

  expect(await a.pages({ kind: "page new", canvas, name: "Read me" })).toBe(0);
  expect(a.said()).toBe("read-me\n");
  expect(await a.pages({ kind: "page new", canvas, name: "read  me" })).toBe(1);
  expect(a.said()).toContain("a page of flow has that name or key");
  expect(await a.pages({ kind: "page new", canvas: "none", name: "X" })).toBe(1);
  expect(a.said()).toBe("no canvas none\n");
  expect(await a.pages({ kind: "page new", canvas, name: "!!" })).toBe(65);
  expect(a.said()).toContain("not a page name: a page name needs a letter or a digit");
  for (let n = 3; n <= 50; n++) await a.pages({ kind: "page new", canvas, name: `P ${n}` });
  a.said();
  expect(await a.pages({ kind: "page new", canvas, name: "One more" })).toBe(1);
  expect(a.said()).toContain("flow has 50 pages, the most it can have");

  expect(await a.pages({ kind: "page rename", canvas, page: "read-me", name: "Start" })).toBe(0);
  expect(a.said()).toBe("renamed read-me; its key stays read-me\n");
  expect(await a.pages({ kind: "page rename", canvas, page: "read-me", name: "page 1" })).toBe(1);
  expect(a.said()).toContain("another page of flow has that name");
  expect(await a.pages({ kind: "page rename", canvas, page: "nope", name: "X" })).toBe(1);
  expect(a.said()).toContain("no page nope on flow");
  expect(await a.pages({ kind: "page rename", canvas, page: "read-me", name: " " })).toBe(65);
  a.said();

  expect(await a.pages({ kind: "page order", canvas, pages: ["read-me"] })).toBe(0);
  expect(a.said()).toBe("ordered the pages of flow\n");
  expect(await a.pages({ kind: "page order", canvas, pages: ["nope"] })).toBe(1);
  expect(a.said()).toContain("no canvas flow, or a page that it does not have");
  await a.pages({ kind: "pages", canvas });
  expect(a.said().split("\n").slice(0, 2)).toEqual([
    "read-me\tStart\t0 frames",
    "page-1\tPage 1\t1 frame",
  ]);

  expect(await a.pages({ kind: "page rm", canvas, page: "page-1" })).toBe(1);
  expect(a.said()).toContain("page page-1 has 1 frame: move each to another page first");
  expect(await a.pages({ kind: "page rm", canvas, page: "read-me" })).toBe(0);
  expect(a.said()).toBe("deleted page read-me\n");
  expect(await a.pages({ kind: "page rm", canvas, page: "read-me" })).toBe(1);
  expect(a.said()).toContain("no page read-me on flow");
});

test("page rm of the last page exits 1 and says so", async () => {
  const a = await ann(false);
  expect(await a.pages({ kind: "page rm", canvas, page: "page-1" })).toBe(1);
  expect(a.said()).toBe("page-1 is the last page of flow: a canvas has one page at least\n");
});

async function main(args: string[]) {
  const out: string[] = [];
  const codes: number[] = [];
  const stop = new AbortController();

  const free = Bun.serve({ port: 0, fetch: () => new Response(null) });
  const port = free.port;
  await free.stop();
  const app = await easelCmd.default({
    env: { HOME: tmpdir(), EASEL_TOKEN: "t0ken", EASEL_SERVER: `localhost:${port}` },
    args,
    cwd: root,
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: (code) => (codes.push(code), stop.abort()),
  });
  await app.closed;
  return { code: codes[0], out: out.join("") };
}

test("the command line: --help names each page command; a right command reaches the server (69 here), a wrong one is usage (64)", async () => {
  const help = (await main(["--help"])).out;
  for (const line of [
    "easel put <canvas> <file|dir|-> [--name N] [--size WxH] [--page P] [--at x,y]",
    "easel move <canvas> <id> --at <x>,<y> [--page P]",
    "easel pages <canvas>",
    "easel page new <canvas> <name>",
    "easel page rename <canvas> <page> <name>",
    "easel page rm <canvas> <page>",
    "easel page order <canvas> <page>...",
  ]) {
    expect(help).toContain(line);
  }

  const doc = join(mkdtempSync(join(tmpdir(), "easel-cli-pages-")), "a.html");
  writeFileSync(doc, "<p>a</p>");
  const reaches = [
    ["put", "flow", doc, "--page", "two", "--at", "1,2"],
    ["move", "flow", "0123456789ab", "--at", "1,2", "--page", "two"],
    ["pages", "flow"],
    ["page", "new", "flow", "Two"],
    ["page", "rename", "flow", "two", "Second"],
    ["page", "rm", "flow", "two"],
    ["page", "order", "flow", "two", "page-1"],
  ];
  for (const args of reaches) {
    expect({ args, code: (await main(args)).code }).toEqual({ args, code: 69 });
  }

  const wrong = [
    ["move", "flow", "0123456789ab"],
    ["move", "flow", "0123456789ab", "--at", "1,2", "--page", "Not A Key"],
    ["pages"],
    ["page", "new", "flow"],
    ["page", "rename", "flow", "two"],
    ["page", "order", "flow"],
  ];
  for (const args of wrong) {
    expect({ args, code: (await main(args)).code }).toEqual({ args, code: 64 });
  }
});
