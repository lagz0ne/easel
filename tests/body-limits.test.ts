import { createHash, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";

import { serve } from "@tinkered/bun";
import { ws } from "@tinkered/bun/client";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import { afterAll, afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { access } from "@/access";
import { maxImageBytes } from "@/frames/contract";
import { mcpMaxBody } from "@/mcp/http.server";

vi.setConfig({ testTimeout: 30_000 });

type Cmd = typeof import("../cmds/server");

const server: Cmd = await import(new URL("../cmds/server.ts", import.meta.url).href);

const root = new URL("..", import.meta.url).pathname;

const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

afterAll(() => collector.stop());

const oneMiB = 1024 * 1024;

async function boot() {
  const out: string[] = [];
  const stop = new AbortController();
  const app = await server.default({
    env: {
      PORT: "0",
      PUBLIC_ORIGIN: "https://app.example",
      OTEL_SERVICE_NAME: "body-limits-test",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}traces`,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}logs`,
    },
    args: [],
    cwd: root,
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: () => stop.abort(),
  });
  if (!("resolve" in app)) throw new Error(`the server did not start: ${out.join("")}`);
  closers.push(async () => (stop.abort(), await app.closed));
  const url = app.resolve(serve.url).get() ?? new URL("http://localhost:0");
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { url, setupCode };
}

async function ownerToken(srv: Awaited<ReturnType<typeof boot>>) {
  const meta = operation({
    label: "test.meta",
    run: async (): Promise<Record<string, string>> => ({}),
  });
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      ws.client({
        url: `ws://${srv.url.host}/rpc`,
        meta,
        headers: { origin: "https://app.example" },
      }),
      access.login({ remote: ws.client }),
    ],
  }).ready;
  closers.push(() => scope.close());
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const setup = { name: "ann", code: srv.setupCode(), digest };
  expect((await scope.run(access.login["login.setup"], { input: setup })).kind).toBe("granted");

  return text;
}

function chunkOf(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const named = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(Bun.hash.crc32(named));

  return Buffer.concat([length, named, crc]);
}

function storedPngUpTo(maxBytes: number) {
  const width = 2048;
  const row = 1 + width * 3;
  const height = Math.floor((maxBytes - 4096) / row);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head.set([8, 2, 0, 0, 0], 8);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return Buffer.concat([
    signature,
    chunkOf("IHDR", head),
    chunkOf("IDAT", deflateSync(Buffer.alloc(row * height), { level: 0 })),
    chunkOf("IEND", Buffer.alloc(0)),
  ]);
}

const toolResult = z.object({
  result: z.object({ structuredContent: z.looseObject({ kind: z.string() }) }),
});

function mcpPost(srv: Awaited<ReturnType<typeof boot>>, token: string, body: BodyInit) {
  return fetch(new URL("/mcp", srv.url), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body,
  });
}

async function callTool(
  srv: Awaited<ReturnType<typeof boot>>,
  token: string,
  name: string,
  args: Record<string, unknown>,
) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const answer = await mcpPost(srv, token, body);

  return { status: answer.status, size: body.length, text: await answer.text() };
}

function chunked(total: number) {
  const left = { bytes: total };
  return new ReadableStream<Uint8Array>({
    pull(out) {
      const next = Math.min(left.bytes, 64 * 1024);
      left.bytes -= next;
      if (next > 0) out.enqueue(new Uint8Array(next).fill(0x61));
      else out.close();
    },
  });
}

test("POST /mcp takes put_frame with an image of 10 MiB as base64, over 1 MiB of JSON; past its max of 16 MiB it is 413", async () => {
  const srv = await boot();
  const token = await ownerToken(srv);
  const made = await callTool(srv, token, "create_canvas", { name: "Big" });
  expect(made.status).toBe(200);

  const png = storedPngUpTo(maxImageBytes);
  expect(png.byteLength).toBeLessThanOrEqual(maxImageBytes);
  expect(png.byteLength).toBeGreaterThan(maxImageBytes - 8192);
  const put = await callTool(srv, token, "put_frame", {
    canvas: "big",
    name: "Large",
    image: { mimeType: "image/png", data: png.toString("base64") },
  });
  expect(put.size).toBeGreaterThan(13 * oneMiB);
  expect(put.status).toBe(200);
  expect(toolResult.parse(JSON.parse(put.text)).result.structuredContent.kind).toBe("created");

  const over = await mcpPost(srv, token, "x".repeat(mcpMaxBody + 1));
  expect(over.status).toBe(413);
});

test("a route with no maxBody of its own takes 1 MiB, and refuses one byte more with 413, by Content-Length and by count", async () => {
  const srv = await boot();
  const tokenAt = new URL("/oauth/token", srv.url);
  const form = { "content-type": "application/x-www-form-urlencoded" };

  const full = await fetch(tokenAt, { method: "POST", headers: form, body: "a".repeat(oneMiB) });
  expect(full.status).toBe(400);
  expect(await full.json()).toEqual({ error: "unsupported_grant_type" });

  const byLength = await fetch(tokenAt, {
    method: "POST",
    headers: form,
    body: "a".repeat(oneMiB + 1),
  });
  expect(byLength.status).toBe(413);

  const byCount = await fetch(tokenAt, {
    method: "POST",
    headers: form,
    body: chunked(oneMiB + 1),
  });
  expect(byCount.status).toBe(413);
});
