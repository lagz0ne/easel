import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { browserOps, openOps, signInWithCode, signInWithLink } from "@/access/browser.server";
import { sessionCookie } from "@/access/contract";
import { accessEnv } from "@/access/env.server";
import { byToken, owner, user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, renameOps, userOps } from "@/access/users.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const publicOrigin = "https://easel.test";

type Mode = "approve" | "open" | "single";

async function boot(options: { mode?: Mode; file?: string; durable?: boolean } = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const scope = createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: options.file ?? ":memory:" }),
      accessServer({
        mode: options.mode ?? "single",
        origin: publicOrigin,
        stdout: { write: (chunk: string) => out.push(chunk) },
        trusted: [],
        durable: options.durable ?? false,
      }),
      access.login({ implement: loginOps }),
      access.browser({ implement: browserOps }),
      access.open({ implement: openOps, onStart: [user, byToken] }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user, owner] }),
      access.rename({ implement: renameOps, onStart: [user, owner] }),
      memory.server({
        services: [
          access.login,
          access.browser,
          access.open,
          access.user,
          access.owner,
          access.rename,
        ],
      }),
    ],
  });
  const server = await scope.ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, out, setupCode };
}

type Srv = Awaited<ReturnType<typeof boot>>;

function token() {
  const text = randomBytes(32).toString("base64url");

  return { text, digest: createHash("sha256").update(text).digest("hex") };
}

async function client(server: Scope.Handle, held: { token?: string; cookie?: string } = {}) {
  const meta = operation({
    label: "test.singleMeta",
    run: async (): Promise<Record<string, string>> =>
      held.token ? { authorization: `Bearer ${held.token}` } : {},
  });
  const headers: Record<string, string> = { "x-easel-peer": "203.0.113.9" };
  if (held.cookie) headers.cookie = held.cookie;
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: server, headers, meta }),
      access.login({ remote: memory.client }),
      access.browser({ remote: memory.client }),
      access.open({ remote: memory.client }),
      access.user({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      access.rename({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return {
    start: (name?: string) =>
      scope.run(access.browser["browser.start"], { input: name === undefined ? {} : { name } }),
    wait: (request: string) => scope.run(access.browser["browser.wait"], { input: { request } }),
    link: () => scope.run(access.open["browser.link"], { input: null }),
    login: (name: string, digest = token().digest) =>
      scope.run(access.login["login.start"], { input: { name, digest } }),
    setup: (name: string, code: string, digest: string) =>
      scope.run(access.login["login.setup"], { input: { name, code, digest } }),
    me: () => scope.run(access.user["users.me"], { input: null }),
    list: () => scope.run(access.owner["users.list"], { input: null }),
    add: (name: string, asOwner?: boolean) =>
      scope.run(access.owner["users.add"], {
        input: { name, digest: token().digest, owner: asOwner },
      }),
    addWith: (name: string, digest: string) =>
      scope.run(access.owner["users.add"], { input: { name, digest } }),
    approve: (code: string, asOwner?: boolean) =>
      scope.run(access.owner["users.approve"], { input: { code, owner: asOwner } }),
    revoke: (name: string) => scope.run(access.owner["users.revoke"], { input: { name } }),
    rename: (name: string, to: string) =>
      scope.run(access.rename["users.rename"], { input: { name, to } }),
  };
}

type Client = Awaited<ReturnType<typeof client>>;

async function theOwner(srv: Srv, name = "rocky") {
  const t = token();
  const anon = await client(srv.server);
  expect(await anon.setup(name, srv.setupCode(), t.digest)).toMatchObject({ kind: "granted" });

  return { cli: await client(srv.server, { token: t.text }), token: t.text };
}

async function post(
  srv: Srv,
  op: typeof signInWithCode,
  path: string,
  fields: Record<string, string>,
) {
  const body = new URLSearchParams(fields).toString();
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
    "content-length": String(body.length),
    "sec-fetch-site": "same-origin",
  };
  const request = new Request(`${publicOrigin}${path}`, { method: "POST", headers, body });
  const session = srv.server.createSession({ tags: [transport.request(request)] });
  try {
    const reply = await session.run(op);
    if (!(reply instanceof Response)) throw new Error("not a response");
    return reply;
  } finally {
    await session.close();
  }
}

const cookieOf = (reply: Response) => {
  const secret = new RegExp(`^${sessionCookie}=([0-9a-f]{64});`).exec(
    reply.headers.get("set-cookie") ?? "",
  )?.[1];

  return secret ? `${sessionCookie}=${secret}` : null;
};

async function codeWithNoName(srv: Srv, person: Client) {
  const browser = await client(srv.server);
  const shown = await browser.start();
  if (shown.kind !== "pending") throw new Error(`not pending: ${shown.kind}`);
  const approved = await person.approve(shown.code);
  const reply = await post(srv, signInWithCode, "/auth/code", { request: shown.request });

  return { browser, shown, approved, cookie: cookieOf(reply) };
}

const refused = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: unknown) =>
      access.user.fault.is(error) || access.rename.fault.is(error) ? error.payload : String(error),
  );

test("EASEL_AUTH=single is a mode of its own: the env reads it, and any other word is refused", () => {
  expect(accessEnv.parse({ EASEL_AUTH: "single" }).mode).toBe("single");
  expect(accessEnv.safeParse({ EASEL_AUTH: "solo" }).success).toBe(false);
});

test("single: a server with no user prints a setup code, and the setup makes the person, an owner", async () => {
  const srv = await boot();
  expect(srv.setupCode()).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);

  const { cli } = await theOwner(srv);
  expect(await cli.me()).toEqual({ kind: "me", name: "rocky", owner: true });
});

test("single on a public origin starts; in production it needs EASEL_DB, as approve does", async () => {
  await boot({ mode: "single" });

  await expect(boot({ mode: "single", durable: true })).rejects.toThrow();
});

test("criterion 1: the sign-in page asks for a code with no name; the approve of the person signs the browser in as the person", async () => {
  const srv = await boot();
  const { cli } = await theOwner(srv);

  const signed = await codeWithNoName(srv, cli);
  expect(signed.approved).toMatchObject({
    kind: "approved",
    user: { name: "rocky", role: "owner" },
  });
  if (!signed.cookie) throw new Error("no cookie");
  const phone = await client(srv.server, { cookie: signed.cookie });
  expect(await phone.me()).toEqual({ kind: "me", name: "rocky", owner: true });
});

test("single: a name that the page sends is not used; the code is for the person who approves it", async () => {
  const srv = await boot();
  const { cli } = await theOwner(srv);
  const browser = await client(srv.server);

  const shown = await browser.start("bob");
  if (shown.kind !== "pending") throw new Error("not pending");
  expect(await cli.approve(shown.code)).toMatchObject({ user: { name: "rocky" } });
  expect((await cli.list()).users.map((u) => u.name)).toEqual(["rocky"]);
});

test("approve: a sign-in page that sends no name is told that it needs one", async () => {
  const srv = await boot({ mode: "approve" });
  await theOwner(srv);
  const browser = await client(srv.server);

  expect(await browser.start()).toEqual({ kind: "name" });
});

test("criterion 3: in single, each login is refused the same way, with a new name or with the name of a user, so no name shows", async () => {
  const srv = await boot();
  const { cli } = await theOwner(srv);
  const anon = await client(srv.server);

  expect(await anon.login("bob")).toEqual({ kind: "single" });
  expect(await anon.login("rocky")).toEqual({ kind: "single" });
  expect((await cli.list()).requests).toEqual([]);
});

test("single: users approve --owner is refused, and the code still waits", async () => {
  const srv = await boot();
  const { cli } = await theOwner(srv);
  const browser = await client(srv.server);
  const shown = await browser.start();
  if (shown.kind !== "pending") throw new Error("not pending");

  expect(await cli.approve(shown.code, true)).toEqual({ kind: "single" });
  expect((await cli.list()).requests.map((r) => r.code)).toEqual([shown.code]);
});

test("single: a login code or a named browser code from an approve server makes no user after the move to single", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-single-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "easel.db");
  const before = await boot({ mode: "approve", file });
  const { token: kept } = await theOwner(before);
  const anon = await client(before.server);
  const login = await anon.login("bob");
  const named = await anon.start("cy");
  if (login.kind !== "pending" || named.kind !== "pending") throw new Error("not pending");
  await before.server.close();

  const after = await boot({ mode: "single", file });
  const cli = await client(after.server, { token: kept });
  expect(await cli.approve(login.code)).toEqual({ kind: "single" });
  expect(await cli.approve(named.code)).toEqual({ kind: "single" });
  expect((await cli.list()).users.map((u) => u.name)).toEqual(["rocky"]);
});

test("criterion 4: in single, users add makes an agent member whose token works; users add --owner is refused", async () => {
  const srv = await boot();
  const { cli } = await theOwner(srv);
  const agent = token();

  expect(await cli.addWith("vibea-claude", agent.digest)).toMatchObject({
    kind: "added",
    user: { name: "vibea-claude", role: "member" },
  });
  const tools = await client(srv.server, { token: agent.text });
  expect(await tools.me()).toEqual({ kind: "me", name: "vibea-claude", owner: false });
  expect(await cli.add("ann", true)).toEqual({ kind: "single" });
  expect((await cli.list()).users.map((u) => u.role).toSorted()).toEqual(["member", "owner"]);
});

test("single: the person cannot revoke the person, and an agent's browser of easel open ends at its revoke", async () => {
  const srv = await boot();
  const { cli } = await theOwner(srv);
  const agent = token();
  await cli.addWith("vibea-claude", agent.digest);
  const made = await (await client(srv.server, { token: agent.text })).link();
  const reply = await post(srv, signInWithLink, "/auth/open", { link: made.link });
  const cookie = cookieOf(reply);
  if (!cookie) throw new Error("no cookie");
  const laptop = await client(srv.server, { cookie });
  expect(await laptop.me()).toMatchObject({ name: "vibea-claude", owner: false });

  expect(await cli.revoke("rocky")).toEqual({ kind: "last" });
  expect(await cli.revoke("vibea-claude")).toEqual({ kind: "revoked" });
  expect(await refused(laptop.me())).toEqual({ signIn: true });
});

test("users rename: the token, the browser sessions, a live link and an approved code keep working, under the new name", async () => {
  const srv = await boot();
  const { cli, token: kept } = await theOwner(srv);
  const signed = await codeWithNoName(srv, cli);
  if (!signed.cookie) throw new Error("no cookie");
  const made = await cli.link();
  const browser = await client(srv.server);
  const waiting = await browser.start();
  if (waiting.kind !== "pending") throw new Error("not pending");
  await cli.approve(waiting.code);

  expect(await cli.rename("rocky", "lagz0ne")).toMatchObject({
    kind: "renamed",
    user: { name: "lagz0ne", role: "owner" },
  });

  expect(await (await client(srv.server, { token: kept })).me()).toEqual({
    kind: "me",
    name: "lagz0ne",
    owner: true,
  });
  expect(await (await client(srv.server, { cookie: signed.cookie })).me()).toMatchObject({
    name: "lagz0ne",
  });
  const opened = cookieOf(await post(srv, signInWithLink, "/auth/open", { link: made.link }));
  if (!opened) throw new Error("the link made before the rename signs in no browser");
  expect(await (await client(srv.server, { cookie: opened })).me()).toMatchObject({
    name: "lagz0ne",
  });
  const used = cookieOf(
    await post(srv, signInWithCode, "/auth/code", { request: waiting.request }),
  );
  if (!used) throw new Error("the code approved before the rename signs in no browser");
  const list = await cli.list();
  expect(list.users.map((u) => u.name)).toEqual(["lagz0ne"]);
  expect(new Set(list.sessions.map((s) => s.name))).toEqual(new Set(["lagz0ne"]));
});

test("users rename keeps the rename after a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-rename-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "easel.db");
  const before = await boot({ mode: "approve", file });
  const { cli, token: kept } = await theOwner(before);
  await cli.rename("rocky", "lagz0ne");
  await before.server.close();

  const after = await boot({ mode: "single", file });
  expect(await (await client(after.server, { token: kept })).me()).toMatchObject({
    name: "lagz0ne",
    owner: true,
  });
});

test("users rename answers taken for a name of a user or of a code that waits, and gone for no user", async () => {
  const srv = await boot({ mode: "approve" });
  const { cli } = await theOwner(srv);
  await cli.add("vibea-claude");
  const anon = await client(srv.server);
  await anon.login("bob");
  await anon.start("cy");

  expect(await cli.rename("rocky", "vibea-claude")).toEqual({ kind: "taken" });
  expect(await cli.rename("rocky", "bob")).toEqual({ kind: "taken" });
  expect(await cli.rename("rocky", "cy")).toEqual({ kind: "taken" });
  expect(await cli.rename("nobody", "dee")).toEqual({ kind: "gone" });
  expect((await cli.list()).users.map((u) => u.name).toSorted()).toEqual(["rocky", "vibea-claude"]);
});

test("users rename is an owner call: a member is refused", async () => {
  const srv = await boot();
  const { cli } = await theOwner(srv);
  const agent = token();
  await cli.addWith("vibea-claude", agent.digest);
  const tools = await client(srv.server, { token: agent.text });

  expect(await refused(tools.rename("vibea-claude", "boss"))).toEqual({ owner: true });
});

test("a single server with more than one owner, as after a move from approve, says so in its log at start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-owners-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "easel.db");
  const before = await boot({ mode: "approve", file });
  const { cli } = await theOwner(before);
  await cli.add("ann", true);
  await before.server.close();

  const after = await boot({ mode: "single", file });
  expect(after.out.join("")).toContain("access: a single server has 2 owners: ann, rocky");
});

test("a rename drops a session that a free name kept by mistake, so that old row signs in as no one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-kept-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "easel.db");
  const before = await boot({ file });
  const { token: kept } = await theOwner(before);
  await before.server.close();
  const secret = randomBytes(32).toString("hex");
  const digest = createHash("sha256").update(secret).digest("hex");
  const db = new Database(file);
  db.query(
    "INSERT INTO access_sessions (id, digest, name, browser, since, used) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("0123456789ab", digest, "lagz0ne", "a browser", 1_800_000_000_000, 1_800_000_000_000);
  db.close();

  const after = await boot({ file });
  await (await client(after.server, { token: kept })).rename("rocky", "lagz0ne");

  const old = await client(after.server, { cookie: `${sessionCookie}=${secret}` });
  expect(await refused(old.me())).toEqual({ signIn: true });
});
