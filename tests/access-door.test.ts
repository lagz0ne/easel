import { createHash, randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";

import { serve } from "@tinkered/bun";
import { ws } from "@tinkered/bun/client";
import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterAll, expect, test } from "vite-plus/test";

import { access } from "@/access";

type Server = typeof import("../cmds/server");

const server: Server = await import(new URL("../cmds/server.ts", import.meta.url).href);

const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });

afterAll(() => collector.stop());

async function run(env: Record<string, string>) {
  const stop = new AbortController();
  const out: string[] = [];
  const codes: unknown[] = [];
  const root = await server.default({
    env: {
      PORT: "0",
      OTEL_SERVICE_NAME: "access-door-test",
      VICTORIA_TRACES_URL: `${collector.url}traces`,
      VICTORIA_LOGS_URL: `${collector.url}logs`,
      ...env,
    },
    args: [],
    cwd: process.cwd(),
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: (code, reason) => (codes.push(code), stop.abort(reason ?? code)),
  });
  if (!("resolve" in root)) throw new Error("the command did not start");
  const url = root.resolve(serve.url).get() ?? new URL("http://localhost:0");
  const close = async () => (stop.abort(), await root.closed);

  return { url, out, codes, close };
}

async function socket(host: string) {
  const ws = new WebSocket(`ws://${host}/rpc`);
  const replies = new Map<number, (text: string) => void>();
  ws.onmessage = (event) => {
    for (const reply of JSON.parse(String(event.data))) replies.get(reply.i)?.(reply.t);
  };
  const opened = await new Promise<boolean>((done) => {
    ws.onopen = () => done(true);
    ws.onerror = () => done(false);
  });
  let next = 0;
  const call = (address: string, input: unknown) =>
    new Promise<{ ok: boolean; kind?: string; value?: { kind: string }; payload?: unknown }>(
      (done) => {
        const i = ++next;
        replies.set(i, (text) => done(JSON.parse(text)));
        ws.send(JSON.stringify([{ i, a: address, t: JSON.stringify(input) }]));
      },
    );

  return { opened, call, close: () => ws.close() };
}

const digest = () => createHash("sha256").update(randomBytes(32)).digest("hex");

test("the door writes the peer itself: a client's own peer header and X-Forwarded-For are not believed", async () => {
  const app = await run({ PUBLIC_ORIGIN: "", EASEL_TRUSTED_PROXIES: "10.0.0.0/8" });
  const plain = await socket(app.url.host);
  for (let i = 0; i < 30; i++) {
    expect((await plain.call("login.wait", { request: "0".repeat(32) })).value?.kind).toBe(
      "expired",
    );
  }
  const headers = { "x-easel-peer": "10.0.0.1", "x-forwarded-for": "192.0.2.77" };
  const forged = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      ws.client({ url: `ws://${app.url.host}/rpc`, headers }),
      access.login({ remote: ws.client }),
    ],
  }).ready;

  expect(
    await forged.run(access.login["login.wait"], { input: { request: "0".repeat(32) } }),
  ).toEqual({
    kind: "slow",
    retryIn: expect.any(Number),
  });
  await forged.close();
  plain.close();
  await app.close();
});

test("the setup code is in the log once, and works over the socket; an invalid fault carries no secret", async () => {
  const app = await run({ PUBLIC_ORIGIN: "" });
  const log = app.out.join("");
  const code = /setup code: (\S+)/.exec(log)?.[1] ?? "";
  const client = await socket(app.url.host);
  const sent = digest();
  const bad = await client.call("login.setup", {
    name: "ann",
    code: "BCDF-GHJ1",
    digest: `${sent.slice(1)}g`,
  });

  expect(log.split(code)).toHaveLength(2);
  expect(log).toContain("no EASEL_DB");
  expect(bad).toMatchObject({ ok: false, kind: "invalid" });
  expect(JSON.stringify(bad)).not.toMatch(/BCDF-GHJ1|BCDFGHJ1/);
  expect(JSON.stringify(bad)).not.toContain(sent.slice(1));
  expect(await client.call("login.setup", { name: "ann", code, digest: sent })).toMatchObject({
    ok: true,
    value: { kind: "granted" },
  });
  client.close();
  await app.close();
});

const outside = Object.values(networkInterfaces())
  .flat()
  .find((net) => net && !net.internal && net.family === "IPv4")?.address;

test("open: a peer on this machine is granted at once, as an owner", async () => {
  const app = await run({ EASEL_AUTH: "open", PUBLIC_ORIGIN: "http://localhost:4318" });
  const client = await socket(`127.0.0.1:${app.url.port}`);

  expect(app.out.join("")).not.toContain("setup code");
  expect(await client.call("login.start", { name: "solo", digest: digest() })).toMatchObject({
    ok: true,
    value: { kind: "granted", user: { name: "solo", role: "owner" } },
  });
  client.close();
  await app.close();
});

test.skipIf(!outside)(
  "open: a peer from another machine is refused every rpc call; health and version stay readable",
  async () => {
    const app = await run({ EASEL_AUTH: "open", PUBLIC_ORIGIN: "http://localhost:4318" });
    const client = await socket(`${outside}:${app.url.port}`);
    const status = async (path: string) =>
      (await fetch(`http://${outside}:${app.url.port}${path}`)).status;

    expect(client.opened).toBe(false);
    expect(await status("/rpc")).toBe(403);
    expect(await status("/rpc/login.start")).toBe(403);
    expect(await status("/api/health")).toBe(200);
    expect(await status("/api/version")).toBe(200);
    await app.close();
  },
);

test("a trusted proxy entry that is not a CIDR stops the start", async () => {
  const failed = await run({ EASEL_TRUSTED_PROXIES: "10.0.0.0/8,10.0.0.0/33" }).then(
    async (app) => (await app.close(), "started"),
    (error: unknown) => String(error),
  );

  expect(failed).toContain("not a CIDR");
});

test("open does not start unless PUBLIC_ORIGIN is loopback", async () => {
  for (const origin of ["", "https://easel.example"]) {
    const failed = await run({ EASEL_AUTH: "open", PUBLIC_ORIGIN: origin }).then(
      async (app) => (await app.close(), "started"),
      (error: unknown) => String(error),
    );
    expect(failed).toContain("MissingConfig");
  }
});
