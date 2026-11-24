import { serve } from "@tinkered/bun";
import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { afterAll, expect, test } from "vite-plus/test";

import { telemetry } from "~/components/telemetry/index.server";

type Server = typeof import("../cmds/server");

const server: Server = await import(new URL("../cmds/server.ts", import.meta.url).href);

const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });
const stop = new AbortController();

type Root = Scope.Starting & { readonly closed: Promise<unknown> };

const started = (await server.default({
  env: {
    PORT: "0",
    OTEL_SERVICE_NAME: "server-test",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}traces`,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}logs`,
    PUBLIC_ORIGIN: "https://app.example",
  },
  args: [],
  cwd: process.cwd(),
  signal: stop.signal,
  stdout: { write: () => true },
  stderr: { write: () => true },
  exit: (code, reason) => stop.abort(reason ?? code),
})) as Root;

const urlOf = (root: Root) => root.resolve(serve.url).get()!;

afterAll(async () => {
  stop.abort();
  await started.closed;
  await collector.stop();
});

const proxied = (path: string, body: unknown) =>
  fetch(new URL(path, urlOf(started)), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.example" },
    body: JSON.stringify(body),
  });

async function greetOver(root: Root, origin?: string) {
  const headers = origin === undefined ? {} : { origin };
  const socket = new WebSocket(`ws://${urlOf(root).host}/rpc`, { headers } as never);
  const reply = await new Promise<string>((done) => {
    socket.onopen = () => socket.send(JSON.stringify([{ i: 1, a: "greet", t: '{"name":"Duke"}' }]));
    socket.onmessage = (e) => done(JSON.parse(String(e.data))[0].t);
    socket.onclose = (e) => done(`closed ${e.code}`);
    socket.onerror = () => done("refused");
  });

  socket.close();
  return reply;
}

const answer = async (root: Root, origin?: string): Promise<unknown> => {
  const reply = await greetOver(root, origin);

  return reply.startsWith("{") ? JSON.parse(reply) : reply;
};

test("PUBLIC_ORIGIN reaches rpc: a socket from the public origin passes behind a TLS proxy; a foreign one, and a sandboxed frame's \"null\", are refused; the CLI's, with no Origin, passes", async () => {
  const hello = { ok: true, value: { text: "Hello, Duke." } };

  expect(await answer(started, "https://app.example")).toEqual(hello);
  expect(await answer(started, "https://evil.example")).toBe("refused");
  expect(await answer(started, "null")).toBe("refused");
  expect(await answer(started)).toEqual(hello);
});

test("PUBLIC_ORIGIN reaches telemetry: a tab batch from the public origin is taken", async () => {
  const reply = await proxied("/api/telemetry", { logs: [], traces: [] });

  expect(reply?.status).toBe(202);
});

test("an empty PUBLIC_ORIGIN counts as unset: rpc and telemetry take the request URL's origin", async () => {
  const quiet = new AbortController();
  const plain = (await server.default({
    env: {
      PORT: "0",
      OTEL_SERVICE_NAME: "server-test",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}traces`,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}logs`,
      PUBLIC_ORIGIN: "",
    },
    args: [],
    cwd: process.cwd(),
    signal: quiet.signal,
    stdout: { write: () => true },
    stderr: { write: () => true },
    exit: (code, reason) => quiet.abort(reason ?? code),
  })) as Root;
  const at = urlOf(plain);
  const post = (path: string, body: unknown) =>
    fetch(new URL(path, at), {
      method: "POST",
      headers: { "content-type": "application/json", origin: at.origin },
      body: JSON.stringify(body),
    });

  const local = await greetOver(plain, "http://localhost");
  expect(local).toBe("refused");
  expect(await greetOver(plain, "null")).toBe("refused");
  expect(await greetOver(plain, "https://app.example")).toBe("refused");
  expect(await answer(plain, at.origin)).toMatchObject({ ok: true });
  expect(await answer(plain)).toMatchObject({ ok: true });
  expect((await post("/api/telemetry", { logs: [], traces: [] }))?.status).toBe(202);
  quiet.abort();
  await plain.closed;
});

test("a telemetry origin that is not an http(s) URL fails its root's start, naming telemetry.origin", async () => {
  const failureOf = async (origin: string) => {
    const sink = telemetry.server({
      service: "server-test",
      tracesUrl: new URL(`${collector.url}traces`),
      logsUrl: new URL(`${collector.url}logs`),
      origin,
    });
    try {
      await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS }), sink] }).close();
      return { origin, kind: undefined, label: undefined };
    } catch (error) {
      const { kind, payload } = Object(error);
      return { origin, kind, label: Object(payload).label };
    }
  };

  const origins = ["app.example", "file:///x", "ftp://app.example", "null"];
  expect(await Promise.all(origins.map(failureOf))).toEqual(
    origins.map((origin) => ({ origin, kind: "DataValidationFailed", label: "telemetry.origin" })),
  );
});
