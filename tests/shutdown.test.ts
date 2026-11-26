import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serve } from "@tinkered/bun";
import { ws } from "@tinkered/bun/client";
import { exits } from "@tinkered/cli/test";
import { capsule, createScope, operation } from "@tinkered/core";
import { afterAll, afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";

import { access } from "@/access";
import { accessDoor } from "@/access/guards.server";
import { frames } from "@/frames";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type Server = typeof import("../cmds/server");

const server: Server = await import(new URL("../cmds/server.ts", import.meta.url).href);

const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });

afterAll(() => collector.stop());

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const grace = 8000;

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

const within = (closed: Promise<unknown>, ms: number) =>
  Promise.race([closed.then(() => "closed"), tick(ms).then(() => "hung")]);

async function until(ok: () => boolean) {
  for (let i = 0; i < 250 && !ok(); i++) await tick();
  expect(ok()).toBe(true);
}

const diskInMemory = existsSync("/dev/shm") ? "/dev/shm" : tmpdir();

function folder() {
  const dir = mkdtempSync(join(diskInMemory, "easel-shutdown-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));

  return dir;
}

async function run(port: string, env: Record<string, string>) {
  const stop = new AbortController();
  const out: string[] = [];
  const root = await server.default({
    env: {
      PORT: port,
      OTEL_SERVICE_NAME: "shutdown-test",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}traces`,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}logs`,
      ...env,
    },
    args: [],
    cwd: process.cwd(),
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: (_, reason) => stop.abort(reason),
  });
  if (!("resolve" in root)) throw new Error(`the command did not start: ${out.join("")}`);
  const url = root.resolve(serve.url).get() ?? new URL("http://localhost:0");
  closers.push(async () => (stop.abort(), await root.closed));
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { url, stop, closed: root.closed, setupCode };
}

async function socket(host: string) {
  const raw = new WebSocket(`ws://${host}/rpc`);
  const replies = new Map<number, (text: string) => void>();
  raw.onmessage = (event) => {
    for (const reply of JSON.parse(String(event.data))) replies.get(reply.i)?.(reply.t);
  };
  const ended = new Promise<number>((done) => (raw.onclose = (event) => done(event.code)));
  await new Promise((done) => (raw.onopen = done));
  closers.push(() => raw.close());
  let next = 0;
  const call = (address: string, input: unknown) =>
    new Promise<string>((done) => {
      const i = ++next;
      replies.set(i, done);
      raw.send(JSON.stringify([{ i, a: address, t: JSON.stringify(input) }]));
    });

  return { call, ended };
}

const batch = (name: string) => ({
  traces: [
    {
      side: "browser",
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
      flags: 1,
      name,
      kind: 1,
      startTimeUnixNano: "1",
      endTimeUnixNano: "2",
      attributes: [],
      events: [],
      status: { code: 2, message: "TypeError: x is undefined" },
    },
  ],
  logs: [],
});

function storedLabels(file: string) {
  const db = new Database(file, { readonly: true });
  try {
    const rows = z
      .array(z.object({ body: z.string() }))
      .parse(db.query("SELECT body FROM ops_groups").all());
    return rows.map((row) => z.object({ label: z.string() }).parse(JSON.parse(row.body)).label);
  } finally {
    db.close();
  }
}

const digest = () => createHash("sha256").update(randomBytes(32)).digest("hex");

test("a stop drains: a waiting call's socket closes 1001 going away, the error the sink holds is written, and the root closes within the grace (judged rule 8)", async () => {
  const file = join(folder(), "easel.db");
  const app = await run("0", { EASEL_DB: file });
  const seen = await fetch(new URL("/api/telemetry", app.url), {
    method: "POST",
    headers: { "content-type": "application/json", origin: app.url.origin },
    body: JSON.stringify(batch("page.board")),
  });
  expect(seen.status).toBe(202);

  const raw = await socket(app.url.host);
  const started = z
    .object({
      ok: z.literal(true),
      value: z.object({ kind: z.literal("pending"), request: z.string() }),
    })
    .parse(JSON.parse(await raw.call("login.start", { name: "bo", digest: digest() })));
  void raw.call("login.wait", { request: started.value.request });
  await tick(100);

  const at = performance.now();
  app.stop.abort();
  expect(await within(app.closed, grace + 1000)).toBe("closed");
  expect(performance.now() - at).toBeLessThan(grace);
  expect(await raw.ended).toBe(1001);
  expect(storedLabels(file)).toEqual(["page.board"]);
});

type Held = { token?: string; pass?: string };

async function client(port: string, held: Held) {
  const meta = operation({
    label: "test.meta",
    run: async (): Promise<Record<string, string>> => ({
      ...(held.token ? { authorization: `Bearer ${held.token}` } : {}),
      ...(held.pass ? { pass: held.pass } : {}),
    }),
  });
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      ws.client({ url: `ws://localhost:${port}/rpc`, meta }),
      access.login({ remote: ws.client }),
      frames.api({ remote: ws.client }),
      frames.board({ read: ws.client }),
      frames.viewer({ remote: ws.client }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return scope;
}

const idOf = (out: { kind: string }) => ("id" in out && typeof out.id === "string" ? out.id : "");

test("a viewer's tab says Reconnecting when the server stops, and once it is back shows what an agent added, deleted and wrote while it was down (viewer-gate-open s1 to s3, s3 to s1)", async () => {
  const file = join(folder(), "easel.db");
  const first = await run("0", { EASEL_DB: file });
  const port = first.url.port;
  const held: Held = {};
  const tab = await client(port, held);

  const token = randomBytes(32).toString("base64url");
  const setup = {
    name: "ann",
    code: first.setupCode(),
    digest: createHash("sha256").update(token).digest("hex"),
  };
  expect((await tab.run(access.login["login.setup"], { input: setup })).kind).toBe("granted");
  held.token = token;
  expect((await tab.run(frames.api["canvas.create"], { input: { name: "flow" } })).kind).toBe(
    "created",
  );
  const home = { canvas: "flow", html: "<p>1</p>", name: "Home" };
  const homeId = idOf(await tab.run(frames.api["frame.put"], { input: home }));
  const keep = { canvas: "flow", html: "<p>1</p>", name: "Keep" };
  const keepId = idOf(await tab.run(frames.api["frame.put"], { input: keep }));
  const shared = await tab.run(frames.api["canvas.share"], { input: { canvas: "flow" } });
  const link = shared.kind === "shared" ? shared.path.slice("/s/".length) : "";
  held.token = undefined;
  const opened = await tab.run(frames.viewer["share.open"], { input: { link, name: "Bo" } });
  held.pass = opened.kind === "open" ? opened.pass : "";

  const list = tab.resolve(frames.board.frames.where({ canvas: "flow" }));
  closers.push(list.watch(() => undefined));
  const doc = tab.resolve(frames.board.docs.of({ canvas: "flow", id: keepId }));
  closers.push(doc.watch(() => undefined));
  const faults = tab.resolve(frames.board.faults);
  const reconnecting = () => faults.get().frames?.fault === "link";
  const names = () =>
    list
      .get()
      .map((f) => f.name)
      .toSorted();
  await until(() => names().length === 2 && doc.get()?.version === 1);
  expect(reconnecting()).toBe(false);

  first.stop.abort();
  expect(await within(first.closed, grace + 1000)).toBe("closed");
  await until(reconnecting);
  expect(names()).toEqual(["Home", "Keep"]);

  const side = await run("0", { EASEL_DB: file });
  const agent = await client(side.url.port, { token });
  const added = { canvas: "flow", html: "<p>n</p>", name: "New" };
  expect((await agent.run(frames.api["frame.put"], { input: added })).kind).toBe("created");
  const gone = { canvas: "flow", id: homeId };
  expect((await agent.run(frames.api["frame.delete"], { input: gone })).kind).toBe("deleted");
  const wrote = { canvas: "flow", id: keepId, base: 1, html: "<p>2</p>" };
  expect((await agent.run(frames.api["frame.put"], { input: wrote })).kind).toBe("updated");
  await agent.close();
  side.stop.abort();
  expect(await within(side.closed, grace + 1000)).toBe("closed");
  expect(reconnecting()).toBe(true);
  expect(names()).toEqual(["Home", "Keep"]);

  const seen: string[] = [];
  closers.push(faults.watch(() => void (reconnecting() || seen.push(names().join(",")))));
  await run(port, { EASEL_DB: file });
  await until(() => !reconnecting());
  expect(seen[0]).toBe("Keep,New");
  expect(names()).toEqual(["Keep", "New"]);
  await until(() => doc.get()?.version === 2);
  expect(doc.get()?.html).toBe("<p>2</p>");
});

const hangs = capsule({
  label: "test.hangs",
  hooks: {
    async start({ next }) {
      await next();

      return {
        fetch: (request: Request) =>
          new URL(request.url).pathname === "/api/hang"
            ? new Promise<Response>(() => undefined)
            : new Response("ok"),
      };
    },
  },
});

function holdClose() {
  const held = Promise.withResolvers<void>();
  const binding = capsule({
    label: "test.holdClose",
    hooks: {
      async close({ next }) {
        await held.promise;
        return next();
      },
    },
  });

  return { binding: binding(), release: () => held.resolve() };
}

async function doorOnly(doorGrace: number, hold = holdClose()) {
  const inner = hangs();
  const door = accessDoor({ inner, grace: doorGrace });
  const root = createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      serve({ port: 0, websocket: door }),
      hold.binding,
      door,
      inner,
    ],
  });
  const live = await root.ready;
  const url = live.resolve(serve.url).get() ?? new URL("http://localhost:0");
  closers.push(() => (hold.release(), live.close()));

  return { url, live, hold };
}

test("a request that never answers is cut once the grace runs out, and the root closes", async () => {
  const app = await doorOnly(300);
  app.hold.release();
  const hung = fetch(new URL("/api/hang", app.url)).then(
    () => "answered",
    () => "cut",
  );
  await tick(100);

  expect(await within(app.live.close(), 3000)).toBe("closed");
  expect(await hung).toBe("cut");
});

test("a stopping door takes no new work: a request in the drain is refused 503", async () => {
  const app = await doorOnly(5000);
  expect((await fetch(new URL("/api/ok", app.url))).status).toBe(200);

  const closing = app.live.close();
  await tick(50);
  expect((await fetch(new URL("/api/ok", app.url))).status).toBe(503);

  app.hold.release();
  expect(await within(closing, 3000)).toBe("closed");
});
