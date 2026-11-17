import { mkdtempSync, rmSync } from "node:fs";
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
import { userOps } from "@/access/users.server";
import { cli } from "@/cli";
import { framesRun } from "@/cli/frames";
import type { FramesCommand } from "@/cli/frames";
import { frames } from "@/frames";
import { framesApi } from "@/frames/contract";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { shareServer } from "@/frames/share.server";
import { framesServer } from "@/frames/store.server";

// `easel share <canvas>` (SPEC-frames.md § Share a canvas) as the cmd runs it: the CLI's capsule
// over the memory transport against the real share server on SQLite in memory. It prints the
// link's page on its own server (decision C4); `--password` is bad usage until passwords are built.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

const origin = "https://easel.test";

/** A `canvas.share` that never answers, so the CLI's deadline ends it. */
const hangingShare = operation({
  label: "test.hangingShare",
  input: framesApi["canvas.share"].input,
  run: async (_, { clock, signal }) => {
    await clock.sleep(3_600_000, signal);
    return { kind: "gone" as const };
  },
});

/** A `canvas.share` that throws: the server's `failed` fault. */
const brokenShare = operation({
  label: "test.brokenShare",
  input: framesApi["canvas.share"].input,
  run: () => {
    throw new Error("a bug on the server");
  },
});

/** A `canvas.share` that answers a path off the server: `//evil.example/s/<32 hex>`. */
const offSiteShare = operation({
  label: "test.offSiteShare",
  input: framesApi["canvas.share"].input,
  run: () => ({ kind: "shared" as const, path: `//evil.example/s/${"a".repeat(32)}` }),
});

/** One server: access, frames and share on SQLite in memory, and a memory transport. */
async function boot(share: "real" | "hang" | "broken" | "offSite" = "real") {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const stub = {
    hang: { "canvas.share": hangingShare },
    broken: { "canvas.share": brokenShare },
    offSite: { "canvas.share": offSiteShare },
  };
  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      shareServer(),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      frames.api({
        implement: { ...framesOps, ...(share === "real" ? {} : stub[share]) },
        onStart: [user],
      }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      memory.server({ services: [access.login, access.user, frames.api] }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, setupCode };
}

type Srv = Awaited<ReturnType<typeof boot>>;

/** One CLI, as the cmd builds it: what it prints, and its runs. */
async function easel(srv: Srv, json = true) {
  const dir = mkdtempSync(join(tmpdir(), "easel-share-cli-"));
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
        server: origin,
        hosts: join(dir, "hosts.json"),
      }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return {
    out,
    err,
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
async function ann(srv: Srv, json = true) {
  const a = await easel(srv, json);
  expect(await a.login()).toBe(0);
  expect(await a.run({ kind: "canvas new", name: "Flow" })).toBe(0);
  a.out.splice(0);

  return a;
}

const link = new RegExp(`^${origin}/s/[0-9a-f]{32}$`);

test("share prints <server>/s/<link> and exits 0; sharing again prints the same link; ls says shared", async () => {
  const srv = await boot();
  const a = await ann(srv);

  expect(await a.run({ kind: "share", canvas: "flow" })).toBe(0);
  const [first] = a.lines();
  expect(first).toEqual({ kind: "shared", url: expect.stringMatching(link) });
  expect(await a.run({ kind: "share", canvas: "flow" })).toBe(0);
  expect(a.lines()).toEqual([first]);

  expect(await a.run({ kind: "canvas ls" })).toBe(0);
  expect(a.lines()).toMatchObject([{ canvases: [{ key: "flow", shared: true }] }]);
});

test("without --json, share prints the URL alone on one line", async () => {
  const srv = await boot();
  const a = await ann(srv, false);

  expect(await a.run({ kind: "share", canvas: "flow" })).toBe(0);
  expect(a.out.join("")).toMatch(new RegExp(`^${origin}/s/[0-9a-f]{32}\n$`));
});

test("share on a canvas that is not there exits 1 and says how to make it", async () => {
  const srv = await boot();
  const a = await ann(srv, false);

  expect(await a.run({ kind: "share", canvas: "nope" })).toBe(1);
  expect(a.out.join("")).toBe("");
  expect(a.err.join("")).toContain("no canvas nope: make it with `easel canvas new`");
});

test("share --password exits 64 with one line, sends nothing, and the canvas stays unshared", async () => {
  const srv = await boot();
  const a = await ann(srv);

  expect(await a.run({ kind: "share", canvas: "flow", password: "hunter2" })).toBe(64);
  expect(a.lines()).toEqual([
    { usage: "--password is not built yet: a share link opens for anyone who has it" },
  ]);
  expect(await a.run({ kind: "canvas ls" })).toBe(0);
  expect(a.lines()).toMatchObject([{ canvases: [{ key: "flow", shared: false }] }]);
});

test("share without a sign-in exits 2; with its server gone, 69", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const guest = await easel(srv);

  expect(await guest.run({ kind: "share", canvas: "flow" })).toBe(2);
  expect(guest.lines()).toEqual([{ refused: { signIn: true } }]);
  await srv.server.close();
  expect(await a.run({ kind: "share", canvas: "flow" })).toBe(69);
  expect(a.lines()).toEqual([{ unreachable: origin }]);
});

test("a share with no answer in 60 s exits 69; a share that fails exits 70 with the trace", async () => {
  const hung = await boot("hang");
  const a = await ann(hung);
  const run = a.run({ kind: "share", canvas: "flow" });
  await tick(50);
  hung.clock.advance(60_000);
  await tick(50);
  hung.clock.advance(3_600_000);
  expect(await run).toBe(69);
  expect(a.lines()).toEqual([{ unreachable: origin }]);

  const broken = await boot("broken");
  const b = await ann(broken);
  expect(await b.run({ kind: "share", canvas: "flow" })).toBe(70);
  const [line] = b.lines();
  expect(line.failed).toMatch(/^[\w-]{8,}$/);
});

test("a share answer whose path is not /s/<link> prints no URL: the link stays on the server it signed in to", async () => {
  const srv = await boot("offSite");
  const a = await ann(srv);
  const code = await a.run({ kind: "share", canvas: "flow" });
  // The contract holds the path to /s/<32 hex>: an answer off it is the server's bug, 70.
  expect(code).toBe(70);
  expect(JSON.stringify(a.lines())).not.toContain("evil.example");
});
