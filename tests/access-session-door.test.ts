import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serve } from "@tinkered/bun";
import { ws } from "@tinkered/bun/client";
import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterAll, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { sessionCookie } from "@/access/contract";

type Server = typeof import("../cmds/server");

const server: Server = await import(new URL("../cmds/server.ts", import.meta.url).href);

const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });

const folder = mkdtempSync(join(tmpdir(), "easel-session-door-"));

afterAll(() => (collector.stop(), rmSync(folder, { recursive: true, force: true })));

async function run(file: string) {
  const stop = new AbortController();
  const out: string[] = [];
  const root = await server.default({
    env: {
      PORT: "0",
      PUBLIC_ORIGIN: "",
      EASEL_DB: file,
      OTEL_SERVICE_NAME: "access-session-door-test",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}traces`,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}logs`,
    },
    args: [],
    cwd: process.cwd(),
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: (code, reason) => stop.abort(reason ?? code),
  });
  if (!("resolve" in root)) throw new Error("the command did not start");
  const url = root.resolve(serve.url).get() ?? new URL("http://localhost:0");

  return { url, out, close: async () => (stop.abort(), await root.closed) };
}

function scopeAs(host: string, secret: string) {
  const headers = { cookie: `${sessionCookie}=${secret}` };

  return createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      ws.client({ url: `ws://${host}/rpc`, headers }),
      access.user({ remote: ws.client }),
      access.owner({ remote: ws.client }),
    ],
  }).ready;
}

function closeCodeOf(host: string, secret: string) {
  const opened = Promise.withResolvers<void>();
  const code = Promise.withResolvers<number>();
  const [hostname = "", port = ""] = host.split(":");
  const upgrade = request({
    hostname,
    port: Number(port),
    path: "/rpc",
    headers: {
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-version": "13",
      "sec-websocket-key": randomBytes(16).toString("base64"),
      cookie: `${sessionCookie}=${secret}`,
    },
  });
  upgrade.on("upgrade", (_, socket) => {
    opened.resolve();
    socket.on("data", (frame: Buffer) => {
      if (frame[0] === 0x88) code.resolve(frame.readUInt16BE(2));
    });
  });
  upgrade.end();

  return { opened: opened.promise, code: code.promise };
}

const refused = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: unknown) => (access.user.fault.is(error) ? error.payload : String(error)),
  );

const hex = (bytes: number) => randomBytes(bytes).toString("hex");

const digestOf = (secret: string) => createHash("sha256").update(secret).digest("hex");

function seed(file: string, now: number) {
  const db = new Database(file);
  const user = db.query("INSERT INTO access_users (name, role, since, digest) VALUES (?, ?, ?, ?)");
  const session = db.query(
    "INSERT INTO access_sessions (id, digest, name, browser, since, used) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const secrets = { ann: hex(32), bob: hex(32) };
  const ids = { ann: hex(6), bob: hex(6) };
  user.run("ann", "owner", now, digestOf(hex(32)));
  user.run("bob", "member", now, digestOf(hex(32)));
  session.run(ids.ann, digestOf(secrets.ann), "ann", "Firefox on Linux", now, now);
  session.run(ids.bob, digestOf(secrets.bob), "bob", "Chrome on Android", now, now);
  db.close();

  return { secrets, ids };
}

test("a socket with a session cookie reads as its user; users.end closes that socket at once (4401), and its cookie reads nothing after", async () => {
  const file = join(folder, "easel.db");
  await (await run(file)).close();
  const { secrets, ids } = seed(file, Date.now());
  const app = await run(file);
  const ann = await scopeAs(app.url.host, secrets.ann);
  const bob = await scopeAs(app.url.host, secrets.bob);
  const bobSocket = closeCodeOf(app.url.host, secrets.bob);
  await bobSocket.opened;

  expect(await bob.run(access.user["users.me"], { input: null })).toEqual({
    kind: "me",
    name: "bob",
    owner: false,
  });
  expect(await ann.run(access.owner["users.end"], { input: { session: ids.bob } })).toEqual({
    kind: "ended",
  });
  expect(await bobSocket.code).toBe(4401);
  const again = await scopeAs(app.url.host, secrets.bob);
  expect(await refused(again.run(access.user["users.me"], { input: null }))).toEqual({
    signIn: true,
  });
  expect(await ann.run(access.user["users.me"], { input: null })).toMatchObject({ name: "ann" });
  await again.close();
  await bob.close();
  await ann.close();
  await app.close();
}, 30_000);

async function easel(home: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, "cmds/easel.ts", ...args, "--json"], {
    env: { HOME: home, PATH: process.env.PATH ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  const lines = out.split("\n").filter(Boolean);

  return { code, json: lines.map((line) => JSON.parse(line)) };
}

const post = (origin: string, path: string, form: Record<string, string>, cookie = "") =>
  fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { origin, cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });

const secretOf = (reply: Response) =>
  new RegExp(`^${sessionCookie}=([0-9a-f]{64});`).exec(
    reply.headers.get("set-cookie") ?? "",
  )?.[1] ?? "";

const cookieFlags = new RegExp(
  `^${sessionCookie}=[0-9a-f]{64}; Path=/; Max-Age=\\d+; HttpOnly; Secure; SameSite=Lax$`,
);

async function ownerAnn() {
  const app = await run(":memory:");
  const origin = `http://localhost:${app.url.port}`;
  const ann = mkdtempSync(join(folder, "ann-"));
  const setup = /setup code: (\S+)/.exec(app.out.join(""))?.[1] ?? "";
  await easel(ann, "login", origin, "--name", "ann", "--setup", setup);

  return { app, origin, ann };
}

const me = (scope: Awaited<ReturnType<typeof scopeAs>>) =>
  scope.run(access.user["users.me"], { input: null });

test("over the real server and CLI: easel open prints a link that signs one browser in, with the cookie flags; a second post gets no cookie; sign-out ends the session", async () => {
  const { app, origin, ann } = await ownerAnn();

  const opened = await easel(ann, "open", "--no-browser");
  const url = String(opened.json[0]?.url);
  const link = url.split("#")[1] ?? "";
  expect(opened.json).toEqual([
    { kind: "link", url, expiresAt: expect.any(Number), opened: false },
  ]);
  expect(url).toBe(`${origin}/open#${link}`);

  const laptop = await post(origin, "/auth/open", { link });
  const again = await post(origin, "/auth/open", { link });
  expect([laptop.status, laptop.headers.get("location")]).toEqual([303, "/"]);
  expect(laptop.headers.get("set-cookie")).toMatch(cookieFlags);
  expect([again.headers.get("location"), again.headers.get("set-cookie")]).toEqual(["/open", null]);

  const asAnn = await scopeAs(app.url.host, secretOf(laptop));
  expect(await me(asAnn)).toEqual({ kind: "me", name: "ann", owner: true });

  const out = await post(origin, "/auth/out", {}, `${sessionCookie}=${secretOf(laptop)}`);
  expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0; HttpOnly; Secure; SameSite=Lax$/);
  const after = await scopeAs(app.url.host, secretOf(laptop));
  expect(await refused(me(after))).toEqual({ signIn: true });
  expect(app.out.join("")).not.toContain(link);
  expect(readFileSync(join(ann, ".config", "easel", "hosts.json"), "utf8")).not.toContain(link);

  for (const scope of [asAnn, after]) await scope.close();
  await app.close();
}, 30_000);

test("over the real server and CLI: a code that easel users approve approved signs a phone in; easel users lists its session; easel users end ends it (0), then answers gone (1)", async () => {
  const { app, origin, ann } = await ownerAnn();
  const page = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      ws.client({ url: `ws://${app.url.host}/rpc` }),
      access.browser({ remote: ws.client }),
    ],
  }).ready;

  const shown = await page.run(access.browser["browser.start"], { input: { name: "bob" } });
  if (shown.kind !== "pending") throw new Error(`not pending: ${shown.kind}`);
  expect((await easel(ann, "users", "approve", shown.code)).code).toBe(0);
  const phone = await post(origin, "/auth/code", { request: shown.request });
  expect(phone.headers.get("set-cookie")).toMatch(cookieFlags);
  const asBob = await scopeAs(app.url.host, secretOf(phone));
  expect(await me(asBob)).toEqual({ kind: "me", name: "bob", owner: false });

  const listed = await easel(ann, "users");
  const sessions: Array<{ id: string; name: string }> = listed.json[0]?.sessions ?? [];
  const id = sessions.find((row) => row.name === "bob")?.id ?? "";
  expect(sessions.map((row) => row.name)).toEqual(["bob"]);
  expect((await easel(ann, "users", "end", id)).code).toBe(0);
  expect((await easel(ann, "users", "end", id)).code).toBe(1);
  const after = await scopeAs(app.url.host, secretOf(phone));
  expect(await refused(me(after))).toEqual({ signIn: true });

  for (const scope of [page, asBob, after]) await scope.close();
  await app.close();
}, 30_000);
