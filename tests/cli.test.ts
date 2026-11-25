import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation, transport } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { access } from "@/access";
import { browserOps, openOps, signInWithLink } from "@/access/browser.server";
import { request, sessionCookie } from "@/access/contract";
import { byToken, owner, user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessDefaults } from "@/access/settings";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { cli } from "@/cli";
import type { Command } from "@/cli";
import { faultExit } from "@/cli/exit";
import { relinkAfter } from "@/cli/login";
import { browserOpener } from "@/cli/open";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

const origin = "https://easel.test";

async function boot(
  serve = [access.login, access.browser, access.open, access.user, access.owner],
  listOp = ownerOps["users.list"],
) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const count = { waits: 0 };
  const counted = operation({
    label: "test.countedWait",
    input: z.object({ request }),
    depends: { wait: loginOps["login.wait"] },
    run: ({ wait }, { input }) => (count.waits++, wait.run({ input })),
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
      access.login({ implement: { ...loginOps, "login.wait": counted } }),
      access.browser({ implement: browserOps }),
      access.open({ implement: openOps, onStart: [user, byToken] }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: { ...ownerOps, "users.list": listOp }, onStart: [user, owner] }),
      memory.server({ services: serve }),
    ],
  });
  const server = await scope.ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";
  const waits = () => count.waits;

  return { server, clock, setupCode, waits };
}

type Srv = Awaited<ReturnType<typeof boot>>;

function home() {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));

  return join(dir, "easel", "hosts.json");
}

type Options = {
  peer?: string;
  json?: boolean;
  path?: string;
  token?: string;
  opener?: (url: string) => Promise<boolean>;
};

async function easel(srv: Srv, options: Options = {}) {
  const path = options.path ?? home();
  const out: string[] = [];
  const err: string[] = [];
  const stop = new AbortController();
  const app = createScope({
    clock: srv.clock,
    tags: options.opener ? [browserOpener(options.opener)] : [],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({
        peer: srv.server,
        headers: { "x-easel-peer": options.peer ?? "203.0.113.7" },
        meta: cli.bearer,
      }),
      access.login({ remote: memory.client }),
      access.open({ remote: memory.client }),
      access.user({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => err.push(chunk) },
        json: options.json ?? true,
        server: origin,
        hosts: path,
        token: options.token ?? null,
      }),
    ],
  });
  const scope = await app.ready;
  closers.push(() => scope.close());

  return {
    path,
    out,
    err,
    stop,
    run: (command: Command) => scope.run(cli.run, { input: command, signal: stop.signal }),
    wait: (request: string) => scope.run(access.login["login.wait"], { input: { request } }),
    lines: () =>
      out
        .splice(0)
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    scope,
    hosts: () => JSON.parse(readFileSync(path, "utf8")).hosts[origin] ?? {},
  };
}

const login = (name: string, more: { setup?: string; noWait?: boolean } = {}): Command => ({
  kind: "login",
  name,
  noWait: more.noWait ?? false,
  ...(more.setup ? { setup: more.setup } : {}),
});

const users = (act: Extract<Command, { kind: "users" }>["act"]): Command => ({
  kind: "users",
  act,
});

async function ann(srv: Srv) {
  const cli = await easel(srv, { peer: "198.51.100.1" });
  expect(await cli.run(login("ann", { setup: srv.setupCode() }))).toBe(0);
  cli.lines();

  return cli;
}

async function pendingAgent(srv: Srv, name = "agent") {
  const agent = await easel(srv);
  expect(await agent.run(login(name, { noWait: true }))).toBe(0);
  const [line] = agent.lines();

  return { agent, code: String(line.code) };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await tick(10);
  expect(check()).toBe(true);
}

const settled = (run: Promise<number>) =>
  run.then(
    (code) => code,
    (error: unknown) => error,
  );

test("login --setup: the first owner is signed in; the token is kept 0600 and never printed", async () => {
  const srv = await boot();
  const a = await easel(srv, { peer: "198.51.100.1" });

  expect(await a.run(login("ann", { setup: srv.setupCode() }))).toBe(0);
  const [line] = a.lines();
  expect(line).toEqual({
    kind: "granted",
    user: { name: "ann", role: "owner", since: srv.clock.currentTimeMillis() },
  });
  const held = a.hosts();
  expect(held.user).toMatchObject({ name: "ann", role: "owner" });
  expect(JSON.stringify(line)).not.toContain(held.user.token);
  expect(statSync(a.path).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(a.path, "utf8")).default).toBe(origin);

  expect(await a.run({ kind: "whoami" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "me", name: "ann", owner: true, server: origin }]);
});

test("login --setup answers taken, wrong and slow with exit 1, and keeps nothing", async () => {
  const srv = await boot();
  await ann(srv);
  const b = await easel(srv, { peer: "198.51.100.2" });

  expect(await b.run(login("bob", { setup: srv.setupCode() }))).toBe(1);
  expect(b.lines()).toEqual([{ kind: "taken" }]);

  const fresh = await boot();
  const c = await easel(fresh, { peer: "198.51.100.3" });
  const wrong = fresh.setupCode() === "BBBB-BBBB" ? "CCCC-CCCC" : "BBBB-BBBB";
  expect(await c.run(login("cat", { setup: wrong }))).toBe(1);
  expect(c.lines()).toEqual([{ kind: "wrong" }]);
  for (let i = 0; i < 4; i++) await c.run(login("cat", { setup: wrong }));
  c.lines();
  expect(await c.run(login("cat", { setup: wrong }))).toBe(1);
  expect(c.lines()).toEqual([{ kind: "slow", retryIn: expect.any(Number) }]);
  expect(existsSync(c.path)).toBe(false);
});

test("the agent starts a login: the code is printed at once, then it is told granted, and is signed in", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const agent = await easel(srv);

  const run = agent.run(login("agent"));
  await until(() => agent.out.length > 0);
  const [pending] = agent.lines();
  expect(pending).toEqual({
    kind: "pending",
    code: expect.any(String),
    expiresAt: srv.clock.currentTimeMillis() + accessDefaults.codeLife,
  });
  expect(agent.hosts().pending).toMatchObject({ name: "agent", code: pending.code });

  expect(await a.run(users({ kind: "approve", code: pending.code, owner: false }))).toBe(0);
  expect(a.lines()).toEqual([
    { kind: "approved", user: expect.objectContaining({ name: "agent", role: "member" }) },
  ]);
  expect(await run).toBe(0);
  expect(agent.lines()).toEqual([
    { kind: "granted", user: expect.objectContaining({ name: "agent", role: "member" }) },
  ]);
  expect(agent.hosts()).toEqual({
    user: { name: "agent", role: "member", token: expect.any(String) },
  });
});

test("login --no-wait prints the pending code and exits 0; login refuses (64) while a login waits or a token is held", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const { agent, code } = await pendingAgent(srv);

  expect(await agent.run(login("agent"))).toBe(64);
  expect(agent.lines()).toEqual([{ usage: expect.stringContaining("--resume") }]);
  expect(await a.run(login("ann"))).toBe(64);
  expect(a.lines()).toEqual([{ usage: expect.stringContaining("easel logout") }]);
  expect(agent.hosts().pending.code).toBe(code);
});

test(
  "the agent starts a login and is told to slow down: exit 1, nothing kept; then the agent starts a login",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    await ann(srv);
    let told: Record<string, unknown> = {};
    let path = "";
    for (let i = 0; i < 8 && told.kind !== "slow"; i++) {
      const agent = await easel(srv);
      const code = await agent.run(login(`agent${i}`, { noWait: true }));
      told = agent.lines()[0];
      path = agent.path;
      expect(code).toBe(told.kind === "pending" ? 0 : 1);
    }
    expect(told).toEqual({ kind: "slow", retryIn: expect.any(Number) });
    expect(existsSync(path)).toBe(false);

    srv.clock.advance(Number(told.retryIn));
    const again = await easel(srv);
    expect(await again.run(login("agent9", { noWait: true }))).toBe(0);
    expect(again.lines()[0]).toMatchObject({ kind: "pending" });
  },
);

test("a name that is taken: exit 1, nothing kept", async () => {
  const srv = await boot();
  await ann(srv);
  const agent = await easel(srv);

  expect(await agent.run(login("ann", { noWait: true }))).toBe(1);
  expect(agent.lines()).toEqual([{ kind: "taken" }]);
  expect(existsSync(agent.path)).toBe(false);
});

test("the agent stops waiting; the agent resumes (login --resume) onto pending, then is told granted", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const first = await easel(srv);

  const run = settled(first.run(login("agent")));
  await until(() => first.out.length > 0);
  const [pending] = first.lines();
  await until(() => srv.waits() > 0);
  first.stop.abort();
  await tick();
  srv.clock.advance(accessDefaults.waitMax);
  expect(await run).not.toBe(0);
  expect(first.hosts().pending).toMatchObject({ code: pending.code });

  const resumed = await easel(srv, { path: first.path });
  const again = resumed.run({ kind: "resume" });
  await until(() => resumed.out.length > 0);
  expect(resumed.lines()).toEqual([
    { kind: "pending", code: pending.code, expiresAt: pending.expiresAt },
  ]);
  await a.run(users({ kind: "approve", code: pending.code, owner: false }));
  expect(await again).toBe(0);
  expect(resumed.lines()).toEqual([
    { kind: "granted", user: expect.objectContaining({ name: "agent" }) },
  ]);
  expect(resumed.hosts().user).toMatchObject({ name: "agent", token: first.hosts().user.token });
});

test("login --no-wait, then an owner approves; the agent resumes (login --resume) onto approved, and is signed in", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const { agent, code } = await pendingAgent(srv);

  expect(await a.run(users({ kind: "approve", code, owner: true }))).toBe(0);
  expect(await agent.run({ kind: "resume" })).toBe(0);
  expect(agent.lines()).toEqual([
    { kind: "pending", code, expiresAt: expect.any(Number) },
    { kind: "granted", user: expect.objectContaining({ name: "agent", role: "owner" }) },
  ]);
  expect(agent.hosts().pending).toBeUndefined();
});

test("a signed-out call while a login waits is refused (signIn): exit 2, and the login is kept; then it resumes onto approved", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const { agent, code } = await pendingAgent(srv);

  expect(await agent.run({ kind: "whoami" })).toBe(2);
  expect(agent.lines()).toEqual([{ refused: { signIn: true } }]);
  expect(agent.hosts().pending).toMatchObject({ code });

  await a.run(users({ kind: "approve", code, owner: false }));
  expect(await agent.run({ kind: "resume" })).toBe(0);
  expect(agent.lines().map((line) => line.kind)).toEqual(["pending", "granted"]);
});

test("login --resume with no login that waits is usage (64)", async () => {
  const srv = await boot();
  const agent = await easel(srv);

  expect(await agent.run({ kind: "resume" })).toBe(64);
  expect(agent.lines()).toEqual([{ usage: expect.stringContaining("no login waits") }]);
});

test("weak fairness: the CLI keeps asking while it waits (login.wait answers pending at 50 s)", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const { agent, code } = await pendingAgent(srv);

  const run = agent.run({ kind: "resume" });
  for (let round = 1; round <= 3; round++) {
    await until(() => srv.waits() >= round);
    await tick();
    srv.clock.advance(accessDefaults.waitMax);
  }
  await until(() => srv.waits() >= 4);
  await a.run(users({ kind: "approve", code, owner: false }));
  expect(await run).toBe(0);
  expect(agent.lines().map((line) => line.kind)).toEqual(["pending", "granted"]);
});

test("its code runs out (10 minutes); the agent is told its code ran out: exit 1, nothing kept", async () => {
  const srv = await boot();
  await ann(srv);
  const { agent } = await pendingAgent(srv);

  const run = agent.run({ kind: "resume" });
  for (
    let round = 1;
    round <= Math.ceil(accessDefaults.codeLife / accessDefaults.waitMax);
    round++
  ) {
    await until(() => srv.waits() >= round);
    await tick();
    srv.clock.advance(accessDefaults.waitMax);
  }
  expect(await run).toBe(1);
  expect(agent.lines().map((line) => line.kind)).toEqual(["pending", "expired"]);
  expect(agent.hosts()).toEqual({});
});

test("an owner denies its code; the agent is told denied: exit 1, nothing kept", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const { agent, code } = await pendingAgent(srv);

  const run = agent.run({ kind: "resume" });
  await until(() => srv.waits() > 0);
  expect(await a.run(users({ kind: "deny", code }))).toBe(0);
  expect(a.lines()).toEqual([{ kind: "denied" }]);
  expect(await run).toBe(1);
  expect(agent.lines().map((line) => line.kind)).toEqual(["pending", "denied"]);
  expect(agent.hosts()).toEqual({});
});

test("told to slow down while it waits: the CLI waits retryIn before it asks again", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const { agent, code } = await pendingAgent(srv);
  const other = await easel(srv);
  for (let i = 0; i < 30; i++) await other.wait("0".repeat(32));
  const before = srv.waits();

  const run = agent.run({ kind: "resume" });
  await until(() => srv.waits() === before + 1);
  await tick(100);
  expect(srv.waits()).toBe(before + 1);

  srv.clock.advance(60_000);
  await until(() => srv.waits() === before + 2);
  await a.run(users({ kind: "approve", code, owner: false }));
  expect(await run).toBe(0);
  expect(agent.lines().map((line) => line.kind)).toEqual(["pending", "granted"]);
});

test("a dropped link while it waits: the CLI asks again after 1, 2, 4, 8 and 16 s, then exits 69 and keeps the login", async () => {
  const srv = await boot();
  await ann(srv);
  const { agent, code } = await pendingAgent(srv);
  await srv.server.close();

  const run = agent.run({ kind: "resume" });
  for (const after of relinkAfter) {
    await tick(50);
    srv.clock.advance(after);
  }
  expect(await run).toBe(69);
  expect(agent.lines()).toEqual([
    { kind: "pending", code, expiresAt: expect.any(Number) },
    { unreachable: origin },
  ]);
  expect(agent.hosts().pending.code).toBe(code);
});

test("the agent stops waiting on an approved code, then an owner revokes the agent; the agent resumes and is told denied", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const { agent, code } = await pendingAgent(srv);

  await a.run(users({ kind: "approve", code, owner: false }));
  expect(await a.run(users({ kind: "revoke", name: "agent" }))).toBe(0);
  expect(a.lines()).toEqual([expect.objectContaining({ kind: "approved" }), { kind: "revoked" }]);
  expect(await agent.run({ kind: "resume" })).toBe(1);
  expect(agent.lines().map((line) => line.kind)).toEqual(["pending", "denied"]);
  expect(agent.hosts()).toEqual({});
});

test(
  "an owner revokes the agent; the agent's next call is refused, and it is told to log in again (exit 2, token dropped)",
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const a = await ann(srv);
    const { agent, code } = await pendingAgent(srv);
    await a.run(users({ kind: "approve", code, owner: false }));
    expect(await agent.run({ kind: "resume" })).toBe(0);
    agent.lines();

    expect(await a.run(users({ kind: "revoke", name: "agent" }))).toBe(0);
    expect(await agent.run({ kind: "whoami" })).toBe(2);
    expect(agent.lines()).toEqual([{ refused: { signIn: true } }]);
    expect(agent.hosts()).toEqual({});
    expect(await agent.run({ kind: "whoami" })).toBe(2);
    expect(await agent.run(login("agent", { noWait: true }))).toBe(0);
  },
);

test("the agent logs out: exit 0, the token is dropped; the last owner's logout answers last (exit 1) and keeps it", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const { agent, code } = await pendingAgent(srv);
  await a.run(users({ kind: "approve", code, owner: false }));
  await agent.run({ kind: "resume" });
  agent.lines();

  expect(await agent.run({ kind: "logout" })).toBe(0);
  expect(agent.lines()).toEqual([{ kind: "ended" }]);
  expect(agent.hosts()).toEqual({});

  a.lines();
  expect(await a.run({ kind: "logout" })).toBe(1);
  expect(a.lines()).toEqual([{ kind: "last" }]);
  expect(a.hosts().user).toMatchObject({ name: "ann" });
});

test("users: the list (always 0); approve, deny and revoke answer gone or last with exit 1", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const { code } = await pendingAgent(srv);

  expect(await a.run(users({ kind: "ls" }))).toBe(0);
  expect(a.lines()).toEqual([
    {
      users: [expect.objectContaining({ name: "ann", role: "owner" })],
      requests: [expect.objectContaining({ code, name: "agent", browser: false })],
      sessions: [],
    },
  ]);
  expect(await a.run(users({ kind: "deny", code }))).toBe(0);
  expect(await a.run(users({ kind: "deny", code }))).toBe(1);
  expect(await a.run(users({ kind: "approve", code, owner: false }))).toBe(1);
  expect(await a.run(users({ kind: "revoke", name: "nobody" }))).toBe(1);
  expect(await a.run(users({ kind: "revoke", name: "ann" }))).toBe(1);
  expect(a.lines()).toEqual([
    { kind: "denied" },
    { kind: "gone" },
    { kind: "gone" },
    { kind: "gone" },
    { kind: "last" },
  ]);
});

async function browserCodeFor(srv: Srv, name: string) {
  const page = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: srv.server, headers: { "x-easel-peer": "192.0.2.4" } }),
      access.browser({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => page.close());
  const shown = await page.run(access.browser["browser.start"], { input: { name } });
  if (shown.kind !== "pending") throw new Error(`not pending: ${shown.kind}`);

  return shown.code;
}

test("users approve of a browser code that asks for another user that is there answers theirs, exit 1: only that user can sign that browser in", async () => {
  const srv = await boot();
  const a = await easel(srv, { peer: "198.51.100.1", json: false });
  expect(await a.run(login("ann", { setup: srv.setupCode() }))).toBe(0);
  const { agent, code } = await pendingAgent(srv);
  expect(await a.run(users({ kind: "approve", code, owner: false }))).toBe(0);
  await agent.run({ kind: "resume" });
  const asked = await browserCodeFor(srv, "agent");

  expect(await a.run(users({ kind: "approve", code: asked, owner: false }))).toBe(1);
  expect(a.err.join("")).toContain(
    `code ${asked} asks to sign a browser in as agent, a user that is there. Only agent can sign that browser in, with \`easel open\`.`,
  );
  const own = await browserCodeFor(srv, "ann");
  expect(await a.run(users({ kind: "approve", code: own, owner: false }))).toBe(0);
});

test("a member's users call is refused: exit 2, it needs an owner, and the token is kept", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const { agent, code } = await pendingAgent(srv);
  await a.run(users({ kind: "approve", code, owner: false }));
  await agent.run({ kind: "resume" });
  agent.lines();

  expect(await agent.run(users({ kind: "ls" }))).toBe(2);
  expect(agent.lines()).toEqual([{ refused: { owner: true } }]);
  expect(agent.hosts().user).toMatchObject({ name: "agent" });
});

test("without --json: a person's text on stdout, errors on stderr, and no token in either", async () => {
  const srv = await boot();
  const a = await easel(srv, { peer: "198.51.100.1", json: false });
  expect(await a.run(login("ann", { setup: srv.setupCode() }))).toBe(0);
  const agent = await easel(srv, { json: false });
  expect(await agent.run(login("agent", { noWait: true }))).toBe(0);
  const code = agent.hosts().pending.code;

  expect(await a.run(users({ kind: "ls" }))).toBe(0);
  expect(await a.run(users({ kind: "approve", code, owner: false }))).toBe(0);
  expect(await agent.run({ kind: "resume" })).toBe(0);
  expect(await agent.run({ kind: "whoami" })).toBe(0);
  expect(await agent.run(users({ kind: "deny", code }))).toBe(2);
  const printed = [...a.out, ...agent.out].join("");
  expect(printed).toContain(`signed in to ${origin} as ann (owner)`);
  expect(printed).toContain(`code ${code} for agent`);
  expect(printed).toMatch(/users:\n {2}ann\towner/);
  expect(printed).toContain(`agent (member) on ${origin}`);
  expect(agent.err.join("")).toContain("this needs an owner");
  for (const held of [a.hosts().user.token, agent.hosts().user.token]) {
    expect([printed, ...a.err, ...agent.err].join("")).not.toContain(held);
  }
});

test("a call the server does not have is missing (76); a server that fails is failed (70)", async () => {
  const broken = operation({
    label: "test.brokenList",
    input: z.null(),
    run: () => {
      throw new Error("the disk is gone");
    },
  });
  const srv = await boot([access.login, access.user, access.owner], broken);
  const a = await ann(srv);
  expect(await a.run(users({ kind: "ls" }))).toBe(70);
  expect(a.lines()).toEqual([{ failed: expect.any(String) }]);
  expect(a.hosts().user).toMatchObject({ name: "ann" });

  const old = await boot([access.login, access.user]);
  const b = await ann(old);
  expect(await b.run(users({ kind: "ls" }))).toBe(76);
  expect(b.lines()).toEqual([{ missing: "users.list" }]);
});

test("each fault has its exit: invalid 65, encode and decode 70, link 69; an error that is no fault is thrown on", async () => {
  const srv = await boot();
  const a = await easel(srv);
  const fault = (kind: "invalid" | "encode" | "decode" | "link") =>
    a.scope.run(faultExit, {
      input: access.owner.fault.make("users.list", kind, { name: "bad" }, "t1"),
    });

  expect(fault("invalid")).toBe(65);
  expect(fault("encode")).toBe(70);
  expect(fault("decode")).toBe(70);
  expect(fault("link")).toBe(69);
  expect(a.lines()).toEqual([
    { invalid: { name: "bad" } },
    { failed: "t1" },
    { failed: "t1" },
    { unreachable: origin },
  ]);
  await expect(async () => a.scope.run(faultExit, { input: new Error("a bug") })).rejects.toThrow(
    "a bug",
  );
});

function brokenHosts() {
  const path = home();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "{ not json");

  return path;
}

test("with EASEL_TOKEN the CLI uses it and never reads or writes hosts.json; a refused token says to get a new one", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const path = brokenHosts();
  const run = await easel(srv, { token: a.hosts().user.token, path, json: false });

  expect(await run.run({ kind: "whoami" })).toBe(0);
  expect(run.out.join("")).toBe(`ann (owner) on ${origin}\n`);
  expect(readFileSync(path, "utf8")).toBe("{ not json");

  const stranger = await easel(srv, { token: "not-a-token", path, json: false });
  expect(await stranger.run({ kind: "whoami" })).toBe(2);
  expect(stranger.err.join("")).toContain(`EASEL_TOKEN does not work on ${origin}`);
  expect(readFileSync(path, "utf8")).toBe("{ not json");
});

test("with EASEL_TOKEN, logout changes nothing and exits 64; login and login --resume exit 64 too", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const path = brokenHosts();
  const run = await easel(srv, { token: a.hosts().user.token, path });

  expect(await run.run({ kind: "logout" })).toBe(64);
  expect(run.lines()).toEqual([{ usage: expect.stringContaining("easel users revoke") }]);
  expect(await run.run({ kind: "whoami" })).toBe(0);
  run.lines();
  expect(await run.run(login("other", { noWait: true }))).toBe(64);
  expect(run.lines()).toEqual([{ usage: expect.stringContaining("EASEL_TOKEN is set") }]);
  expect(await run.run({ kind: "resume" })).toBe(64);
  expect(readFileSync(path, "utf8")).toBe("{ not json");
});

const printToken = (name: string): Command => ({
  kind: "login",
  name,
  noWait: false,
  printToken: true,
});

test("login --print-token: the code at once, then the token one time on stdout; nothing is kept, and the token works as EASEL_TOKEN", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const lead = await easel(srv);

  const run = lead.run(printToken("github"));
  await until(() => lead.out.length > 0);
  const [pending] = lead.lines();
  expect(pending).toEqual({
    kind: "pending",
    code: expect.any(String),
    expiresAt: expect.any(Number),
  });
  expect(existsSync(lead.path)).toBe(false);

  expect(await a.run(users({ kind: "approve", code: pending.code, owner: false }))).toBe(0);
  expect(await run).toBe(0);
  const [granted] = lead.lines();
  expect(granted).toEqual({
    kind: "granted",
    user: expect.objectContaining({ name: "github", role: "member" }),
    token: expect.any(String),
  });
  expect(existsSync(lead.path)).toBe(false);

  const runner = await easel(srv, { token: String(granted.token), json: false });
  expect(await runner.run({ kind: "whoami" })).toBe(0);
  expect(runner.out.join("")).toBe(`github (member) on ${origin}\n`);
});

test("login --print-token from a CLI that is signed in: it is not refused, and a denied code keeps the CLI's own token", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const held = a.hosts();

  const run = a.run(printToken("github"));
  await until(() => a.out.length > 0);
  const [pending] = a.lines();
  const owner = await easel(srv, { token: String(held.user.token) });
  expect(await owner.run(users({ kind: "deny", code: String(pending.code) }))).toBe(0);
  expect(await run).toBe(1);
  expect(a.lines()).toEqual([{ kind: "denied" }]);
  expect(a.hosts()).toEqual(held);
});

test("login --print-token without --json: stdout holds only the token; the code and the next step go to stderr", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const lead = await easel(srv, { json: false });

  const run = lead.run(printToken("github"));
  await until(() => lead.err.length > 0);
  const code = /code (\S+) for github/.exec(lead.err.join(""))?.[1] ?? "";
  expect(lead.out).toEqual([]);
  expect(await a.run(users({ kind: "approve", code, owner: false }))).toBe(0);
  expect(await run).toBe(0);

  const [token, ...more] = lead.out.join("").split("\n");
  expect(more).toEqual([""]);
  expect(token).toMatch(/^[\w-]{43}$/);
  expect(lead.err.join("")).toContain("EASEL_TOKEN");
  expect(lead.err.join("")).not.toContain(String(token));
});

test("easel open: prints a one-time sign-in link of the server, with the link after #, and opens it in the browser when it can", async () => {
  const srv = await boot();
  const opened: string[] = [];
  const a = await easel(srv, {
    peer: "198.51.100.1",
    opener: async (url) => (opened.push(url), true),
  });
  expect(await a.run(login("ann", { setup: srv.setupCode() }))).toBe(0);
  a.lines();

  expect(await a.run({ kind: "open", noBrowser: false })).toBe(0);
  const [line] = a.lines();
  expect(line).toEqual({
    kind: "link",
    url: expect.stringMatching(new RegExp(`^${origin}/open#[0-9a-f]{64}$`)),
    expiresAt: srv.clock.currentTimeMillis() + 5 * 60_000,
    opened: true,
  });
  expect(opened).toEqual([line.url]);
  expect(String(line.url)).not.toContain(a.hosts().user.token);

  expect(await a.run({ kind: "open", noBrowser: true })).toBe(0);
  expect(a.lines()[0]).toMatchObject({ opened: false });
  expect(opened).toHaveLength(1);
});

test("easel open with no browser to open says to open the link; a link of a revoked token is refused with exit 2", async () => {
  const srv = await boot();
  const a = await easel(srv, { peer: "198.51.100.1", json: false });
  expect(await a.run(login("ann", { setup: srv.setupCode() }))).toBe(0);
  a.out.splice(0);

  expect(await a.run({ kind: "open", noBrowser: false })).toBe(0);
  expect(a.out.join("")).toMatch(
    /^open it in a browser\. It signs in one browser as you, one time, until .+:\nhttps:\/\/easel\.test\/open#[0-9a-f]{64}\n$/,
  );

  const stranger = await easel(srv, { token: "not-a-token", json: false });
  expect(await stranger.run({ kind: "open", noBrowser: true })).toBe(2);
});

test("easel users lists each browser session; easel users end ends it (0), then answers gone (1)", async () => {
  const srv = await boot();
  const a = await ann(srv);
  expect(await a.run({ kind: "open", noBrowser: true })).toBe(0);
  const url = String(a.lines()[0]?.url);
  const link = url.slice(url.indexOf("#") + 1);
  const body = new URLSearchParams({ link }).toString();
  const posted = new Request(`${origin}/auth/open`, {
    method: "POST",
    headers: {
      origin,
      "content-length": String(body.length),
      "user-agent": "Firefox/133.0 (X11; Linux)",
    },
    body,
  });
  const session = srv.server.createSession({ tags: [transport.request(posted)] });
  const reply = await session.run(signInWithLink);
  await session.close();
  expect(reply instanceof Response && reply.headers.get("set-cookie")).toMatch(
    new RegExp(`^${sessionCookie}=`),
  );

  expect(await a.run(users({ kind: "ls" }))).toBe(0);
  const [listed] = a.lines();
  expect(listed.sessions).toEqual([
    expect.objectContaining({ name: "ann", browser: "Firefox on Linux" }),
  ]);
  const id = String(listed.sessions[0].id);

  const text = await easel(srv, { token: a.hosts().user.token, path: a.path, json: false });
  expect(await text.run(users({ kind: "ls" }))).toBe(0);
  expect(text.out.join("")).toContain(
    `browser sessions (end one with \`easel users end <session>\`):\n  ${id}\tann\tFirefox on Linux\t`,
  );

  expect(await a.run(users({ kind: "end", session: id }))).toBe(0);
  expect(await a.run(users({ kind: "end", session: id }))).toBe(1);
  expect(a.lines()).toEqual([{ kind: "ended" }, { kind: "gone" }]);
});
