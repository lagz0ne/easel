import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { capsule, createScope, operation } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { access } from "@/access";
import { owner, user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { cli } from "@/cli";
import type { Command } from "@/cli";
import { ops } from "@/ops";
import { opsOwnerOps, opsServer, opsUserOps } from "@/ops/ops.server";
import { counters, fixerLease } from "@/ops/registry";
import { sight } from "@/ops/sink.server";
import type { Sighting } from "@/ops/sink.server";
import { release } from "@/release";

// `easel status` and `easel errors` (SPEC-ops.md § Journeys) over the memory transport: each
// command's answers, their exit codes (the contract's success lists, SPEC.md rule 1), and what a
// person reads. The server and every CLI share one test clock.

// Each test signs in two people over the transport first; a busy host makes that slow.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const t0 = 1_800_000_000_000;
const origin = "https://easel.test";

/** One server with ops, a fixer lease on the fingerprints in `leases`, and one module's counters. */
async function boot() {
  const clock = makeTestClock({ now: t0 });
  const out: string[] = [];
  const leases = new Map<string, string>();
  const lease = operation({
    label: "test.lease",
    input: z.string(),
    run: (_, { input }) => leases.get(input) ?? null,
  });
  const depth = operation({ label: "test.depth", run: async () => ({ depth: 2 }) });
  const module = capsule({
    label: "testModule",
    tags: [fixerLease({ op: lease }), counters({ module: "queue", op: depth })],
  });
  const scope = createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({
        mode: "approve",
        origin: null,
        stdout: { write: (chunk: string) => out.push(chunk) },
        trusted: [],
        durable: false,
      }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user, owner] }),
      release({ commit: "c0ffee", build: 7 }),
      module({}),
      opsServer({}),
      ops.user({ implement: opsUserOps, onStart: [user] }),
      ops.owner({ implement: opsOwnerOps, onStart: [user, owner] }),
      memory.server({
        services: [access.login, access.user, access.owner, ops.user, ops.owner],
      }),
    ],
  });
  const server = await scope.ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";
  const see = (more: Partial<Sighting> = {}) =>
    server.run(sight, {
      input: {
        side: "server",
        label: "todo.add",
        name: "TypeError",
        message: "no todo 12",
        traceId: "a".repeat(32),
        ...more,
      },
    });

  return { server, clock, setupCode, leases, see };
}

type Srv = Awaited<ReturnType<typeof boot>>;

/** One CLI, as the cmd builds it, on the memory transport: what it prints, and its runs. */
async function easel(srv: Srv, peer: string, json = true, hosts = home()) {
  const out: string[] = [];
  const err: string[] = [];
  const app = createScope({
    clock: srv.clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: srv.server, headers: { "x-easel-peer": peer }, meta: cli.bearer }),
      access.login({ remote: memory.client }),
      access.user({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      ops.user({ remote: memory.client }),
      ops.owner({ remote: memory.client }),
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => err.push(chunk) },
        json,
        server: origin,
        hosts,
      }),
    ],
  });
  const scope = await app.ready;
  closers.push(() => scope.close());

  return {
    out,
    err,
    hosts,
    run: (command: Command) => scope.run(cli.run, { input: command }),
    /** Each JSON line printed since the last read. */
    lines: () =>
      out
        .splice(0)
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    /** The text printed since the last read, stdout then stderr. */
    text: () => [out.splice(0).join(""), err.splice(0).join("")],
  };
}

/** A fresh folder for one CLI's hosts file. */
function home() {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-ops-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));

  return join(dir, "easel", "hosts.json");
}

const errorsCmd = (act: Extract<Command, { kind: "errors" }>["act"]): Command => ({
  kind: "errors",
  act,
});

/**
 * Ann, the first owner, and Bob, a member she approved, each signed in on a JSON CLI; and a text
 * CLI for each on the same hosts file.
 */
async function people(srv: Srv) {
  const ann = await easel(srv, "198.51.100.1");
  const setup = { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false } as const;
  expect(await ann.run(setup)).toBe(0);
  const bob = await easel(srv, "198.51.100.2");
  expect(await bob.run({ kind: "login", name: "bob", noWait: true })).toBe(0);
  const code = String(bob.lines()[0]?.code);
  expect(await ann.run({ kind: "users", act: { kind: "approve", code, owner: false } })).toBe(0);
  expect(await bob.run({ kind: "resume" })).toBe(0);
  ann.lines();
  bob.lines();

  return {
    ann,
    bob,
    annText: await easel(srv, "198.51.100.1", false, ann.hosts),
    bobText: await easel(srv, "198.51.100.2", false, bob.hosts),
  };
}

// ---- easel status (any user)

test("status: any user reads the build, checks, counters, errors and the fixer; exit 0", async () => {
  const srv = await boot();
  const { bob } = await people(srv);
  await srv.see();

  expect(await bob.run({ kind: "status" })).toBe(0);

  expect(bob.lines()).toEqual([
    {
      commit: "c0ffee",
      build: 7,
      uptime: 0,
      checks: expect.arrayContaining([
        { name: "database", ok: true, detail: "reads and writes" },
        { name: "disk", ok: true, detail: "in memory" },
      ]),
      counters: { "queue.depth": 2 },
      errors: { hour: 1, day: 1, open: 1, unconfirmed: 0, dropped: 0 },
      fixerSeen: null,
      fixerSilent: false,
    },
  ]);
});

test("status with no token is refused: the text says to log in again; exit 2", async () => {
  const srv = await boot();
  const nobody = await easel(srv, "198.51.100.9", false);

  expect(await nobody.run({ kind: "status" })).toBe(2);

  expect(nobody.text()).toEqual([
    "",
    `not signed in to ${origin}: log in again with \`easel login ${origin} --name <name>\`\n`,
  ]);
});

test("status as text: one check a line, the counters, the counts, and the fixer's tick", async () => {
  const srv = await boot();
  const { annText, bobText } = await people(srv);
  await srv.see();
  expect(await annText.run(errorsCmd({ kind: "tick" }))).toBe(0);
  annText.text();

  expect(await bobText.run({ kind: "status" })).toBe(0);
  const lines = bobText.text()[0]?.split("\n") ?? [];
  expect(lines[0]).toBe("build 7 (c0ffee), up 0 s");
  expect(lines).toContain("  ok   database: reads and writes");
  expect(lines).toContain("  queue.depth 2");
  expect(lines).toContain(
    "errors: 1 in the last hour, 1 in the last day; 1 open (0 unconfirmed), 0 dropped",
  );
  expect(lines).toContain(`fixer: last tick ${new Date(t0).toISOString()}`);

  srv.clock.advance(31 * 60_000);
  expect(await bobText.run({ kind: "status" })).toBe(0);
  expect(bobText.text()[0]).toContain(`fixer: last tick ${new Date(t0).toISOString()}, silent\n`);
});

test("status as text: a fixer that never ticked, and a failing check", async () => {
  const srv = await boot();
  const { bobText } = await people(srv);
  srv.clock.advance(31 * 60_000);

  expect(await bobText.run({ kind: "status" })).toBe(0);

  expect(bobText.text()[0]).toContain("fixer: never ticked, silent\n");
});

// ---- easel errors (an owner)

test("errors ls: the groups as JSON, without samples; --open, --side and --since; exit 0", async () => {
  const srv = await boot();
  const { ann } = await people(srv);
  await srv.see({ label: "a.old" });
  srv.clock.advance(3 * 3_600_000);
  await srv.see({ label: "b.new", side: "browser" });

  expect(await ann.run(errorsCmd({ kind: "ls", open: false }))).toBe(0);
  const [all] = ann.lines();
  expect(all.errors.map((g: { label: string }) => g.label)).toEqual(["b.new", "a.old"]);
  expect(all.errors[0]).not.toHaveProperty("samples");

  expect(await ann.run(errorsCmd({ kind: "ls", open: true, side: "server" }))).toBe(0);
  expect(ann.lines()[0].errors.map((g: { label: string }) => g.label)).toEqual(["a.old"]);

  expect(await ann.run(errorsCmd({ kind: "ls", open: false, since: "2h" }))).toBe(0);
  expect(ann.lines()[0].errors.map((g: { label: string }) => g.label)).toEqual(["b.new"]);

  const day = new Date(t0 + 3_600_000).toISOString();
  expect(await ann.run(errorsCmd({ kind: "ls", open: false, since: day }))).toBe(0);
  expect(ann.lines()[0].errors.map((g: { label: string }) => g.label)).toEqual(["b.new"]);
});

test("--since reads seconds, minutes, hours and days back on the clock", async () => {
  const srv = await boot();
  const { ann } = await people(srv);
  await srv.see({ label: "a" });
  srv.clock.advance(2 * 86_400_000);
  await srv.see({ label: "b" });
  srv.clock.advance(30_000);

  const seen = async (since: string) => {
    expect(await ann.run(errorsCmd({ kind: "ls", open: false, since }))).toBe(0);
    return ann.lines()[0].errors.map((g: { label: string }) => g.label);
  };

  expect(await seen("90s")).toEqual(["b"]);
  expect(await seen("1m")).toEqual(["b"]);
  expect(await seen("1h")).toEqual(["b"]);
  expect(await seen("3d")).toEqual(["b", "a"]);
  expect(await seen("10s")).toEqual([]);
});

test("errors ls as text: one group a line; none says so", async () => {
  const srv = await boot();
  const { annText: ann } = await people(srv);

  expect(await ann.run(errorsCmd({ kind: "ls", open: false }))).toBe(0);
  expect(ann.text()[0]).toBe("no error groups\n");

  const { fingerprint } = await srv.see();
  expect(await ann.run(errorsCmd({ kind: "ls", open: false }))).toBe(0);
  expect(ann.text()[0]).toBe(`${fingerprint}  open  server  1x  todo.add  TypeError: no todo 12\n`);
});

test("errors show: the group and its samples (exit 0); by --trace too; an unknown one is gone (exit 1)", async () => {
  const srv = await boot();
  const { ann } = await people(srv);
  const { fingerprint } = await srv.see();

  expect(await ann.run(errorsCmd({ kind: "show", find: { fingerprint } }))).toBe(0);
  const [found] = ann.lines();
  expect(found).toMatchObject({
    kind: "found",
    error: { fingerprint, status: "open" },
    samples: [{ at: t0, build: 7, traceId: "a".repeat(32), message: "no todo 12" }],
  });

  expect(await ann.run(errorsCmd({ kind: "show", find: { trace: "a".repeat(32) } }))).toBe(0);
  expect(ann.lines()[0].error.fingerprint).toBe(fingerprint);

  expect(await ann.run(errorsCmd({ kind: "show", find: { fingerprint: "0".repeat(64) } }))).toBe(1);
  expect(ann.lines()).toEqual([{ kind: "gone" }]);
});

test("errors show as text: the group line, when and on which builds, the fix, the trace, the samples", async () => {
  const srv = await boot();
  const { annText: ann } = await people(srv);
  const { fingerprint } = await srv.see({ build: 3 });
  await ann.run(errorsCmd({ kind: "hand-off", fingerprint, reason: "the host" }));
  ann.text();

  expect(await ann.run(errorsCmd({ kind: "show", find: { fingerprint } }))).toBe(0);

  const at = new Date(t0).toISOString();
  expect(ann.text()[0]).toBe(
    [
      `${fingerprint}  human  server  1x  todo.add  TypeError: no todo 12`,
      `  seen ${at} to ${at}, on builds 3`,
      "  fixed in none; handed off: the host",
      `  trace ${"a".repeat(32)}`,
      `  ${at} build 3: no todo 12`,
      "",
    ].join("\n"),
  );
  expect(await ann.run(errorsCmd({ kind: "show", find: { fingerprint: "0".repeat(64) } }))).toBe(1);
  expect(ann.text()).toEqual(["", "no such error group\n"]);
});

test("errors resolve: resolved exits 0; notLive, failing, held and gone exit 1, each with its words", async () => {
  const srv = await boot();
  const { annText: ann } = await people(srv);
  const failing = await srv.see({ label: "a.failing" });
  const fixed = await srv.see({ label: "b.fixed", build: 4 });
  const held = await srv.see({ label: "c.held", build: 4 });
  srv.leases.set(held.fingerprint, "claim-1");
  const resolve = (fingerprint: string, build: number) =>
    ann.run(errorsCmd({ kind: "resolve", fingerprint, build }));

  expect(await resolve(fixed.fingerprint, 8)).toBe(1);
  expect(ann.text()[1]).toBe("build 8 is not live yet (live: 7): try again once it deploys\n");
  expect(await resolve(failing.fingerprint, 6)).toBe(1);
  expect(ann.text()[1]).toBe(
    "the error was seen on build 7, at or after 6: the fix did not hold\n",
  );
  expect(await resolve(held.fingerprint, 6)).toBe(1);
  expect(ann.text()[1]).toBe(
    "a fixer holds this group: only its claim moves it until the lease ends\n",
  );
  expect(await resolve("0".repeat(64), 6)).toBe(1);
  expect(ann.text()[1]).toBe("no such error group\n");
  expect(await resolve(fixed.fingerprint, 6)).toBe(0);
  expect(ann.text()[0]).toBe("resolved in build 6\n");
});

test("errors resolve --json prints the answer; a resolved group shows fixedIn", async () => {
  const srv = await boot();
  const { ann } = await people(srv);
  const { fingerprint } = await srv.see({ build: 2 });

  expect(await ann.run(errorsCmd({ kind: "resolve", fingerprint, build: 5 }))).toBe(0);
  expect(ann.lines()).toEqual([{ kind: "resolved" }]);
  expect(await ann.run(errorsCmd({ kind: "resolve", fingerprint, build: 9 }))).toBe(1);
  expect(ann.lines()).toEqual([{ kind: "notLive", live: 7 }]);
});

test("errors hand-off: handed exits 0, the reason trimmed; held and gone exit 1", async () => {
  const srv = await boot();
  const { annText: ann } = await people(srv);
  const mine = await srv.see({ label: "a.mine" });
  const held = await srv.see({ label: "b.held" });
  srv.leases.set(held.fingerprint, "claim-1");
  const handOff = (fingerprint: string) =>
    ann.run(errorsCmd({ kind: "hand-off", fingerprint, reason: "  the host is down  " }));

  expect(await handOff(mine.fingerprint)).toBe(0);
  expect(ann.text()[0]).toBe("handed off: a person has it\n");
  expect(await handOff(held.fingerprint)).toBe(1);
  expect(ann.text()[1]).toBe(
    "a fixer holds this group: only its claim moves it until the lease ends\n",
  );
  expect(await handOff("0".repeat(64))).toBe(1);
  expect(ann.text()[1]).toBe("no such error group\n");

  expect(await ann.run(errorsCmd({ kind: "show", find: { fingerprint: mine.fingerprint } }))).toBe(
    0,
  );
  expect(ann.text()[0]).toContain("handed off: the host is down\n");
});

test("errors tick: stamps the fixer's tick; exit 0", async () => {
  const srv = await boot();
  const { annText: ann } = await people(srv);

  expect(await ann.run(errorsCmd({ kind: "tick" }))).toBe(0);

  expect(ann.text()[0]).toBe(`stamped ${new Date(t0).toISOString()}\n`);
});

test("a member is refused each owner command: the text says it needs an owner; exit 2", async () => {
  const srv = await boot();
  const { bob } = await people(srv);
  const fingerprint = "0".repeat(64);
  const commands: Command[] = [
    errorsCmd({ kind: "ls", open: false }),
    errorsCmd({ kind: "show", find: { fingerprint } }),
    errorsCmd({ kind: "resolve", fingerprint, build: 1 }),
    errorsCmd({ kind: "hand-off", fingerprint, reason: "mine" }),
    errorsCmd({ kind: "tick" }),
  ];

  for (const command of commands) expect(await bob.run(command)).toBe(2);

  expect(bob.lines()).toEqual(commands.map(() => ({ refused: { owner: true } })));
});

// ---- A server that is gone

test("each ops command whose server is gone exits 69: cannot reach the server", async () => {
  const srv = await boot();
  const { ann } = await people(srv);
  const fingerprint = "0".repeat(64);
  const commands: Command[] = [
    { kind: "status" },
    errorsCmd({ kind: "ls", open: false }),
    errorsCmd({ kind: "show", find: { fingerprint } }),
    errorsCmd({ kind: "resolve", fingerprint, build: 1 }),
    errorsCmd({ kind: "hand-off", fingerprint, reason: "mine" }),
    errorsCmd({ kind: "tick" }),
  ];
  await srv.server.close();

  for (const command of commands) expect(await ann.run(command)).toBe(69);

  expect(ann.lines()).toEqual(commands.map(() => ({ unreachable: origin })));
});
