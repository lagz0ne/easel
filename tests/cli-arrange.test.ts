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
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-arrange-"));
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

async function flow(a: Awaited<ReturnType<typeof ann>>, count: number) {
  const ids: string[] = [];
  for (let n = 1; n <= count; n++) {
    const place = ids.length === 0 ? { section: "Checkout" } : { after: ids[ids.length - 1] };
    expect(await a.frames({ kind: "put", canvas, file: a.file, size: "390x844", ...place })).toBe(
      0,
    );
    ids.push(/created ([0-9a-f]{12})/.exec(a.said())?.[1] ?? "");
  }
  return ids;
}

test("put --section and --after place a flow; ls names the section; two places, --page with --after, or a relation with --id is usage", async () => {
  const a = await ann(false);
  const [one = "", two = ""] = await flow(a, 2);

  expect(await a.frames({ kind: "ls", canvas })).toBe(0);
  const listed = a.said();
  expect(listed).toContain(
    `${one}\tuntitled\tpage-1\t0,120 390x844\tv1\texploring\tsection Checkout`,
  );
  expect(listed).toContain(
    `${two}\tuntitled\tpage-1\t470,120 390x844\tv1\texploring\tsection Checkout`,
  );

  expect(await a.frames({ kind: "put", canvas, file: a.file, below: one })).toBe(0);
  expect(a.said()).toMatch(/^created [0-9a-f]{12} v1\n$/);

  const put = { kind: "put", canvas, file: a.file } as const;
  const bad = [
    [
      { ...put, after: one, section: "Checkout" },
      "give one place: --at, --after, --below or --section",
    ],
    [{ ...put, at: "0,0", below: one }, "give one place"],
    [{ ...put, after: one, page: "page-1" }, "--page does not go with --after or --below"],
    [
      { ...put, id: one, base: "1", section: "Checkout" },
      "--after, --below, --section and --rev do not go with --id",
    ],
    [{ ...put, after: "nope" }, "--after takes a frame's id"],
    [{ ...put, below: "nope" }, "--below takes a frame's id"],
    [{ ...put, section: "!!" }, "--section takes a name"],
    [{ ...put, rev: "-1" }, "--rev takes the revision you read"],
  ] as const;
  for (const [command, words] of bad) {
    expect(await a.frames(command)).toBe(64);
    expect(a.said()).toContain(words);
  }
});

test("put answers changed on an old --rev and placed after a frame with an exact place, exits 1, and writes nothing; each finding is a line on stderr", async () => {
  const a = await ann(false);
  await flow(a, 1);
  expect(await a.frames({ kind: "put", canvas, file: a.file, at: "0,0", size: "100x100" })).toBe(0);
  const fixed = /created ([0-9a-f]{12})/.exec(a.said())?.[1] ?? "";

  expect(
    await a.frames({ kind: "put", canvas, file: a.file, section: "Checkout", rev: "99" }),
  ).toBe(1);
  expect(a.said()).toMatch(/^changed: the canvas is at revision \d+ now, and nothing was written/);
  expect(await a.frames({ kind: "put", canvas, file: a.file, after: fixed })).toBe(1);
  expect(a.said()).toContain(`placed: ${fixed} has an exact place`);

  expect(await a.frames({ kind: "put", canvas, file: a.file, at: "50,50", size: "100x100" })).toBe(
    0,
  );
  const near = /created ([0-9a-f]{12})/.exec(a.out.join(""))?.[1] ?? "";
  expect(a.said()).toBe(`created ${near} v1\ntouch ${fixed} ${near}\n`);
});

test("move --size, --after, --below and --section place the frame and say where; no place is usage; changed, placed and gone exit 1", async () => {
  const a = await ann(false);
  const [one = "", two = "", three = ""] = await flow(a, 3);
  const move = { kind: "move", canvas } as const;

  expect(await a.pages({ ...move, id: two, size: "690x844" })).toBe(0);
  expect(a.said()).toBe(`moved ${two} at size 690x844\n`);
  expect(await a.pages({ ...move, id: three, after: one })).toBe(0);
  expect(a.said()).toBe(`moved ${three} after ${one}\n`);
  expect(await a.pages({ ...move, id: three, after: one })).toBe(0);
  expect(a.said()).toBe(`${three} is after ${one} already\n`);
  expect(await a.pages({ ...move, id: two, below: one })).toBe(0);
  expect(a.said()).toBe(`moved ${two} below ${one}\n`);
  expect(await a.pages({ ...move, id: two, section: "Other" })).toBe(0);
  expect(a.said()).toBe(`moved ${two} in section Other\n`);
  expect(await a.pages({ ...move, id: one, at: "9000,0" })).toBe(0);
  expect(a.said()).toBe(`moved ${one} to 9000,0\n`);

  expect(await a.pages({ ...move, id: three, after: one })).toBe(1);
  expect(a.said()).toContain(`placed: ${one} has an exact place`);
  expect(await a.pages({ ...move, id: three, size: "100x100", rev: "999" })).toBe(1);
  expect(a.said()).toContain("and move with --rev");
  expect(await a.pages({ ...move, id: "0123456789ab", section: "Other" })).toBe(1);
  expect(a.said()).toContain("no frame 0123456789ab on flow");

  expect(await a.pages({ ...move, id: three })).toBe(64);
  expect(a.said()).toContain("a move needs a place");
  expect(await a.pages({ ...move, id: three, size: "big" })).toBe(64);
  expect(a.said()).toContain("--size takes WxH");
  expect(await a.pages({ ...move, id: three, at: "1,1", section: "Other" })).toBe(64);
  expect(a.said()).toContain("give one place");
});

test("section places, orders, wraps and spaces a section; layout lists the sections and exits 1 on a finding", async () => {
  const a = await ann(false);
  const [one = ""] = await flow(a, 3);

  expect(await a.pages({ kind: "section", canvas, name: "Checkout", wrap: "2", gap: "40" })).toBe(
    0,
  );
  expect(a.said()).toBe("set section Checkout on page-1\n");
  expect(await a.pages({ kind: "section", canvas, name: "Checkout", wrap: "2", gap: "40" })).toBe(
    0,
  );
  expect(a.said()).toBe("section Checkout on page-1 is so already\n");
  expect(
    await a.pages({ kind: "section", canvas, name: "Checkout", noWrap: true, at: "0,4000" }),
  ).toBe(0);
  a.said();
  expect(
    await a.pages({ kind: "section", canvas, name: "Checkout", flow: true, first: true }),
  ).toBe(0);
  a.said();

  expect(await a.pages({ kind: "layout", canvas })).toBe(0);
  const laid = a.said().split("\n");
  expect(laid[0]).toMatch(/^page page-1\trev \d+$/);
  expect(laid[1]).toMatch(/^section checkout\tCheckout\t0,0 \d+x\d+\t3 frames$/);
  expect(laid[2]).toBe("no touch and no stray");

  expect(await a.pages({ kind: "section", canvas, name: "Checkout", at: "0,0" })).toBe(0);
  a.said();
  expect(await a.frames({ kind: "put", canvas, file: a.file, at: "10,130", size: "50x50" })).toBe(
    0,
  );
  const stray = /created ([0-9a-f]{12})/.exec(a.said())?.[1] ?? "";
  expect(await a.pages({ kind: "layout", canvas })).toBe(1);
  const found = a.said();
  expect(found).toContain(`\tat\n`);
  expect(found).toContain(`touch ${one} ${stray}`);
  expect(found).toContain(`stray ${stray} Checkout`);

  expect(await a.pages({ kind: "section", canvas, name: "Checkout", gap: "40", rev: "999" })).toBe(
    1,
  );
  expect(a.said()).toContain("and set with --rev");
  expect(await a.pages({ kind: "section", canvas, name: "Nope", gap: "40" })).toBe(1);
  expect(a.said()).toContain("no section Nope on that page of flow");
  expect(await a.pages({ kind: "layout", canvas, page: "nope" })).toBe(1);
  expect(a.said()).toContain("no canvas flow, or no page nope");

  const usage = [
    [{ at: "1,1", flow: true }, "--at does not go with --flow"],
    [{ after: "Other", first: true }, "--after does not go with --first"],
    [{ wrap: "2", noWrap: true }, "--wrap does not go with --no-wrap"],
    [{}, "give a change"],
    [{ wrap: "0" }, "--wrap takes the most columns"],
    [{ gap: "8" }, "--gap takes the space"],
    [{ at: "x" }, "--at takes x,y"],
    [{ after: "!!" }, "--after takes the name of a section"],
    [{ rev: "x", gap: "40" }, "--rev takes the revision"],
  ] as const;
  for (const [flags, words] of usage) {
    expect(await a.pages({ kind: "section", canvas, name: "Checkout", ...flags })).toBe(64);
    expect(a.said()).toContain(words);
  }
  expect(await a.pages({ kind: "section", canvas, name: "!!", gap: "40" })).toBe(64);
  expect(a.said()).toContain("a section name has 1 to 80 characters");
});

test("with --json, a change prints its answer with the layout and no finding lines", async () => {
  const a = await ann(true);
  expect(await a.frames({ kind: "put", canvas, file: a.file, section: "Checkout" })).toBe(0);
  const [made] = a.lines();
  expect(made).toMatchObject({
    kind: "created",
    layout: { page: "page-1", findings: [], more: 0 },
  });

  expect(await a.frames({ kind: "put", canvas, file: a.file, at: "0,0" })).toBe(0);
  expect(a.lines()[0].layout.findings).toEqual([]);
  expect(a.err).toEqual([]);
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

test("the command line: --help names the place commands; a right one reaches the server (69 here), a wrong one is usage (64)", async () => {
  const help = (await main(["--help"])).out;
  for (const line of [
    "easel put <canvas> <file|dir|-> [--after <id> | --below <id> | --section <name>] [--rev <n>]",
    "easel move <canvas> <id> [--after <id> | --below <id> | --section <name>] [--page P] [--size WxH] [--rev <n>]",
    "easel section <canvas> <name> [--page P] [--at x,y | --flow] [--after <section> | --first]",
    "easel layout <canvas> [--page P]",
  ]) {
    expect(help).toContain(line);
  }

  const doc = join(mkdtempSync(join(tmpdir(), "easel-cli-arrange-")), "a.html");
  writeFileSync(doc, "<p>a</p>");
  const reaches = [
    ["put", "flow", doc, "--section", "Checkout", "--rev", "3"],
    ["put", "flow", doc, "--after", "0123456789ab"],
    ["put", "flow", doc, "--below", "0123456789ab"],
    ["move", "flow", "0123456789ab", "--after", "0123456789ac", "--size", "10x10", "--rev", "1"],
    ["move", "flow", "0123456789ab", "--below", "0123456789ac"],
    ["move", "flow", "0123456789ab", "--section", "Checkout", "--page", "two"],
    [
      "section",
      "flow",
      "Checkout",
      "--page",
      "two",
      "--at",
      "1,2",
      "--first",
      "--wrap",
      "3",
      "--gap",
      "40",
      "--rev",
      "2",
    ],
    ["section", "flow", "Checkout", "--flow", "--after", "Login", "--no-wrap"],
    ["layout", "flow"],
    ["layout", "flow", "--page", "two"],
  ];
  for (const args of reaches) {
    expect({ args, code: (await main(args)).code }).toEqual({ args, code: 69 });
  }

  const wrong = [
    ["section", "flow"],
    ["section", "flow", "Checkout", "--wrap"],
    ["layout"],
    ["layout", "flow", "--size", "1x1"],
    ["put", "flow", doc, "--after", "0123456789ab", "--page", "two"],
  ];
  for (const args of wrong) {
    expect({ args, code: (await main(args)).code }).toEqual({ args, code: 64 });
  }
});
