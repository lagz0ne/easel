import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, transport } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { owner, user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { cli } from "@/cli";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { kit } from "@/kit";
import { kitOps } from "@/kit/ops.server";
import { portClient, portServer } from "@/kit/port-link";
import { runtimeNames } from "@/kit/runtime";
import type { BuiltRuntime } from "@/kit/runtime.server";
import { mcpHttp, mcpMeta } from "@/mcp/http.server";
import { ops } from "@/ops";
import { parts } from "@/parts";
import { queue } from "@/queue";
import { words } from "@/words";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

function fakeRuntime(): BuiltRuntime {
  const imports = Object.fromEntries(
    runtimeNames.map((name) => [name, `${name.replace(/^@/, "").replaceAll("/", "__")}.js`]),
  );
  const files = Object.fromEntries(Object.values(imports).map((file) => [file, "export {};"]));
  return { sha: createHash("sha256").update("fake").digest("hex"), imports, files };
}

const signInHeader = `Bearer realm="easel", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;

async function boot() {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const channel = new MessageChannel();
  const mcpScope = createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      portClient({ port: Promise.resolve(channel.port2), meta: mcpMeta }),
      access.user({ remote: portClient }),
      access.owner({ remote: portClient }),
      frames.api({ remote: portClient }),
      kit.api({ remote: portClient }),
      words.api({ remote: portClient }),
      parts.api({ remote: portClient }),
      queue.api({ remote: portClient }),
      ops.user({ remote: portClient }),
      ops.owner({ remote: portClient }),
    ],
  });
  const services = [access.login, access.user, access.owner, frames.api, kit.api];
  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout, runtime: fakeRuntime() }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user, owner] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      kit.api({ implement: kitOps, onStart: [user] }),
      memory.server({ services }),
      portServer({ services }),
      mcpHttp({
        origin,
        scope: mcpScope.ready,
      }),
    ],
  }).ready;
  const stop = new AbortController();
  const accepted = server.run(portServer.accept, {
    input: { port: channel.port1, stop: stop.signal },
  });
  closers.push(async () => {
    stop.abort();
    await accepted;
    await (await mcpScope.ready).close();
    await server.close();
  });
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  const door = (request: Request) => {
    const path = new URL(request.url).pathname;
    const tags = [transport.request(request)];
    if (path === "/.well-known/oauth-protected-resource") {
      return server.run(mcpHttp.resource, { tags });
    }
    if (path === "/.well-known/oauth-authorization-server") {
      return server.run(mcpHttp.issuer, { tags });
    }
    if (path === "/oauth/authorize") return server.run(mcpHttp.authorize, { tags });
    if (path === "/oauth/token") return server.run(mcpHttp.token, { tags });

    return server.run(mcpHttp.route, { tags });
  };
  const fetch = async (url: string | URL, init?: RequestInit) => door(new Request(url, init));

  return { server, clock, setupCode, fetch };
}

type Srv = Awaited<ReturnType<typeof boot>>;

async function easel(srv: Srv) {
  const dir = mkdtempSync(join(tmpdir(), "easel-mcp-http-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const out: string[] = [];
  const hosts = join(dir, "hosts.json");
  const scope = await createScope({
    clock: srv.clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: srv.server, meta: cli.bearer }),
      access.login({ remote: memory.client }),
      access.user({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => out.push(chunk) },
        json: true,
        server: origin,
        hosts,
      }),
    ],
  }).ready;
  closers.push(() => scope.close());
  const token = () => /"token":\s*"([^"]+)"/.exec(readFileSync(hosts, "utf8"))?.[1] ?? "";

  return { scope, out, token };
}

async function team(srv: Srv) {
  const ann = await easel(srv);
  const setup = { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false } as const;
  expect(await ann.scope.run(cli.run, { input: setup })).toBe(0);
  const bob = await easel(srv);
  expect(
    await bob.scope.run(cli.run, { input: { kind: "login", name: "bob", noWait: true } }),
  ).toBe(0);
  const code = /"code":\s*"([^"]+)"/.exec(bob.out.join(""))?.[1] ?? "";
  const approve = { kind: "users", act: { kind: "approve", code, owner: false } } as const;
  expect(await ann.scope.run(cli.run, { input: approve })).toBe(0);
  expect(await bob.scope.run(cli.run, { input: { kind: "resume" } })).toBe(0);

  return { ann: ann.token(), bob: bob.token(), owner: ann };
}

async function client(srv: Srv, token: string) {
  const link = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    fetch: srv.fetch,
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const mcp = new Client({ name: "test", version: "1" });
  await mcp.connect(link);
  closers.push(() => mcp.close());

  return mcp;
}

test("a client with a live token lists the tools over HTTP, and a call runs as its user", async () => {
  const srv = await boot();
  const { ann } = await team(srv);
  const mcp = await client(srv, ann);

  expect((await mcp.listTools()).tools).toHaveLength(45);
  const answer = await mcp.callTool({ name: "list_canvases", arguments: {} });
  expect(answer).toMatchObject({ isError: false, structuredContent: { canvases: [] } });
  const made = await mcp.callTool({ name: "create_canvas", arguments: { name: "Flow" } });
  expect(made).toMatchObject({
    isError: false,
    structuredContent: { kind: "created", key: "flow" },
  });
});

test("an owner tool is refused for a member over HTTP: the socket's guards run", async () => {
  const srv = await boot();
  const { ann, bob } = await team(srv);

  const refused = await (await client(srv, bob)).callTool({ name: "list_users", arguments: {} });
  expect(refused).toMatchObject({
    isError: true,
    content: [{ text: expect.stringMatching(/^refused \{"owner":true\}/) }],
  });
  const listed = await (await client(srv, ann)).callTool({ name: "list_users", arguments: {} });
  expect(listed).toMatchObject({ isError: false });
});

test("no token, a wrong token, a foreign origin and a GET each get their status", async () => {
  const srv = await boot();
  await team(srv);
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const post = (headers: Record<string, string>) =>
    srv.fetch(`${origin}/mcp`, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
    });

  const none = await post({});
  expect([none.status, none.headers.get("www-authenticate")]).toEqual([401, signInHeader]);
  const wrong = await post({ authorization: "Bearer not-a-token" });
  expect([wrong.status, wrong.headers.get("www-authenticate")]).toEqual([401, signInHeader]);
  const foreign = await post({ authorization: "Bearer x", origin: "https://evil.test" });
  expect(foreign.status).toBe(403);
  const get = await srv.fetch(`${origin}/mcp`, { method: "GET" });
  expect([get.status, get.headers.get("allow")]).toEqual([405, "POST"]);
});

const claude = {
  id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
  callback: "https://claude.ai/api/mcp/auth_callback",
};

function claudeApp() {
  const held: {
    tokens?: OAuthTokens;
    client?: OAuthClientInformationMixed;
    verifier: string;
    sent: URL | null;
  } = { verifier: "", sent: null };
  const provider: OAuthClientProvider = {
    redirectUrl: claude.callback,
    clientMetadataUrl: claude.id,
    clientMetadata: { redirect_uris: [claude.callback], client_name: "Claude" },
    state: () => "state-1",
    clientInformation: () => held.client,
    saveClientInformation: (client) => void (held.client = client),
    tokens: () => held.tokens,
    saveTokens: (tokens) => void (held.tokens = tokens),
    redirectToAuthorization: (url) => void (held.sent = url),
    saveCodeVerifier: (verifier) => void (held.verifier = verifier),
    codeVerifier: () => held.verifier,
  };

  return { provider, held };
}

test("Claude finds the sign-in from the 401, signs in with an easel token, and its calls run as that user", async () => {
  const srv = await boot();
  const { bob } = await team(srv);
  const app = claudeApp();
  const link = () =>
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      fetch: srv.fetch,
      authProvider: app.provider,
    });
  const first = link();
  await expect(new Client({ name: "claude", version: "1" }).connect(first)).rejects.toThrow(
    UnauthorizedError,
  );
  const sent = app.held.sent ?? new URL(origin);
  expect(sent.pathname).toBe("/oauth/authorize");

  const page = await srv.fetch(sent);
  expect(page.status).toBe(200);
  expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(await page.text()).toContain("claude.ai");

  const form = new URLSearchParams(sent.searchParams);
  form.set("token", bob);
  const back = await srv.fetch(`${origin}/oauth/authorize`, { method: "POST", body: form });
  expect(back.status).toBe(302);
  const to = new URL(back.headers.get("location") ?? origin);
  expect([
    `${to.origin}${to.pathname}`,
    to.searchParams.get("state"),
    to.searchParams.get("iss"),
  ]).toEqual([claude.callback, "state-1", origin]);

  await first.finishAuth(to.searchParams.get("code") ?? "");
  const mcp = new Client({ name: "claude", version: "1" });
  await mcp.connect(link());
  closers.push(() => mcp.close());
  const refused = await mcp.callTool({ name: "list_users", arguments: {} });
  expect(refused).toMatchObject({
    isError: true,
    content: [{ text: expect.stringMatching(/^refused \{"owner":true\}/) }],
  });
});

test("the sign-in refuses a wrong token, an unknown redirect, a wrong verifier and a used code", async () => {
  const srv = await boot();
  const { ann } = await team(srv);
  const verifier = "v".repeat(43);
  const challenge = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
  const ask = {
    response_type: "code",
    client_id: claude.id,
    redirect_uri: claude.callback,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "s",
  };
  const authorize = (fields: Record<string, string>) =>
    srv.fetch(`${origin}/oauth/authorize`, {
      method: "POST",
      body: new URLSearchParams(fields),
    });
  const exchange = (fields: Record<string, string>) =>
    srv.fetch(`${origin}/oauth/token`, { method: "POST", body: new URLSearchParams(fields) });

  const foreign = await srv.fetch(
    `${origin}/oauth/authorize?${new URLSearchParams({ ...ask, redirect_uri: "https://evil.test/cb" })}`,
  );
  expect([foreign.status, foreign.headers.get("location")]).toEqual([400, null]);
  const plain = await authorize({ ...ask, code_challenge_method: "plain", token: ann });
  expect([plain.status, plain.headers.get("location")]).toEqual([400, null]);
  const wrong = await authorize({ ...ask, token: "not-a-token" });
  expect([wrong.status, wrong.headers.get("location")]).toEqual([401, null]);
  expect(await wrong.text()).toContain("The token is wrong.");

  const grant = async () => {
    const back = await authorize({ ...ask, token: ann });
    const code = new URL(back.headers.get("location") ?? origin).searchParams.get("code") ?? "";

    return { grant_type: "authorization_code", code, redirect_uri: claude.callback };
  };
  const guessed = await grant();
  const bad = await exchange({ ...guessed, code_verifier: "w".repeat(43) });
  expect([bad.status, await bad.json()]).toEqual([400, { error: "invalid_grant" }]);
  const once = await exchange({ ...guessed, code_verifier: verifier });
  expect([once.status, await once.json()]).toEqual([400, { error: "invalid_grant" }]);
  const fresh = await grant();
  const good = await exchange({ ...fresh, code_verifier: verifier });
  expect([good.status, await good.json()]).toEqual([
    200,
    { access_token: ann, token_type: "Bearer" },
  ]);
  const again = await exchange({ ...fresh, code_verifier: verifier });
  expect([again.status, await again.json()]).toEqual([400, { error: "invalid_grant" }]);
  const refresh = await exchange({ grant_type: "refresh_token", refresh_token: "x" });
  expect([refresh.status, await refresh.json()]).toEqual([
    400,
    { error: "unsupported_grant_type" },
  ]);
});

test("an owner makes a user for Claude with `easel users add`; its token signs Claude in until a revoke", async () => {
  const srv = await boot();
  const { owner } = await team(srv);
  const add = { kind: "users", act: { kind: "add", name: "ann-claude", owner: false } } as const;

  expect(await owner.scope.run(cli.run, { input: add })).toBe(0);
  const given = /"token":\s*"([^"]+)"/.exec(owner.out.join(""))?.[1] ?? "";
  expect(owner.out.join("")).toContain('"kind":"added"');
  expect(await owner.scope.run(cli.run, { input: add })).toBe(1);
  expect(owner.out.join("")).toContain('"kind":"taken"');

  const mcp = await client(srv, given);
  expect(await mcp.callTool({ name: "list_canvases", arguments: {} })).toMatchObject({
    isError: false,
  });
  const revoke = { kind: "users", act: { kind: "revoke", name: "ann-claude" } } as const;
  expect(await owner.scope.run(cli.run, { input: revoke })).toBe(0);
  const after = await srv.fetch(`${origin}/mcp`, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    headers: {
      authorization: `Bearer ${given}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
  });
  expect(after.status).toBe(401);
});

const startPart = [
  'import { copy } from "@easel/kit";',
  'import { resource } from "@tinkered/core";',
  "",
  'const texts = ["trial.start"] as const;',
  "",
  "const text = resource({",
  '  label: "trial.text",',
  "  depends: { say: copy.say },",
  "  factory: ({ say }) => say(texts),",
  "});",
  "",
  "export function View() {",
  '  return <button className="bg-primary p-4">Start</button>;',
  "}",
  "",
].join("\n");

test("L3: agent A sets trial.start; agent B lists the texts over MCP and puts a ready frame with it; the put is created and B adds no text; with the ready frame of A, two agents use one text key (L1)", async () => {
  const srv = await boot();
  const tokens = await team(srv);
  const a = await client(srv, tokens.ann);
  const b = await client(srv, tokens.bob);
  const call = (mcp: Client, name: string, args: Record<string, unknown>) =>
    mcp.callTool({ name, arguments: args });

  const made = await call(a, "create_canvas", { name: "Flow" });
  expect(made).toMatchObject({ isError: false, structuredContent: { key: "flow" } });
  const set = await call(a, "set_texts", { texts: { "trial.start": { en: "Start the trial" } } });
  expect(set).toMatchObject({ isError: false, structuredContent: { kind: "updated", rev: 2 } });

  const listed = await call(b, "list_texts", {});
  expect(listed).toMatchObject({
    isError: false,
    structuredContent: { rev: 2, texts: { "trial.start": { en: "Start the trial" } } },
  });

  const put = await call(b, "put_frame", { canvas: "flow", tsx: startPart, ready: true });
  expect(put).toMatchObject({
    isError: false,
    structuredContent: { kind: "created", version: 1, findings: [] },
  });
  const own = await call(a, "put_frame", { canvas: "flow", tsx: startPart, ready: true });
  expect(own).toMatchObject({ isError: false, structuredContent: { kind: "created" } });
  expect(await call(b, "list_frames", { canvas: "flow" })).toMatchObject({
    isError: false,
    structuredContent: {
      frames: [
        { version: 1, status: "ready" },
        { version: 1, status: "ready" },
      ],
    },
  });
  expect(await call(a, "list_texts", {})).toMatchObject({
    structuredContent: { rev: 2, texts: { "trial.start": { en: "Start the trial" } } },
  });
});
