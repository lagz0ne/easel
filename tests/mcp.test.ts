import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { cli } from "@/cli";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { kit } from "@/kit";
import { mcpLink } from "@/mcp/server";
import { ops } from "@/ops";
import { queue } from "@/queue";
import { words } from "@/words";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

async function boot(options: { noFrames?: boolean } = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      memory.server({
        services: [
          access.login,
          access.user,
          access.owner,
          ...(options.noFrames ? [] : [frames.api]),
        ],
      }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, setupCode };
}

type Srv = Awaited<ReturnType<typeof boot>>;

async function easel(srv: Srv) {
  const dir = mkdtempSync(join(tmpdir(), "easel-mcp-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const out: string[] = [];
  const err: string[] = [];
  const scope = await createScope({
    clock: srv.clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: srv.server, meta: cli.bearer }),
      access.login({ remote: memory.client }),
      access.user({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      kit.api({ remote: memory.client }),
      words.api({ remote: memory.client }),
      queue.api({ remote: memory.client }),
      ops.user({ remote: memory.client }),
      ops.owner({ remote: memory.client }),
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => err.push(chunk) },
        json: true,
        server: origin,
        hosts: join(dir, "hosts.json"),
      }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return { scope, out, err };
}

async function mcp(cli$: Awaited<ReturnType<typeof easel>>) {
  const [ours, theirs] = InMemoryTransport.createLinkedPair();
  const served = cli$.scope.run(cli.run, {
    input: { kind: "mcp" },
    tags: [mcpLink(async () => ours)],
  });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(theirs);

  return { client, served };
}

async function ann(srv: Srv) {
  const a = await easel(srv);
  const login = { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false } as const;
  expect(await a.scope.run(cli.run, { input: login })).toBe(0);
  a.out.splice(0);

  return a;
}

test("easel mcp lists list_canvases with its schemas, and a call answers the user's canvases", async () => {
  const srv = await boot();
  const a = await easel(srv);
  expect(
    await a.scope.run(cli.run, {
      input: { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false },
    }),
  ).toBe(0);
  expect(
    await a.scope.run(cli.run, {
      input: { kind: "frames", act: { kind: "canvas new", name: "Flow" } },
    }),
  ).toBe(0);
  a.out.splice(0);

  const { client, served } = await mcp(a);
  const { tools } = await client.listTools();
  expect(tools).toHaveLength(42);
  for (const tool of tools) {
    expect([tool.name, tool.inputSchema.type, tool.outputSchema?.type]).toEqual([
      tool.name,
      "object",
      "object",
    ]);
  }
  expect(client.getInstructions()).toBe(
    "Frames are made from the kit of this easel. Call `kit_capsules` before the first app frame.",
  );
  const list = tools.find((tool) => tool.name === "list_canvases");
  expect(list).toMatchObject({
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object" },
    outputSchema: { type: "object", properties: { canvases: { type: "array" } } },
  });
  expect(list?.description).toMatch(/canvas/);

  const answer = await client.callTool({ name: "list_canvases", arguments: {} });
  const canvases = [
    { key: "flow", name: "Flow", created: srv.clock.currentTimeMillis(), shared: false },
  ];
  expect(answer.isError).toBe(false);
  expect(answer.structuredContent).toEqual({ canvases });
  expect(answer.content).toEqual([{ type: "text", text: JSON.stringify({ canvases }) }]);

  await client.close();
  expect(await served).toBe(0);
  expect(a.out).toEqual([]);
});

test("easel mcp with no token for the server exits 2 with the refusal of a sign-in, and serves nothing", async () => {
  const srv = await boot();
  const a = await easel(srv);

  const [ours] = InMemoryTransport.createLinkedPair();
  const code = await a.scope.run(cli.run, {
    input: { kind: "mcp" },
    tags: [mcpLink(async () => ours)],
  });
  expect(code).toBe(2);
  expect(a.out.join("")).toBe(`${JSON.stringify({ refused: { signIn: true } })}\n`);
});

test("a tool that is not in the table, and a call that the server does not serve, are tool errors", async () => {
  const srv = await boot({ noFrames: true });
  const { client, served } = await mcp(await ann(srv));

  const unknown = await client.callTool({ name: "list_everything", arguments: {} });
  expect(unknown).toMatchObject({
    isError: true,
    content: [{ type: "text", text: "no tool list_everything: list the tools again" }],
  });
  const missing = await client.callTool({ name: "list_canvases", arguments: {} });
  expect(missing).toMatchObject({
    isError: true,
    content: [{ type: "text", text: "this easel has no canvas.list: update easel" }],
  });

  await client.close();
  expect(await served).toBe(0);
});

test("a tool error carries no input value: a short password is not in the text of its invalid fault", async () => {
  const srv = await boot();
  const a = await ann(srv);
  expect(
    await a.scope.run(cli.run, {
      input: { kind: "frames", act: { kind: "canvas new", name: "Flow" } },
    }),
  ).toBe(0);
  const { client, served } = await mcp(a);

  const answer = await client.callTool({
    name: "share_canvas",
    arguments: { canvas: "flow", password: "sEcRe7x" },
  });
  const text = JSON.stringify(answer.content);
  expect(answer.isError).toBe(true);
  expect(text).toMatch(/the input is wrong: password: [^"]+\. Fix it, then call again/);
  expect(text).not.toContain("sEcRe7x");

  await client.close();
  expect(await served).toBe(0);
});
