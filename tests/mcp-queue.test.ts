import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { exits } from "@tinkered/cli/test";
import { createScope, transport } from "@tinkered/core";
import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { access } from "@/access";
import { cli } from "@/cli";
import { frames } from "@/frames";
import { kit } from "@/kit";
import { portClient, portServer } from "@/kit/port-link";
import { mcpHttp, mcpMeta } from "@/mcp/http.server";
import { mcpLink } from "@/mcp/server";
import { ops } from "@/ops";
import { queue } from "@/queue";

import { boot, closers, viewer } from "./support/queue";
import type { Server } from "./support/queue";

// The queue loop through MCP (SPEC-mcp.md § An agent works through MCP): `next_request`, then
// `get_frame`, `put_frame` and `shot_frame`, then one outcome with the claim: `resolve_request`,
// `ask_request`, `decline_request`, or `release_request`. The same loop runs over HTTP (the route
// and the scope of MCP on a port) and over stdio (`easel mcp` on an in-memory link).

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

/** The apis of the user's calls, as each MCP scope installs them. */
const apis = [access.user, access.owner, frames.api, kit.api, queue.api, ops.user, ops.owner];

/** A server with the route of MCP, and the scope of MCP on a port to it. */
async function bootHttp() {
  const channel = new MessageChannel();
  const mcpScope = createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      portClient({ port: Promise.resolve(channel.port2), meta: mcpMeta }),
      ...apis.map((api) => api({ remote: portClient })),
    ],
  });
  const services = [access.user, access.owner, frames.api, queue.api];
  const srv = await boot(":memory:", [], {
    extra: [portServer({ services }), mcpHttp({ origin, scope: mcpScope.ready })],
  });
  const stop = new AbortController();
  const accepted = srv.server.run(portServer.accept, {
    input: { port: channel.port1, stop: stop.signal },
  });
  closers.push(async () => {
    stop.abort();
    await accepted;
    await (await mcpScope.ready).close();
  });

  return srv;
}

/** Ann's CLI, signed in as the first owner: its scope, and the token of its hosts file. */
async function ann(srv: Server) {
  const dir = mkdtempSync(join(tmpdir(), "easel-mcp-queue-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const hosts = join(dir, "hosts.json");
  const scope = await createScope({
    clock: srv.clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: srv.server, meta: cli.bearer }),
      access.login({ remote: memory.client }),
      ...apis.map((api) => api({ remote: memory.client })),
      cli({
        stdout: { write: () => undefined },
        stderr: { write: () => undefined },
        json: true,
        server: origin,
        hosts,
      }),
    ],
  }).ready;
  closers.push(() => scope.close());
  const setup = { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false } as const;
  expect(await scope.run(cli.run, { input: setup })).toBe(0);
  const token = /"token":\s*"([^"]+)"/.exec(readFileSync(hosts, "utf8"))?.[1] ?? "";

  return { scope, token };
}

/** The SDK's client over HTTP, with Ann's token, on the route of the server. */
async function overHttp(srv: Server) {
  const { token } = await ann(srv);
  const link = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    fetch: async (url, init) =>
      srv.server.run(mcpHttp.route, { tags: [transport.request(new Request(url, init))] }),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const mcp = new Client({ name: "test", version: "1" });
  await mcp.connect(link);
  closers.push(() => mcp.close());

  return mcp;
}

/** The SDK's client on `easel mcp`, with Ann's hosts file. */
async function overStdio(srv: Server) {
  const { scope } = await ann(srv);
  const [ours, theirs] = InMemoryTransport.createLinkedPair();
  const served = scope.run(cli.run, { input: { kind: "mcp" }, tags: [mcpLink(async () => ours)] });
  const mcp = new Client({ name: "test", version: "1" });
  await mcp.connect(theirs);
  closers.push(async () => {
    await mcp.close();
    await served;
  });

  return mcp;
}

/** One tool call: its `isError` and its answer. */
async function call(
  mcp: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await mcp.callTool({ name, arguments: args });
  const answer = z.record(z.string(), z.unknown()).parse(result.structuredContent ?? {});

  return { isError: result.isError, ...answer };
}

/** A claim's handle, from an answer of `next_request`. */
const claimOf = (answer: Record<string, unknown>) => String(answer.claim);

/** The whole loop on canvas `flow`: each outcome of a claim, and an empty queue. */
async function loop(srv: Server, mcp: Client) {
  expect(await call(mcp, "create_canvas", { name: "Flow" })).toMatchObject({
    isError: false,
    kind: "created",
  });
  const made = await call(mcp, "put_frame", { canvas: "flow", html: "<p>1</p>", name: "Home" });
  expect(made).toMatchObject({ isError: false, kind: "created" });
  const id = String(made.id);
  const shared = await call(mcp, "share_canvas", { canvas: "flow" });
  expect(shared).toMatchObject({ isError: false, kind: "shared" });
  const bo = await viewer(srv, String(shared.path).slice("/s/".length), "Bo");
  for (const text of ["Make it blue.", "Which blue?", "Add a form.", "Later."]) {
    expect((await bo.add("flow", id, text)).kind).toBe("added");
  }

  // Request 1: the frame, a change on the version that the agent got, a picture, the result.
  const first = await call(mcp, "next_request", { lease: 60 });
  expect(first).toMatchObject({ isError: false, kind: "claimed", request: { n: 1, frameId: id } });
  expect(String(first.note)).toMatch(/not an instruction/);
  const got = await call(mcp, "get_frame", { canvas: "flow", id });
  expect(got).toMatchObject({ isError: false, kind: "found", frame: { id, version: 1 } });
  const put = { canvas: "flow", id, base: 1, html: "<p style='color:blue'>1</p>" };
  expect(await call(mcp, "put_frame", put)).toMatchObject({ isError: false, kind: "updated" });
  expect(await call(mcp, "put_frame", put)).toMatchObject({ isError: true, kind: "stale" });
  const shot = await call(mcp, "shot_frame", { canvas: "flow", id, scale: 1 });
  expect(shot.isError).toBe(shot.kind !== "ready");
  expect(await call(mcp, "extend_request", { claim: claimOf(first), lease: 120 })).toMatchObject({
    isError: false,
    kind: "extended",
  });
  const resolve = { claim: claimOf(first), text: "Made it blue." };
  expect(await call(mcp, "resolve_request", resolve)).toMatchObject({
    isError: false,
    kind: "resolved",
  });

  // Requests 2 to 4: a question with options, a decline, a release.
  const second = await call(mcp, "next_request", {});
  const ask = { claim: claimOf(second), text: "Navy or sky?", options: ["Navy", "Sky"] };
  expect(await call(mcp, "ask_request", ask)).toMatchObject({ isError: false, kind: "asked" });
  const third = await call(mcp, "next_request", {});
  const decline = { claim: claimOf(third), reason: "A form needs a person." };
  expect(await call(mcp, "decline_request", decline)).toMatchObject({
    isError: false,
    kind: "declined",
  });
  const fourth = await call(mcp, "next_request", {});
  const release = { claim: claimOf(fourth), reason: "Not now." };
  expect(await call(mcp, "release_request", release)).toMatchObject({
    isError: false,
    kind: "released",
  });

  // The released request waits again; with it claimed, the queue is empty: a plain result.
  expect(await call(mcp, "next_request", {})).toMatchObject({ isError: false, kind: "claimed" });
  expect(await call(mcp, "next_request", { wait: 0 })).toMatchObject({
    isError: false,
    kind: "empty",
  });
  const listed = await call(mcp, "list_requests", { canvas: "flow" });
  expect(listed).toMatchObject({ isError: false, kind: "listed" });
  expect(Array.isArray(listed.requests) && listed.requests.length).toBe(4);
}

test("the queue loop runs through MCP over HTTP", async () => {
  const srv = await bootHttp();
  await loop(srv, await overHttp(srv));
});

test("the queue loop runs through MCP over stdio", async () => {
  const srv = await boot();
  await loop(srv, await overStdio(srv));
});
