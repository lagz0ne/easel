import { createHash, randomBytes } from "node:crypto";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Capsule, Observe, Scope, Tag } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import type { preset } from "@tinkered/core/testing";
import { expect } from "vite-plus/test";
import { z } from "zod";

import { access } from "@/access";
import { owner, user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { shareOps, shareServer } from "@/frames/share.server";
import { framesServer } from "@/frames/store.server";
import { queue } from "@/queue";
import { channelOps } from "@/queue/channels.server";
import { dispatchServer, dispatchState } from "@/queue/dispatch.server";
import { mayAct } from "@/queue/guards.server";
import { queueOps, requestOps } from "@/queue/ops.server";
import type { reportInput } from "@/queue/starts";
import { startsOps } from "@/queue/starts.server";
import { queueServer } from "@/queue/store.server";

export const closers: Array<() => unknown> = [];

export const tick = (ms = 30) => new Promise((done) => setTimeout(done, ms));

export async function until(ok: () => boolean) {
  for (let i = 0; i < 50 && !ok(); i++) await tick(20);
  expect(ok()).toBe(true);
}

export const start = 1_800_000_000_000;

export const natsChannel = operation({
  label: "test.natsChannel",
  input: z.array(z.string()),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: canvases }) =>
    connection.db.$client
      .query(
        `INSERT INTO queue_channels (name, kind, repo, label, trigger, token, url, subject, inbox,
           canvases, created)
         VALUES ('loop', 'nats', '', '', '', 'seed', 'nats://127.0.0.1:1', 'easel.requests',
           '_INBOX', $canvases, 0)`,
      )
      .run({ $canvases: JSON.stringify(canvases) }).changes,
});

export async function boot(
  file = ":memory:",
  presets: Array<ReturnType<typeof preset>> = [],
  more: {
    github?: (request: Request) => Promise<Response>;
    observe?: Observe.Config;
    extra?: readonly Capsule.Installable[];
    agreement?: boolean;
    tags?: Tag.Bindings;
  } = {},
) {
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [
    access.login,
    access.owner,
    frames.api,
    frames.board,
    frames.viewer,
    queue.api,
    queue.viewer,
    queue.channels,
    queue.starts,
  ];
  const clock = makeTestClock({ now: start });
  const scope = createScope({
    clock,
    presets,
    tags: more.tags,
    ...(more.observe ? { observe: more.observe } : {}),
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      shareServer(),
      queueServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      frames.viewer({ implement: shareOps }),
      queue.api({ implement: queueOps, onStart: [user] }),
      queue.viewer({ implement: requestOps, onStart: [mayAct] }),
      dispatchServer({
        ...(more.github ? { fetch: more.github, base: "https://github.test" } : {}),
        agreement: more.agreement ?? false,
      }),
      queue.channels({ implement: channelOps, onStart: [user, owner] }),
      queue.starts({ implement: startsOps, onStart: [user] }),
      memory.server({ services }),
      ...(more.extra ?? []),
    ],
  });
  const server = await scope.ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, clock, setupCode, out };
}

export type Server = Awaited<ReturnType<typeof boot>>;

let keys = 0;
export const newKey = () => `key-${String(++keys).padStart(12, "0")}`;

export async function client(
  server: Scope.Handle,
  held: { token?: string; pass?: string } = {},
  peer = "198.51.100.1",
) {
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
      memory.client({ peer: server, headers: { "x-easel-peer": peer }, meta }),
      access.login({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      frames.board({ read: memory.client }),
      frames.viewer({ remote: memory.client }),
      queue.api({ remote: memory.client }),
      queue.viewer({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      queue.channels({ remote: memory.client }),
      queue.starts({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());
  const api = queue.api;

  return {
    scope,
    held,
    add: (
      canvas: string,
      frameId: string | null,
      text = "Move the button up.",
      key = newKey(),
      version = 1,
    ) =>
      scope.run(queue.viewer["request.add"], {
        input:
          frameId === null
            ? { canvas, frameId: null, version: null, x: 40, y: 60, text, key }
            : { canvas, frameId, version, x: 40, y: 60, text, key },
      }),
    edit: (canvas: string, n: number, text = "Move it to the left.") =>
      scope.run(queue.viewer["request.edit"], { input: { canvas, n, text } }),
    note: (canvas: string, n: number, text = "Also the footer.") =>
      scope.run(queue.viewer["request.note"], { input: { canvas, n, text } }),
    answer: (canvas: string, n: number, text = "Navy.", option?: number) =>
      scope.run(queue.viewer["request.answer"], {
        input: option === undefined ? { canvas, n, text } : { canvas, n, text, option },
      }),
    accept: (canvas: string, n: number) =>
      scope.run(queue.viewer["request.accept"], { input: { canvas, n } }),
    reopen: (canvas: string, n: number, text = "Still too low.") =>
      scope.run(queue.viewer["request.reopen"], { input: { canvas, n, text } }),
    close: (canvas: string, n: number, text?: string) =>
      scope.run(queue.viewer["request.close"], {
        input: text === undefined ? { canvas, n } : { canvas, n, text },
      }),
    list: (input: { canvas?: string; state?: "waiting" | "person" | "inWork" } = {}) =>
      scope.run(api["request.list"], { input }),
    next: (input: { canvas?: string; n?: number; lease?: number; wait?: number } = {}) =>
      scope.run(api["request.next"], { input }),
    extend: (claim: string, lease?: number) =>
      scope.run(api["request.extend"], {
        input: lease === undefined ? { claim } : { claim, lease },
      }),
    release: (claim: string, reason = "The network dropped.") =>
      scope.run(api["request.release"], { input: { claim, reason } }),
    decline: (claim: string, reason = "No form here.") =>
      scope.run(api["request.decline"], { input: { claim, reason } }),
    ask: (claim: string, text = "Which blue?", more: { html?: string; options?: string[] } = {}) =>
      scope.run(api["request.ask"], { input: { claim, text, ...more } }),
    resolve: (claim: string, text = "Moved the button up.", html?: string, build?: number) =>
      scope.run(api["request.resolve"], {
        input: {
          claim,
          text,
          ...(html === undefined ? {} : { html }),
          ...(build === undefined ? {} : { build }),
        },
      }),
    deliveries: (canvas: string, n: number) =>
      scope.run(api["request.deliveries"], { input: { canvas, n } }),
    setChannel: (
      token: string,
      more: { name?: string; repo?: string; label?: string; trigger?: string } = {},
    ) =>
      scope.run(queue.channels["channel.set"], {
        input: { name: "gh", kind: "github", repo: "acme/design", label: "easel", ...more, token },
      }),
    channels: () => scope.run(queue.channels["channel.list"], { input: {} }),
    removeChannel: (name = "gh") =>
      scope.run(queue.channels["channel.remove"], { input: { name } }),
    agree: (canvas: string, n: number) =>
      scope.run(queue.starts["request.agree"], { input: { canvas, n } }),
    limits: (input: { name: string; running?: number; perDay?: number }) =>
      scope.run(queue.starts["channel.limits"], { input }),
    report: (input: z.input<typeof reportInput>) =>
      scope.run(queue.starts["channel.report"], { input }),
  };
}

export type Client = Awaited<ReturnType<typeof client>>;

export async function ann(srv: Server) {
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await client(srv.server);
  const answer = await login.scope.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  expect(answer.kind).toBe("granted");
  await login.scope.close();

  return client(srv.server, { token: text });
}

export const twin = (srv: Server, of: Client) => client(srv.server, { token: of.held.token });

export async function sharedFlow(srv: Server, password?: string) {
  const a = await ann(srv);
  await a.scope.run(frames.api["canvas.create"], { input: { name: "flow" } });
  const made = await a.scope.run(frames.api["frame.put"], {
    input: { canvas: "flow", html: "<p>1</p>", name: "Home" },
  });
  if (made.kind !== "created") throw new Error(made.kind);
  const shared = await a.scope.run(frames.api["canvas.share"], {
    input: password === undefined ? { canvas: "flow" } : { canvas: "flow", password },
  });
  if (shared.kind !== "shared") throw new Error(shared.kind);

  return { a, id: made.id, link: shared.path.slice("/s/".length) };
}

export async function viewer(srv: Server, link: string, name?: string, peer?: string) {
  const tab = await client(srv.server, {}, peer);
  const opened = await tab.scope.run(frames.viewer["share.open"], {
    input: name === undefined ? { link } : { link, name },
  });
  if (opened.kind !== "open") throw new Error(opened.kind);
  tab.held.pass = opened.pass;
  return tab;
}

export function watchQueue(tab: Client, canvas = "flow") {
  const list = tab.scope.resolve(frames.board.requests.where({ canvas }));
  const thread = tab.scope.resolve(frames.board.messages.where({ canvas }));
  closers.push(
    list.watch(() => undefined),
    thread.watch(() => undefined),
  );
  return { requests: () => list.get(), messages: () => thread.get() };
}

export const faultOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: unknown) =>
      queue.viewer.fault.is(error) ||
      queue.api.fault.is(error) ||
      queue.channels.fault.is(error) ||
      queue.starts.fault.is(error)
        ? { fault: error.fault, payload: error.payload }
        : { fault: "other", payload: String(error) },
  );

export const claimOf = (answer: { kind: string; claim?: string }) => {
  if (answer.kind !== "claimed" || answer.claim === undefined) throw new Error(answer.kind);
  return answer.claim;
};

export async function rounds(srv: Server, ms: number, step = 1000) {
  for (let moved = 0; moved < ms; moved += step) {
    const before = srv.server.run(dispatchState);
    srv.clock.advance(Math.min(step, ms - moved));
    for (let i = 0; i < 100; i++) {
      const now = srv.server.run(dispatchState);
      if (now.rounds > before.rounds && now.busy === 0) break;
      await tick(5);
    }
  }
}
