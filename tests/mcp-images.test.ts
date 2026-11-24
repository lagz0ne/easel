import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { makeTestClock, memory, preset } from "@tinkered/core/testing";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { routes } from "~/components/requests/index.server";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { cli } from "@/cli";
import { pictureFetch } from "@/cli/frames";
import { frames } from "@/frames";
import { imageRoute } from "@/frames/images.server";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { drawPage, pictureRoute, picturesServer } from "@/frames/pictures.server";
import { framesServer } from "@/frames/store.server";
import { kit } from "@/kit";
import { agentSide, mcpLink } from "@/mcp/server";
import { ops } from "@/ops";
import { queue } from "@/queue";

import { base64, jpegOf, pngOf, webpOf } from "./support/images";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

async function boot() {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const stop = new AbortController();
  const picture = await webpOf(800, 500);
  const server = await createScope({
    clock,
    presets: [preset(drawPage, async () => picture)],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      picturesServer({ chromium: process.execPath, database: ":memory:" }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      memory.server({ services: [access.login, access.user, access.owner, frames.api] }),
      routes({
        stop: stop.signal,
        table: {
          "GET /api/pictures/{canvas}/{id}/{version}": pictureRoute,
          "GET /api/images/{canvas}/{sha}": imageRoute,
        },
      }),
    ],
  }).ready;
  closers.push(() => (stop.abort(), server.close()));
  const route = server.resolve(routes).fetch;
  const send = async (request: Request) =>
    (await route(request, server)) ?? new Response(null, { status: 404 });
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, setupCode, send };
}

type Srv = Awaited<ReturnType<typeof boot>>;

async function agent(srv: Srv, send: (request: Request) => Promise<Response> = srv.send) {
  const dir = mkdtempSync(join(tmpdir(), "easel-mcp-images-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const scope = await createScope({
    clock: srv.clock,
    tags: [pictureFetch(send)],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: srv.server, meta: cli.bearer }),
      access.login({ remote: memory.client }),
      access.user({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      kit.api({ remote: memory.client }),
      queue.api({ remote: memory.client }),
      ops.user({ remote: memory.client }),
      ops.owner({ remote: memory.client }),
      cli({
        stdout: { write: () => undefined },
        stderr: { write: () => undefined },
        json: true,
        server: origin,
        hosts: join(dir, "hosts.json"),
      }),
    ],
  }).ready;
  closers.push(() => scope.close());
  const login = { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false } as const;
  expect(await scope.run(cli.run, { input: login })).toBe(0);

  const [ours, theirs] = InMemoryTransport.createLinkedPair();
  const served = scope.run(cli.run, { input: { kind: "mcp" }, tags: [mcpLink(async () => ours)] });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(theirs);
  closers.push(async () => (await client.close(), await served));
  await client.callTool({ name: "create_canvas", arguments: { name: "Flow" } });

  return client;
}

const result = z.object({
  isError: z.boolean(),
  structuredContent: z.looseObject({}),
  content: z.array(
    z.union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() }),
    ]),
  ),
});

async function call(client: Client, name: string, args: Record<string, unknown>) {
  return result.parse(await client.callTool({ name, arguments: args }));
}

async function putImage(client: Client, mimeType: string, bytes: Uint8Array) {
  const made = await call(client, "put_frame", {
    canvas: "flow",
    name: "Shot",
    image: { mimeType, data: base64(bytes) },
  });
  expect(made).toMatchObject({ isError: false, structuredContent: { kind: "created" } });
  return z.object({ id: z.string() }).parse(made.structuredContent).id;
}

async function sizeOf(data: string) {
  return new Bun.Image(Buffer.from(data, "base64")).metadata();
}

test("put_frame takes an image as MCP image content, and get_frame answers it as image content", async () => {
  const srv = await boot();
  const client = await agent(srv);
  const id = await putImage(client, "image/png", await pngOf(390, 844));

  const got = await call(client, "get_frame", { canvas: "flow", id });
  expect(got.isError).toBe(false);
  expect(got.structuredContent).toMatchObject({
    kind: "found",
    frame: { id, w: 390, h: 844, image: { mimeType: "image/png", w: 390, h: 844 } },
  });
  const [, image] = got.content;
  expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
  expect(await sizeOf(image?.type === "image" ? image.data : "")).toEqual({
    width: 390,
    height: 844,
    format: "png",
  });
});

test("get_frame fits a large image to 1568 px on its long side for the agent, and keeps a JPEG a JPEG", async () => {
  const srv = await boot();
  const client = await agent(srv);
  const id = await putImage(client, "image/jpeg", await jpegOf(3136, 1000));

  const got = await call(client, "get_frame", { canvas: "flow", id });
  const [, image] = got.content;
  expect(image).toMatchObject({ type: "image", mimeType: "image/jpeg" });
  expect(await sizeOf(image?.type === "image" ? image.data : "")).toEqual({
    width: agentSide,
    height: 500,
    format: "jpeg",
  });
});

test("shot_frame answers the picture as image content, as PNG", async () => {
  const srv = await boot();
  const client = await agent(srv);
  const made = await call(client, "put_frame", { canvas: "flow", html: "<p>1</p>", name: "Home" });
  const { id } = z.object({ id: z.string() }).parse(made.structuredContent);

  const shot = await call(client, "shot_frame", { canvas: "flow", id, scale: 0.5 });
  expect(shot.structuredContent).toMatchObject({ kind: "ready", version: 1 });
  const [, image] = shot.content;
  expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
  expect(await sizeOf(image?.type === "image" ? image.data : "")).toEqual({
    width: 800,
    height: 500,
    format: "png",
  });
});

test("get_frame of an HTML frame answers text only, and fetches nothing", async () => {
  const srv = await boot();
  const asked: string[] = [];
  const client = await agent(srv, async (request) => (asked.push(request.url), srv.send(request)));
  const made = await call(client, "put_frame", { canvas: "flow", html: "<p>1</p>", name: "Home" });
  const { id } = z.object({ id: z.string() }).parse(made.structuredContent);

  const got = await call(client, "get_frame", { canvas: "flow", id });
  expect(got.content.map((part) => part.type)).toEqual(["text"]);
  expect(asked).toEqual([]);
});

test("an image that cannot be fetched gives a text that says so in place of the image, and no tool error", async () => {
  const srv = await boot();
  const client = await agent(srv, async () => new Response(null, { status: 503 }));
  const id = await putImage(client, "image/png", await pngOf(40, 30));

  const got = await call(client, "get_frame", { canvas: "flow", id });
  expect(got.isError).toBe(false);
  expect(got.content[1]).toEqual({
    type: "text",
    text: expect.stringMatching(
      /^the image at \/api\/images\/flow\/[0-9a-f]{64} cannot be fetched \(HTTP 503\): call again$/,
    ),
  });
});

test("put_frame of an SVG as an image is a tool error that says badImage", async () => {
  const srv = await boot();
  const client = await agent(srv);

  const made = await call(client, "put_frame", {
    canvas: "flow",
    image: { mimeType: "image/png", data: base64(new TextEncoder().encode("<svg></svg>")) },
  });
  expect(made.isError).toBe(true);
  expect(made.content[0]).toMatchObject({
    type: "text",
    text: expect.stringMatching(/^badImage: /),
  });
});
