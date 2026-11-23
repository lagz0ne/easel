import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vite-plus/test";

import { frames } from "@/frames";
import { queue } from "@/queue";

import {
  boot,
  claimOf,
  client,
  closers,
  newKey,
  sharedFlow,
  until,
  viewer,
  watchQueue,
} from "./support/queue";

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const onCanvas = (page?: string) => ({
  canvas: "flow",
  frameId: null,
  version: null,
  x: 10,
  y: 20,
  text: "Add a note here.",
  key: newKey(),
  ...(page === undefined ? {} : { page }),
});

test("a request with no frame keeps the page of the tab; with no page it is on the first page; a page not there is gone; a request on a frame has no page of its own", async () => {
  const srv = await boot();
  const { a, id, link } = await sharedFlow(srv);
  await a.scope.run(frames.api["page.create"], { input: { canvas: "flow", name: "Two" } });
  const bo = await viewer(srv, link, "Bo");
  const add = (input: ReturnType<typeof onCanvas>) =>
    bo.scope.run(queue.viewer["request.add"], { input });

  expect(await add(onCanvas("two"))).toEqual({ kind: "added", n: 1 });
  expect(await add(onCanvas())).toEqual({ kind: "added", n: 2 });
  expect(await add(onCanvas("nope"))).toEqual({ kind: "gone" });
  expect(await bo.add("flow", id)).toEqual({ kind: "added", n: 3 });

  const seen = watchQueue(bo);
  await until(() => seen.requests().length === 3);
  const pages = seen
    .requests()
    .toSorted((x, y) => x.n - y.n)
    .map((r) => r.page);
  expect(pages).toEqual(["two", "page-1", null]);
});

test("request.next of a request with no frame gives the frames of its page only", async () => {
  const srv = await boot();
  const { a, link } = await sharedFlow(srv);
  await a.scope.run(frames.api["page.create"], { input: { canvas: "flow", name: "Two" } });
  const there = await a.scope.run(frames.api["frame.put"], {
    input: { canvas: "flow", html: "<p>2</p>", name: "Second", page: "two" },
  });
  const bo = await viewer(srv, link, "Bo");
  await bo.scope.run(queue.viewer["request.add"], { input: onCanvas("two") });

  const claimed = await a.next({ canvas: "flow" });
  claimOf(claimed);
  expect(claimed).toMatchObject({ kind: "claimed", request: { page: "two", frameId: null } });
  expect(claimed.kind === "claimed" && claimed.frames?.map((f) => f.name)).toEqual(["Second"]);
  expect(there.kind).toBe("created");
});

test("a move of a frame keeps its request on it: the same frame, the same version, and the frame is not changed since the ask", async () => {
  const srv = await boot();
  const { a, id, link } = await sharedFlow(srv);
  await a.scope.run(frames.api["page.create"], { input: { canvas: "flow", name: "Two" } });
  const bo = await viewer(srv, link, "Bo");
  await bo.add("flow", id);

  expect(
    await a.scope.run(frames.api["frame.move"], {
      input: { canvas: "flow", id, x: 900, y: 40, page: "two" },
    }),
  ).toEqual({ kind: "moved" });
  const claimed = await a.next({ canvas: "flow" });
  expect(claimed).toMatchObject({
    kind: "claimed",
    request: { frameId: id, version: 1, page: null },
    frame: { id, page: "two", x: 900, y: 40, version: 1 },
  });
});

test("a request with no frame made before pages is on the first page after a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-queue-pages-"));
  const file = join(dir, "easel.db");
  const first = await boot(file);
  const { a: owner, link } = await sharedFlow(first);
  const bo = await viewer(first, link, "Bo");
  await bo.scope.run(queue.viewer["request.add"], { input: onCanvas() });
  for (const close of closers.splice(0).reverse()) await close();

  const db = new Database(file);
  db.exec("ALTER TABLE queue_requests DROP COLUMN page");
  db.close();

  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const again = await boot(file);
  const a = await client(again.server, { token: owner.held.token });
  const listed = await a.list({ canvas: "flow" });
  expect(listed).toMatchObject({ requests: [{ frameId: null, page: "page-1" }] });
}, 60_000);
