import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation, transport } from "@tinkered/core";
import type { Observe, Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import {
  browserOf,
  browserOps,
  linkLife,
  openOps,
  signInWithCode,
  signInWithLink,
  signOut,
} from "@/access/browser.server";
import { sessionCookie } from "@/access/contract";
import {
  byToken,
  cookieSecret,
  idleLife,
  owner,
  socketDigest,
  user,
  usedStep,
} from "@/access/guards.server";
import { codeLife, loginOps, waitMax } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

const minute = 60_000;

const publicOrigin = "https://easel.test";

const loopOrigin = "http://127.0.0.1:4318";

const phone =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

async function boot(options: { file?: string; mode?: "approve" | "open" } = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
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
        origin: options.mode === "open" ? loopOrigin : publicOrigin,
        stdout: { write: (chunk: string) => out.push(chunk) },
        trusted: [],
        durable: false,
      }),
      access.login({ implement: loginOps }),
      access.browser({ implement: browserOps }),
      access.open({ implement: openOps, onStart: [user, byToken] }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user, owner] }),
      memory.server({
        services: [access.login, access.browser, access.open, access.user, access.owner],
      }),
    ],
  });
  const server = await scope.ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  const origin = options.mode === "open" ? loopOrigin : publicOrigin;

  return { server, clock, out, spans, logs, setupCode, origin };
}

type Srv = Awaited<ReturnType<typeof boot>>;

function token() {
  const text = randomBytes(32).toString("base64url");

  return { text, digest: createHash("sha256").update(text).digest("hex") };
}

async function client(server: Scope.Handle, held: { token?: string; cookie?: string } = {}) {
  const meta = operation({
    label: "test.meta",
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
    ],
  }).ready;
  closers.push(() => scope.close());

  return {
    start: (name: string) => scope.run(access.browser["browser.start"], { input: { name } }),
    wait: (request: string) => scope.run(access.browser["browser.wait"], { input: { request } }),
    link: () => scope.run(access.open["browser.link"], { input: null }),
    peek: (link: string) => scope.run(access.browser["browser.peek"], { input: { link } }),
    login: (name: string) =>
      scope.run(access.login["login.start"], { input: { name, digest: token().digest } }),
    me: () => scope.run(access.user["users.me"], { input: null }),
    list: () => scope.run(access.owner["users.list"], { input: null }),
    approve: (code: string, asOwner?: boolean) =>
      scope.run(access.owner["users.approve"], { input: { code, owner: asOwner } }),
    deny: (code: string) => scope.run(access.owner["users.deny"], { input: { code } }),
    revoke: (name: string) => scope.run(access.owner["users.revoke"], { input: { name } }),
    end: (session: string) => scope.run(access.owner["users.end"], { input: { session } }),
  };
}

async function firstOwner(srv: Srv) {
  const t = token();
  const ann = await client(srv.server, { token: t.text });
  const anon = await createScope({
    capsules: [
      memory.client({ peer: srv.server, headers: { "x-easel-peer": "198.51.100.1" } }),
      access.login({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => anon.close());
  const made = await anon.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest: t.digest },
  });
  expect(made.kind).toBe("granted");

  return { ann, token: t.text };
}

async function cliMember(srv: Srv, ann: Awaited<ReturnType<typeof client>>, name = "bo") {
  const t = token();
  const anon = await createScope({
    capsules: [
      memory.client({ peer: srv.server, headers: { "x-easel-peer": "198.51.100.7" } }),
      access.login({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => anon.close());
  const started = await anon.run(access.login["login.start"], {
    input: { name, digest: t.digest },
  });
  if (started.kind !== "pending") throw new Error(`not pending: ${started.kind}`);
  await ann.approve(started.code);

  return client(srv.server, { token: t.text });
}

type Form = {
  path: string;
  fields: Record<string, string>;
  cookie?: string;
  from?: string | null;
  site?: string;
};

async function post(srv: Srv, op: typeof signInWithCode, form: Form) {
  const body = new URLSearchParams(form.fields).toString();
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    "content-length": String(body.length),
    "user-agent": phone,
  };
  if (form.from !== null) headers.origin = form.from ?? srv.origin;
  if (form.cookie) headers.cookie = form.cookie;
  if (form.site) headers["sec-fetch-site"] = form.site;

  const request = new Request(`${srv.origin}${form.path}`, { method: "POST", headers, body });
  const session = srv.server.createSession({ tags: [transport.request(request)] });
  try {
    const reply = await session.run(op);
    if (!(reply instanceof Response)) throw new Error("not a response");
    return reply;
  } finally {
    await session.close();
  }
}

const cookieOf = (reply: Response) =>
  new RegExp(`^${sessionCookie}=([0-9a-f]{64});`).exec(reply.headers.get("set-cookie") ?? "")?.[1];

const refused = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: unknown) =>
      access.user.fault.is(error) || access.owner.fault.is(error) || access.open.fault.is(error)
        ? error.payload
        : String(error),
  );

async function codeSignIn(srv: Srv, ann: Awaited<ReturnType<typeof client>>, name: string) {
  const browser = await client(srv.server);
  const shown = await browser.start(name);
  if (shown.kind !== "pending") throw new Error(`not pending: ${shown.kind}`);
  await ann.approve(shown.code);
  const reply = await post(srv, signInWithCode, {
    path: "/auth/code",
    fields: { request: shown.request },
  });
  const secret = cookieOf(reply);
  if (!secret) throw new Error("no cookie");

  return { secret, cookie: `${sessionCookie}=${secret}`, shown };
}

test("the phone shows a code; an owner approves it; the page uses it and gets a session cookie that is HttpOnly, Secure and SameSite=Lax", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const browser = await client(srv.server);

  const shown = await browser.start("ann");
  expect(shown).toMatchObject({
    kind: "pending",
    expiresAt: srv.clock.currentTimeMillis() + codeLife,
  });
  if (shown.kind !== "pending") return;
  expect(await ann.approve(shown.code)).toMatchObject({
    kind: "approved",
    user: { name: "ann", role: "owner" },
  });
  expect(await browser.wait(shown.request)).toEqual({ kind: "approved" });

  const reply = await post(srv, signInWithCode, {
    path: "/auth/code",
    fields: { request: shown.request },
  });
  expect(reply.status).toBe(303);
  expect(reply.headers.get("location")).toBe("/");
  const set = reply.headers.get("set-cookie") ?? "";
  expect(set).toMatch(new RegExp(`^${sessionCookie}=[0-9a-f]{64}; `));
  for (const flag of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) expect(set).toContain(flag);

  const signedIn = await client(srv.server, { cookie: `${sessionCookie}=${cookieOf(reply)}` });
  expect(await signedIn.me()).toEqual({ kind: "me", name: "ann", owner: true });
  expect(await browser.wait(shown.request)).toEqual({ kind: "expired" });
});

test("a used code signs in no second browser: the second post gets no cookie", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const first = await codeSignIn(srv, ann, "ann");

  const again = await post(srv, signInWithCode, {
    path: "/auth/code",
    fields: { request: first.shown.request },
  });
  expect(again.status).toBe(303);
  expect(again.headers.get("set-cookie")).toBeNull();
});

test("a code for a new name makes a member; with --owner, an owner; an owner's session may do owner calls", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);

  const cy = await codeSignIn(srv, ann, "cy");
  const cyBrowser = await client(srv.server, { cookie: cy.cookie });
  expect(await cyBrowser.me()).toEqual({ kind: "me", name: "cy", owner: false });
  expect(await refused(cyBrowser.list())).toEqual({ owner: true });

  const browser = await client(srv.server);
  const shown = await browser.start("dee");
  if (shown.kind !== "pending") throw new Error("not pending");
  expect(await ann.approve(shown.code, true)).toMatchObject({
    user: { name: "dee", role: "owner" },
  });
  const reply = await post(srv, signInWithCode, {
    path: "/auth/code",
    fields: { request: shown.request },
  });
  const dee = await client(srv.server, { cookie: `${sessionCookie}=${cookieOf(reply)}` });
  expect((await dee.list()).users.map((u) => u.name).toSorted()).toEqual(["ann", "cy", "dee"]);
});

test("deny: the page is told denied; a code that ran out is expired; a post of either gets no cookie", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const browser = await client(srv.server);
  const denied = await browser.start("eve");
  const late = await browser.start("fay");
  if (denied.kind !== "pending" || late.kind !== "pending") throw new Error("not pending");

  expect(await ann.deny(denied.code)).toEqual({ kind: "denied" });
  expect(await browser.wait(denied.request)).toEqual({ kind: "denied" });
  expect(await ann.deny(denied.code)).toEqual({ kind: "gone" });
  expect(await ann.approve(denied.code)).toEqual({ kind: "gone" });

  srv.clock.advance(codeLife + 1);
  expect(await browser.wait(late.request)).toEqual({ kind: "expired" });
  expect(await browser.wait("0".repeat(32))).toEqual({ kind: "expired" });
  for (const request of [denied.request, late.request, "not a request"]) {
    const reply = await post(srv, signInWithCode, { path: "/auth/code", fields: { request } });
    expect(reply.headers.get("set-cookie")).toBeNull();
  }
});

test("browser.wait waits up to 50 s, and answers approved at once when an owner approves", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const browser = await client(srv.server);
  const shown = await browser.start("ann");
  if (shown.kind !== "pending") throw new Error("not pending");

  const idle = browser.wait(shown.request);
  await tick();
  srv.clock.advance(waitMax);
  expect(await idle).toEqual({ kind: "pending" });

  const waiting = browser.wait(shown.request);
  await tick();
  await ann.approve(shown.code);
  expect(await waiting).toEqual({ kind: "approved" });
});

test("browser.start and browser.wait count against the limits of login.start and login.wait: then slow", async () => {
  const srv = await boot();
  const browser = await client(srv.server);
  const answers = [];
  for (let n = 0; n < 4; n++) answers.push((await browser.start(`p${n}`)).kind);
  expect(answers).toEqual(["pending", "pending", "pending", "slow"]);

  srv.clock.advance(minute + 1);
  for (let n = 0; n < 3; n++) await browser.start(`q${n}`);
  srv.clock.advance(codeLife + 1);
  for (let n = 0; n < 5; n++) await browser.start(`r${n}`);
  expect((await browser.start("s")).kind).toBe("slow");

  for (let n = 0; n < 30; n++) await browser.wait("0".repeat(32));
  expect((await browser.wait("0".repeat(32))).kind).toBe("slow");
});

test("easel open: the CLI gets a link for 5 minutes; the browser that posts it gets a session as the CLI's user; a second use is refused", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const bo = await cliMember(srv, ann);

  const made = await bo.link();
  expect(made).toMatchObject({ kind: "link", expiresAt: srv.clock.currentTimeMillis() + linkLife });
  expect(made.link).toMatch(/^[0-9a-f]{64}$/);

  const reply = await post(srv, signInWithLink, {
    path: "/auth/open",
    fields: { link: made.link },
  });
  expect(reply.status).toBe(303);
  expect(reply.headers.get("location")).toBe("/");
  const laptop = await client(srv.server, { cookie: `${sessionCookie}=${cookieOf(reply)}` });
  expect(await laptop.me()).toEqual({ kind: "me", name: "bo", owner: false });

  const copy = await post(srv, signInWithLink, { path: "/auth/open", fields: { link: made.link } });
  expect(copy.headers.get("location")).toBe("/open");
  expect(copy.headers.get("set-cookie")).toBeNull();
});

test("a link that ran out, or of a user that was revoked, signs in no browser", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const bo = await cliMember(srv, ann);
  const late = await bo.link();
  srv.clock.advance(linkLife + 1);
  const lateReply = await post(srv, signInWithLink, {
    path: "/auth/open",
    fields: { link: late.link },
  });
  expect(lateReply.headers.get("set-cookie")).toBeNull();

  const kept = await bo.link();
  await ann.revoke("bo");
  const revokedReply = await post(srv, signInWithLink, {
    path: "/auth/open",
    fields: { link: kept.link },
  });
  expect(revokedReply.headers.get("set-cookie")).toBeNull();
  const wrong = await post(srv, signInWithLink, { path: "/auth/open", fields: { link: "nope" } });
  expect(wrong.headers.get("location")).toBe("/open");
});

test("browser.peek names the user of a live link and does not use it; a used link, a link that ran out, and a link of no user answer gone", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const bo = await cliMember(srv, ann);
  const page = await client(srv.server);
  const made = await bo.link();

  expect(await page.peek(made.link)).toEqual({
    kind: "live",
    name: "bo",
    expiresAt: made.expiresAt,
  });
  expect(await page.peek(made.link)).toMatchObject({ kind: "live" });
  const reply = await post(srv, signInWithLink, {
    path: "/auth/open",
    fields: { link: made.link },
  });
  expect(cookieOf(reply)).toMatch(/^[0-9a-f]{64}$/);
  expect(await page.peek(made.link)).toEqual({ kind: "gone" });

  const late = await bo.link();
  srv.clock.advance(linkLife + 1);
  expect(await page.peek(late.link)).toEqual({ kind: "gone" });
  const kept = await bo.link();
  await ann.revoke("bo");
  expect(await page.peek(kept.link)).toEqual({ kind: "gone" });
  expect(await page.peek("c".repeat(64))).toEqual({ kind: "gone" });
});

test("browser.peek has its own limit: past 30 tries in a minute, slow", async () => {
  const srv = await boot();
  const page = await client(srv.server);
  for (let n = 0; n < 30; n++) await page.peek("c".repeat(64));

  expect(await page.peek("c".repeat(64))).toMatchObject({ kind: "slow" });
});

test("an owner cannot approve a browser code that asks for another user that is there: theirs, and the code still waits; the owner may approve a code with the owner's own name", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  await cliMember(srv, ann);
  const page = await client(srv.server);
  const shown = await page.start("bo");
  if (shown.kind !== "pending") throw new Error(`not pending: ${shown.kind}`);

  expect(await ann.approve(shown.code)).toEqual({ kind: "theirs", name: "bo" });
  expect((await ann.list()).requests).toEqual([
    expect.objectContaining({ code: shown.code, browser: true }),
  ]);
  const reply = await post(srv, signInWithCode, {
    path: "/auth/code",
    fields: { request: shown.request },
  });
  expect(reply.headers.get("set-cookie")).toBeNull();

  const own = await codeSignIn(srv, ann, "ann");
  const signedIn = await client(srv.server, { cookie: own.cookie });
  expect(await signedIn.me()).toEqual({ kind: "me", name: "ann", owner: true });
});

test("browser codes and CLI logins wait in their own pools: 3 browser codes from one address do not block a login.start from it", async () => {
  const srv = await boot();
  const page = await client(srv.server);
  const answers = [];
  for (let n = 0; n < 4; n++) answers.push((await page.start(`p${n}`)).kind);
  expect(answers).toEqual(["pending", "pending", "pending", "slow"]);

  expect(await page.login("cli")).toMatchObject({ kind: "pending" });
});

test("a browser session cannot make a sign-in link: browser.link refuses it { token: true }", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const phoneSession = await codeSignIn(srv, ann, "ann");
  const browser = await client(srv.server, { cookie: phoneSession.cookie });

  expect(await refused(browser.link())).toEqual({ token: true });
});

test("a revoke ends each session of the user: its next call is refused { signIn: true }; an approved code that no browser used is denied", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const bo = await cliMember(srv, ann);
  const made = await bo.link();
  const reply = await post(srv, signInWithLink, {
    path: "/auth/open",
    fields: { link: made.link },
  });
  const laptop = await client(srv.server, { cookie: `${sessionCookie}=${cookieOf(reply)}` });
  expect((await laptop.me()).name).toBe("bo");

  const browser = await client(srv.server);
  const shown = await browser.start("bo");
  if (shown.kind !== "pending") throw new Error("not pending");
  await ann.approve(shown.code);

  expect(await ann.revoke("bo")).toEqual({ kind: "revoked" });
  expect(await refused(laptop.me())).toEqual({ signIn: true });
  expect(await browser.wait(shown.request)).toEqual({ kind: "denied" });
  expect((await ann.list()).sessions.filter((s) => s.name === "bo")).toEqual([]);
});

test("a code approved for a name whose user was removed after the approve answers denied", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  await cliMember(srv, ann, "gus");
  const browser = await client(srv.server);
  const shown = await browser.start("gus");
  if (shown.kind !== "pending") throw new Error("not pending");
  await ann.approve(shown.code);
  await ann.revoke("gus");

  expect(await browser.wait(shown.request)).toEqual({ kind: "denied" });
});

test("sign out: the session ends, the cookie is cleared, and the next call is refused", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const phoneSession = await codeSignIn(srv, ann, "ann");

  const out = await post(srv, signOut, {
    path: "/auth/out",
    fields: {},
    cookie: phoneSession.cookie,
  });
  expect(out.status).toBe(303);
  expect(out.headers.get("set-cookie")).toMatch(
    new RegExp(`^${sessionCookie}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`),
  );
  const browser = await client(srv.server, { cookie: phoneSession.cookie });
  expect(await refused(browser.me())).toEqual({ signIn: true });

  const again = await post(srv, signOut, { path: "/auth/out", fields: {} });
  expect(again.status).toBe(303);
});

test("a post that the browser marks cross-site, or from another origin, or with no mark and no origin, is refused 403; a body past 4 KiB is refused 413", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const phoneSession = await codeSignIn(srv, ann, "ann");
  const forged = [
    { from: "https://evil.test" },
    { from: "null" },
    { from: null },
    { from: srv.origin, site: "cross-site" },
    { from: srv.origin, site: "same-site" },
    { from: srv.origin, site: "none" },
  ];

  for (const sent of forged) {
    const out = { path: "/auth/out", fields: {}, cookie: phoneSession.cookie, ...sent };
    expect([sent, (await post(srv, signOut, out)).status]).toEqual([sent, 403]);
  }
  const big = await post(srv, signInWithLink, {
    path: "/auth/open",
    fields: { link: "a".repeat(5000) },
  });
  expect(big.status).toBe(413);
  const browser = await client(srv.server, { cookie: phoneSession.cookie });
  expect((await browser.me()).name).toBe("ann");
});

test("a page with no-referrer sends Origin null: its post is taken when the browser marks it same-origin (Sec-Fetch-Site)", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const phoneSession = await codeSignIn(srv, ann, "ann");

  const out = await post(srv, signOut, {
    path: "/auth/out",
    fields: {},
    cookie: phoneSession.cookie,
    from: "null",
    site: "same-origin",
  });
  expect([out.status, out.headers.get("location")]).toEqual([303, "/"]);
  const browser = await client(srv.server, { cookie: phoneSession.cookie });
  expect(await refused(browser.me())).toEqual({ signIn: true });
});

test("users.list shows each session (its browser, when it was last used) and the browser codes; users.end ends one, then answers gone", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const phoneSession = await codeSignIn(srv, ann, "ann");
  const browser = await client(srv.server);
  const waiting = await browser.start("hal");
  if (waiting.kind !== "pending") throw new Error("not pending");

  const listed = await ann.list();
  expect(listed.requests).toEqual([
    {
      code: waiting.code,
      name: "hal",
      since: srv.clock.currentTimeMillis(),
      expiresAt: waiting.expiresAt,
      browser: true,
    },
  ]);
  expect(listed.sessions).toEqual([
    {
      id: expect.stringMatching(/^[0-9a-f]{12}$/),
      name: "ann",
      browser: "Chrome on Android",
      since: srv.clock.currentTimeMillis(),
      used: srv.clock.currentTimeMillis(),
    },
  ]);
  expect(JSON.stringify(listed)).not.toContain(phoneSession.secret);

  const id = listed.sessions[0]?.id ?? "";
  expect(await ann.end(id)).toEqual({ kind: "ended" });
  expect(await ann.end(id)).toEqual({ kind: "gone" });
  const ended = await client(srv.server, { cookie: phoneSession.cookie });
  expect(await refused(ended.me())).toEqual({ signIn: true });
});

test("a session ends after 30 days with no use; a use moves its last use, at most once an hour", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const phoneSession = await codeSignIn(srv, ann, "ann");
  const browser = await client(srv.server, { cookie: phoneSession.cookie });
  const since = srv.clock.currentTimeMillis();

  srv.clock.advance(usedStep - 1);
  await browser.me();
  expect((await ann.list()).sessions[0]?.used).toBe(since);
  srv.clock.advance(1);
  await browser.me();
  expect((await ann.list()).sessions[0]?.used).toBe(since + usedStep);

  srv.clock.advance(idleLife + 1);
  expect(await refused(browser.me())).toEqual({ signIn: true });
  expect((await ann.list()).sessions).toEqual([]);
});

test("sessions survive a restart; the database keeps only the digest of a session and of a link", async () => {
  const folder = mkdtempSync(join(tmpdir(), "easel-browser-"));
  const file = join(folder, "easel.db");
  const first = await boot({ file });
  const { ann, token: annToken } = await firstOwner(first);
  const phoneSession = await codeSignIn(first, ann, "ann");
  const link = await ann.link();
  for (const close of closers.splice(0).reverse()) await close();
  closers.push(() => rmSync(folder, { recursive: true, force: true }));

  const bytes = readFileSync(file).toString("latin1");
  expect(bytes).not.toContain(phoneSession.secret);
  expect(bytes).not.toContain(link.link);

  const second = await boot({ file });
  const browser = await client(second.server, { cookie: phoneSession.cookie });
  expect((await browser.me()).name).toBe("ann");
  const again = await client(second.server, { token: annToken });
  expect((await again.list()).sessions).toHaveLength(1);
}, 30_000);

test("open: browser.start approves at once, and makes the name an owner when no user has it", async () => {
  const srv = await boot({ mode: "open" });
  const browser = await client(srv.server);
  const shown = await browser.start("solo");
  if (shown.kind !== "pending") throw new Error("not pending");

  expect(await browser.wait(shown.request)).toEqual({ kind: "approved" });
  const reply = await post(srv, signInWithCode, {
    path: "/auth/code",
    fields: { request: shown.request },
  });
  const signedIn = await client(srv.server, { cookie: `${sessionCookie}=${cookieOf(reply)}` });
  expect(await signedIn.me()).toEqual({ kind: "me", name: "solo", owner: true });

  const second = await browser.start("solo");
  if (second.kind !== "pending") throw new Error("not pending");
  const again = await post(srv, signInWithCode, {
    path: "/auth/code",
    fields: { request: second.request },
  });
  expect(cookieOf(again)).toMatch(/^[0-9a-f]{64}$/);
});

test("the cookie reads only one easel session; a second one with the same name, or a bad value, reads none", async () => {
  const srv = await boot();
  const read = (header: string | null) => srv.server.run(cookieSecret, { input: header });

  const secret = "a".repeat(64);

  expect(read(`theme=dark; ${sessionCookie}=${secret}`)).toBe(secret);
  expect(read(`${sessionCookie}=${secret}; ${sessionCookie}=${"b".repeat(64)}`)).toBeNull();
  expect(read(`${sessionCookie}=short`)).toBeNull();
  expect(read(null)).toBeNull();
});

test("a socket is named by the digest of its upgrade request's session cookie, so an ended session finds it; a socket with no cookie has none", async () => {
  const srv = await boot();
  const secret = "c".repeat(64);
  const upgrade = (cookie: string) =>
    new Request("https://easel.test/rpc", { headers: { cookie } });
  const read = (data: unknown) => srv.server.run(socketDigest, { input: data });

  expect(read({ req: upgrade(`${sessionCookie}=${secret}`) })).toBe(
    createHash("sha256").update(secret).digest("hex"),
  );
  expect(read({ req: upgrade("theme=dark") })).toBeNull();
  expect(read(undefined)).toBeNull();
});

test("the browser of a session is named from its user agent", async () => {
  const srv = await boot();
  const name = (agent: string | null) => srv.server.run(browserOf, { input: agent });

  expect(name(phone)).toBe("Chrome on Android");
  expect(name("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1")).toBe(
    "Safari on iPhone",
  );
  expect(name("Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0")).toBe(
    "Firefox on Linux",
  );
  expect(name("curl/8")).toBe("a browser");
  expect(name("Windows")).toBe("Windows");
});

test("no session secret, link or code request reaches an answer of another call, a span, or a log record", async () => {
  const srv = await boot();
  const { ann } = await firstOwner(srv);
  const phoneSession = await codeSignIn(srv, ann, "ann");
  const link = await ann.link();
  await post(srv, signInWithLink, { path: "/auth/open", fields: { link: link.link } });
  const browser = await client(srv.server, { cookie: phoneSession.cookie });
  await browser.me();
  await post(srv, signOut, { path: "/auth/out", fields: {}, cookie: phoneSession.cookie });
  await refused(browser.me());

  const seen = JSON.stringify([srv.spans, srv.logs, srv.out, await ann.list()]);
  for (const secret of [phoneSession.secret, link.link, phoneSession.shown.request]) {
    expect(seen).not.toContain(secret);
  }
});
