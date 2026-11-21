import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { operation } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { frames } from "@/frames";
import { queue } from "@/queue";
import { requests } from "@/queue/cells";
import { maxOpen } from "@/queue/contract";
import { perAddress, perPass } from "@/queue/ops.server";

import {
  boot,
  client,
  closers,
  faultOf,
  newKey,
  sharedFlow,
  start,
  tick,
  until,
  viewer,
  watchQueue,
} from "./support/queue";

// request.add, request.list and the board cells, over the memory transport (SPEC-queue.md § A
// viewer asks for a change; judged rules 2, 5, 13, 14, 16; fact rules 1, 2). Each test that
// follows a rule of a chart names it: queue-lease (docs/statecharts/queue-lease.md), request-life,
// and viewer-pin-post for the order of the answers of a send.

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

// ---- A viewer asks (queue-lease "a viewer posts it"; request-life "a viewer asks")

test("a viewer posts it: added with n 1; it is open, with no claim and tries 0, its first message the ask, and every tab shows it with the viewer's name within 1 s (AnUnclaimedRequestHasNoClaim)", async () => {
  const srv = await boot();
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  const other = await viewer(srv, link, "Cy", "198.51.100.2");
  const seen = [watchQueue(bo), watchQueue(other), watchQueue(a)];
  await tick();

  srv.clock.advance(5_000);
  expect(await bo.add("flow", id, "Move the button up.")).toEqual({ kind: "added", n: 1 });

  for (const tab of seen) await until(() => tab.requests().length === 1);
  const [made] = seen[1]?.requests() ?? [];
  expect(made).toMatchObject({
    canvas: "flow",
    n: 1,
    frameId: id,
    version: 1,
    x: 40,
    y: 60,
    author: "Bo",
    status: "open",
    claimedBy: null,
    claimedUntil: null,
    claimedAt: null,
    tries: 0,
    acceptedBy: null,
    queuedAt: start + 5_000,
    created: start + 5_000,
    updated: start + 5_000,
  });
  await until(() => seen[1]?.messages().length === 1);
  expect(seen[1]?.messages()[0]).toMatchObject({
    request: made?.id,
    kind: "ask",
    from: "Bo",
    text: "Move the button up.",
    html: null,
    options: null,
    created: start + 5_000,
  });
});

test("n is one more than the highest n of the canvas, and two viewers who send at once never get the same n", async () => {
  const srv = await boot();
  const { id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  const cy = await viewer(srv, link, "Cy", "198.51.100.2");

  const answers = await Promise.all([
    ...Array.from({ length: 5 }, () => bo.add("flow", id)),
    ...Array.from({ length: 5 }, () => cy.add("flow", null)),
  ]);
  const ns = answers.map((answer) => (answer.kind === "added" ? answer.n : 0));
  expect(ns.toSorted((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("the same key again answers added with the same n and saves nothing: one request, one ask (judged rule 13, OneSendOneRequest)", async () => {
  const srv = await boot();
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  const seen = watchQueue(a);
  const key = newKey();

  expect(await bo.add("flow", id, "Move it.", key)).toEqual({ kind: "added", n: 1 });
  const again = await Promise.all([1, 2, 3].map(() => bo.add("flow", id, "Move it.", key)));
  expect(again).toEqual([1, 2, 3].map(() => ({ kind: "added", n: 1 })));
  // The same key on another canvas is another request.
  await a.scope.run(frames.api["canvas.create"], { input: { name: "other" } });
  expect(await a.add("other", null, "Here.", key)).toEqual({ kind: "added", n: 1 });

  await until(() => seen.requests().length === 1 && seen.messages().length === 1);
  const listed = await a.list();
  expect(listed.requests).toHaveLength(2);
});

test("a key the server has seen answers added before it looks at the frame or the limits: a resend after the frame was removed, or past the limit, is added (viewer-pin-post)", async () => {
  const srv = await boot();
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  const key = newKey();
  expect(await bo.add("flow", id, "Move it.", key)).toEqual({ kind: "added", n: 1 });

  await a.scope.run(frames.api["frame.delete"], { input: { canvas: "flow", id } });
  expect(await bo.add("flow", id, "Move it.", key)).toEqual({ kind: "added", n: 1 });
  for (let i = 1; i < perPass; i++) await bo.add("flow", null);
  expect((await bo.add("flow", null)).kind).toBe("slow");
  expect(await bo.add("flow", id, "Move it.", key)).toEqual({ kind: "added", n: 1 });
});

test("a frame removed in the meantime answers gone, and nothing is saved (GoneSendsNothing); a canvas that is not there answers gone", async () => {
  const srv = await boot();
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  await a.scope.run(frames.api["frame.delete"], { input: { canvas: "flow", id } });

  expect(await bo.add("flow", id)).toEqual({ kind: "gone" });
  expect(await a.add("nowhere", null)).toEqual({ kind: "gone" });
  expect(await a.add("flow", "0123456789ab")).toEqual({ kind: "gone" });
  expect((await a.list()).requests).toEqual([]);
  // A request on the canvas needs no frame.
  expect(await bo.add("flow", null)).toEqual({ kind: "added", n: 1 });
});

test(
  `a canvas with ${maxOpen} requests that are not resolved and not closed answers full, and nothing is saved (judged rule 14)`,
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const { a, id } = await sharedFlow(srv);

    // A user's calls count under the name. Fill the canvas within its limits: the clock moves a
    // minute before each 10th.
    for (let i = 1; i <= maxOpen; i++) {
      if (i % perPass === 0) srv.clock.advance(60_000);
      expect(await a.add("flow", id, `Request ${i}.`)).toEqual({ kind: "added", n: i });
    }

    srv.clock.advance(60_000);
    expect(await a.add("flow", id)).toEqual({ kind: "full" });
    expect(await a.add("flow", null)).toEqual({ kind: "full" });
    expect((await a.list({ canvas: "flow" })).requests).toHaveLength(maxOpen);
  },
);

test(`past ${perPass} calls a minute for one pass, or ${perAddress} for one client address, the answer is slow with retryIn, and nothing is saved (judged rule 14)`, async () => {
  const srv = await boot();
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo", "203.0.113.1");

  for (let i = 1; i <= perPass; i++) expect((await bo.add("flow", id)).kind).toBe("added");
  srv.clock.advance(1_000);
  expect(await bo.add("flow", id)).toEqual({ kind: "slow", retryIn: 59_000 });
  // Another pass from another address is not slowed by Bo.
  const cy = await viewer(srv, link, "Cy", "203.0.113.2");
  expect((await cy.add("flow", id)).kind).toBe("added");
  srv.clock.advance(59_000);
  expect((await bo.add("flow", id)).kind).toBe("added");

  // Many passes behind one address: 30 calls a minute in all.
  srv.clock.advance(60_000);
  const crowd = await Promise.all(
    [1, 2, 3, 4].map((i) => viewer(srv, link, `Viewer${i}`, "203.0.113.9")),
  );
  const answers = [];
  for (const tab of crowd) {
    for (let i = 0; i < 8; i++) answers.push((await tab.add("flow", null)).kind);
  }
  expect(answers.filter((kind) => kind === "added")).toHaveLength(perAddress);
  expect(answers.filter((kind) => kind === "slow")).toHaveLength(2);
  const listed = await a.list({ canvas: "flow" });
  expect(listed.requests).toHaveLength(perPass + 2 + perAddress);
});

// ---- Who may ask (fact rules 1, 2)

test("the name comes from the pass, or from the user, never from the input: an author in the input is invalid", async () => {
  const srv = await boot();
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  await bo.add("flow", id);
  await a.add("flow", null);

  const listed = await a.list({ canvas: "flow" });
  expect(listed.requests.map((r) => r.author)).toEqual(["Bo", "ann"]);
  const forge = () =>
    // @ts-expect-error the contract takes no author: the name is the pass's
    bo.scope.run(queue.viewer["request.add"], {
      input: {
        canvas: "flow",
        frameId: null,
        version: null,
        x: 0,
        y: 0,
        text: "Hi.",
        key: newKey(),
        author: "Mallory",
      },
    });
  // The contract is strict on both sides: the client refuses to send it, as the server would.
  await expect(Promise.resolve().then(forge)).rejects.toThrow("DataValidationFailed");
});

test("mayAct runs first: no pass and no token is refused signIn; a pass for another canvas, or of an ended link, is refused ended; a pass a new password ended is refused locked; a pass with no name is refused name", async () => {
  const srv = await boot();
  const { a, id, link } = await sharedFlow(srv);
  const nobody = await client(srv.server);
  expect(await faultOf(nobody.add("flow", id))).toEqual({
    fault: "refused",
    payload: { signIn: true },
  });

  const bo = await viewer(srv, link, "Bo");
  await a.scope.run(frames.api["canvas.create"], { input: { name: "other" } });
  expect(await faultOf(bo.add("other", null))).toEqual({
    fault: "refused",
    payload: { ended: true },
  });

  const shy = await viewer(srv, link);
  expect(await faultOf(shy.add("flow", id))).toEqual({ fault: "refused", payload: { name: true } });

  await a.scope.run(frames.api["canvas.share"], {
    input: { canvas: "flow", password: "correct horse" },
  });
  expect(await faultOf(bo.add("flow", id))).toEqual({
    fault: "refused",
    payload: { locked: true },
  });

  await a.scope.run(frames.api["canvas.unshare"], { input: { canvas: "flow" } });
  expect(await faultOf(bo.add("flow", id))).toEqual({
    fault: "refused",
    payload: { ended: true },
  });
  expect((await a.list()).requests).toEqual([]);
});

test("request.list runs the user guard first: a viewer's pass alone is refused signIn", async () => {
  const srv = await boot();
  const { link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");

  expect(await faultOf(bo.list())).toEqual({ fault: "refused", payload: { signIn: true } });
});

test("request.list lists the requests of one canvas or of all, in one state or all, oldest first", async () => {
  const srv = await boot();
  const { a, id } = await sharedFlow(srv);
  await a.scope.run(frames.api["canvas.create"], { input: { name: "other" } });
  await a.add("flow", id);
  srv.clock.advance(10);
  await a.add("other", null);
  srv.clock.advance(10);
  await a.add("flow", null);

  const all = await a.list();
  expect(all.requests.map((r) => `${r.canvas} ${r.n}`)).toEqual(["flow 1", "other 1", "flow 2"]);
  const flow = await a.list({ canvas: "flow" });
  expect(flow.requests.map((r) => r.n)).toEqual([1, 2]);
  expect((await a.list({ state: "waiting" })).requests).toHaveLength(3);
  expect((await a.list({ state: "person" })).requests).toEqual([]);
});

// ---- The board

test("the board carries the time of the server for a canvas: a tab reads now, so a lease ends for every tab at one time", async () => {
  const srv = await boot();
  const { link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  srv.clock.advance(1_234);
  const read = bo.scope.resolve(frames.board.serverClock.of({ canvas: "flow" }));
  closers.push(read.watch(() => undefined));

  await until(() => read.get() !== undefined);
  expect(read.get()).toEqual({ canvas: "flow", now: start + 1_234 });
});

test(
  "the requests survive a restart: the store reads them back into the board at start",
  { timeout: 30_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "easel-queue-"));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "easel.db");
    const first = await boot(file);
    const { a, id } = await sharedFlow(first);
    await a.add("flow", id, "Keep me.");
    await first.server.close();

    const again = await boot(file);
    const listed = again.server.run(listAll);
    expect(listed).toEqual([{ n: 1, author: "ann", status: "open" }]);
  },
);

/** The requests on the board of a server, as the store set them. */
const listAll = operation({
  label: "test.listAll",
  depends: { all: requests.atScope.controller },
  run: ({ all }) => all.get().map((r) => ({ n: r.n, author: r.author, status: r.status })),
});

// ---- Kept versions (judged rule 16; SPEC-frames judged rule 16)

test(
  "frames keeps each version that a request refers to: a put that replaces it, and a delete of its frame, save it first; a version no request refers to is not kept",
  { timeout: 30_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "easel-queue-"));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "easel.db");
    const srv = await boot(file);
    const { a, id } = await sharedFlow(srv);
    const put = (html: string, base: number) =>
      a.scope.run(frames.api["frame.put"], { input: { canvas: "flow", id, html, base } });

    await put("<p>2</p>", 1);
    // A viewer saw version 2.
    await a.add("flow", id, "Change it.", newKey(), 2);
    await put("<p>3</p>", 2);
    await put("<p>4</p>", 3);
    await a.scope.run(frames.api["frame.delete"], { input: { canvas: "flow", id } });

    const db = new Database(file, { readonly: true });
    closers.push(() => db.close());
    const kept = db.query("SELECT version, html FROM frames_kept ORDER BY version").all();
    expect(kept).toEqual([{ version: 2, html: "<p>2</p>" }]);
  },
);
