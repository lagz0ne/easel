import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { makeTestClock, memory, preset } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { routes } from "~/components/requests/index.server";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { cli } from "@/cli";
import { framesRun, pictureFetch, shotTries } from "@/cli/frames";
import type { FramesCommand } from "@/cli/frames";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { drawPage, pictureRoute, picturesServer } from "@/frames/pictures.server";
import { framesServer } from "@/frames/store.server";

// `easel shot <canvas> <id> -o <file> [--scale] [--region]` (SPEC-frames.md § Pictures, § Journeys)
// as the cmd runs it: `frame.shot` over the memory transport, then the picture from the route,
// fetched with no port. A test draw stands in for Chromium. Exits: 0 written, 1 off, gone or 404,
// 65 a picture too big or off the frame, 69 busy after 3 tries, 64 a bad flag.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 5) => new Promise((done) => setTimeout(done, ms));

const origin = "https://easel.test";

type Boot = { chromium?: string | null; draw?: "ok" | "fail" };

/** One server: access, pictures and frames on SQLite in memory, the route, a memory transport. */
async function boot(options: Boot = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const stop = new AbortController();
  const drawn: string[] = [];
  const server = await createScope({
    clock,
    presets: [
      preset(drawPage, async (_, { input }) => {
        drawn.push(input.html);
        if (options.draw === "fail") throw new Error("Chromium crashed");
        return new TextEncoder().encode(`webp:${input.html}`);
      }),
    ],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      picturesServer({
        chromium: options.chromium === undefined ? process.execPath : options.chromium,
        database: ":memory:",
      }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      memory.server({ services: [access.login, access.user, access.owner, frames.api] }),
      routes({
        stop: stop.signal,
        table: { "GET /api/pictures/{canvas}/{id}/{version}": pictureRoute },
      }),
    ],
  }).ready;
  closers.push(() => (stop.abort(), server.close()));
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";
  const route = server.resolve(routes).fetch;
  const asked: string[] = [];
  /** The server's picture route, as the CLI's fetch reaches it. */
  const send = async (request: Request) => {
    asked.push(request.url);
    const answer = await route(request, server);
    if (!answer) throw new Error(`no route answers ${request.url}`);
    return answer;
  };

  return { server, clock, setupCode, send, asked, drawn };
}

type Srv = Awaited<ReturnType<typeof boot>>;

/** Ann's CLI, signed in, with a canvas `flow` and one frame on it. `fetch`: how it reaches pictures. */
async function ann(srv: Srv, options: { json?: boolean; fetch?: typeof srv.send } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-shot-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const out: string[] = [];
  const err: string[] = [];
  const scope = await createScope({
    clock: srv.clock,
    tags: [pictureFetch(options.fetch ?? srv.send)],
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
        hosts: join(dir, "hosts.json"),
      }),
    ],
  }).ready;
  closers.push(() => scope.close());
  const run = (command: FramesCommand) => scope.run(framesRun, { input: command });

  expect(
    await scope.run(cli.run, {
      input: { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false },
    }),
  ).toBe(0);
  expect(await run({ kind: "canvas new", name: "Flow" })).toBe(0);
  const page = join(dir, "one.html");
  writeFileSync(page, "<p>1</p>");
  expect(await run({ kind: "put", canvas: "flow", file: page })).toBe(0);
  const made = /[0-9a-f]{12}/.exec(out.join("").trim().split("\n").at(-1) ?? "");
  out.splice(0);
  err.splice(0);

  return {
    dir,
    id: made?.[0] ?? "",
    out,
    err,
    run,
    file: join(dir, "shot.webp"),
    /** All it printed, both streams. */
    printed: () => [...out, ...err].join(""),
    lines: () =>
      [...out.splice(0), ...err.splice(0)]
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  };
}

/** A shot command on the frame. */
const shot = (
  id: string,
  out: string,
  flags: { scale?: string; region?: string } = {},
): FramesCommand => ({ kind: "shot", canvas: "flow", id, out, ...flags });

/** Runs `easel shot` while the test clock walks: each 1 s wait between tries passes. */
async function walking(srv: Srv, run: Promise<number>) {
  const state = { done: false };
  void run.finally(() => (state.done = true));
  for (let i = 0; i < 50 && !state.done; i++) {
    await tick();
    srv.clock.advance(1_000);
  }
  return run;
}

test("easel shot writes the current version's picture to the file and exits 0; the address and its key are never printed", async () => {
  const srv = await boot();
  const a = await ann(srv);

  expect(await a.run(shot(a.id, a.file))).toBe(0);
  expect(readFileSync(a.file, "utf8")).toBe("webp:<p>1</p>");
  const printed = a.printed();
  expect(a.lines()).toEqual([{ kind: "ready", version: 1, file: a.file }]);
  expect(printed).not.toMatch(/k=|\/api\/pictures/);
  expect(srv.asked).toEqual([
    expect.stringMatching(new RegExp(`^${origin}/api/pictures/flow/${a.id}/1\\?s=1&k=[\\w-]{43}$`)),
  ]);
});

test("easel shot sends --scale and --region with the address, and says what it wrote without --json", async () => {
  const srv = await boot();
  const a = await ann(srv, { json: false });

  expect(await a.run(shot(a.id, a.file, { scale: "0.5", region: "0,0,100,50" }))).toBe(0);
  expect(srv.asked[0]).toMatch(/\?s=0\.5&k=[\w-]+&r=0,0,100,50$/);
  expect(a.out.join("")).toBe(`${a.id} v1 written to ${a.file}\n`);
  expect(a.printed()).not.toMatch(/k=/);
});

test("easel shot with pictures off exits 1 and fetches nothing", async () => {
  const srv = await boot({ chromium: null });
  const a = await ann(srv);
  expect(await a.run(shot(a.id, a.file))).toBe(1);
  expect(a.lines()).toEqual([{ kind: "off" }]);
  expect(srv.asked).toEqual([]);
});

test("easel shot on a frame that is not there exits 1, gone", async () => {
  const srv = await boot();
  const a = await ann(srv);
  expect(await a.run(shot("000000000000", a.file))).toBe(1);
  expect(a.lines()).toEqual([{ kind: "gone" }]);
  expect(srv.asked).toEqual([]);
});

test("a bad --scale or --region exits 64 and asks the server nothing", async () => {
  const srv = await boot();
  const a = await ann(srv, { json: false });

  for (const flags of [
    { scale: "3" },
    { scale: "half" },
    { region: "1,2,3" },
    { region: "0,0,0,5" },
  ]) {
    expect(await a.run(shot(a.id, a.file, flags))).toBe(64);
  }

  expect(a.err.join("")).toMatch(/--scale takes 0\.25, 0\.5, 1 or 2/);
  expect(a.err.join("")).toMatch(/--region takes x,y,w,h/);
  expect(srv.asked).toEqual([]);
});

test("a region off the frame exits 65: the server answers 400", async () => {
  const srv = await boot();
  const a = await ann(srv);

  // The clock walks: a retry would come back, and be counted, not hang.
  expect(await walking(srv, a.run(shot(a.id, a.file, { region: "0,0,1441,10" })))).toBe(65);
  expect(a.lines()).toEqual([{ kind: "failed", status: 400 }]);
  expect(srv.asked).toHaveLength(1);
  expect(srv.drawn).toEqual([]);
});

test("a server busy 3 times exits 69, waiting Retry-After between tries", async () => {
  const srv = await boot({ draw: "fail" });
  const a = await ann(srv);

  expect(await walking(srv, a.run(shot(a.id, a.file)))).toBe(69);

  expect(srv.asked).toHaveLength(shotTries);
  expect(srv.drawn).toHaveLength(shotTries);
  expect(a.lines()).toEqual([{ kind: "failed", status: 503 }]);
});

test("a busy server that draws on the next try: exit 0", async () => {
  const srv = await boot();
  const a = await ann(srv, {
    fetch: async (request) =>
      srv.asked.push(request.url) === 1
        ? new Response(null, { status: 503, headers: { "Retry-After": "1" } })
        : srv.send(request),
  });
  expect(await walking(srv, a.run(shot(a.id, a.file)))).toBe(0);
  expect(srv.asked).toHaveLength(3);
  expect(readFileSync(a.file, "utf8")).toBe("webp:<p>1</p>");
});

test("a Retry-After over 5 s is waited 5 s", async () => {
  const srv = await boot();
  const a = await ann(srv, {
    fetch: async (request) =>
      srv.asked.push(request.url) === 1
        ? new Response(null, { status: 503, headers: { "Retry-After": "3600" } })
        : srv.send(request),
  });
  const ran = a.run(shot(a.id, a.file));
  await tick(20);
  expect(srv.asked).toHaveLength(1);

  srv.clock.advance(4_999);
  await tick(20);
  expect(srv.asked).toHaveLength(1);
  srv.clock.advance(1);
  for (let i = 0; i < 100 && srv.asked.length < 2; i++) await tick();
  expect(srv.asked).toHaveLength(3);
  expect(await ran).toBe(0);
});

test("a server out of reach 3 times exits 69", async () => {
  const srv = await boot();
  const tries: string[] = [];
  const a = await ann(srv, {
    fetch: async (request) => {
      tries.push(request.url);
      throw new TypeError("connection refused");
    },
  });
  expect(await walking(srv, a.run(shot(a.id, a.file)))).toBe(69);
  expect(tries).toHaveLength(shotTries);
});

test("a picture gone by the fetch (404) exits 1; any other status exits 70; neither is tried again", async () => {
  for (const [status, exit] of [
    [404, 1],
    [500, 70],
  ] as const) {
    const srv = await boot();
    const tries: string[] = [];
    const a = await ann(srv, {
      fetch: async (request) => (tries.push(request.url), new Response(null, { status })),
    });

    // The clock walks: a retry would come back, and be counted, not hang.
    expect(await walking(srv, a.run(shot(a.id, a.file)))).toBe(exit);

    expect(a.lines()).toEqual([{ kind: "failed", status }]);
    expect(tries).toHaveLength(1);
  }
});
