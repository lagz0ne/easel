import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serve } from "@tinkered/bun";
import { ws } from "@tinkered/bun/client";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import { afterAll, afterEach, expect, test, vi } from "vite-plus/test";

import { access } from "@/access";
import { ops } from "@/ops";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type Cmd = typeof import("../cmds/server");

const server: Cmd = await import(new URL("../cmds/server.ts", import.meta.url).href);
const easelCmd: Cmd = await import(new URL("../cmds/easel.ts", import.meta.url).href);

const root = new URL("..", import.meta.url).pathname;

const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

afterAll(() => collector.stop());

async function main(cmd: Cmd, args: string[], env: Record<string, string>) {
  const out: string[] = [];
  const codes: number[] = [];
  const stop = new AbortController();
  const app = await cmd.default({
    env,
    args,
    cwd: root,
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: (code) => (codes.push(code), stop.abort()),
  });

  return { app, stop, codes, out };
}

async function boot() {
  const started = await main(server, [], {
    PORT: "0",
    BUILD: "7",
    GIT_SHA: "c0ffee",
    PUBLIC_ORIGIN: "https://app.example",
    OTEL_SERVICE_NAME: "ops-cmd-test",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}traces`,
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}logs`,
  });
  const { app } = started;
  if (!("resolve" in app)) throw new Error(`the server did not start: ${started.out.join("")}`);
  closers.push(async () => (started.stop.abort(), await app.closed));
  const url = app.resolve(serve.url).get() ?? new URL("http://localhost:0");
  const setupCode = () => /setup code: (\S+)/.exec(started.out.join(""))?.[1] ?? "";

  return { url, setupCode };
}

async function client(url: URL) {
  const held: { token?: string } = {};
  const meta = operation({
    label: "test.meta",
    run: async (): Promise<Record<string, string>> =>
      held.token ? { authorization: `Bearer ${held.token}` } : {},
  });
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      ws.client({
        url: `ws://${url.host}/rpc`,
        meta,
        headers: { origin: "https://app.example" },
      }),
      access.login({ remote: ws.client }),
      access.owner({ remote: ws.client }),
      ops.user({ remote: ws.client }),
      ops.owner({ remote: ws.client }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return { held, scope };
}

function token() {
  const text = randomBytes(32).toString("base64url");

  return { text, digest: createHash("sha256").update(text).digest("hex") };
}

async function people(srv: Awaited<ReturnType<typeof boot>>) {
  const ann = await client(srv.url);
  const a = token();
  const setup = { name: "ann", code: srv.setupCode(), digest: a.digest };
  expect((await ann.scope.run(access.login["login.setup"], { input: setup })).kind).toBe("granted");
  ann.held.token = a.text;

  const bob = await client(srv.url);
  const b = token();
  const started = await bob.scope.run(access.login["login.start"], {
    input: { name: "bob", digest: b.digest },
  });
  if (started.kind !== "pending") throw new Error(`not pending: ${started.kind}`);
  await ann.scope.run(access.owner["users.approve"], { input: { code: started.code } });
  const waited = await bob.scope.run(access.login["login.wait"], {
    input: { request: started.request },
  });
  expect(waited.kind).toBe("granted");
  bob.held.token = b.text;

  return { ann, bob };
}

const faultOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (thrown: unknown) =>
      ops.owner.fault.is(thrown)
        ? { fault: thrown.fault, payload: thrown.payload }
        : { fault: "other", payload: String(thrown) },
  );

const batch = {
  traces: [
    {
      side: "browser",
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
      flags: 1,
      name: "page.board",
      kind: 1,
      startTimeUnixNano: "1",
      endTimeUnixNano: "2",
      attributes: [],
      events: [],
      status: { code: 2, message: "TypeError: x is undefined" },
    },
  ],
  logs: [],
};

test("the cmd wires ops: /api/version says BUILD, a member is refused ops.errors, a forged tab batch is an unconfirmed group", async () => {
  const srv = await boot();
  const { ann, bob } = await people(srv);

  const version = await fetch(new URL("/api/version", srv.url));
  expect(await version.json()).toEqual({ commit: "c0ffee", build: 7, client: null });

  expect(await faultOf(bob.scope.run(ops.owner["ops.errors"], { input: {} }))).toEqual({
    fault: "refused",
    payload: { owner: true },
  });

  const forged = await fetch(new URL("/api/telemetry", srv.url), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.example" },
    body: JSON.stringify(batch),
  });
  expect(forged.status).toBe(202);
  const status = await bob.scope.run(ops.user["ops.status"], { input: null });
  expect(status).toMatchObject({ build: 7, errors: { open: 1, unconfirmed: 1 } });
  const listed = await ann.scope.run(ops.owner["ops.errors"], { input: {} });
  expect(listed.errors).toMatchObject([{ side: "browser", label: "page.board", lastBuild: 7 }]);
});

test("production refuses to start without BUILD, or with build 0: exit 78, and it says why", async () => {
  for (const BUILD of [undefined, "", "0", "seven"]) {
    const env: Record<string, string> = { NODE_ENV: "production", PORT: "0" };
    if (BUILD !== undefined) env.BUILD = BUILD;
    const run = await main(server, [], env);
    await run.app.closed;

    expect(run.codes).toEqual([78]);
    expect(run.out.join("")).toBe(
      "easel serve: production needs BUILD, a build number above 0; the image sets it\n",
    );
  }
});

test("errors ls --since with a date that is not on the calendar is bad usage: exit 64", async () => {
  const home = mkdtempSync(join(tmpdir(), "easel-ops-cmd-"));
  closers.push(() => rmSync(home, { recursive: true, force: true }));
  const free = Bun.serve({ port: 0, fetch: () => new Response(null) });
  const at = `localhost:${free.port}`;
  await free.stop();
  const ls = async (since: string) => {
    const run = await main(easelCmd, ["errors", "ls", "--json", "--server", at, "--since", since], {
      HOME: home,
    });
    await run.app.closed;
    return { code: run.codes[0], out: run.out.join("") };
  };

  for (const since of ["2026-02-30", "2026-13-01", "2026-11-17Tnoon", "x", "7w"]) {
    const run = await ls(since);
    expect(run.code).toBe(64);
    expect(Object.keys(JSON.parse(run.out))).toEqual(["usage"]);
  }
  expect((await ls("2026-02-28")).code).toBe(69);
  expect((await ls("2h")).code).toBe(69);
});
