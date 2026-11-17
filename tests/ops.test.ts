import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { capsule, createScope, operation } from "@tinkered/core";
import type { Capsule, Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { access } from "@/access";
import { owner, user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { ops } from "@/ops";
import {
  error,
  errors,
  handOff,
  opsOwnerOps,
  opsServer,
  opsUserOps,
  ready,
  resolveError,
  silentAfter,
  status,
} from "@/ops/ops.server";
import { observePanics, panic } from "@/ops/panic.server";
import { claim, counters, fixerLease, readiness } from "@/ops/registry";
import { messageCap, normalize, sight, sightBatch } from "@/ops/sink.server";
import type { Sighting } from "@/ops/sink.server";
import { release } from "@/release";

// ops on a test clock, against the ops-issues charts (docs/statecharts/ops-issues.md and
// ops-issues-person.md), their model's ops-side actions (models/ops/Lifecycle.tla), and
// SPEC-ops.md's rules. Each test names the action or rule it checks.

// SQLite on disk with `synchronous = FULL` waits on fsync; a busy host makes that slow.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const t0 = 1_800_000_000_000;

const byText = (a: string, b: string) => a.localeCompare(b);
const minute = 60_000;

/** Lets the sink's fire-and-forget sightings run: no timer, only the queued work. */
async function drain() {
  for (let i = 0; i < 20; i++) await new Promise((done) => setImmediate(done));
}

/** A fresh folder, removed after the test. */
function folder() {
  const dir = mkdtempSync(join(tmpdir(), "easel-ops-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));

  return dir;
}

type Boot = {
  file?: string;
  database?: string;
  build?: number;
  clock?: ReturnType<typeof makeTestClock>;
  caps?: { groups: number; retired: number };
  minFree?: number;
  extra?: readonly Capsule.Installable[];
};

/** The SQLite file, and `opsServer`'s config, with the cmd's defaults. */
function configOf(options: Boot) {
  const file = options.file ?? ":memory:";
  const config = {
    database: options.database ?? file,
    caps: options.caps ?? { groups: 1000, retired: 10_000 },
    minFree: options.minFree ?? 100 * 1024 * 1024,
  };

  return { file, config };
}

/** One server: SQLite, access, release, ops, and a memory transport, on one test clock. */
async function boot(options: Boot = {}) {
  const clock = options.clock ?? makeTestClock({ now: t0 });
  const out: string[] = [];
  const { file, config } = configOf(options);
  const scope = createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file }),
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
      release({ commit: "c0ffee", build: options.build ?? 5 }),
      ...(options.extra ?? []),
      opsServer(config),
      ops.user({ implement: opsUserOps, onStart: [user] }),
      ops.owner({ implement: opsOwnerOps, onStart: [user, owner] }),
      memory.server({
        services: [access.login, access.user, access.owner, ops.user, ops.owner],
      }),
    ],
  });
  const server = await scope.ready;
  const closed = { done: false };
  const close = async () => {
    if (closed.done) return;
    closed.done = true;
    await server.close();
  };
  closers.push(close);
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return {
    server,
    clock,
    close,
    setupCode,
    /** One sighting through the sink, as a failed span gives it. */
    see: (more: Partial<Sighting> = {}) =>
      server.run(sight, {
        input: {
          side: "server",
          label: "todo.add",
          name: "TypeError",
          message: "no todo 12",
          traceId: null,
          ...more,
        },
      }),
    list: (input: { open?: boolean; side?: "server" | "browser"; since?: number } = {}) =>
      server.run(errors, { input }).then((answer) => answer.errors),
    show: (fingerprint: string) => server.run(error, { input: { fingerprint } }),
    resolve: (fingerprint: string, build: number, holds?: string) =>
      server.run(resolveError, {
        input: { fingerprint, build },
        tags: holds === undefined ? [] : [claim(holds)],
      }),
    handOff: (fingerprint: string, reason: string, holds?: string) =>
      server.run(handOff, {
        input: { fingerprint, reason },
        tags: holds === undefined ? [] : [claim(holds)],
      }),
    status: () => server.run(status, { input: null }),
    /** One check from status, by its name. */
    check: async (name: string) =>
      (await server.run(status, { input: null })).checks.find((c) => c.name === name),
    ready: async () => {
      const answer = await server.run(ready, { input: {} });
      return { code: answer.status, body: await answer.json(), cache: answer.headers };
    },
  };
}

type Srv = Awaited<ReturnType<typeof boot>>;

/** A fixer that holds a lease on some groups: `leases` maps a fingerprint to its claim. */
function fixer(leases: Map<string, string>) {
  const lease = operation({
    label: "test.lease",
    input: z.string(),
    run: (_, { input }) => leases.get(input) ?? null,
  });

  return capsule({ label: "testFixer", tags: [fixerLease({ op: lease })] })({});
}

/** A token as the CLI makes it, and the digest it sends. */
function token() {
  const text = randomBytes(32).toString("base64url");

  return { text, digest: createHash("sha256").update(text).digest("hex") };
}

/** One rpc client at one address, with the token it holds. */
async function client(server: Scope.Handle, peer: string) {
  const held: { token?: string } = {};
  const meta = operation({
    label: "test.meta",
    run: async (): Promise<Record<string, string>> =>
      held.token ? { authorization: `Bearer ${held.token}` } : {},
  });
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: server, headers: { "x-easel-peer": peer }, meta }),
      access.login({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      ops.user({ remote: memory.client }),
      ops.owner({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return { held, scope };
}

/** The first owner, by the setup code; and a member that an owner approved. */
async function people(srv: Srv) {
  const ann = await client(srv.server, "198.51.100.1");
  const a = token();
  const setup = { name: "ann", code: srv.setupCode(), digest: a.digest };
  expect((await ann.scope.run(access.login["login.setup"], { input: setup })).kind).toBe("granted");
  ann.held.token = a.text;

  const bob = await client(srv.server, "198.51.100.2");
  const b = token();
  const started = await bob.scope.run(access.login["login.start"], {
    input: { name: "bob", digest: b.digest },
  });
  if (started.kind !== "pending") throw new Error(`not pending: ${started.kind}`);
  await ann.scope.run(access.owner["users.approve"], { input: { code: started.code } });
  const waited = await bob.scope.run(access.login["login.wait"], {
    input: { request: started.request },
  });
  expect(waited.kind).toBe("granted");
  bob.held.token = b.text;

  return { ann, bob, nobody: await client(srv.server, "198.51.100.3") };
}

/** The fault a call ended in, and its payload; null when it answered. */
const faultOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (thrown: unknown) =>
      ops.user.fault.is(thrown) || ops.owner.fault.is(thrown)
        ? { fault: thrown.fault, payload: thrown.payload }
        : { fault: "other", payload: String(thrown) },
  );

/** Whether the file still has the groups table. */
function tableOf(file: string) {
  const db = new Database(file, { readonly: true });
  try {
    return !!db.query("SELECT name FROM sqlite_master WHERE name = 'ops_groups'").get();
  } finally {
    db.close();
  }
}

/** The groups as stored in the SQLite file, read by a second connection. */
function stored(file: string) {
  const db = new Database(file, { readonly: true });
  try {
    const rows = db.query("SELECT body FROM ops_groups").all();
    return z
      .array(z.object({ body: z.string() }))
      .parse(rows)
      .map((row) => JSON.parse(row.body));
  } finally {
    db.close();
  }
}

// ---- An error is recorded (SPEC-ops.md § An error is recorded; chart: "the error happens")

const boom = operation({
  label: "todo.add",
  run: () => {
    throw new TypeError('no todo "a1" at 12');
  },
});

const outer = operation({
  label: "todo.save",
  depends: { boom },
  run: ({ boom }) => boom.run(),
});

test("ErrorSeen, none -> open: a thrown operation opens a group with its build, trace id and sample", async () => {
  const srv = await boot();

  srv.server.settle(boom);
  await drain();

  const [group] = await srv.list();
  expect(group).toMatchObject({
    side: "server",
    label: "todo.add",
    name: "TypeError",
    count: 1,
    firstSeen: t0,
    lastSeen: t0,
    builds: [5],
    lastBuild: 5,
    status: "open",
    fixedIn: null,
    reason: null,
  });
  expect(group?.traceId).toMatch(/^[0-9a-f]{32}$/);
  expect(group?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  const shown = await srv.show(group?.fingerprint ?? "");
  expect(shown).toMatchObject({
    kind: "found",
    samples: [{ at: t0, build: 5, traceId: group?.traceId, message: 'no todo "a1" at 12' }],
  });
});

test("a throw that passes up through its callers is one sighting, under the innermost span", async () => {
  const srv = await boot();

  srv.server.settle(outer);
  await drain();

  expect((await srv.list()).map((g) => [g.label, g.count])).toEqual([["todo.add", 1]]);
});

test("a log at error is a sighting; a warning is not; a log whose cause was counted is not twice", async () => {
  const srv = await boot();
  const logs = operation({
    label: "queue.tick",
    run: (_, ctx) => {
      ctx.log.warn("slow queue 300 ms");
      ctx.log.error("disk full on /data 42");
    },
  });
  const caught = operation({
    label: "queue.retry",
    depends: { boom: boom.controller },
    run: async ({ boom }, ctx) => {
      try {
        boom.run();
      } catch (cause) {
        ctx.log.error("the retry failed", { cause });
      }
    },
  });

  srv.server.settle(logs);
  await srv.server.settle(caught);
  await drain();

  const groups = await srv.list();
  expect(groups.map((g) => [g.label, g.name, g.message].join(" | ")).toSorted(byText)).toEqual([
    "queue.tick | log | disk full on /data 42",
    'todo.add | TypeError | no todo "a1" at 12',
  ]);
});

test("a fingerprint has no numbers, ids, hex or quoted values; side, label and name are in it (judged rule 5)", async () => {
  const srv = await boot();

  const a = await srv.see({
    message: 'no todo "abc" at 12 for 1f0e2d3c-aaaa-4bbb-8ccc-0123456789ab',
  });
  const b = await srv.see({
    message: "no todo 'xyz' at 99 for 7f0e2d3c-dddd-4eee-8fff-ba9876543210",
  });
  const c = await srv.see({ message: "no todo 0xdeadbeef01 at 3" });
  const d = await srv.see({ message: "no todo 0xcafebabe02 at 4" });
  const other = await srv.see({ label: "todo.move", message: "no todo 12" });
  const browser = await srv.see({ side: "browser", message: "no todo 12" });
  const named = await srv.see({ name: "RangeError", message: "no todo 12" });

  expect(a.fingerprint).toBe(b.fingerprint);
  expect(c.fingerprint).toBe(d.fingerprint);
  expect(new Set([a, c, other, browser, named].map((s) => s.fingerprint)).size).toBe(5);
  expect(b.kind).toBe("counted");
});

test("a sample holds no token, password, share pass, key or frame document; it is capped (judged rules 1, 2)", async () => {
  const srv = await boot();
  const secret = randomBytes(32).toString("base64url");
  // Under the long-run rule's 24 characters: only the bearer rule removes it.
  const short = randomBytes(12).toString("base64url");
  const message = [
    `Bearer ${secret}`,
    `Bearer ${short}`,
    `token=${secret.slice(0, 10)}`,
    'password: "hunter2"',
    "share=opensesame",
    `key ${randomBytes(24).toString("hex")}`,
    "<!doctype html><html><body>the frame</body></html>",
  ].join(" ");

  const { fingerprint } = await srv.see({ message });
  const long = await srv.see({ label: "x.long", message: "word ".repeat(1000) });

  const shown = await srv.show(fingerprint);
  if (shown.kind !== "found") throw new Error("no group");
  const text = JSON.stringify(shown);
  for (const leak of [secret, short, secret.slice(0, 10), "hunter2", "opensesame", "the frame"]) {
    expect(text).not.toContain(leak);
  }
  expect(shown.error.message).toContain("[removed]");
  const capped = await srv.show(long.fingerprint);
  expect(capped.kind === "found" && capped.error.message.length).toBe(messageCap);
});

test("scrub: a secret key inside a longer word, pwd, a password after a space, a URL's user, any first tag, a 20-character run (judged rule 1)", async () => {
  const srv = await boot();
  // Each value is shorter than the long-run rule's 20 characters, so only its own rule removes it.
  const short = () => randomBytes(6).toString("base64url");
  const values = {
    shareSnake: short(),
    shareCamel: short(),
    accessToken: short(),
    apiKey: short(),
    pwd: short(),
    spoken: short(),
    user: short(),
    pass: short(),
    phrase: short(),
  };
  const run = randomBytes(15).toString("base64url");
  const message = [
    `share_pass=${values.shareSnake}`,
    `sharePass: ${values.shareCamel}`,
    `access_token=${values.accessToken}`,
    `api_key=${values.apiKey}`,
    `pwd=${values.pwd}`,
    `passphrase=${values.phrase}`,
    `password ${values.spoken}`,
    `https://${values.user}:${values.pass}@db.example/x`,
    `run ${run}`,
  ].join(" ");
  const sealed = await srv.see({ label: "x.keys", message });
  const tagged = await srv.see({
    label: "x.tag",
    message: "render failed: <svg><text>the frame</text></svg>",
  });

  const text = JSON.stringify([
    await srv.show(sealed.fingerprint),
    await srv.show(tagged.fingerprint),
  ]);
  expect(run).toHaveLength(20);
  for (const leak of [...Object.values(values), run, "the frame"]) expect(text).not.toContain(leak);
  expect(text).toContain("render failed: [document removed]");
  expect(text).toContain("https://[removed]@db.example/x");
});

test("a tab's batch: an error span and an error log are browser groups; ok, refused and info are not", async () => {
  const srv = await boot();
  const span = (name: string, code: 1 | 2, message?: string, build?: string) => ({
    side: "browser" as const,
    traceId: "1".repeat(32),
    spanId: "2".repeat(16),
    flags: 1 as const,
    name,
    kind: 1 as const,
    startTimeUnixNano: "1",
    endTimeUnixNano: "2",
    attributes: build ? [{ key: "build", value: { stringValue: build } }] : [],
    events: [],
    status: { code, ...(message === undefined ? {} : { message }) },
  });
  const line = (level: number, msg: string, build?: string) => ({
    time: t0,
    level,
    msg,
    service: "tab",
    side: "browser" as const,
    ...(build ? { attributes: { build } } : {}),
  });

  await srv.server.run(sightBatch, {
    input: {
      traces: [
        span("page.board", 2, "TypeError: x is undefined", "3"),
        span("page.ok", 1),
        span("page.call", 2, "the call was refused"),
        span("page.bare", 2),
      ],
      logs: [line(50, "chunk failed to load", "99"), line(30, "a note")],
    },
  });

  const groups = await srv.list({ side: "browser" });
  const shown = groups.map((g) => [g.label, g.name, g.message, g.lastBuild].join(" | "));
  expect(shown.toSorted(byText)).toEqual([
    "log | log | chunk failed to load | 5",
    "page.bare | Error |  | 5",
    "page.board | TypeError | x is undefined | 3",
  ]);
  // A browser-only group is counted and shown, as unconfirmed (step 5).
  expect((await srv.status()).errors).toMatchObject({ open: 3, unconfirmed: 3 });
  expect(await srv.list({ side: "server" })).toEqual([]);
});

// ---- An error group moves through its states (Lifecycle.tla's ops actions)

test("OwnerResolves: resolve answers notLive before the build is live, failing once seen on it, else resolved (judged rule 7)", async () => {
  const srv = await boot({ build: 5 });
  const { fingerprint } = await srv.see();

  expect(await srv.resolve(fingerprint, 6)).toEqual({ kind: "notLive", live: 5 });
  expect(await srv.resolve(fingerprint, 5)).toEqual({ kind: "failing", seen: 5 });
  expect((await srv.list())[0]?.status).toBe("open");
  expect(await srv.resolve(fingerprint, 4)).toEqual({ kind: "failing", seen: 5 });
});

test("OwnerResolves: a group seen only on older builds is resolved, fixedIn = n", async () => {
  const srv = await boot({ build: 7 });
  const { fingerprint } = await srv.see({ build: 4 });

  expect(await srv.resolve(fingerprint, 6)).toEqual({ kind: "resolved" });
  expect((await srv.list())[0]).toMatchObject({ status: "resolved", fixedIn: 6, lastBuild: 4 });
});

test("ErrorSeen, resolved -> regressed on a build >= fixedIn; an older build changes nothing (judged rule 6)", async () => {
  const srv = await boot({ build: 7 });
  const { fingerprint } = await srv.see({ build: 4 });
  await srv.resolve(fingerprint, 6);

  expect((await srv.see({ build: 5 })).kind).toBe("counted");
  expect((await srv.list())[0]).toMatchObject({ status: "resolved", fixedIn: 6 });

  expect((await srv.see({ build: 6 })).kind).toBe("regressed");
  expect((await srv.list())[0]).toMatchObject({ status: "regressed", fixedIn: 6, lastBuild: 6 });

  // regressed stays regressed, and is on the work list (step 5).
  expect((await srv.see()).kind).toBe("counted");
  expect((await srv.list({ open: true })).map((g) => g.status)).toEqual(["regressed"]);
});

test("a tab cannot claim a build that is not out: its build counts up to the live one", async () => {
  const srv = await boot({ build: 5 });

  await srv.see({ side: "browser", build: 900 });

  expect((await srv.list())[0]).toMatchObject({ builds: [5], lastBuild: 5 });
});

test("OwnerHandsOff: hand-off sets human with the reason; human stays human when seen again (HumanStaysHuman)", async () => {
  const srv = await boot();
  const { fingerprint } = await srv.see();

  expect(await srv.handOff(fingerprint, "the cause is the host")).toEqual({ kind: "handed" });
  await srv.see();
  await srv.see({ build: 2 });

  expect((await srv.list())[0]).toMatchObject({ status: "human", reason: "the cause is the host" });
  expect(await srv.list({ open: true })).toEqual([]);
  // Only resolve moves it on.
  expect(await srv.resolve(fingerprint, 6)).toEqual({ kind: "notLive", live: 5 });
});

test("OwnerResolves from human: an owner's resolve moves a human group to resolved", async () => {
  const srv = await boot({ build: 9 });
  const { fingerprint } = await srv.see({ build: 3 });
  await srv.handOff(fingerprint, "a person looks");

  expect(await srv.resolve(fingerprint, 8)).toEqual({ kind: "resolved" });
  expect((await srv.list())[0]).toMatchObject({ status: "resolved", fixedIn: 8 });
});

test("resolve, hand-off and show answer gone for a fingerprint with no group", async () => {
  const srv = await boot();
  const none = "f".repeat(64);

  expect(await srv.resolve(none, 1)).toEqual({ kind: "gone" });
  expect(await srv.handOff(none, "why")).toEqual({ kind: "gone" });
  expect(await srv.show(none)).toEqual({ kind: "gone" });
  expect(await srv.server.run(error, { input: { trace: "9".repeat(32) } })).toEqual({
    kind: "gone",
  });
});

test("show --trace finds the group by the trace id of a failed fault, also in an older sample", async () => {
  const srv = await boot();
  const first = "a".repeat(32);
  await srv.see({ traceId: first });
  await srv.see({ traceId: "b".repeat(32) });

  const found = await srv.server.run(error, { input: { trace: first } });

  expect(found).toMatchObject({ kind: "found", error: { traceId: "b".repeat(32) } });
});

// ---- The fixer's lease and claim (fact rule 8; FixerResolves, FixerSeesFailing, FixerGivesUp, FixRefused)

test("held: while a lease is live, resolve and hand-off with no claim or another claim answer held and write nothing (fact rule 8)", async () => {
  const leases = new Map<string, string>();
  const srv = await boot({ build: 7, extra: [fixer(leases)] });
  const { fingerprint } = await srv.see({ build: 3 });
  leases.set(fingerprint, "claim-1");

  expect(await srv.resolve(fingerprint, 6)).toEqual({ kind: "held" });
  expect(await srv.handOff(fingerprint, "mine now")).toEqual({ kind: "held" });
  expect(await srv.resolve(fingerprint, 6, "claim-2")).toEqual({ kind: "held" });
  expect(await srv.handOff(fingerprint, "mine now", "claim-2")).toEqual({ kind: "held" });
  expect((await srv.list())[0]).toMatchObject({ status: "open", fixedIn: null, reason: null });

  // A group with no lease is not held.
  const other = await srv.see({ label: "todo.move", build: 3 });
  expect(await srv.resolve(other.fingerprint, 6)).toEqual({ kind: "resolved" });
});

test("FixerResolves and FixerSeesFailing: under the claim that holds the lease, resolve moves the group", async () => {
  const leases = new Map<string, string>();
  const srv = await boot({ build: 7, extra: [fixer(leases)] });
  const failing = await srv.see({ label: "a.failing", build: 6 });
  const fixed = await srv.see({ label: "a.fixed", build: 4 });
  leases.set(failing.fingerprint, "claim-1");
  leases.set(fixed.fingerprint, "claim-2");

  expect(await srv.resolve(failing.fingerprint, 6, "claim-1")).toEqual({
    kind: "failing",
    seen: 6,
  });
  expect(await srv.resolve(fixed.fingerprint, 8, "claim-2")).toEqual({ kind: "notLive", live: 7 });
  expect(await srv.resolve(fixed.fingerprint, 6, "claim-2")).toEqual({ kind: "resolved" });
  expect(await srv.show(fixed.fingerprint)).toMatchObject({
    error: { status: "resolved", fixedIn: 6 },
  });
});

test("FixerGivesUp and FixRefused: under its claim, the fixer hands the group to a person", async () => {
  const leases = new Map<string, string>();
  const srv = await boot({ extra: [fixer(leases)] });
  const { fingerprint } = await srv.see();
  leases.set(fingerprint, "claim-1");

  expect(await srv.handOff(fingerprint, "two fixes did not hold", "claim-1")).toEqual({
    kind: "handed",
  });
  expect((await srv.list())[0]).toMatchObject({
    status: "human",
    reason: "two fixes did not hold",
  });
});

// ---- The cap and the retired list (Dropped; judged rules 3 and 4)

test("Dropped: at the cap the oldest resolved group is retired; seen on a build >= fixedIn it is back as regressed", async () => {
  const srv = await boot({ build: 7, caps: { groups: 2, retired: 10 } });
  const old = await srv.see({ label: "a.old", build: 3 });
  srv.clock.advance(minute);
  await srv.see({ side: "browser", label: "b.page" });
  await srv.resolve(old.fingerprint, 6);
  srv.clock.advance(minute);

  // The resolved group goes first, though the browser group is newer.
  expect((await srv.see({ label: "c.new" })).kind).toBe("opened");
  expect((await srv.list()).map((g) => g.label).toSorted(byText)).toEqual(["b.page", "c.new"]);

  // An older build: nothing changes, and the group stays retired.
  expect((await srv.see({ label: "a.old", build: 5 })).kind).toBe("older");
  expect((await srv.list()).map((g) => g.label).toSorted(byText)).toEqual(["b.page", "c.new"]);

  // At the fix's build or later: back as regressed, fixedIn kept (OpenMeansNeverResolved).
  const back = await srv.see({ label: "a.old", build: 6 });
  expect(back.kind).toBe("regressed");
  expect(await srv.show(old.fingerprint)).toMatchObject({
    error: { status: "regressed", fixedIn: 6, count: 1 },
  });
  expect((await srv.list()).map((g) => g.label).toSorted(byText)).toEqual(["a.old", "c.new"]);
});

test("at the cap with no resolved group, the oldest browser group goes; with none, the new group is dropped and counted", async () => {
  const srv = await boot({ caps: { groups: 2, retired: 10 } });
  await srv.see({ side: "browser", label: "page.a" });
  srv.clock.advance(minute);
  await srv.see({ label: "b.open" });
  srv.clock.advance(minute);

  expect((await srv.see({ label: "c.open" })).kind).toBe("opened");
  expect((await srv.list()).map((g) => g.label).toSorted(byText)).toEqual(["b.open", "c.open"]);

  await srv.handOff((await srv.list())[0]?.fingerprint ?? "", "a person has it");
  expect((await srv.see({ label: "d.new" })).kind).toBe("dropped");
  expect((await srv.see({ label: "e.new" })).kind).toBe("dropped");
  expect((await srv.list()).map((g) => g.label).toSorted(byText)).toEqual(["b.open", "c.open"]);
  expect((await srv.status()).errors.dropped).toBe(2);
});

test("the retired list keeps the newest fingerprints: one pushed out of it comes back as a new open group", async () => {
  const srv = await boot({ build: 7, caps: { groups: 1, retired: 1 } });
  const first = await srv.see({ label: "a.first", build: 3 });
  await srv.resolve(first.fingerprint, 6);
  srv.clock.advance(minute);
  const second = await srv.see({ label: "b.second", build: 3 });
  await srv.resolve(second.fingerprint, 6);
  srv.clock.advance(minute);
  await srv.see({ label: "c.third", build: 3 });
  await srv.resolve((await srv.list())[0]?.fingerprint ?? "", 6);

  // a.first left the list when b.second joined it: it is new again.
  expect((await srv.see({ label: "a.first", build: 7 })).kind).toBe("opened");
});

// ---- Persistence: one write a second, the drain, and a restart (judged rules 2 and 8)

test("the sink writes a group at most once a second; resolve and hand-off are written before they answer (judged rule 2)", async () => {
  const file = join(folder(), "easel.db");
  const srv = await boot({ file });

  for (let i = 0; i < 10; i++) await srv.see({ message: `no todo ${i}` });
  expect(stored(file)).toEqual([]);

  srv.clock.advance(1000);
  await drain();
  const [row] = stored(file);
  expect(row).toMatchObject({ count: 10, status: "open" });
  expect(row.samples).toHaveLength(5);

  await srv.handOff(row.fingerprint, "a person has it");
  expect(stored(file)[0]).toMatchObject({ status: "human", count: 10 });
});

test("shutdown drains: a sighting not yet flushed is written when the server closes (judged rule 8)", async () => {
  const file = join(folder(), "easel.db");
  const srv = await boot({ file });
  await srv.see();

  await srv.close();

  expect(stored(file)).toMatchObject([{ label: "todo.add", count: 1 }]);
});

test("a restart keeps the groups, the retired list, the dropped count and the fixer's tick; a new build regresses", async () => {
  const file = join(folder(), "easel.db");
  const clock = makeTestClock({ now: t0 });
  const first = await boot({ file, clock, build: 7, caps: { groups: 1, retired: 5 } });
  const { ann } = await people(first);
  const old = await first.see({ label: "a.old", build: 3 });
  await first.resolve(old.fingerprint, 6);
  await first.see({ label: "b.open" });
  await first.handOff((await first.list())[0]?.fingerprint ?? "", "kept");
  await first.see({ label: "c.dropped" });
  await ann.scope.run(ops.owner["ops.fixerTick"], { input: null });
  await first.close();

  // The next deploy: build 8 on the same file.
  const next = await boot({ file, clock, build: 8, caps: { groups: 2, retired: 5 } });
  expect((await next.list()).map((g) => [g.label, g.status])).toEqual([["b.open", "human"]]);
  expect((await next.status()).errors.dropped).toBe(1);
  expect((await next.status()).fixerSeen).toBe(t0);
  expect((await next.see({ label: "a.old" })).kind).toBe("regressed");
});

// ---- Readiness, status and the fixer's tick (SPEC-ops.md § An agent checks the server)

test("status: the build, the checks, each module's counters, the error counts and the fixer", async () => {
  const depth = operation({ label: "test.depth", run: async () => ({ depth: 3, leases: 1 }) });
  const queue = capsule({ label: "testQueue", tags: [counters({ module: "queue", op: depth })] });
  const srv = await boot({ build: 12, extra: [queue({})] });
  await srv.see({ label: "a" });
  await srv.see({ label: "b", side: "browser" });
  srv.clock.advance(2 * 60 * minute);
  await srv.see({ label: "c" });

  expect(await srv.status()).toEqual({
    commit: "c0ffee",
    build: 12,
    uptime: 2 * 60 * minute,
    checks: expect.arrayContaining([
      { name: "database", ok: true, detail: "reads and writes" },
      { name: "disk", ok: true, detail: "in memory" },
    ]),
    counters: { "queue.depth": 3, "queue.leases": 1 },
    errors: { hour: 1, day: 3, open: 3, unconfirmed: 1, dropped: 0 },
    fixerSeen: null,
    fixerSilent: true,
  });
  srv.clock.advance(23 * 60 * minute);
  expect((await srv.status()).errors).toMatchObject({ hour: 0, day: 1 });
});

test("errors ls: newest first; --open is open and regressed; --side and --since filter", async () => {
  const srv = await boot({ build: 7 });
  const a = await srv.see({ label: "a", build: 3 });
  srv.clock.advance(minute);
  await srv.see({ label: "b", side: "browser" });
  srv.clock.advance(minute);
  await srv.see({ label: "c" });
  await srv.resolve(a.fingerprint, 6);

  expect((await srv.list()).map((g) => g.label)).toEqual(["c", "b", "a"]);
  expect((await srv.list({ open: true })).map((g) => g.label)).toEqual(["c", "b"]);
  expect((await srv.list({ side: "browser" })).map((g) => g.label)).toEqual(["b"]);
  expect((await srv.list({ since: t0 + minute })).map((g) => g.label)).toEqual(["c", "b"]);
  expect(Object.keys((await srv.list())[0] ?? {})).not.toContain("samples");
});

test("/api/ready: 200 with no failing check; it is never cached", async () => {
  const srv = await boot();

  const answer = await srv.ready();

  expect(answer.code).toBe(200);
  expect(answer.body).toEqual({ failing: [], fixerSeen: null, fixerSilent: false });
  expect(answer.cache.get("cache-control")).toBe("no-store");
});

test("/api/ready turns 503 when the data directory is not writable, and back to 200 when it is", async () => {
  const dir = join(folder(), "data");
  mkdirSync(dir);
  const srv = await boot({ database: join(dir, "easel.db") });
  expect((await srv.ready()).code).toBe(200);

  // Removing the folder stops root too, which file modes do not.
  rmSync(dir, { recursive: true });
  const down = await srv.ready();
  expect(down).toMatchObject({ code: 503, body: { failing: ["disk"] } });
  expect(await srv.check("disk")).toEqual({
    name: "disk",
    ok: false,
    detail: "not writable: ENOENT",
  });

  mkdirSync(dir);
  expect((await srv.ready()).code).toBe(200);
  expect(readdirSync(dir)).toEqual([]);
});

test("the disk check fails when the disk has less than minFree left", async () => {
  const srv = await boot({
    database: join(folder(), "easel.db"),
    minFree: Number.MAX_SAFE_INTEGER,
  });

  expect((await srv.ready()).body.failing).toEqual(["disk"]);
  expect((await srv.check("disk"))?.detail).toMatch(/^\d+ MiB free$/);
});

test("a failed store write fails the database check, and the next write that works clears it", async () => {
  const file = join(folder(), "easel.db");
  const srv = await boot({ file });
  const other = new Database(file);
  closers.push(() => other.close());
  other.exec("DROP TABLE ops_groups");

  await srv.see();
  srv.clock.advance(1000);
  await drain();
  expect(await srv.ready()).toMatchObject({ code: 503, body: { failing: ["database"] } });
  expect(await srv.check("database")).toEqual({
    name: "database",
    ok: false,
    detail: "the last write failed: no such table: ops_groups",
  });

  other.exec("CREATE TABLE ops_groups (fingerprint TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL)");
  srv.clock.advance(1000);
  await drain();
  expect((await srv.ready()).code).toBe(200);
  expect(stored(file)).toHaveLength(1);
});

test("a module's readiness check: failing, throwing or silent for 5 s, it makes /api/ready 503 by its name", async () => {
  const state = { frames: true };
  const frames = operation({
    label: "test.frames",
    run: async () => ({ ok: state.frames, detail: "chromium" }),
  });
  const broken = operation({
    label: "test.broken",
    run: async (): Promise<{ ok: boolean; detail: string }> => {
      throw new Error("no browser");
    },
  });
  const stuck = operation({
    label: "test.stuck",
    run: (_, { clock, signal }) =>
      clock.sleep(60_000, signal).then(() => ({ ok: true, detail: "late" })),
  });
  const mod = capsule({
    label: "testFrames",
    tags: [
      readiness({ name: "frames", op: frames }),
      readiness({ name: "broken", op: broken }),
      readiness({ name: "stuck", op: stuck }),
    ],
  });
  const srv = await boot({ extra: [mod({})] });

  const pending = srv.ready();
  await drain();
  srv.clock.advance(5000);
  const answer = await pending;

  expect(answer).toMatchObject({
    code: 503,
    body: { failing: expect.arrayContaining(["broken", "stuck"]) },
  });
  expect(answer.body.failing).toHaveLength(2);
  const shown = srv.status();
  await drain();
  srv.clock.advance(5000);
  expect((await shown).checks).toEqual(
    expect.arrayContaining([
      { name: "frames", ok: true, detail: "chromium" },
      { name: "broken", ok: false, detail: "the check failed" },
      { name: "stuck", ok: false, detail: "no answer in 5 s" },
    ]),
  );
});

test("fixerSilent: 30 minutes after the last tick and not before, also across a restart; with no tick, from the start", async () => {
  const file = join(folder(), "easel.db");
  const clock = makeTestClock({ now: t0 });
  const srv = await boot({ file, clock });
  const { ann } = await people(srv);

  clock.advance(silentAfter + 1);
  expect((await srv.ready()).body).toEqual({ failing: [], fixerSeen: null, fixerSilent: true });

  const stamped = await ann.scope.run(ops.owner["ops.fixerTick"], { input: null });
  expect(stamped).toEqual({ kind: "stamped", at: t0 + silentAfter + 1 });
  clock.advance(silentAfter);
  expect((await srv.ready()).body.fixerSilent).toBe(false);
  await srv.close();

  // A restart does not reset it: the stored tick counts.
  const again = await boot({ file, clock });
  expect((await again.ready()).body).toEqual({
    failing: [],
    fixerSeen: stamped.at,
    fixerSilent: false,
  });
  clock.advance(1);
  expect((await again.ready()).body.fixerSilent).toBe(true);
  // A silent fixer does not make the server unready.
  expect((await again.ready()).code).toBe(200);
});

test("the fixer's tick is kept in memory when the store cannot write it", async () => {
  const file = join(folder(), "easel.db");
  const srv = await boot({ file });
  const { ann } = await people(srv);
  const other = new Database(file);
  closers.push(() => other.close());
  other.exec("DROP TABLE ops_meta");

  const stamped = await ann.scope.run(ops.owner["ops.fixerTick"], { input: null });

  expect((await srv.status()).fixerSeen).toBe(stamped.at);
  expect((await srv.ready()).body.failing).toEqual(["database"]);
});

// ---- Who may call (fact rule 2), and what is no error (step 4)

test("ops.status is any user's; the other calls are an owner's; a refusal is no error group", async () => {
  const srv = await boot();
  const { ann, bob, nobody } = await people(srv);
  await srv.see();

  expect((await bob.scope.run(ops.user["ops.status"], { input: null })).build).toBe(5);
  expect(await faultOf(bob.scope.run(ops.owner["ops.errors"], { input: {} }))).toEqual({
    fault: "refused",
    payload: { owner: true },
  });
  expect(await faultOf(bob.scope.run(ops.owner["ops.fixerTick"], { input: null }))).toEqual({
    fault: "refused",
    payload: { owner: true },
  });
  for (const call of [
    nobody.scope.run(ops.user["ops.status"], { input: null }),
    nobody.scope.run(ops.owner["ops.errors"], { input: {} }),
  ]) {
    expect(await faultOf(call)).toEqual({ fault: "refused", payload: { signIn: true } });
  }
  expect((await ann.scope.run(ops.owner["ops.errors"], { input: {} })).errors).toHaveLength(1);
  await drain();
  // An answer kind is the contract working too: gone is no error.
  await ann.scope.run(ops.owner["ops.error"], { input: { fingerprint: "0".repeat(64) } });
  await drain();
  expect(await srv.list()).toHaveLength(1);
});

// ---- The panic path (fact rule 5, judged rule 9)

type Exit = { code: number; reason: unknown; storedThen: unknown[] };

/** A panic's ends: what reached stderr, and the exit with what the store held at that moment. */
function ends(file: string) {
  const err: string[] = [];
  const exited: Exit[] = [];
  const to = {
    stderr: { write: (chunk: string) => err.push(chunk) },
    exit: (code: number, reason: unknown) => {
      // A store that lost its table holds nothing readable.
      const storedThen = existsSync(file) && tableOf(file) ? stored(file) : [];
      exited.push({ code, reason, storedThen });
    },
    closed: Promise.resolve(),
  };

  return { err, exited, to };
}

test("a panic reaches stderr, then the store, then exit 1 (fact rule 5)", async () => {
  const file = join(folder(), "easel.db");
  const srv = await boot({ file });
  const { err, exited, to } = ends(file);
  const thrown = new RangeError(`bad offset 42 with token=${"s".repeat(30)}`);

  await srv.server.run(panic, { input: { error: thrown, to } });

  expect(err.join("")).toMatch(/^panic: RangeError: bad offset 42 with token=\[removed\]\n\s+at /);
  expect(err.join("")).not.toContain("s".repeat(30));
  expect(exited).toHaveLength(1);
  expect(exited[0]).toMatchObject({ code: 1, reason: thrown });
  expect(exited[0]?.storedThen).toMatchObject([{ label: "panic", name: "RangeError" }]);
});

test("if the store itself fails, the panic still reaches stderr, and says the store failed (judged rule 9)", async () => {
  const file = join(folder(), "easel.db");
  const srv = await boot({ file });
  const other = new Database(file);
  closers.push(() => other.close());
  other.exec("DROP TABLE ops_groups");
  const { err, exited, to } = ends(file);

  await srv.server.run(panic, { input: { error: "a thrown string", to } });

  expect(err[0]).toBe("panic: a thrown string\n");
  expect(err[1]).toMatch(/^ops: the panic is not in the store: no such table: ops_groups\n$/);
  expect(exited.map((e) => e.code)).toEqual([1]);
});

test("a close that fails after a panic is said on stderr", async () => {
  const srv = await boot();
  const err: string[] = [];
  const to = {
    stderr: { write: (chunk: string) => err.push(chunk) },
    exit: () => undefined,
    closed: Promise.reject(new Error("the socket would not close")),
  };

  await srv.server.run(panic, { input: { error: new Error("x"), to } });

  expect(err.at(-1)).toBe("server close failed: the socket would not close\n");
});

test("observePanics covers unhandled rejections and uncaught exceptions, and stops when told", async () => {
  const file = join(folder(), "easel.db");
  const srv = await boot({ file });
  const { err, exited, to } = ends(file);
  const before = {
    rejection: process.listeners("unhandledRejection"),
    exception: process.listeners("uncaughtException"),
  };

  const off = srv.server.run(observePanics, { input: { scope: srv.server, ...to } });
  const added = {
    rejection: process.listeners("unhandledRejection").filter((l) => !before.rejection.includes(l)),
    exception: process.listeners("uncaughtException").filter((l) => !before.exception.includes(l)),
  };
  expect([added.rejection.length, added.exception.length]).toEqual([1, 1]);
  added.rejection[0]?.call(process, new Error("lost promise"), Promise.resolve());
  added.exception[0]?.call(process, new Error("thrown in a timer"), "uncaughtException");
  await drain();
  off();

  expect(err.filter((line) => line.startsWith("panic:"))).toEqual([
    expect.stringMatching(/^panic: Error: lost promise\n/),
    expect.stringMatching(/^panic: Error: thrown in a timer\n/),
  ]);
  expect(exited.map((e) => e.code)).toEqual([1, 1]);
  expect(process.listeners("unhandledRejection")).toEqual(before.rejection);
  expect(process.listeners("uncaughtException")).toEqual(before.exception);
});

// ---- ops imports no later module (fact rule 6)

test("ops imports only access, release, the base and libraries (fact rule 6)", () => {
  const dir = new URL("../src/ops/", import.meta.url).pathname;
  const allowed = /^(@\/access|@\/release|~\/|\.\/|node:|zod$|drizzle-orm|@tinkered\/)/;

  const imports = readdirSync(dir).flatMap((name) =>
    [...readFileSync(join(dir, name), "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1] ?? ""),
  );

  expect(imports.length).toBeGreaterThan(10);
  expect(imports.filter((path) => !allowed.test(path))).toEqual([]);
});

// ---- The sink is the only writer of sightings (fact rule 1)

test("only the sink and the panic path call the sink's operations; only the sink counts a sighting (fact rule 1)", () => {
  const root = new URL("../", import.meta.url).pathname;
  const files = ["src", "cmds"].flatMap((top) =>
    readdirSync(join(root, top), { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
      .map((name) => join(top, name)),
  );
  const text = (path: string) => readFileSync(join(root, path), "utf8");
  const callers = files.filter((path) =>
    /\b(sight|sightBatch|sightSpan|sightLog|openGroup|countKnown|makeRoom)\b/.test(text(path)),
  );
  const counters = files.filter((path) => /\bcount: \w+\.count \+ 1|\bcount: 1,/.test(text(path)));

  expect(callers.toSorted((a, b) => a.localeCompare(b))).toEqual([
    "src/ops/panic.server.ts",
    "src/ops/sink.server.ts",
  ]);
  expect(counters).toEqual(["src/ops/sink.server.ts"]);
});

// ---- The edges of the group's moves, the cap and the retired list (conformance review)

test("OwnerResolves: seen on 7, then on the older 5, resolve 6 is failing: the highest build counts (judged rule 7)", async () => {
  const srv = await boot({ build: 7 });
  const { fingerprint } = await srv.see({ build: 7 });
  await srv.see({ build: 5 });

  expect(await srv.resolve(fingerprint, 6)).toEqual({ kind: "failing", seen: 7 });
});

test("OwnerResolves twice: a second resolve moves fixedIn to its build", async () => {
  const srv = await boot({ build: 7 });
  const { fingerprint } = await srv.see({ build: 4 });
  await srv.resolve(fingerprint, 5);

  expect(await srv.resolve(fingerprint, 7)).toEqual({ kind: "resolved" });
  expect((await srv.list())[0]).toMatchObject({ status: "resolved", fixedIn: 7 });
});

test("HumanStaysHuman: a human group with a fixedIn, seen on a later build, stays human", async () => {
  const srv = await boot({ build: 9 });
  const { fingerprint } = await srv.see({ build: 3 });
  await srv.resolve(fingerprint, 5);
  await srv.handOff(fingerprint, "a person looks");

  expect((await srv.see({ build: 8 })).kind).toBe("counted");
  expect((await srv.list())[0]).toMatchObject({ status: "human", fixedIn: 5 });
});

test("the same label, name and message on both sides are two groups: the side is in the fingerprint (judged rule 5)", async () => {
  const srv = await boot();
  const server = await srv.see({ side: "server" });
  const browser = await srv.see({ side: "browser" });

  expect(server.fingerprint).not.toBe(browser.fingerprint);
  expect(await srv.list()).toHaveLength(2);
});

test("two messages that differ only in a uuid are one group (judged rule 5)", async () => {
  const srv = await boot();
  const a = await srv.see({ message: "no frame f47ac10b-58cc-4372-a567-0e02b2c3d479" });
  const b = await srv.see({ message: "no frame 123e4567-e89b-12d3-a456-426614174000" });

  expect(b).toEqual({ fingerprint: a.fingerprint, kind: "counted" });
});

test("normalize makes two uuids one, without the scrub's help (judged rule 5)", async () => {
  // The scrub removes a uuid first (a 36-character run), so through the sink the uuid rule is
  // never reached; it holds on its own should the run rule change.
  const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => scope.close());
  const of = (id: string) => scope.run(normalize, { input: `no frame ${id}` });

  expect(of("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe("no frame #");
  expect(of("123e4567-e89b-12d3-a456-426614174000")).toBe("no frame #");
});

test("at the cap a confirmed regressed group never goes; of two browser groups the oldest goes (judged rule 3)", async () => {
  const srv = await boot({ build: 7, caps: { groups: 3, retired: 10 } });
  const { fingerprint } = await srv.see({ label: "a.regressed", build: 5 });
  await srv.resolve(fingerprint, 6);
  expect((await srv.see({ label: "a.regressed", build: 7 })).kind).toBe("regressed");
  srv.clock.advance(1000);
  await srv.see({ label: "b.one", side: "browser" });
  srv.clock.advance(1000);
  await srv.see({ label: "b.two", side: "browser" });
  srv.clock.advance(1000);

  expect((await srv.see({ label: "c.new" })).kind).toBe("opened");
  const kept = (await srv.list()).map((g) => `${g.label} ${g.status}`);
  expect(kept.toSorted(byText)).toEqual(["a.regressed regressed", "b.two open", "c.new open"]);
});

test("the retired list at its cap keeps every entry; one past it, the oldest goes (judged rule 4)", async () => {
  const srv = await boot({ build: 7, caps: { groups: 1, retired: 2 } });
  const retire = async (label: string) => {
    const { fingerprint } = await srv.see({ label, build: 5 });
    await srv.resolve(fingerprint, 6);
  };
  await retire("a.first");
  await retire("b.second");
  await srv.see({ label: "c.third", build: 5 });

  // Two retired, the cap: both are kept, so an older build changes nothing.
  expect((await srv.see({ label: "a.first", build: 5 })).kind).toBe("older");
  expect((await srv.see({ label: "b.second", build: 5 })).kind).toBe("older");

  await srv.resolve((await srv.list())[0]?.fingerprint ?? "", 6);
  await srv.see({ label: "d.fourth", build: 5 });
  // Three retired: a.first left the list, so it is new, and no group can make room for it.
  expect((await srv.see({ label: "a.first", build: 5 })).kind).toBe("dropped");
  expect((await srv.see({ label: "b.second", build: 5 })).kind).toBe("older");
});

// ---- The store: exact timing, the dropped count, an early eviction, a failed move

/** ops's stamps as stored: `dropped`, `fixerSeen`. */
function metaOf(file: string) {
  const db = new Database(file, { readonly: true });
  try {
    const rows = z
      .array(z.object({ key: z.string(), value: z.number() }))
      .parse(db.query("SELECT key, value FROM ops_meta").all());
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  } finally {
    db.close();
  }
}

test("one write a second, exactly: after 999 ms no row, 1 ms later the row (judged rule 2)", async () => {
  const file = join(folder(), "easel.db");
  const srv = await boot({ file });
  await srv.see();

  srv.clock.advance(999);
  await drain();
  expect(stored(file)).toEqual([]);

  srv.clock.advance(1);
  await drain();
  expect(stored(file)).toMatchObject([{ label: "todo.add", count: 1 }]);
});

test("a new group dropped at the cap is counted in the store, with nothing else to write (judged rule 3)", async () => {
  const file = join(folder(), "easel.db");
  const srv = await boot({ file, caps: { groups: 1, retired: 10 } });
  await srv.see({ label: "a.kept" });
  srv.clock.advance(1000);
  await drain();
  expect(metaOf(file)).toEqual({ dropped: 0 });

  expect((await srv.see({ label: "b.new" })).kind).toBe("dropped");
  srv.clock.advance(1000);
  await drain();
  expect(metaOf(file)).toEqual({ dropped: 1 });
});

test("a group retired and pushed out of the retired list before the flush leaves no row behind (judged rule 4)", async () => {
  const file = join(folder(), "easel.db");
  const srv = await boot({ file, build: 7, caps: { groups: 1, retired: 1 } });
  const a = await srv.see({ label: "a.first", build: 5 });
  srv.clock.advance(1000);
  await drain();
  await srv.resolve(a.fingerprint, 6);
  const b = await srv.see({ label: "b.second", build: 5 });
  await srv.resolve(b.fingerprint, 6);
  await srv.see({ label: "c.third", build: 5 });

  srv.clock.advance(1000);
  await drain();
  expect(stored(file).map((g) => g.label)).toEqual(["c.third"]);
});

test("a resolve or hand-off the store cannot write fails (a failed fault), and the group is as it was", async () => {
  const file = join(folder(), "easel.db");
  const srv = await boot({ file, build: 7 });
  const { ann } = await people(srv);
  const { fingerprint } = await srv.see({ build: 4 });
  const other = new Database(file);
  closers.push(() => other.close());
  other.exec("DROP TABLE ops_groups");

  await expect(srv.resolve(fingerprint, 6)).rejects.toThrow(
    "ops: the resolve is not stored: no such table: ops_groups",
  );
  await expect(srv.handOff(fingerprint, "a person")).rejects.toThrow(
    "ops: the hand-off is not stored: no such table: ops_groups",
  );
  const input = { fingerprint, build: 6 };
  const call = ann.scope.run(ops.owner["ops.resolveError"], { input });
  expect((await faultOf(call))?.fault).toBe("failed");
  expect((await srv.list())[0]).toMatchObject({ status: "open", fixedIn: null, reason: null });
});

test("a refused fault that passes up through a server operation is no error group (step 4)", async () => {
  const srv = await boot();
  const { bob } = await people(srv);
  const relay = operation({
    label: "test.relay",
    run: () => bob.scope.run(ops.owner["ops.errors"], { input: {} }),
  });

  expect(await faultOf(srv.server.run(relay))).toEqual({
    fault: "refused",
    payload: { owner: true },
  });
  await drain();
  expect(await srv.list()).toEqual([]);
});
