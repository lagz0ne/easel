import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
import { portClient, portServer } from "@/kit/port-link";
import { mcpHttp, mcpMeta } from "@/mcp/http.server";
import { ops } from "@/ops";
import { queue } from "@/queue";

// `POST /mcp` (SPEC-mcp.md § A remote agent adds easel), as the server cmd joins it: the route
// in the server's scope, and the scope of MCP on a port to it, with each request's token as the
// meta of its calls. The MCP client is the SDK's, over HTTP, with a fetch that runs the route.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

/** The server's scope, with the route of MCP, and the scope of MCP on a port to it. */
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
      queue.api({ remote: portClient }),
      ops.user({ remote: portClient }),
      ops.owner({ remote: portClient }),
    ],
  });
  const services = [access.login, access.user, access.owner, frames.api];
  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user, owner] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
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

  /** One request to `/mcp`, as the route table runs it. */
  const fetch = async (url: string | URL, init?: RequestInit) =>
    server.run(mcpHttp.route, { tags: [transport.request(new Request(url, init))] });

  return { server, clock, setupCode, fetch };
}

type Srv = Awaited<ReturnType<typeof boot>>;

/** A user's CLI: its runs, and the token that its hosts file keeps. */
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

/** Ann, the first owner, and Bob, a member that she approved: each with a token. */
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

  return { ann: ann.token(), bob: bob.token() };
}

/** The SDK's client on `/mcp`, with a token. */
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

  expect((await mcp.listTools()).tools).toHaveLength(31);
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
  expect([none.status, none.headers.get("www-authenticate")]).toEqual([
    401,
    'Bearer realm="easel"',
  ]);
  const wrong = await post({ authorization: "Bearer not-a-token" });
  expect([wrong.status, wrong.headers.get("www-authenticate")]).toEqual([
    401,
    'Bearer realm="easel"',
  ]);
  const foreign = await post({ authorization: "Bearer x", origin: "https://evil.test" });
  expect(foreign.status).toBe(403);
  const get = await srv.fetch(`${origin}/mcp`, { method: "GET" });
  expect([get.status, get.headers.get("allow")]).toEqual([405, "POST"]);
});
