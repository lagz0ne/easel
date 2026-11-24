import { serve } from "@tinkered/bun";
import type { Scope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

type Server = typeof import("../cmds/server");

const server: Server = await import(new URL("../cmds/server.ts", import.meta.url).href);

type Root = Scope.Starting & { readonly closed: Promise<unknown> };

async function withServer(env: Record<string, string>, body: (url: URL) => Promise<void>) {
  const stop = new AbortController();
  const root = (await server.default({
    env: { PORT: "0", OTEL_SERVICE_NAME: "no-export-test", ...env },
    args: [],
    cwd: process.cwd(),
    signal: stop.signal,
    stdout: { write: () => true },
    stderr: { write: () => true },
    exit: (code, reason) => stop.abort(reason ?? code),
  })) as Root;
  const url = root.resolve(serve.url).get();
  try {
    if (!url) throw new Error("the server has no url");
    await body(url);
  } finally {
    stop.abort();
    await root.closed;
  }
}

test("the server starts with no OTLP endpoint, and answers its health", async () => {
  await withServer({}, async (url) => {
    const health = await fetch(new URL("/api/health", url));
    expect(health.status).toBe(200);
  });
});

test("only the kind whose URL is given is sent: traces, and no logs", async () => {
  const paths: string[] = [];
  const collector = Bun.serve({
    port: 0,
    fetch: (request) => {
      paths.push(new URL(request.url).pathname);
      return new Response(null, { status: 204 });
    },
  });
  try {
    await withServer(
      { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}traces` },
      async (url) => {
        expect((await fetch(new URL("/api/version", url))).status).toBe(200);
      },
    );
  } finally {
    await collector.stop();
  }

  expect(paths).toContain("/traces");
  expect(paths.every((path) => path === "/traces")).toBe(true);
});

test("OTEL_EXPORTER_OTLP_ENDPOINT sends the traces to /v1/traces and the logs to /v1/logs, as OTLP JSON with the resource of the env", async () => {
  const posts: { path: string; type: string; body: string }[] = [];
  const collector = Bun.serve({
    port: 0,
    fetch: async (request) => {
      posts.push({
        path: new URL(request.url).pathname,
        type: String(request.headers.get("content-type")),
        body: await request.text(),
      });
      return new Response(null, { status: 200 });
    },
  });
  try {
    await withServer(
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: `${collector.url}otlp/`,
        OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=production",
        GIT_SHA: "abc1234",
      },
      async (url) => {
        expect((await fetch(new URL("/api/version", url))).status).toBe(200);
      },
    );
  } finally {
    await collector.stop();
  }

  expect(posts.map((post) => post.path)).toContain("/otlp/v1/traces");
  expect(posts.every((post) => ["/otlp/v1/traces", "/otlp/v1/logs"].includes(post.path))).toBe(
    true,
  );
  expect(posts.every((post) => post.type === "application/json")).toBe(true);
  const traces = posts.find((post) => post.path === "/otlp/v1/traces");
  expect(traces?.body).toContain(
    '{"key":"deployment.environment","value":{"stringValue":"production"}}',
  );
  expect(traces?.body).toContain('{"key":"service.version","value":{"stringValue":"abc1234"}}');
  expect(traces?.body).toContain('{"key":"service.name","value":{"stringValue":"no-export-test"}}');
});
