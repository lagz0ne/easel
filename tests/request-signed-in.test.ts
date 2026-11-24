import { createHash, randomBytes } from "node:crypto";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { openOps, signInWithLink } from "@/access/browser.server";
import { sessionCookie } from "@/access/contract";
import { byToken, user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { mayName, passOps, shareOps, shareServer } from "@/frames/share.server";
import { framesServer } from "@/frames/store.server";
import { queue } from "@/queue";
import { dispatchServer } from "@/queue/dispatch.server";
import { mayAct } from "@/queue/guards.server";
import { queueOps, requestOps } from "@/queue/ops.server";
import { queueServer } from "@/queue/store.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

async function boot() {
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [
    access.login,
    access.open,
    access.owner,
    frames.api,
    frames.board,
    frames.viewer,
    frames.pass,
    queue.api,
    queue.viewer,
  ];
  const scope = createScope({
    clock: makeTestClock({ now: 1_800_000_000_000 }),
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      shareServer(),
      queueServer({ stdout }),
      access.login({ implement: loginOps }),
      access.open({ implement: openOps, onStart: [user, byToken] }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      frames.viewer({ implement: shareOps }),
      frames.pass({ implement: passOps, onStart: [mayName] }),
      queue.api({ implement: queueOps, onStart: [user] }),
      queue.viewer({ implement: requestOps, onStart: [mayAct] }),
      dispatchServer({ agreement: true }),
      memory.server({ services }),
    ],
  });
  const server = await scope.ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, setupCode };
}

type Srv = Awaited<ReturnType<typeof boot>>;

async function client(server: Scope.Handle, held: { token?: string; cookie?: string } = {}) {
  const meta = operation({
    label: "test.meta",
    run: async (): Promise<Record<string, string>> =>
      held.token ? { authorization: `Bearer ${held.token}` } : {},
  });
  const headers: Record<string, string> = { "x-easel-peer": "198.51.100.1" };
  if (held.cookie) headers.cookie = held.cookie;
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: server, headers, meta }),
      access.login({ remote: memory.client }),
      access.open({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      frames.board({ read: memory.client }),
      frames.pass({ remote: memory.client }),
      queue.api({ remote: memory.client }),
      queue.viewer({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return {
    scope,
    add: (frameId: string, text = "Make the dock smaller.") =>
      scope.run(queue.viewer["request.add"], {
        input: { canvas: "flow", frameId, version: 1, x: 4, y: 6, text, key: newKey() },
      }),
    edit: (n: number, text: string) =>
      scope.run(queue.viewer["request.edit"], { input: { canvas: "flow", n, text } }),
    note: (n: number, text: string) =>
      scope.run(queue.viewer["request.note"], { input: { canvas: "flow", n, text } }),
    close: (n: number) =>
      scope.run(queue.viewer["request.close"], { input: { canvas: "flow", n } }),
    next: () => scope.run(queue.api["request.next"], { input: { canvas: "flow" } }),
    name: (name: string) =>
      scope.run(frames.pass["share.name"], { input: { canvas: "flow", name } }),
    where: (id: string) => scope.run(frames.pass["share.frame"], { input: { canvas: "flow", id } }),
  };
}

let keys = 0;
const newKey = () => `signed-${String(++keys).padStart(12, "0")}`;

function token() {
  const text = randomBytes(32).toString("base64url");
  return { text, digest: createHash("sha256").update(text).digest("hex") };
}

async function cliUser(srv: Srv, name: string, owner?: Awaited<ReturnType<typeof client>>) {
  const t = token();
  const anon = await client(srv.server);
  if (owner === undefined) {
    const made = await anon.scope.run(access.login["login.setup"], {
      input: { name, code: srv.setupCode(), digest: t.digest },
    });
    expect(made.kind).toBe("granted");
    return client(srv.server, { token: t.text });
  }

  const started = await anon.scope.run(access.login["login.start"], {
    input: { name, digest: t.digest },
  });
  if (started.kind !== "pending") throw new Error(started.kind);
  await owner.scope.run(access.owner["users.approve"], { input: { code: started.code } });
  const waited = await anon.scope.run(access.login["login.wait"], {
    input: { request: started.request },
  });
  expect(waited.kind).toBe("granted");
  return client(srv.server, { token: t.text });
}

async function browserOf(srv: Srv, cli: Awaited<ReturnType<typeof client>>) {
  const made = await cli.scope.run(access.open["browser.link"], { input: null });
  const body = new URLSearchParams({ link: made.link }).toString();
  const request = new Request(`${origin}/auth/open`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/x-www-form-urlencoded",
      "content-length": String(body.length),
    },
    body,
  });
  const session = srv.server.createSession({ tags: [transport.request(request)] });
  const reply = await session.run(signInWithLink).finally(() => session.close());
  if (!(reply instanceof Response)) throw new Error("not a response");
  const secret = new RegExp(`^${sessionCookie}=([0-9a-f]{64});`).exec(
    reply.headers.get("set-cookie") ?? "",
  )?.[1];
  if (!secret) throw new Error("no cookie");

  return client(srv.server, { cookie: `${sessionCookie}=${secret}` });
}

async function flowWithFrame(srv: Srv) {
  const ann = await cliUser(srv, "ann");
  await ann.scope.run(frames.api["canvas.create"], { input: { name: "flow" } });
  const put = await ann.scope.run(frames.api["frame.put"], {
    input: { canvas: "flow", html: "<p>1</p>", name: "One" },
  });
  if (put.kind !== "created") throw new Error(put.kind);

  return { ann, id: put.id };
}

function rowsOf(srv: Srv) {
  const list = srv.server.resolve(frames.board.requests.where({ canvas: "flow" }));
  return list.get().map((r) => ({ n: r.n, author: r.author }));
}

function thread(srv: Srv) {
  const list = srv.server.resolve(frames.board.messages.where({ canvas: "flow" }));
  return list.get().map((m) => ({ kind: m.kind, from: m.from, text: m.text }));
}

const faultOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: unknown) =>
      frames.pass.fault.is(error) || queue.viewer.fault.is(error)
        ? { fault: error.fault, payload: error.payload }
        : { fault: "other", payload: String(error) },
  );

test("on /c/<canvas>, the browser of the owner adds a request with no pass and no name: the owner's name is its author, it is agreed at add, and easel next gives it to an agent (H-4, ARequestOfThePersonIsAgreed)", async () => {
  const srv = await boot();
  const { ann, id } = await flowWithFrame(srv);
  const browser = await browserOf(srv, ann);

  expect(await browser.add(id)).toEqual({ kind: "added", n: 1 });

  expect(rowsOf(srv)).toEqual([{ n: 1, author: "ann" }]);
  const claimed = await ann.next();
  expect(claimed.kind).toBe("claimed");
});

test("on /c/<canvas>, the browser of a member adds a request with the member's name as its author; it waits for the owner, so easel next gives nothing", async () => {
  const srv = await boot();
  const { ann, id } = await flowWithFrame(srv);
  const cy = await cliUser(srv, "cy", ann);
  const browser = await browserOf(srv, cy);

  expect(await browser.add(id)).toEqual({ kind: "added", n: 1 });

  expect(rowsOf(srv)).toEqual([{ n: 1, author: "cy" }]);
  expect(await ann.next()).toEqual({ kind: "empty" });
});

test("on /c/<canvas>, the browser of the owner corrects, notes and closes its request as the owner, with no name step", async () => {
  const srv = await boot();
  const { ann, id } = await flowWithFrame(srv);
  const browser = await browserOf(srv, ann);
  expect((await browser.add(id, "Make the dock smaller.")).kind).toBe("added");

  expect(await browser.edit(1, "Make the dock half as tall.")).toEqual({ kind: "edited" });
  expect(await browser.note(1, "Keep the icons.")).toEqual({ kind: "noted" });
  expect(await browser.close(1)).toEqual({ kind: "closed" });

  expect(thread(srv).map((m) => m.from)).toEqual(["ann", "ann", "ann", "ann"]);
});

test("share.name and share.frame take a browser with a session and no pass: share.name answers the user's name, share.frame the page of the frame; with no session and no pass, both are refused signIn", async () => {
  const srv = await boot();
  const { ann, id } = await flowWithFrame(srv);
  const browser = await browserOf(srv, ann);
  const nobody = await client(srv.server);

  expect(await browser.name("Mai")).toEqual({ kind: "named", name: "ann" });
  expect(await browser.where(id)).toEqual({ kind: "found", page: "page-1" });
  expect(await faultOf(nobody.name("Mai"))).toEqual({
    fault: "refused",
    payload: { signIn: true },
  });
  expect(await faultOf(nobody.where(id))).toEqual({
    fault: "refused",
    payload: { signIn: true },
  });
});
