import { createHash, randomBytes } from "node:crypto";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { access } from "@/access";
import { frames } from "@/frames";
import { frames as frameCells, kept, pages, removed } from "@/frames/contract";
import { canvases } from "@/frames/store.server";
import { kit } from "@/kit/cells";
import { queue } from "@/queue";
import { messages, requests } from "@/queue/cells";

import { githubDouble } from "./support/github";
import {
  ann,
  boot,
  client,
  closers,
  faultOf,
  rounds,
  sharedFlow,
  until,
  viewer,
  watchQueue,
} from "./support/queue";
import type { Client, Server } from "./support/queue";

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const token = `ghp_${randomBytes(18).toString("hex")}`;

const ended = { fault: "refused", payload: { ended: true } };

const rowsOfCanvas = {
  canvases: "SELECT COUNT(*) AS n FROM frames_canvases WHERE key = $canvas",
  frames: "SELECT COUNT(*) AS n FROM frames_frames WHERE canvas = $canvas",
  pages: "SELECT COUNT(*) AS n FROM frames_pages WHERE canvas = $canvas",
  kept: "SELECT COUNT(*) AS n FROM frames_kept WHERE canvas = $canvas",
  removed: "SELECT COUNT(*) AS n FROM frames_removed WHERE canvas = $canvas",
  links: "SELECT COUNT(*) AS n FROM frames_links WHERE canvas = $canvas",
  passes: `SELECT COUNT(*) AS n FROM frames_passes WHERE link NOT IN (SELECT link FROM frames_links)
    OR link IN (SELECT link FROM frames_links WHERE canvas = $canvas)`,
  requests: "SELECT COUNT(*) AS n FROM queue_requests WHERE canvas = $canvas",
  messages: "SELECT COUNT(*) AS n FROM queue_messages WHERE canvas = $canvas",
  deliveries: `SELECT COUNT(*) AS n FROM queue_deliveries WHERE request NOT IN (SELECT id FROM queue_requests)
    OR request IN (SELECT id FROM queue_requests WHERE canvas = $canvas)`,
  keyGeneration: "SELECT COALESCE(MAX(gen), 0) AS n FROM frames_keygen WHERE canvas = $canvas",
};

const countRows = operation({
  label: "test.countRows",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: canvas }) => {
    const db = connection.db.$client;
    const count = (sql: string) =>
      z.object({ n: z.number() }).parse(db.query(sql).get({ $canvas: canvas })).n;
    return Object.fromEntries(
      Object.entries(rowsOfCanvas).map(([name, sql]) => [name, count(sql)]),
    );
  },
});

const countCells = operation({
  label: "test.countCells",
  input: z.string(),
  depends: {
    canvasCells: canvases.atScope.controller,
    frameCells: frameCells.atScope.controller,
    pageCells: pages.atScope.controller,
    keptCells: kept.atScope.controller,
    removedCells: removed.atScope.controller,
    requestCells: requests.atScope.controller,
    messageCells: messages.atScope.controller,
    kitCells: kit.atScope.controller,
  },
  run: (cells, { input: canvas }) => ({
    canvases: cells.canvasCells.of({ key: canvas }).get() === undefined ? 0 : 1,
    frames: cells.frameCells.where({ canvas }).get().length,
    pages: cells.pageCells.where({ canvas }).get().length,
    kept: cells.keptCells.where({ canvas }).get().length,
    removed: cells.removedCells.where({ canvas }).get().length,
    requests: cells.requestCells.where({ canvas }).get().length,
    messages: cells.messageCells.where({ canvas }).get().length,
    kit: cells.kitCells.of({ canvas }).get() === undefined ? 0 : 1,
  }),
});

const deleteCanvas = (by: Client, canvas: string) =>
  by.scope.run(frames.api["canvas.delete"], { input: { canvas } });

async function fullCanvas(srv: Server, a: Client, id: string, link: string) {
  const bo = await viewer(srv, link, "Bo");
  expect((await bo.add("flow", id, "Make the title larger.")).kind).toBe("added");
  srv.clock.advance(10);
  const put = (input: { html: string; name?: string; id?: string; base?: number }) =>
    a.scope.run(frames.api["frame.put"], { input: { canvas: "flow", ...input } });
  expect((await put({ html: "<p>2</p>", id, base: 1 })).kind).toBe("updated");
  const extra = await put({ html: "<p>x</p>", name: "Extra" });
  if (extra.kind !== "created") throw new Error(extra.kind);
  expect(
    await a.scope.run(frames.api["frame.delete"], { input: { canvas: "flow", id: extra.id } }),
  ).toEqual({ kind: "deleted", layout: expect.any(Object) });
  expect(
    (await a.scope.run(frames.api["page.create"], { input: { canvas: "flow", name: "Second" } }))
      .kind,
  ).toBe("created");
  await rounds(srv, 5000);

  return bo;
}

async function otherCanvas(a: Client) {
  await a.scope.run(frames.api["canvas.create"], { input: { name: "other" } });
  const made = await a.scope.run(frames.api["frame.put"], {
    input: { canvas: "other", html: "<p>o</p>", name: "Other" },
  });
  if (made.kind !== "created") throw new Error(made.kind);
  expect((await a.add("other", made.id, "Keep me.")).kind).toBe("added");
}

test("canvas.delete deletes the canvas with its frames, pages, kept versions, removed frames, requests, messages, deliveries, link and passes; a second delete answers gone", async () => {
  const github = githubDouble(token);
  const srv = await boot(":memory:", [], { github: github.fetch });
  const { a, id, link } = await sharedFlow(srv);
  expect(await a.setChannel(token)).toEqual({ kind: "saved" });
  await otherCanvas(a);
  await fullCanvas(srv, a, id, link);
  const before = await srv.server.run(countRows, { input: "flow" });
  const otherBefore = await srv.server.run(countRows, { input: "other" });
  expect(before).toEqual({
    canvases: 1,
    frames: 1,
    pages: 2,
    kept: 1,
    removed: 1,
    links: 1,
    passes: 1,
    requests: 1,
    messages: 1,
    deliveries: 1,
    keyGeneration: 0,
  });

  expect(await deleteCanvas(a, "flow")).toEqual({ kind: "deleted" });

  expect(await srv.server.run(countRows, { input: "flow" })).toEqual({
    canvases: 0,
    frames: 0,
    pages: 0,
    kept: 0,
    removed: 0,
    links: 0,
    passes: 0,
    requests: 0,
    messages: 0,
    deliveries: 0,
    keyGeneration: 1,
  });
  expect(srv.server.run(countCells, { input: "flow" })).toEqual({
    canvases: 0,
    frames: 0,
    pages: 0,
    kept: 0,
    removed: 0,
    requests: 0,
    messages: 0,
    kit: 0,
  });
  expect(await srv.server.run(countRows, { input: "other" })).toEqual(otherBefore);
  expect((await a.scope.run(frames.api["canvas.list"], { input: null })).canvases).toMatchObject([
    { key: "other" },
  ]);
  expect(await deleteCanvas(a, "flow")).toEqual({ kind: "gone" });
});

test("a new canvas with the key of a deleted one starts empty: one page, no frame, no request, not shared", async () => {
  const srv = await boot();
  const { a, id, link } = await sharedFlow(srv);
  await fullCanvas(srv, a, id, link);

  expect(await deleteCanvas(a, "flow")).toEqual({ kind: "deleted" });
  expect(await a.scope.run(frames.api["canvas.create"], { input: { name: "flow" } })).toEqual({
    kind: "created",
    key: "flow",
  });

  expect(await a.scope.run(frames.api["frame.list"], { input: { canvas: "flow" } })).toEqual({
    kind: "found",
    rev: 0,
    frames: [],
  });
  expect(await a.scope.run(frames.api["page.list"], { input: { canvas: "flow" } })).toEqual({
    kind: "found",
    pages: [{ key: "page-1", name: "Page 1", frames: 0 }],
  });
  expect(await a.list({ canvas: "flow" })).toMatchObject({ requests: [] });
  expect((await a.scope.run(frames.api["canvas.list"], { input: null })).canvases).toMatchObject([
    { key: "flow", shared: false },
  ]);
});

test("a canvas delete sends the refusal to each live watch of each pass before it answers; the pass and the link are refused after (EndPushedAtOnce)", async () => {
  const srv = await boot();
  const { a, link } = await sharedFlow(srv);
  const tab = await viewer(srv, link, "Bo");
  const list = tab.scope.resolve(frames.board.frames.where({ canvas: "flow" }));
  closers.push(list.watch(() => undefined));
  const queueRead = watchQueue(tab);
  await until(() => list.get().length === 1);
  const fault = (part: "frames" | "requests") => {
    const error = tab.scope.resolve(frames.board.faults).get()[part];
    return frames.board.fault.is(error) ? { fault: error.fault, payload: error.payload } : null;
  };
  expect(fault("frames")).toBeNull();
  expect(queueRead.requests()).toEqual([]);

  expect(await deleteCanvas(a, "flow")).toEqual({ kind: "deleted" });
  await until(() => fault("frames") !== null && fault("requests") !== null);
  expect(fault("frames")).toEqual(ended);
  expect(fault("requests")).toEqual(ended);

  expect(
    await faultOf(
      tab.scope.run(queue.viewer["request.add"], {
        input: {
          canvas: "flow",
          frameId: null,
          version: null,
          x: 1,
          y: 1,
          text: "Still here?",
          key: "key-after-delete",
        },
      }),
    ),
  ).toEqual(ended);
  const late = await client(srv.server);
  expect(await late.scope.run(frames.viewer["share.open"], { input: { link } })).toEqual({
    kind: "gone",
  });
});

test("a member deletes a canvas; a guest is refused, sign in, and the canvas stays", async () => {
  const srv = await boot();
  const owner = await ann(srv);
  await owner.scope.run(frames.api["canvas.create"], { input: { name: "flow" } });
  await owner.scope.run(frames.api["canvas.create"], { input: { name: "other" } });
  const guest = await client(srv.server, {}, "198.51.100.3");

  const refused = await deleteCanvas(guest, "flow").then(
    () => null,
    (error: unknown) => (frames.api.fault.is(error) ? [error.fault, error.payload] : error),
  );
  expect(refused).toEqual(["refused", { signIn: true }]);
  const bob = await member(srv, owner);
  expect(await deleteCanvas(bob, "flow")).toEqual({ kind: "deleted" });
  expect(
    (await owner.scope.run(frames.api["canvas.list"], { input: null })).canvases,
  ).toMatchObject([{ key: "other" }]);
});

async function member(srv: Server, owner: Client) {
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const bob = await client(srv.server, {}, "198.51.100.2");
  const started = await bob.scope.run(access.login["login.start"], {
    input: { name: "bob", digest },
  });
  if (started.kind !== "pending") throw new Error(started.kind);
  await owner.scope.run(access.owner["users.approve"], { input: { code: started.code } });
  const waited = await bob.scope.run(access.login["login.wait"], {
    input: { request: started.request },
  });
  expect(waited.kind).toBe("granted");
  bob.held.token = text;

  return bob;
}
