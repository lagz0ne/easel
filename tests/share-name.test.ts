import { createHash, randomBytes } from "node:crypto";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { mayName, passOps, shareOps, shareServer } from "@/frames/share.server";
import { framesServer } from "@/frames/store.server";
import { queue } from "@/queue";
import { mayAct } from "@/queue/guards.server";
import { requestOps } from "@/queue/ops.server";
import { queueServer } from "@/queue/store.server";

// `share.name` (SPEC-frames § Contract; SPEC-viewer § Open the link): the viewer gives a name at
// the first request, not at the link. The page holds a live pass and no password, so it does not
// open the link again: it sets the name on the pass it holds. The pass is the proof (`mayName`,
// as `mayRead` judges a pass). A pass takes a name once: a later name does not replace it, and
// the call answers the name the pass holds.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/** One server as cmds/server.ts wires frames, share, the pass's name and the queue. */
async function boot() {
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [
    access.login,
    frames.api,
    frames.board,
    frames.viewer,
    frames.pass,
    queue.viewer,
  ];
  const scope = createScope({
    clock: makeTestClock({ now: 1_800_000_000_000 }),
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
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
      frames.pass({ implement: passOps, onStart: [mayName] }),
      queue.viewer({ implement: requestOps, onStart: [mayAct] }),
      memory.server({ services }),
    ],
  });
  const server = await scope.ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, setupCode };
}

/** A client: a user with a token, or a viewer's tab whose meta carries `held.pass`. */
async function client(server: Scope.Handle, held: { token?: string; pass?: string } = {}) {
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
      memory.client({ peer: server, headers: { "x-easel-peer": "198.51.100.1" }, meta }),
      access.login({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      frames.board({ read: memory.client }),
      frames.viewer({ remote: memory.client }),
      frames.pass({ remote: memory.client }),
      queue.viewer({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return {
    scope,
    held,
    name: (name: string, canvas = "flow") =>
      scope.run(frames.pass["share.name"], { input: { canvas, name } }),
    add: (key: string) =>
      scope.run(queue.viewer["request.add"], {
        input: {
          canvas: "flow",
          frameId: null,
          version: null,
          x: 1,
          y: 2,
          text: "Add a FAQ.",
          key,
        },
      }),
  };
}

/** Canvas `flow`, shared (with `password`, if one): Ann's client and the link. */
async function sharedFlow(srv: Awaited<ReturnType<typeof boot>>, password?: string) {
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await client(srv.server);
  await login.scope.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  const a = await client(srv.server, { token: text });
  await a.scope.run(frames.api["canvas.create"], { input: { name: "flow" } });
  await a.scope.run(frames.api["canvas.create"], { input: { name: "other" } });
  const shared = await a.scope.run(frames.api["canvas.share"], {
    input: password === undefined ? { canvas: "flow" } : { canvas: "flow", password },
  });
  if (shared.kind !== "shared") throw new Error(shared.kind);

  return { a, link: shared.path.slice("/s/".length) };
}

/** A viewer's tab that opened `link` (with `password`, if one) and holds its pass. */
async function tab(srv: Awaited<ReturnType<typeof boot>>, link: string, password?: string) {
  const t = await client(srv.server);
  const opened = await t.scope.run(frames.viewer["share.open"], {
    input: password === undefined ? { link } : { link, password },
  });
  if (opened.kind !== "open") throw new Error(opened.kind);
  t.held.pass = opened.pass;
  return t;
}

/** The fault a call ended in, and its payload; null when it answered. */
const faultOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: unknown) =>
      frames.pass.fault.is(error) || queue.viewer.fault.is(error)
        ? { fault: error.fault, payload: error.payload }
        : { fault: "other", payload: String(error) },
  );

test("a pass with no name takes the name, trimmed; then request.add saves the request with that name as its author", async () => {
  const srv = await boot();
  const { link } = await sharedFlow(srv);
  const mai = await tab(srv, link);

  expect(await faultOf(mai.add("k".repeat(16)))).toEqual({
    fault: "refused",
    payload: { name: true },
  });
  expect(await mai.name("  Mai  ")).toEqual({ kind: "named", name: "Mai" });
  expect(await mai.add("k".repeat(16))).toEqual({ kind: "added", n: 1 });

  const rows = srv.server.resolve(frames.board.requests.where({ canvas: "flow" })).get();
  expect(rows.map((r) => r.author)).toEqual(["Mai"]);
});

test("a pass takes a name only once: a later name does not replace it, and the call answers the name the pass holds", async () => {
  const srv = await boot();
  const { link } = await sharedFlow(srv);
  const mai = await tab(srv, link);

  expect(await mai.name("Mai")).toEqual({ kind: "named", name: "Mai" });
  expect(await mai.name("Tom")).toEqual({ kind: "named", name: "Mai" });

  // A pass that opened with the name this browser kept holds it too.
  const kept = await client(srv.server);
  const opened = await kept.scope.run(frames.viewer["share.open"], { input: { link, name: "Bo" } });
  kept.held.pass = opened.kind === "open" ? opened.pass : "";
  expect(await kept.name("Cy")).toEqual({ kind: "named", name: "Bo" });
});

test("mayName: no pass, a made-up pass, or a pass for another canvas is refused ended; a pass a new password ended is refused locked", async () => {
  const srv = await boot();
  const { a, link } = await sharedFlow(srv, "first password");
  const mai = await tab(srv, link, "first password");
  const forged = await client(srv.server, { pass: "f".repeat(32) });
  const signedIn = await client(srv.server, { token: a.held.token });

  const ended = { fault: "refused", payload: { ended: true } };
  expect(await faultOf(signedIn.name("Ann"))).toEqual(ended);
  expect(await faultOf(forged.name("Mai"))).toEqual(ended);
  expect(await faultOf(mai.name("Mai", "other"))).toEqual(ended);

  await a.scope.run(frames.api["canvas.share"], {
    input: { canvas: "flow", password: "second password" },
  });
  expect(await faultOf(mai.name("Mai"))).toEqual({ fault: "refused", payload: { locked: true } });
});

test("a name is 1 to 40 characters, trimmed; any other stops on the client", async () => {
  const srv = await boot();
  const { link } = await sharedFlow(srv);
  const mai = await tab(srv, link);

  for (const name of ["", "   ", "x".repeat(41)]) {
    const sent = await Promise.try(() => mai.name(name)).then(
      () => "sent",
      (error: unknown) => String(error),
    );
    expect(sent).toContain("DataValidationFailed");
  }
  expect(await mai.name(` ${"x".repeat(40)} `)).toEqual({ kind: "named", name: "x".repeat(40) });
});
