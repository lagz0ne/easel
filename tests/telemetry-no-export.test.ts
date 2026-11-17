import { serve } from "@tinkered/bun";
import type { Scope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

// SPEC-ops.md fact rule 4: the server starts without Victoria, and telemetry export is on only
// for a kind whose URL is given (OpenTelemetry's convention: no endpoint, no exporter).

type Server = typeof import("../cmds/server");

/** The real server command, run in this process; the lint bans a static parent import. */
const server: Server = await import(new URL("../cmds/server.ts", import.meta.url).href);

type Root = Scope.Starting & { readonly closed: Promise<unknown> };

/** Starts the server command with this env, and stops it after `body`. */
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
  // The command returns once its scope is ready.
  const url = root.resolve(serve.url).get();
  try {
    if (!url) throw new Error("the server has no url");
    await body(url);
  } finally {
    stop.abort();
    await root.closed;
  }
}

test("the server starts with no VICTORIA_* URL, and answers its health", async () => {
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
    await withServer({ VICTORIA_TRACES_URL: `${collector.url}traces` }, async (url) => {
      expect((await fetch(new URL("/api/version", url))).status).toBe(200);
    });
  } finally {
    await collector.stop();
  }

  expect(paths).toContain("/traces");
  expect(paths.every((path) => path === "/traces")).toBe(true);
});
