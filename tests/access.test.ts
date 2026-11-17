import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Observe, Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { accessEnv } from "@/access/env.server";
import { owner, user } from "@/access/guards.server";
import { codeLife, limits, loginOps, maxPending, waitMax } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";

// access over the memory transport, against the access-login chart (docs/statecharts) and
// SPEC-access's rules. The server runs on a test clock; each client is one CLI at one address.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/** Lets a call cross the memory transport and reach its `await`. */
const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

const minute = 60_000;

type Boot = {
  file?: string;
  mode?: "approve" | "open";
  origin?: string | null;
  trusted?: readonly string[];
  durable?: boolean;
  clock?: ReturnType<typeof makeTestClock>;
};

/** One server: SQLite, access, and a memory transport. Its log lines and spans are kept. */
async function boot(options: Boot = {}) {
  const clock = options.clock ?? makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const spans: Observe.Span[] = [];
  const logs: Observe.Log[] = [];
  const scope = createScope({
    clock,
    observe: { export: (span) => void spans.push(span), log: (line) => void logs.push(line) },
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: options.file ?? ":memory:" }),
      accessServer({
        mode: options.mode ?? "approve",
        origin: options.origin ?? null,
        stdout: { write: (chunk: string) => out.push(chunk) },
        trusted: options.trusted ?? [],
        durable: options.durable ?? false,
      }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user, owner] }),
      memory.server({ services: [access.login, access.user, access.owner] }),
    ],
  });
  const server = await scope.ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, out, spans, logs, setupCode };
}

/** A token as the CLI makes it, and the digest it sends. */
function token() {
  const text = randomBytes(32).toString("base64url");

  return { text, digest: createHash("sha256").update(text).digest("hex") };
}

type Client = { token?: string; peer?: string; forwarded?: string };

/** One CLI: its address (the door's peer header), and its token once it has one. */
async function cli(server: Scope.Handle, options: Client = {}) {
  const held = { token: options.token };
  const meta = operation({
    label: "test.meta",
    run: async (): Promise<Record<string, string>> =>
      held.token ? { authorization: `Bearer ${held.token}` } : {},
  });
  const headers: Record<string, string> = { "x-easel-peer": options.peer ?? "203.0.113.1" };
  if (options.forwarded) headers["x-forwarded-for"] = options.forwarded;
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: server, headers, meta }),
      access.login({ remote: memory.client }),
      access.user({ remote: memory.client }),
      access.owner({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return {
    held,
    /** Ends this CLI's scope: before its server closes, so its close does not wait on a peer. */
    close: () => scope.close(),
    start: (name: string, digest: string) =>
      scope.run(access.login["login.start"], { input: { name, digest } }),
    setup: (name: string, code: string, digest: string) =>
      scope.run(access.login["login.setup"], { input: { name, code, digest } }),
    wait: (request: string) => scope.run(access.login["login.wait"], { input: { request } }),
    me: () => scope.run(access.user["users.me"], { input: null }),
    end: () => scope.run(access.user["login.end"], { input: null }),
    list: () => scope.run(access.owner["users.list"], { input: null }),
    approve: (code: string, asOwner?: boolean) =>
      scope.run(access.owner["users.approve"], { input: { code, owner: asOwner } }),
    deny: (code: string) => scope.run(access.owner["users.deny"], { input: { code } }),
    revoke: (name: string) => scope.run(access.owner["users.revoke"], { input: { name } }),
  };
}

/** The fault a call ended in, and its payload; null when it answered. */
const faultOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: unknown) =>
      access.user.fault.is(error) || access.owner.fault.is(error) || access.login.fault.is(error)
        ? { fault: error.fault, payload: error.payload }
        : { fault: "other", payload: String(error) },
  );

const signIn = { fault: "refused", payload: { signIn: true } };

/** Ann becomes the first owner with the setup code; her CLI then holds her token. */
async function firstOwner(srv: Awaited<ReturnType<typeof boot>>, name = "ann") {
  const ann = await cli(srv.server, { peer: "198.51.100.1" });
  const t = token();
  expect(await ann.setup(name, srv.setupCode(), t.digest)).toEqual({
    kind: "granted",
    user: { name, role: "owner", since: srv.clock.currentTimeMillis() },
  });
  ann.held.token = t.text;

  return ann;
}

/** The agent starts a login from its own address: its code and request. */
async function startAgent(server: Scope.Handle, name = "agent", peer = "203.0.113.7") {
  const agent = await cli(server, { peer });
  const t = token();
  const answer = await agent.start(name, t.digest);
  if (answer.kind !== "pending") throw new Error(`not pending: ${answer.kind}`);

  return {
    agent,
    token: t,
    code: answer.code,
    request: answer.request,
    expiresAt: answer.expiresAt,
  };
}

// ---- The first owner (chart region Owners: s0 -> s2; judged rule 4)

test("the setup code makes the first owner once; then it answers taken", async () => {
  const srv = await boot();
  expect(srv.setupCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  const ann = await firstOwner(srv);

  expect(await ann.me()).toEqual({ kind: "me", name: "ann", owner: true });
  const bob = await cli(srv.server, { peer: "198.51.100.2" });
  expect(await bob.setup("bob", srv.setupCode(), token().digest)).toEqual({ kind: "taken" });
  expect(await bob.setup("bob", "bbbb cccc", token().digest)).toEqual({ kind: "taken" });
});

test("a wrong setup code answers wrong; case, spaces and the hyphen do not matter", async () => {
  const srv = await boot();
  const ann = await cli(srv.server);
  const typed = srv.setupCode().toLowerCase().replace("-", " ");

  expect(
    await ann.setup(
      "ann",
      srv.setupCode() === "BBBB-BBBB" ? "CCCC-CCCC" : "BBBB-BBBB",
      token().digest,
    ),
  ).toEqual({
    kind: "wrong",
  });
  expect((await ann.setup("Ann", typed, token().digest)).kind).toBe("granted");
});

test("a setup name that a waiting code carries answers taken (judged rule 7)", async () => {
  const srv = await boot();
  await startAgent(srv.server, "ann");
  const ann = await cli(srv.server, { peer: "198.51.100.1" });

  expect(await ann.setup("ann", srv.setupCode(), token().digest)).toEqual({ kind: "taken" });
  expect((await ann.setup("anne", srv.setupCode(), token().digest)).kind).toBe("granted");
});

// Three starts on a file: each open and close syncs it to disk, seconds under load (30 s budget).
test("the server restarts: users and logins stay, the old setup code answers wrong, and a request is forgotten a day after its code ends (expired)", async () => {
  const folder = mkdtempSync(join(tmpdir(), "easel-access-"));
  closers.push(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, "easel.db");
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const first = await boot({ file, clock });
  const old = first.setupCode();
  await first.server.close();

  const second = await boot({ file, clock });
  const ann = await cli(second.server);
  expect(second.setupCode()).not.toBe(old);
  expect(await ann.setup("ann", old, token().digest)).toEqual({ kind: "wrong" });
  const t = token();
  expect((await ann.setup("ann", second.setupCode(), t.digest)).kind).toBe("granted");
  ann.held.token = t.text;
  const { agent, request, code } = await startAgent(second.server);
  const denied = await startAgent(second.server, "eve");
  expect(await ann.deny(denied.code)).toEqual({ kind: "denied" });
  for (const client of [ann, agent, denied.agent]) await client.close();
  await second.server.close();

  // A day and more later: the codes that ended are no longer kept; the user and its token are.
  clock.advance(25 * 60 * minute);
  const third = await boot({ file, clock });
  const again = await cli(third.server, { token: t.text });
  expect(third.out.join("")).not.toContain("setup code");
  expect(await again.me()).toEqual({ kind: "me", name: "ann", owner: true });
  expect(await again.wait(denied.request)).toEqual({ kind: "expired" });
  expect(await again.wait(request)).toEqual({ kind: "expired" });
  expect(await again.approve(code)).toEqual({ kind: "gone" });
}, 30_000);

test("a row that does not parse is skipped at start; the log says how many, not what", async () => {
  const folder = mkdtempSync(join(tmpdir(), "easel-access-"));
  closers.push(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, "easel.db");
  await (await boot({ file })).server.close();
  const db = new Database(file);
  db.run("INSERT INTO access_users VALUES ('mallory', 'owner', 1, 'secret-not-a-digest')");
  db.close();

  const srv = await boot({ file });
  const log = srv.out.join("");
  expect(log).toContain("skipped 1 rows");
  expect(log).not.toContain("secret-not-a-digest");
  // The bad row is no user: the server still waits for its first owner.
  expect((await firstOwner(srv)).held.token).toBeTruthy();
}, 30_000);

/** A file-backed server for restart tests: a fresh folder, removed after the test. */
function dbFile() {
  const folder = mkdtempSync(join(tmpdir(), "easel-access-"));
  closers.push(() => rmSync(folder, { recursive: true, force: true }));

  return join(folder, "easel.db");
}

test("the server restarts after a revoke and a logout: both tokens are refused, both names are free", async () => {
  const file = dbFile();
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const first = await boot({ file, clock });
  const ann = await firstOwner(first);
  const signed = [];
  for (const name of ["bob", "cat"]) {
    const {
      agent,
      token: t,
      code,
      request,
    } = await startAgent(first.server, name, `203.0.113.${name.length + signed.length}`);
    await ann.approve(code);
    await agent.wait(request);
    agent.held.token = t.text;
    signed.push({ agent, token: t.text });
  }
  const [bob, cat] = signed;
  if (!bob || !cat) throw new Error("two agents");
  expect(await ann.revoke("bob")).toEqual({ kind: "revoked" });
  expect(await cat.agent.end()).toEqual({ kind: "ended" });
  for (const client of [ann, bob.agent, cat.agent]) await client.close();
  await first.server.close();

  const second = await boot({ file, clock });
  for (const old of [bob, cat]) {
    expect(await faultOf((await cli(second.server, { token: old.token })).me())).toEqual(signIn);
  }
  expect((await startAgent(second.server, "bob", "203.0.113.20")).code).toHaveLength(9);
  expect((await startAgent(second.server, "cat", "203.0.113.21")).code).toHaveLength(9);
}, 30_000);

test("the server restarts inside a code's life: denied stays denied, approved still answers granted, a second approve answers gone", async () => {
  const file = dbFile();
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const first = await boot({ file, clock });
  const ann = await firstOwner(first);
  const no = await startAgent(first.server, "eve");
  const yes = await startAgent(first.server, "bob", "203.0.113.8");
  expect(await ann.deny(no.code)).toEqual({ kind: "denied" });
  expect(await ann.approve(yes.code)).toMatchObject({ kind: "approved" });
  for (const client of [ann, no.agent, yes.agent]) await client.close();
  await first.server.close();

  clock.advance(minute);
  const second = await boot({ file, clock });
  const agent = await cli(second.server);
  const owner = await cli(second.server, { token: ann.held.token });
  expect(await agent.wait(no.request)).toEqual({ kind: "denied" });
  expect(await agent.wait(yes.request)).toMatchObject({ kind: "granted", user: { name: "bob" } });
  expect(await owner.approve(yes.code)).toEqual({ kind: "gone" });
  agent.held.token = yes.token.text;
  expect(await agent.me()).toEqual({ kind: "me", name: "bob", owner: false });
}, 30_000);

test("an approve server in production with no EASEL_DB does not start, and says why", async () => {
  const out: string[] = [];
  const failed = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({
        mode: "approve",
        durable: true,
        stdout: { write: (chunk: string) => out.push(chunk) },
      }),
    ],
  }).ready.then(
    () => "started",
    (error: unknown) => String(error),
  );

  expect(failed).toContain("MissingConfig");
  expect(out.join("")).toContain("needs EASEL_DB");
  // With a file, or in open mode on loopback, it starts; dev keeps memory with a warning.
  expect((await boot({ file: dbFile(), durable: true })).setupCode()).toHaveLength(9);
  const open = await boot({ mode: "open", origin: "http://localhost:4318", durable: true });
  expect(open.out.join("")).toContain("no EASEL_DB");
  expect((await boot()).out.join("")).toContain("no EASEL_DB");
}, 30_000);

// ---- An agent joins (chart region The agent)

test("approve: the agent waits, is told granted, and its token works (s6 -> s11 -> s12)", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, token: t, code, request, expiresAt } = await startAgent(srv.server);
  expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  expect(expiresAt).toBe(srv.clock.currentTimeMillis() + codeLife);
  const waiting = agent.wait(request);
  await tick();

  expect(await ann.approve(code.toLowerCase())).toEqual({
    kind: "approved",
    user: { name: "agent", role: "member", since: srv.clock.currentTimeMillis() },
  });
  expect(await waiting).toMatchObject({ kind: "granted", user: { name: "agent", role: "member" } });
  agent.held.token = t.text;
  expect(await agent.me()).toEqual({ kind: "me", name: "agent", owner: false });
  expect(await ann.approve(code)).toEqual({ kind: "gone" });
});

test("approve as owner: the agent is an owner, and may do owner calls (s2 -> s3)", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, token: t, code, request } = await startAgent(srv.server);

  expect(await ann.approve(code, true)).toMatchObject({
    kind: "approved",
    user: { role: "owner" },
  });
  expect(await agent.wait(request)).toMatchObject({ kind: "granted", user: { role: "owner" } });
  agent.held.token = t.text;
  expect((await agent.list()).users.map((u) => u.name)).toEqual(["ann", "agent"]);
});

test("a member is refused every owner call with { owner: true }", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, token: t, code } = await startAgent(srv.server);
  await ann.approve(code);
  agent.held.token = t.text;
  const owner = { fault: "refused", payload: { owner: true } };

  expect(await faultOf(agent.list())).toEqual(owner);
  expect(await faultOf(agent.approve(code))).toEqual(owner);
  expect(await faultOf(agent.deny(code))).toEqual(owner);
  expect(await faultOf(agent.revoke("ann"))).toEqual(owner);
});

test("deny: the agent is told denied, and stays so (s6 -> s10 -> s5)", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, code, request } = await startAgent(srv.server);
  const waiting = agent.wait(request);
  await tick();

  expect(await ann.deny(code)).toEqual({ kind: "denied" });
  expect(await waiting).toEqual({ kind: "denied" });
  expect(await agent.wait(request)).toEqual({ kind: "denied" });
  expect(await ann.deny(code)).toEqual({ kind: "gone" });
  expect(await ann.approve(code)).toEqual({ kind: "gone" });
});

test("a code runs out after 10 minutes, while waiting or not (s6 -> s9 -> s5)", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const first = await startAgent(srv.server);
  srv.clock.advance(codeLife - 30_000);
  const waiting = first.agent.wait(first.request);
  await tick();
  srv.clock.advance(30_000);

  expect(await waiting).toEqual({ kind: "expired" });
  const second = await startAgent(srv.server, "agent2", "203.0.113.8");
  srv.clock.advance(codeLife);
  expect(await second.agent.wait(second.request)).toEqual({ kind: "expired" });
  expect(await ann.approve(second.code)).toEqual({ kind: "gone" });
  expect(await ann.deny(second.code)).toEqual({ kind: "gone" });
  expect(await second.agent.wait("0".repeat(32))).toEqual({ kind: "expired" });
});

test("the agent stops waiting after 50 s; the agent resumes (login --resume) onto an approved code: granted", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, code, request } = await startAgent(srv.server);
  const waiting = agent.wait(request);
  await tick();
  srv.clock.advance(waitMax);

  expect(await waiting).toEqual({ kind: "pending" });
  // It stopped waiting (`--no-wait`); later it resumes with the request (`--resume`).
  expect(await ann.approve(code)).toMatchObject({ kind: "approved" });
  expect((await agent.wait(request)).kind).toBe("granted");
});

test("the agent stops waiting; the agent resumes (login --resume) onto a code still pending, and waits on", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, code, request } = await startAgent(srv.server);
  const waiting = agent.wait(request);
  await tick();
  srv.clock.advance(waitMax);
  expect(await waiting).toEqual({ kind: "pending" });

  const resumed = agent.wait(request);
  await tick();
  srv.clock.advance(waitMax - 1000);
  await tick();
  await ann.approve(code);
  expect((await resumed).kind).toBe("granted");
});

test("a lost granted answer: the next wait answers granted again (s11 -> s13 -> s12)", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, token: t, code, request } = await startAgent(srv.server);
  await ann.approve(code);

  expect((await agent.wait(request)).kind).toBe("granted");
  expect((await agent.wait(request)).kind).toBe("granted");
  agent.held.token = t.text;
  expect((await agent.me()).name).toBe("agent");
});

// ---- Revoke (judged rules 8-9)

test("a revoke before the agent heard granted: it is told denied, never granted (s11 -> s10)", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, token: t, code, request } = await startAgent(srv.server);
  await ann.approve(code);

  expect(await ann.revoke("agent")).toEqual({ kind: "revoked" });
  expect(await agent.wait(request)).toEqual({ kind: "denied" });
  agent.held.token = t.text;
  expect(await faultOf(agent.me())).toEqual(signIn);
});

test("the server answers granted, but the answer is lost; then an owner revokes the agent: it is told denied", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, token: t, code, request } = await startAgent(srv.server);
  await ann.approve(code);
  // This granted answer never reaches the CLI: it does not keep the token.
  expect((await agent.wait(request)).kind).toBe("granted");

  expect(await ann.revoke("agent")).toEqual({ kind: "revoked" });
  expect(await agent.wait(request)).toEqual({ kind: "denied" });
  agent.held.token = t.text;
  expect(await faultOf(agent.me())).toEqual(signIn);
});

test("a revoke of a signed-in agent refuses its next call (s12 -> s14 -> s5)", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, token: t, code, request } = await startAgent(srv.server);
  await ann.approve(code, true);
  await agent.wait(request);
  agent.held.token = t.text;
  expect((await agent.list()).users).toHaveLength(2);

  expect(await ann.revoke("agent")).toEqual({ kind: "revoked" });
  expect(await faultOf(agent.list())).toEqual(signIn);
  expect(await faultOf(agent.me())).toEqual(signIn);
  expect(await agent.wait(request)).toEqual({ kind: "denied" });
  expect(await ann.revoke("agent")).toEqual({ kind: "gone" });
  // The name is free again: a new login for it waits.
  expect((await startAgent(srv.server, "agent", "203.0.113.9")).code).toHaveLength(9);
});

test("a revoke leaves a code that ran out expired, and denies the one it approved", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const old = await startAgent(srv.server);
  srv.clock.advance(codeLife);
  const { agent, code, request } = await startAgent(srv.server, "agent", "203.0.113.8");
  await ann.approve(code);

  expect(await ann.revoke("agent")).toEqual({ kind: "revoked" });
  expect(await old.agent.wait(old.request)).toEqual({ kind: "expired" });
  expect(await agent.wait(request)).toEqual({ kind: "denied" });
});

test("a code a revoke denied stays denied when the same name and digest are approved again", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const first = await startAgent(srv.server);
  await ann.approve(first.code);
  expect(await ann.revoke("agent")).toEqual({ kind: "revoked" });

  const next = await first.agent.start("agent", first.token.digest);
  if (next.kind !== "pending") throw new Error(`not pending: ${next.kind}`);
  await ann.approve(next.code);
  expect((await first.agent.wait(next.request)).kind).toBe("granted");
  expect(await first.agent.wait(first.request)).toEqual({ kind: "denied" });
});

test("Owners: the agent, an owner, logs out, and Ann is the only owner again", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, token: t, code, request } = await startAgent(srv.server);
  await ann.approve(code, true);
  await agent.wait(request);
  agent.held.token = t.text;
  expect((await ann.list()).users.map((u) => [u.name, u.role])).toEqual([
    ["ann", "owner"],
    ["agent", "owner"],
  ]);

  expect(await agent.end()).toEqual({ kind: "ended" });
  expect(await faultOf(agent.me())).toEqual(signIn);
  expect((await ann.list()).users.map((u) => [u.name, u.role])).toEqual([["ann", "owner"]]);
  expect(await ann.end()).toEqual({ kind: "last" });
});

test("the last owner answers last; an owner may revoke themselves while another remains (s3 -> s4)", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  expect(await ann.revoke("ann")).toEqual({ kind: "last" });
  const { agent, token: t, code } = await startAgent(srv.server);
  await ann.approve(code, true);
  agent.held.token = t.text;

  expect(await ann.revoke("ann")).toEqual({ kind: "revoked" });
  expect(await faultOf(ann.me())).toEqual(signIn);
  expect(await agent.revoke("agent")).toEqual({ kind: "last" });
  expect((await agent.list()).users.map((u) => [u.name, u.role])).toEqual([["agent", "owner"]]);
});

// ---- Sign out, and calls with no token

test("whoami, then logout: the token is refused after it, and the name logs in again", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, token: t, code, request } = await startAgent(srv.server);
  await ann.approve(code);
  agent.held.token = t.text;

  expect(await agent.me()).toEqual({ kind: "me", name: "agent", owner: false });
  expect(await agent.end()).toEqual({ kind: "ended" });
  expect(await faultOf(agent.me())).toEqual(signIn);
  expect(await faultOf(agent.end())).toEqual(signIn);
  expect(await agent.wait(request)).toEqual({ kind: "denied" });
  expect((await ann.list()).users.map((u) => u.name)).toEqual(["ann"]);
  // The same name logs in again, with a new token.
  const again = token();
  const next = await agent.start("agent", again.digest);
  if (next.kind !== "pending") throw new Error(`not pending: ${next.kind}`);
  await ann.approve(next.code);
  expect((await agent.wait(next.request)).kind).toBe("granted");
  agent.held.token = again.text;
  expect(await agent.me()).toEqual({ kind: "me", name: "agent", owner: false });
});

test("the last owner's logout answers last, and its token still works", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);

  expect(await ann.end()).toEqual({ kind: "last" });
  expect(await ann.me()).toEqual({ kind: "me", name: "ann", owner: true });
  const { agent, token: t, code } = await startAgent(srv.server);
  await ann.approve(code, true);
  agent.held.token = t.text;
  expect(await ann.end()).toEqual({ kind: "ended" });
  expect(await faultOf(ann.me())).toEqual(signIn);
  expect(await agent.end()).toEqual({ kind: "last" });
});

test("no token, or one no user has, is refused { signIn: true } on user and owner calls", async () => {
  const srv = await boot();
  await firstOwner(srv);
  const guest = await cli(srv.server);

  expect(await faultOf(guest.me())).toEqual(signIn);
  expect(await faultOf(guest.list())).toEqual(signIn);
  guest.held.token = token().text;
  expect(await faultOf(guest.me())).toEqual(signIn);
  expect(await faultOf(guest.revoke("ann"))).toEqual(signIn);
});

test("users.list shows users and the waiting codes, oldest first, and no digest", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const one = await startAgent(srv.server, "one", "203.0.113.11");
  srv.clock.advance(1000);
  const two = await startAgent(srv.server, "two", "203.0.113.12");
  await ann.deny(two.code);
  srv.clock.advance(1000);
  const three = await startAgent(srv.server, "three", "203.0.113.13");
  const list = await ann.list();

  expect(list.requests.map((r) => [r.name, r.code])).toEqual([
    ["one", one.code],
    ["three", three.code],
  ]);
  expect(list.users).toEqual([{ name: "ann", role: "owner", since: 1_800_000_000_000 }]);
  expect(JSON.stringify(list)).not.toMatch(/digest|[0-9a-f]{64}/);
});

// ---- Names (judged rule 7)

test("a name in use answers taken: a user has it, or a waiting code carries it", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { code } = await startAgent(srv.server, "agent");
  const other = await cli(srv.server, { peer: "203.0.113.20" });

  expect(await other.start("agent", token().digest)).toEqual({ kind: "taken" });
  expect(await other.start("ANN", token().digest)).toEqual({ kind: "taken" });
  await ann.deny(code);
  expect((await other.start("agent", token().digest)).kind).toBe("pending");
});

test("a digest in use answers taken", async () => {
  const srv = await boot();
  await firstOwner(srv);
  const { token: t } = await startAgent(srv.server, "agent");
  const other = await cli(srv.server, { peer: "203.0.113.20" });

  expect(await other.start("other", t.digest)).toEqual({ kind: "taken" });
});

// ---- Rate limits (judged rules 10-11)

test("5 login.start a minute from one address; each counts whatever it answers; then slow", async () => {
  const srv = await boot();
  await firstOwner(srv);
  const bot = await cli(srv.server, { peer: "203.0.113.30" });
  for (let i = 0; i < limits["login.start"]; i++) {
    expect((await bot.start("ann", token().digest)).kind).toBe("taken");
  }

  expect(await bot.start("bot", token().digest)).toEqual({ kind: "slow", retryIn: minute });
  srv.clock.advance(minute);
  expect((await bot.start("bot", token().digest)).kind).toBe("pending");
});

test("5 login.setup a minute: past it, even the right setup code answers slow", async () => {
  const srv = await boot();
  const bot = await cli(srv.server);
  for (let i = 0; i < limits["login.setup"]; i++) {
    srv.clock.advance(1000);
    expect((await bot.setup("bot", "BBBB-BBBB", token().digest)).kind).not.toBe("slow");
  }

  expect(await bot.setup("ann", srv.setupCode(), token().digest)).toEqual({
    kind: "slow",
    retryIn: 56_000,
  });
  const elsewhere = await cli(srv.server, { peer: "198.51.100.40" });
  expect((await elsewhere.setup("ann", srv.setupCode(), token().digest)).kind).toBe("granted");
});

test("30 login.wait a minute from one address, then slow", async () => {
  const srv = await boot();
  const bot = await cli(srv.server);
  for (let i = 0; i < limits["login.wait"]; i++) await bot.wait("0".repeat(32));

  expect(await bot.wait("0".repeat(32))).toEqual({ kind: "slow", retryIn: minute });
});

test("at most 3 codes wait from one address; past it login.start answers slow until one runs out", async () => {
  const srv = await boot();
  await firstOwner(srv);
  const bot = await cli(srv.server, { peer: "203.0.113.50" });
  for (let i = 0; i < maxPending.address; i++) {
    expect((await bot.start(`bot${i}`, token().digest)).kind).toBe("pending");
    srv.clock.advance(1000);
  }

  expect(await bot.start("bot9", token().digest)).toEqual({
    kind: "slow",
    retryIn: codeLife - 3000,
  });
  srv.clock.advance(codeLife - 3000);
  expect((await bot.start("bot9", token().digest)).kind).toBe("pending");
});

test("at most 20 codes wait at once, from any addresses", async () => {
  const srv = await boot();
  await firstOwner(srv);
  for (let i = 0; i < maxPending.all; i++) {
    await startAgent(srv.server, `bot${i}`, `203.0.113.${100 + Math.floor(i / 3)}`);
  }
  const late = await cli(srv.server, { peer: "203.0.113.200" });

  expect(await late.start("late", token().digest)).toEqual({ kind: "slow", retryIn: codeLife });
});

test("X-Forwarded-For counts only from a trusted proxy, and never an entry the client wrote", async () => {
  const srv = await boot({ trusted: ["10.0.0.0/8", "fd00::/8"] });
  const via = (forwarded: string, peer = "10.1.2.3") => cli(srv.server, { peer, forwarded });
  const one = await via("6.6.6.6, 192.0.2.1");
  for (let i = 0; i < limits["login.wait"]; i++) await one.wait("0".repeat(32));

  // The client wrote the first entry: a new one does not make a new address.
  expect((await (await via("7.7.7.7, 192.0.2.1")).wait("0".repeat(32))).kind).toBe("slow");
  expect((await (await via("192.0.2.2", "fd00::1")).wait("0".repeat(32))).kind).toBe("expired");
  // From a peer that is not trusted, the header is not read: all of it is one address.
  const outside = (forwarded: string) => cli(srv.server, { peer: "192.0.2.99", forwarded });
  for (let i = 0; i < limits["login.wait"]; i++) {
    await (await outside(`192.0.2.${i}`)).wait("0".repeat(32));
  }
  expect((await (await outside("192.0.2.250")).wait("0".repeat(32))).kind).toBe("slow");
});

test("X-Forwarded-For is read from the right past each trusted proxy (Cloudflare, then Traefik)", async () => {
  const edge = "173.245.48.0/20";
  const srv = await boot({ trusted: ["10.0.0.0/8", edge] });
  const via = (forwarded: string) => cli(srv.server, { peer: "10.1.2.3", forwarded });
  const one = await via("6.6.6.6, 192.0.2.1, 173.245.48.5");
  for (let i = 0; i < limits["login.wait"]; i++) await one.wait("0".repeat(32));

  // The client is the first entry from the right that is not a trusted proxy.
  expect((await (await via("192.0.2.1, 173.245.48.9")).wait("0".repeat(32))).kind).toBe("slow");
  expect((await (await via("7.7.7.7, 192.0.2.1")).wait("0".repeat(32))).kind).toBe("slow");
  expect((await (await via("192.0.2.2, 173.245.48.5")).wait("0".repeat(32))).kind).toBe("expired");
  // Every entry trusted: the leftmost is the client.
  const inside = await via("10.9.9.9, 173.245.48.5");
  for (let i = 0; i < limits["login.wait"]; i++) await inside.wait("0".repeat(32));
  expect((await (await via("10.9.9.9")).wait("0".repeat(32))).kind).toBe("slow");
});

test("an IPv6 address counts by its /64", async () => {
  const srv = await boot();
  const one = await cli(srv.server, { peer: "2001:db8:1:2::1" });
  for (let i = 0; i < limits["login.wait"]; i++) await one.wait("0".repeat(32));

  for (const peer of ["2001:db8:1:2:ffff::9", "2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd"]) {
    expect((await (await cli(srv.server, { peer })).wait("0".repeat(32))).kind).toBe("slow");
  }
  expect(
    (await (await cli(srv.server, { peer: "2001:db8:1:3::1" })).wait("0".repeat(32))).kind,
  ).toBe("expired");
});

test("the env: trusted proxies are loopback when unset, an entry that is not a CIDR stops the start; NODE_ENV=production asks for a file", () => {
  expect(accessEnv.parse({}).trusted).toEqual(["127.0.0.0/8", "::1"]);
  expect(accessEnv.parse({}).durable).toBe(false);
  expect(accessEnv.parse({ NODE_ENV: "production" }).durable).toBe(true);
  expect(
    accessEnv.parse({ EASEL_TRUSTED_PROXIES: " 10.0.0.0/8, fd00::/8,192.0.2.7 " }).trusted,
  ).toEqual(["10.0.0.0/8", "fd00::/8", "192.0.2.7"]);
  for (const bad of [
    "10.0.0.0/33",
    "fd00::/129",
    "10.0.0/8",
    "10.0.0.0/8/1",
    "10.0.0.0/x",
    "proxy",
  ]) {
    expect(accessEnv.safeParse({ EASEL_TRUSTED_PROXIES: bad }).success).toBe(false);
  }
});

// ---- open (judged rule 12)

test("open: each login is granted at once, as an owner; there is no setup code", async () => {
  const srv = await boot({ mode: "open", origin: "http://localhost:4318" });
  const solo = await cli(srv.server);
  const t = token();

  expect(srv.out.join("")).not.toContain("setup code");
  expect(await solo.start("solo", t.digest)).toMatchObject({
    kind: "granted",
    user: { role: "owner" },
  });
  expect(await solo.setup("other", "BBBB-BBBB", token().digest)).toEqual({ kind: "taken" });
  solo.held.token = t.text;
  expect(await solo.me()).toEqual({ kind: "me", name: "solo", owner: true });
});

test("open does not start unless the public origin is loopback", async () => {
  for (const origin of [null, "https://easel.example", "not a url"]) {
    const failed = await boot({ mode: "open", origin }).then(
      () => "started",
      (error: unknown) => String(error),
    );
    expect(failed).toContain("MissingConfig");
  }
  for (const origin of ["http://127.0.0.1:4318", "http://[::1]:4318"]) {
    expect((await boot({ mode: "open", origin })).out.join("")).not.toContain("setup code");
  }
});

// ---- Secrets (judged rule 13)

test("no token, digest, code or request reaches a span, a log record, or an invalid fault", async () => {
  const srv = await boot();
  const ann = await firstOwner(srv);
  const { agent, token: t, code, request } = await startAgent(srv.server);
  await ann.approve(code);
  await agent.wait(request);
  agent.held.token = t.text;
  await agent.me();
  await agent.end();
  // The client checks the input before it sends: its error names the field, not the value. The
  // server's own `invalid` fault is checked over the socket (access-door.test.ts).
  const bad = await Promise.try(() =>
    agent.setup("x", "BCDF-GHJ1", `${t.digest.slice(0, 63)}g`),
  ).then(
    () => null,
    (error: unknown) => error,
  );
  const secrets = [t.text, t.digest, code, code.replace("-", ""), request, srv.setupCode()];
  const seen = `${JSON.stringify([srv.spans, srv.logs, bad])} ${String(bad)}`;

  expect(String(bad)).toContain("DataValidationFailed");
  for (const secret of [...secrets, "BCDF-GHJ1", t.digest.slice(0, 63)]) {
    expect(seen).not.toContain(secret);
  }
  expect(srv.out.join("").split(srv.setupCode())).toHaveLength(2);
});
