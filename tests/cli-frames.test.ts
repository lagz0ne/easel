import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { framesRun, stdinText } from "@/cli/frames";
import type { FramesCommand } from "@/cli/frames";
import { frames } from "@/frames";
import { framesApi, maxDocBytes, maxMadeCssBytes, maxSentDocBytes } from "@/frames/contract";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";

// `easel canvas new|ls`, `put`, `ls`, `get` and `rm` (SPEC-frames.md § Journeys) as the cmd runs
// them: the CLI's capsule over the memory transport, each command's exit code by frames'
// success lists (SPEC-cli fact rule 3), and the shell's fault exits through the frames bridge.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

const origin = "https://easel.test";

/** A `frame.list` that never answers, so the CLI's deadline ends it. */
const hangingList = operation({
  label: "test.hangingList",
  input: framesApi["frame.list"].input,
  run: async (_, { clock, signal }) => {
    await clock.sleep(3_600_000, signal);
    return { kind: "gone" as const };
  },
});

/** A `frame.delete` that never answers, so the CLI's deadline ends it. */
const hangingDelete = operation({
  label: "test.hangingDelete",
  input: framesApi["frame.delete"].input,
  run: async (_, { clock, signal }) => {
    await clock.sleep(3_600_000, signal);
    return { kind: "gone" as const };
  },
});

/** A `frame.get` that throws: the server's `failed` fault. */
const brokenGet = operation({
  label: "test.brokenGet",
  input: framesApi["frame.get"].input,
  run: () => {
    throw new Error("a bug on the server");
  },
});

/** `hang`: list and delete never answer. `noFrames`: a server older than frames, without its api. */
type Boot = { hang?: boolean; broken?: boolean; noFrames?: boolean };

/** One server: access and frames on SQLite in memory, and a memory transport. */
async function boot(options: Boot = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const implement = {
    ...framesOps,
    ...(options.hang ? { "frame.list": hangingList, "frame.delete": hangingDelete } : {}),
    ...(options.broken ? { "frame.get": brokenGet } : {}),
  };
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
      ...(options.noFrames
        ? []
        : [
            frames.api({ implement, onStart: [user] }),
            frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
          ]),
      memory.server({
        services: [
          access.login,
          access.user,
          access.owner,
          ...(options.noFrames ? [] : [frames.api]),
        ],
      }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, setupCode };
}

type Srv = Awaited<ReturnType<typeof boot>>;

type Options = { json?: boolean; stdin?: string; path?: string };

/** One CLI, as the cmd builds it: what it prints, its runs, and a folder for its files. */
async function easel(srv: Srv, options: Options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-frames-"));
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
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => err.push(chunk) },
        json: options.json ?? true,
        server: origin,
        hosts: options.path ?? join(dir, "hosts.json"),
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
    run: (command: FramesCommand) => scope.run(framesRun, { input: command }),
    login: () =>
      scope.run(cli.run, {
        input: { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false },
      }),
    /** Each JSON line printed since the last read. */
    lines: () =>
      out
        .splice(0)
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

/** Ann, the first owner, signed in on her own CLI, and a canvas `flow`. */
async function ann(srv: Srv, options: Options = {}) {
  const a = await easel(srv, options);
  expect(await a.login()).toBe(0);
  a.lines();
  expect(await a.run({ kind: "canvas new", name: "Flow" })).toBe(0);
  a.lines();

  return a;
}

/** Ann's CLI, the frame she put, and its id. */
async function withFrame(srv: Srv, html = "<p>1</p>") {
  const a = await ann(srv);
  expect(await a.run({ kind: "put", canvas: "flow", file: a.file("one.html", html) })).toBe(0);
  const [made] = a.lines();

  return { a, id: String(made.id) };
}

// ---- easel canvas new|ls

test("canvas new prints the key and exits 0; a taken key exits 1; a name with no key exits 65 and sends nothing", async () => {
  const srv = await boot();
  const a = await ann(srv);
  expect(await a.run({ kind: "canvas new", name: "Checkout Flow" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "created", key: "checkout-flow" }]);
  expect(await a.run({ kind: "canvas new", name: "checkout flow" })).toBe(1);
  expect(a.lines()).toEqual([{ kind: "taken" }]);
  expect(await a.run({ kind: "canvas new", name: "!!!" })).toBe(65);
  expect(a.lines()).toMatchObject([{ invalid: { name: [expect.any(String)] } }]);

  expect(await a.run({ kind: "canvas ls" })).toBe(0);
  expect(a.lines()).toEqual([
    {
      canvases: [
        { key: "flow", name: "Flow", created: srv.clock.currentTimeMillis(), shared: false },
        {
          key: "checkout-flow",
          name: "Checkout Flow",
          created: srv.clock.currentTimeMillis(),
          shared: false,
        },
      ],
    },
  ]);
});

test("canvas ls and ls print one line per canvas or frame without --json", async () => {
  const srv = await boot();
  const a = await easel(srv, { json: false });

  expect(await a.login()).toBe(0);
  a.out.splice(0);
  expect(await a.run({ kind: "canvas ls" })).toBe(0);
  expect(a.out.join("")).toContain("no canvas yet");
  a.out.splice(0);
  await a.run({ kind: "canvas new", name: "Flow" });
  await a.run({ kind: "put", canvas: "flow", file: a.file("x.html", "<p/>"), name: "home" });
  a.out.splice(0);
  expect(await a.run({ kind: "ls", canvas: "flow" })).toBe(0);
  expect(a.out.join("")).toMatch(/^[0-9a-f]{12}\thome\t0,0 1440x900\tv1\n$/);
});

// ---- easel put

test("put makes a frame and exits 0; a put with --id at its version exits 0, updated or unchanged", async () => {
  const srv = await boot();
  const { a, id } = await withFrame(srv);
  const file = a.file("two.html", "<p>2</p>");

  expect(await a.run({ kind: "put", canvas: "flow", file, id, base: "1" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "updated", id, version: 2, findings: [], more: 0 }]);
  expect(await a.run({ kind: "put", canvas: "flow", file, id, base: "2" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "unchanged", id, version: 2, findings: [], more: 0 }]);
});

test("put on an old version exits 1, stale, and says how to get the frame again", async () => {
  const srv = await boot();
  const { a, id } = await withFrame(srv);
  await a.run({ kind: "put", canvas: "flow", file: a.file("a.html", "<p>a</p>"), id, base: "1" });
  a.lines();
  const b = await easel(srv, { json: false, path: join(a.dir, "hosts.json") });

  expect(
    await b.run({ kind: "put", canvas: "flow", file: a.file("b.html", "<p>b</p>"), id, base: "1" }),
  ).toBe(1);
  expect(b.err.join("")).toContain(`stale: ${id} is at v2, nothing was written`);
  expect(b.err.join("")).toContain("--base 2");
});

test("put with --id on a frame that is not there, or on a canvas that is not there, exits 1, gone", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const file = a.file("x.html", "<p/>");

  expect(await a.run({ kind: "put", canvas: "flow", file, id: "0123456789ab", base: "1" })).toBe(1);
  expect(await a.run({ kind: "put", canvas: "nowhere", file })).toBe(1);
  expect(a.lines()).toEqual([{ kind: "gone" }, { kind: "gone" }]);
  expect(await a.run({ kind: "ls", canvas: "flow" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "found", frames: [] }]);
});

test("put: --id needs --base, --base needs --id, and --name or --size with --id is bad usage, 64 (C5)", async () => {
  const srv = await boot();
  const { a, id } = await withFrame(srv);
  const file = a.file("x.html", "<p>x</p>");
  const bad: FramesCommand[] = [
    { kind: "put", canvas: "flow", file, id },
    { kind: "put", canvas: "flow", file, base: "1" },
    { kind: "put", canvas: "flow", file, id, base: "1", name: "n" },
    { kind: "put", canvas: "flow", file, id, base: "1", size: "1x1" },
    { kind: "put", canvas: "flow", file: join(a.dir, "missing.html") },
    { kind: "put", canvas: "flow", file: "-" },
  ];
  for (const command of bad) expect(await a.run(command)).toBe(64);

  expect(a.lines().map((line) => Object.keys(line))).toEqual(bad.map(() => ["usage"]));
  expect(await a.run({ kind: "get", canvas: "flow", id })).toBe(0);
  expect(a.lines()).toMatchObject([{ frame: { version: 1 } }]);
});

test("put with --base 0, --size 0x5 or --id that is no id exits 64 with one line that names the flag", async () => {
  const srv = await boot();
  const { a, id } = await withFrame(srv);
  const file = a.file("x.html", "<p>x</p>");

  expect(await a.run({ kind: "put", canvas: "flow", file, id, base: "0" })).toBe(64);
  expect(await a.run({ kind: "put", canvas: "flow", file, size: "0x5" })).toBe(64);
  expect(await a.run({ kind: "put", canvas: "flow", file, size: "wide" })).toBe(64);
  expect(await a.run({ kind: "put", canvas: "flow", file, id: "nothex", base: "1" })).toBe(64);
  expect(a.lines()).toEqual([
    { usage: "--base takes the version you got, 1 or more: `easel get` prints it" },
    { usage: "--size takes WxH in CSS pixels, each 1 to 16000, as 390x844" },
    { usage: "--size takes WxH in CSS pixels, each 1 to 16000, as 390x844" },
    { usage: "--id takes a frame's id, 12 of 0-9 and a-f: `easel ls <canvas>` prints them" },
  ]);
  expect(await a.run({ kind: "ls", canvas: "flow" })).toBe(0);
  expect(a.lines()).toMatchObject([{ frames: [{ id, version: 1 }] }]);
});

test("put - reads the document from stdin", async () => {
  const srv = await boot();
  const a = await ann(srv, { stdin: "<p>from stdin</p>" });

  expect(await a.run({ kind: "put", canvas: "flow", file: "-" })).toBe(0);
  const [made] = a.lines();
  expect(await a.run({ kind: "get", canvas: "flow", id: String(made.id) })).toBe(0);
  expect(a.lines()).toMatchObject([{ frame: { html: "<p>from stdin</p>" } }]);
});

// ---- easel put: the findings of the kit check (SPEC-cli.md § Learn the kit, SPEC-kit K5)

test("put prints each finding on stderr as file:line:col rule what. Fix: fix, at most 20, then the count; it exits 0", async () => {
  const srv = await boot();
  const a = await easel(srv, { json: false });
  expect(await a.login()).toBe(0);
  await a.run({ kind: "canvas new", name: "Flow" });
  a.out.splice(0);
  a.err.splice(0);
  const file = a.file(
    "page.html",
    `<p class="p-4 text-red-500">a</p>\n<i class="bgg-primary"></i>`,
  );

  expect(await a.run({ kind: "put", canvas: "flow", file })).toBe(0);
  expect(a.out.join("")).toMatch(/^created [0-9a-f]{12} v1\n$/);
  expect(a.err.splice(0)).toEqual([
    `${file}:1:15 look/color "text-red-500" is a color of Tailwind's palette, not of the look. Fix: use text-destructive\n`,
    `${file}:2:11 kit/class "bgg-primary" is not a class of the kit or of the look. Fix: use bg-primary\n`,
  ]);

  const many = Array.from({ length: 25 }, (_, i) => `<p class="bgg-primary">${i}</p>`);
  expect(
    await a.run({ kind: "put", canvas: "flow", file: a.file("many.html", many.join("")) }),
  ).toBe(0);
  const told = a.err.splice(0);
  expect(told).toHaveLength(21);
  expect(told.at(-1)).toBe("and 5 more\n");
});

test("put --json answers the findings in the answer, and prints nothing more", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const file = a.file("page.html", `<p class="text-red-500">a</p>`);

  expect(await a.run({ kind: "put", canvas: "flow", file })).toBe(0);
  expect(a.lines()).toMatchObject([
    { kind: "created", findings: [{ line: 1, col: 11, rule: "look/color" }], more: 0 },
  ]);
  expect(a.err).toEqual([]);
});

test("put of a document whose made CSS would be over 256 KiB exits 1, tooBig, and says so", async () => {
  const srv = await boot();
  const a = await easel(srv, { json: false });
  expect(await a.login()).toBe(0);
  await a.run({ kind: "canvas new", name: "Flow" });
  const classes = Array.from({ length: 9000 }, (_, i) => `w-[${i + 1}px]`).join(" ");

  expect(
    await a.run({
      kind: "put",
      canvas: "flow",
      file: a.file("wide.html", `<p class="${classes}">`),
    }),
  ).toBe(1);
  expect(a.err.join("")).toContain(`its made CSS would be over ${maxMadeCssBytes} bytes`);
}, 30_000);

test("put of a document over 1 MiB of UTF-8 exits 1, tooBig, and sends nothing", async () => {
  const srv = await boot();
  const a = await ann(srv);

  expect(
    await a.run({ kind: "put", canvas: "flow", file: a.file("big.html", "é".repeat(600_000)) }),
  ).toBe(1);
  expect(a.lines()).toEqual([{ kind: "tooBig", maxBytes: maxDocBytes }]);
  await a.run({ kind: "ls", canvas: "flow" });
  expect(a.lines()).toEqual([{ kind: "found", frames: [] }]);
});

test("put of a document under 1 MiB whose JSON is over the socket's limit exits 1, tooBig, and sends nothing", async () => {
  const srv = await boot();
  const a = await ann(srv);
  // 1 MiB less one of `"`: under maxDocBytes as UTF-8, but each is `\"` as JSON, 2 bytes.
  const quotes = '"'.repeat(maxDocBytes - 1);
  expect(Buffer.byteLength(JSON.stringify(quotes))).toBeGreaterThan(maxSentDocBytes);

  expect(await a.run({ kind: "put", canvas: "flow", file: a.file("q.html", quotes) })).toBe(1);
  expect(a.lines()).toEqual([{ kind: "tooBig", maxBytes: maxDocBytes }]);
  await a.run({ kind: "ls", canvas: "flow" });
  expect(a.lines()).toEqual([{ kind: "found", frames: [] }]);
  // Under the limit as JSON, quotes go: half a MiB of them.
  const half = '"'.repeat(maxDocBytes / 2);
  expect(await a.run({ kind: "put", canvas: "flow", file: a.file("h.html", half) })).toBe(0);
});

// ---- easel ls, get, rm

test("ls exits 0 with the frames, and 1 for a canvas that is not there", async () => {
  const srv = await boot();
  const { a, id } = await withFrame(srv);

  expect(await a.run({ kind: "ls", canvas: "flow" })).toBe(0);
  expect(a.lines()).toEqual([
    { kind: "found", frames: [{ id, name: "untitled", x: 0, y: 0, w: 1440, h: 900, version: 1 }] },
  ]);
  expect(await a.run({ kind: "ls", canvas: "nowhere" })).toBe(1);
  expect(a.lines()).toEqual([{ kind: "gone" }]);
});

test("get -o writes the document to the file and prints the version; without -o it prints the document", async () => {
  const srv = await boot();
  const { a, id } = await withFrame(srv, "<p>é</p>");
  const out = join(a.dir, "got.html");
  expect(await a.run({ kind: "get", canvas: "flow", id, out })).toBe(0);
  expect(readFileSync(out, "utf8")).toBe("<p>é</p>");
  expect(a.lines()).toEqual([
    {
      kind: "found",
      frame: { id, name: "untitled", x: 0, y: 0, w: 1440, h: 900, version: 1 },
      file: out,
    },
  ]);

  const plain = await easel(srv, { json: false, path: join(a.dir, "hosts.json") });
  expect(await plain.run({ kind: "get", canvas: "flow", id })).toBe(0);
  expect(plain.out.join("")).toBe("<p>é</p>\n");
  expect(await plain.run({ kind: "get", canvas: "flow", id: "0123456789ab" })).toBe(1);
  expect(plain.err.join("")).toContain("no frame 0123456789ab on flow");
});

test("rm exits 0, deleted; a second rm exits 1, gone", async () => {
  const srv = await boot();
  const { a, id } = await withFrame(srv);

  expect(await a.run({ kind: "rm", canvas: "flow", id })).toBe(0);
  expect(await a.run({ kind: "rm", canvas: "flow", id })).toBe(1);
  expect(a.lines()).toEqual([{ kind: "deleted" }, { kind: "gone" }]);
});

// ---- The shell's fault exits, through the frames bridge

test("each frames command without a sign-in exits 2, refused", async () => {
  const srv = await boot();
  await ann(srv);
  const guest = await easel(srv);
  const file = guest.file("x.html", "<p/>");
  const commands: FramesCommand[] = [
    { kind: "canvas new", name: "x" },
    { kind: "canvas ls" },
    { kind: "put", canvas: "flow", file },
    { kind: "ls", canvas: "flow" },
    { kind: "get", canvas: "flow", id: "0123456789ab" },
    { kind: "rm", canvas: "flow", id: "0123456789ab" },
  ];
  for (const command of commands) expect(await guest.run(command)).toBe(2);

  expect(guest.lines()).toEqual(commands.map(() => ({ refused: { signIn: true } })));
}, 30_000);

test("each frames command whose server is gone exits 69: cannot reach the server", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const file = a.file("x.html", "<p/>");
  const commands: FramesCommand[] = [
    { kind: "canvas new", name: "x" },
    { kind: "canvas ls" },
    { kind: "put", canvas: "flow", file },
    { kind: "ls", canvas: "flow" },
    { kind: "get", canvas: "flow", id: "0123456789ab" },
    { kind: "rm", canvas: "flow", id: "0123456789ab" },
  ];
  await srv.server.close();
  for (const command of commands) expect(await a.run(command)).toBe(69);

  expect(a.lines()).toEqual(commands.map(() => ({ unreachable: origin })));
});

test("a call with no answer in 60 s exits 69: the deadline ends it, not the late answer", async () => {
  const srv = await boot({ hang: true });
  const a = await ann(srv);
  const hung: FramesCommand[] = [
    { kind: "ls", canvas: "flow" },
    { kind: "rm", canvas: "flow", id: "0123456789ab" },
  ];
  for (const command of hung) {
    const run = a.run(command);
    await tick(50);
    srv.clock.advance(59_999);
    await tick(50);

    expect(a.out.join("")).toBe("");
    srv.clock.advance(1);
    await tick(50);
    // The memory transport settles an aborted call when its peer's run ends: the late answer,
    // `gone` (exit 1), then comes, and the CLI has already taken the deadline's `link` fault.
    srv.clock.advance(3_600_000);
    expect(await run).toBe(69);
    expect(a.lines()).toEqual([{ unreachable: origin }]);
  }
});

test("each frames command on a server without frames exits 76, missing, and names the call", async () => {
  const srv = await boot({ noFrames: true });
  const a = await easel(srv);
  expect(await a.login()).toBe(0);
  a.lines();
  const file = a.file("x.html", "<p/>");
  const commands: Array<[FramesCommand, string]> = [
    [{ kind: "canvas new", name: "x" }, "canvas.create"],
    [{ kind: "canvas ls" }, "canvas.list"],
    [{ kind: "put", canvas: "flow", file }, "frame.put"],
    [{ kind: "ls", canvas: "flow" }, "frame.list"],
    [{ kind: "get", canvas: "flow", id: "0123456789ab" }, "frame.get"],
    [{ kind: "rm", canvas: "flow", id: "0123456789ab" }, "frame.delete"],
  ];
  for (const [command] of commands) expect(await a.run(command)).toBe(76);

  expect(a.lines()).toEqual(commands.map(([, call]) => ({ missing: call })));
});

test("a server that fails exits 70 with the trace; the token is never printed", async () => {
  const srv = await boot({ broken: true });
  const { a, id } = await withFrame(srv);
  expect(await a.run({ kind: "get", canvas: "flow", id })).toBe(70);
  const [line] = a.lines();
  expect(Object.keys(line)).toEqual(["failed"]);
  // The trace the server gave the fault, so a person can find it: never null.
  expect(line.failed).toMatch(/^[\w-]{8,}$/);

  const hosts = readFileSync(join(a.dir, "hosts.json"), "utf8");
  const token = String(JSON.parse(hosts).hosts[origin].user.token);
  expect(token.length).toBeGreaterThan(20);
  expect(a.out.join("") + a.err.join("")).not.toContain(token);
});
