import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { preset } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { frames } from "@/frames";
import { queue } from "@/queue";
import { defaultLease, maxTries, stateOf } from "@/queue/contract";
import { claimRow } from "@/queue/store.server";

import {
  boot,
  claimOf,
  client,
  closers,
  faultOf,
  sharedFlow,
  start,
  tick,
  twin,
  until,
  viewer,
  watchQueue,
} from "./support/queue";
import type { Client, Server } from "./support/queue";

// The claim, the lease, the outcomes and the count of tries (SPEC-queue.md § An agent works the
// queue, § A request no agent finishes; judged rules 6 to 8, 10 to 12, 15, 16, 21), against the
// queue-lease chart (docs/statecharts/queue-lease.md, models/queue/Queue.tla). Each test that
// follows a rule of the chart names it. The server runs on a test clock: a lease ends by time
// alone.

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const leaseMs = defaultLease * 1000;

/** Flow shared, Bo a viewer, Ann an agent, and `count` requests from Bo on frame Home. */
async function queued(srv: Server, count = 1) {
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  for (let i = 0; i < count; i++) {
    expect((await bo.add("flow", id, `Request ${i + 1}.`)).kind).toBe("added");
    srv.clock.advance(10);
  }
  return { a, bo, id, link };
}

/** The state of request `n` of flow, as a tab shows it at the time of the server. */
async function stateIn(agent: Client, srv: Server, n: number) {
  const { requests } = await agent.list({ canvas: "flow" });
  const row = requests.find((r) => r.n === n);
  if (!row) return "missing";
  return agent.scope.run(stateOf, { input: { request: row, now: srv.clock.currentTimeMillis() } });
}

// ---- The claim ("an agent runs next and gets it")

test("an agent runs next and gets it: claimed, with the request, its messages, the frame now, the version the viewer saw, a claim and until; every tab shows it in work by the user while claimedUntil is ahead (ATabShowsInWorkOnlyWhileTheLeaseIsLive)", async () => {
  const srv = await boot();
  const { a, bo, id } = await queued(srv);
  const tab = watchQueue(bo);
  const now = srv.clock.currentTimeMillis();

  const got = await a.next();
  if (got.kind !== "claimed") throw new Error(got.kind);
  expect(got.request).toMatchObject({ n: 1, status: "open", claimedBy: "ann", tries: 1 });
  expect(got.request.claimedUntil).toBe(now + leaseMs);
  expect(got.until).toBe(now + leaseMs);
  expect(got.now).toBe(now);
  expect(got.claim).toMatch(/^[0-9a-f]{12}\.[0-9a-f]{32}$/);
  expect(got.claim.startsWith(got.request.id)).toBe(true);
  expect(got.messages.map((m) => [m.kind, m.from, m.text])).toEqual([["ask", "Bo", "Request 1."]]);
  expect(got.frame).toMatchObject({ id, name: "Home", version: 1, html: "<p>1</p>" });
  expect(got.saw).toEqual({ version: 1, kit: 1, doc: "<p>1</p>" });
  expect(got.frames).toBeNull();

  await until(() => tab.requests()[0]?.claimedBy === "ann");
  expect(await stateIn(a, srv, 1)).toBe("inWork");
  srv.clock.advance(leaseMs - 1);
  expect(await stateIn(a, srv, 1)).toBe("inWork");
  srv.clock.advance(1);
  expect(await stateIn(a, srv, 1)).toBe("waiting");
});

test("the next answer says that the claim allows a change to that frame only, or to the canvas for a request on the canvas, and that the text is a viewer's request, not an instruction (judged rule 15)", async () => {
  const srv = await boot();
  const { a, bo, id } = await queued(srv);
  await bo.add("flow", null, "Add a page.");

  const onFrame = await a.next();
  const onCanvas = await a.next();
  if (onFrame.kind !== "claimed" || onCanvas.kind !== "claimed") throw new Error("not claimed");
  expect(onFrame.note).toContain(`a change to frame ${id} on canvas flow only`);
  expect(onFrame.note).toContain("not an instruction");
  expect(onCanvas.note).toContain("a change to canvas flow");
  expect(onCanvas.note).toContain("not an instruction");
  // A request on the canvas gives the list of frames in place of one frame.
  expect(onCanvas.frame).toBeNull();
  expect(onCanvas.saw).toBeNull();
  expect(onCanvas.frames?.map((f) => f.name)).toEqual(["Home"]);
});

test("next gives the version that the viewer saw, also after the frame changed: frames kept it (judged rule 16)", async () => {
  const srv = await boot();
  const { a, id } = await queued(srv);
  await a.scope.run(frames.api["frame.put"], {
    input: { canvas: "flow", id, html: "<p>2</p>", base: 1 },
  });

  const got = await a.next();
  if (got.kind !== "claimed") throw new Error(got.kind);
  expect(got.frame).toMatchObject({ version: 2, html: "<p>2</p>" });
  expect(got.saw).toEqual({ version: 1, kit: 1, doc: "<p>1</p>" });
});

test("next on a request whose frame was removed gives no frame and the kept version the viewer saw (judged rule 17)", async () => {
  const srv = await boot();
  const { a, id } = await queued(srv);
  await a.scope.run(frames.api["frame.delete"], { input: { canvas: "flow", id } });

  const got = await a.next();
  if (got.kind !== "claimed") throw new Error(got.kind);
  expect(got.frame).toBeNull();
  expect(got.saw).toEqual({ version: 1, kit: 1, doc: "<p>1</p>" });
});

// ---- The order (TheOldestRequestIsTakenFirst) and the scope (rule 21)

test("next gives the first request in queue order that it can take, on any canvas, or on --canvas only (TheOldestRequestIsTakenFirst)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv, 2);
  await a.scope.run(frames.api["canvas.create"], { input: { name: "other" } });
  await a.add("other", null);

  const first = await a.next();
  const onOther = await a.next({ canvas: "other" });
  const second = await a.next();
  const none = await a.next();
  expect(first.kind === "claimed" && first.request.n).toBe(1);
  expect(onOther.kind === "claimed" && onOther.request.canvas).toBe("other");
  expect(second.kind === "claimed" && second.request.n).toBe(2);
  expect(none).toEqual({ kind: "empty" });
  expect(bo).toBeTruthy();
});

test("next with n and canvas takes only that request, and only while it is waiting; else it answers empty (rule 21)", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 3);

  const two = await a.next({ canvas: "flow", n: 2 });
  expect(two.kind === "claimed" && two.request.n).toBe(2);
  expect(await a.next({ canvas: "flow", n: 2 })).toEqual({ kind: "empty" });
  expect(await a.next({ canvas: "flow", n: 9 })).toEqual({ kind: "empty" });
  const rest = await a.next();
  expect(rest.kind === "claimed" && rest.request.n).toBe(1);
});

test("n without canvas, a lease out of 30 to 3600, or a wait over 50 is invalid", async () => {
  const srv = await boot();
  const { a } = await queued(srv);
  const call = (input: { canvas?: string; n?: number; lease?: number; wait?: number }) =>
    Promise.resolve().then(() => a.next(input));

  for (const input of [{ n: 1 }, { lease: 29 }, { lease: 3601 }, { wait: 51 }]) {
    await expect(call(input)).rejects.toThrow("DataValidationFailed");
  }
  expect((await a.list({ state: "waiting" })).requests).toHaveLength(1);
});

test("an agent's calls run the user guard first: no token is refused signIn, also with a viewer's pass", async () => {
  const srv = await boot();
  const { bo } = await queued(srv);
  const nobody = await client(srv.server);

  expect(await faultOf(nobody.next())).toEqual({ fault: "refused", payload: { signIn: true } });
  expect(await faultOf(bo.next())).toEqual({ fault: "refused", payload: { signIn: true } });
});

// ---- The race (ARequestIsHeldByAtMostOneAgent; judged rule 6; the success criteria)

test(
  "two agents never get the same request: a double of the store write runs a second next to its end before the write of the first one lands, and the two get different requests (ARequestIsHeldByAtMostOneAgent)",
  { timeout: 30_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "easel-queue-"));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "easel.db");
    const other = new Database(file, { create: true });
    closers.push(() => other.close());
    const raced: { second: () => Promise<unknown> } = { second: async () => undefined };
    let first = true;
    // The store write, on its own connection: the first call waits for a whole second
    // request.next before it writes. A claim that found its request before this point, then
    // wrote, would give both agents request 1.
    const double = preset(claimRow, async (_, ctx) => {
      if (first) {
        first = false;
        await raced.second();
      }
      return claimRow.run({ connection: { db: { $client: other } } }, ctx);
    });
    const srv = await boot(file, [double]);
    const { a } = await queued(srv, 2);
    const b = await twin(srv, a);
    raced.second = () => b.next();

    const gotA = await a.next();
    const listed = await a.list({ canvas: "flow", state: "inWork" });
    expect(listed.requests.map((r) => r.n).toSorted((x, y) => x - y)).toEqual([1, 2]);
    expect(gotA.kind === "claimed" && gotA.request.n).toBe(2);
    expect(first).toBe(false);
  },
);

test("two agents that call next at the same time get different requests, also with one token (ARequestIsHeldByAtMostOneAgent)", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 5);
  const agents = [a, await twin(srv, a), await twin(srv, a)];

  const got = await Promise.all([...agents, ...agents].map((agent) => agent.next()));
  const ns = got.flatMap((g) => (g.kind === "claimed" ? [g.request.n] : []));
  expect(ns.toSorted((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  expect(got.filter((g) => g.kind === "empty")).toHaveLength(1);
});

// ---- The wait (AWaitingAgentIsWokenWhenARequestCanBeTaken; judged rule 12)

test("with nothing to take, next waits and holds no lock; it wakes when a viewer adds one, and claims it (AWaitingAgentIsWokenWhenARequestCanBeTaken)", async () => {
  const srv = await boot();
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");

  const waiting = a.next({ wait: 50 });
  await tick();
  // The wait holds no lock: the add goes through while next waits.
  expect(await bo.add("flow", id, "Now.")).toEqual({ kind: "added", n: 1 });
  const got = await waiting;
  expect(got.kind === "claimed" && got.request.n).toBe(1);
});

test("a waiting next wakes when an agent releases a request, and takes it (AWaitingAgentIsWokenWhenARequestCanBeTaken)", async () => {
  const srv = await boot();
  const { a } = await queued(srv);
  const b = await twin(srv, a);
  const claim = claimOf(await a.next());

  const waiting = b.next({ wait: 50 });
  await tick();
  expect(await a.release(claim)).toEqual({ kind: "released" });
  const got = await waiting;
  expect(got.kind === "claimed" && got.request.tries).toBe(2);
});

test("a waiting next wakes when a lease runs out, and takes the request at once; the old claim answers lost (AStaleClaimEndsNothing)", async () => {
  const srv = await boot();
  const { a } = await queued(srv);
  const b = await twin(srv, a);
  const claim = claimOf(await a.next({ lease: 30 }));

  const waiting = b.next({ wait: 50 });
  await tick();
  srv.clock.advance(30_000);
  const got = await waiting;
  expect(got.kind === "claimed" && got.request.n).toBe(1);
  expect(await a.resolve(claim)).toEqual({ kind: "lost" });
});

test("a next that waits answers empty when wait passes; wait 0 answers at once", async () => {
  const srv = await boot();
  const { a } = await sharedFlow(srv);

  expect(await a.next()).toEqual({ kind: "empty" });
  const waiting = a.next({ wait: 50 });
  let done = false;
  void waiting.then(() => (done = true));
  await tick();
  srv.clock.advance(49_999);
  await tick();
  expect(done).toBe(false);
  srv.clock.advance(1);
  expect(await waiting).toEqual({ kind: "empty" });
});

// ---- The lease ("the lease runs out"; ATabShowsInWorkOnlyWhileTheLeaseIsLive, AStaleClaimEndsNothing)

test("a lease that runs out puts the request back with no write: tabs show it waiting, and a call with the old claim answers lost and writes nothing, also when no agent took it since (AStaleClaimEndsNothing, ARefusalWritesNothing)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);
  const tab = watchQueue(bo);
  const claim = claimOf(await a.next());
  await until(() => tab.requests()[0]?.claimedBy === "ann");
  const before = tab.requests()[0];

  srv.clock.advance(leaseMs);
  expect(await stateIn(a, srv, 1)).toBe("waiting");
  for (const call of [
    a.resolve(claim),
    a.ask(claim),
    a.decline(claim),
    a.release(claim),
    a.extend(claim),
  ]) {
    expect(await call).toEqual({ kind: "lost" });
  }
  await tick();
  expect(tab.requests()[0]).toEqual(before);
  expect(tab.messages()).toHaveLength(1);
});

test("a handle from an earlier claim is refused lost, also when the same agent claimed the same request again since (OldHandleIsRefused, AStaleHandleCannotExtend)", async () => {
  const srv = await boot();
  const { a } = await queued(srv);
  const old = claimOf(await a.next());
  srv.clock.advance(leaseMs);
  const fresh = claimOf(await a.next());

  expect(fresh).not.toBe(old);
  expect(await a.extend(old)).toEqual({ kind: "lost" });
  expect(await a.resolve(old)).toEqual({ kind: "lost" });
  expect(await a.resolve(fresh)).toEqual({ kind: "resolved" });
});

test("extend starts the lease again from now, for --lease or 300 s; an agent whose lease is live is never told lost (ALiveHolderIsNeverToldLost)", async () => {
  const srv = await boot();
  const { a } = await queued(srv);
  const claim = claimOf(await a.next({ lease: 60 }));

  srv.clock.advance(59_000);
  const now = srv.clock.currentTimeMillis();
  expect(await a.extend(claim)).toEqual({ kind: "extended", until: now + leaseMs, now });
  srv.clock.advance(leaseMs - 1);
  expect(await a.extend(claim, 30)).toEqual({
    kind: "extended",
    until: now + leaseMs - 1 + 30_000,
    now: now + leaseMs - 1,
  });
  expect(await stateIn(a, srv, 1)).toBe("inWork");
  expect((await a.list({ state: "inWork" })).requests[0]?.tries).toBe(1);
});

// ---- The outcomes (OnlyTheHolderEndsATry; judged rule 10)

test("the holder resolves: resolved, the lease ends, and the result holds the text, the HTML part and the frame version before and after", async () => {
  const srv = await boot();
  const { a, bo, id } = await queued(srv);
  const tab = watchQueue(bo);
  const claim = claimOf(await a.next());
  await a.scope.run(frames.api["frame.put"], {
    input: { canvas: "flow", id, html: "<p>2</p>", base: 1 },
  });
  const html = "<!doctype html><p>The button, moved.</p>";

  expect(await a.resolve(claim, "Moved the button up.", html)).toEqual({ kind: "resolved" });
  await until(() => tab.messages().length === 2);
  expect(tab.requests()[0]).toMatchObject({
    status: "resolved",
    claimedBy: null,
    claimedUntil: null,
    tries: 1,
  });
  expect(tab.messages().find((m) => m.kind === "result")).toMatchObject({
    from: "ann",
    text: "Moved the button up.",
    html,
    before: 1,
    after: 2,
    // The kit versions at the claim and at the resolve (K10): no change of the look, the seed.
    beforeKit: 1,
    afterKit: 1,
  });
  expect(await stateIn(a, srv, 1)).toBe("result");
});

test("a result with no frame change has the same version before and after; a request on the canvas has none", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);
  await bo.add("flow", null, "Add a page.");
  const tab = watchQueue(bo);

  expect(await a.resolve(claimOf(await a.next()), "Nothing to change.")).toEqual({
    kind: "resolved",
  });
  expect(await a.resolve(claimOf(await a.next()), "Added it.")).toEqual({ kind: "resolved" });
  await until(() => tab.messages().filter((m) => m.kind === "result").length === 2);
  const results = tab.messages().filter((m) => m.kind === "result");
  expect(results.map((m) => [m.before, m.after])).toEqual(
    expect.arrayContaining([
      [1, 1],
      [null, null],
    ]),
  );
});

test("the holder asks: the request leaves the queue for a viewer with the question, its HTML part and up to 6 options (AQuestionWaitsForAViewer)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);
  const tab = watchQueue(bo);
  const claim = claimOf(await a.next());
  const html = "<html><p>Two blues.</p></html>";

  expect(await a.ask(claim, "Which blue?", { html, options: ["Navy", "Sky"] })).toEqual({
    kind: "asked",
  });
  await until(() => tab.messages().length === 2);
  expect(tab.requests()[0]).toMatchObject({
    status: "asking",
    claimedBy: null,
    claimedUntil: null,
  });
  expect(tab.messages()[1]).toMatchObject({
    kind: "question",
    text: "Which blue?",
    html,
    options: ["Navy", "Sky"],
  });
  expect(await stateIn(a, srv, 1)).toBe("question");
  // A question is not in the queue, and its tries never make it need a person.
  expect(await a.next()).toEqual({ kind: "empty" });
  srv.clock.advance(leaseMs * 10);
  expect(await stateIn(a, srv, 1)).toBe("question");
});

test("an HTML part that is not a full document, or over 256 KiB, and options out of 2 to 6, are invalid", async () => {
  const srv = await boot();
  const { a } = await queued(srv);
  const claim = claimOf(await a.next());
  const big = `<!doctype html>${"x".repeat(256 * 1024)}`;
  const call = (more: { html?: string; options?: string[] }) =>
    Promise.resolve().then(() => a.ask(claim, "Which?", more));

  for (const more of [
    { html: "<p>part</p>" },
    { html: big },
    { options: ["One"] },
    { options: ["1", "2", "3", "4", "5", "6", "7"] },
  ]) {
    await expect(call(more)).rejects.toThrow("DataValidationFailed");
  }
  expect(await stateIn(a, srv, 1)).toBe("inWork");
});

test("the holder declines: the request needs a person at once, with its reason (ARequestNeedsAPersonOnlyAfterTriesWithNoOutcome)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);
  const tab = watchQueue(bo);

  expect(await a.decline(claimOf(await a.next()), "No form here.")).toEqual({ kind: "declined" });
  await until(() => tab.messages().length === 2);
  expect(tab.requests()[0]).toMatchObject({ status: "person", claimedBy: null, tries: 1 });
  expect(tab.messages()[1]).toMatchObject({ kind: "decline", text: "No form here." });
  expect(await stateIn(a, srv, 1)).toBe("person");
  expect((await a.list({ state: "person" })).requests.map((r) => r.n)).toEqual([1]);
});

test("a claim on a request that left the queue answers wrongState with the state now, never lost, and writes nothing (AHandleOnARequestOutOfTheQueueIsToldWrongState)", async () => {
  const srv = await boot();
  const { a } = await queued(srv);
  const b = await twin(srv, a);
  const old = claimOf(await a.next());
  srv.clock.advance(leaseMs);
  const live = claimOf(await b.next());
  expect(await b.resolve(live)).toEqual({ kind: "resolved" });

  // The earlier holder, and the holder itself again, are told the state now.
  expect(await a.resolve(old)).toEqual({ kind: "wrongState", state: "result" });
  expect(await b.extend(live)).toEqual({ kind: "wrongState", state: "result" });
  expect(await b.ask(live)).toEqual({ kind: "wrongState", state: "result" });
  expect(await b.release(live)).toEqual({ kind: "wrongState", state: "result" });
  expect(await b.decline(live)).toEqual({ kind: "wrongState", state: "result" });
  const { requests } = await a.list();
  expect(requests[0]).toMatchObject({ status: "resolved", tries: 2 });
});

test("a claim on a request that does not exist answers gone", async () => {
  const srv = await boot();
  const { a } = await sharedFlow(srv);
  const claim = `000000000000.${"0".repeat(32)}`;

  expect(await a.resolve(claim)).toEqual({ kind: "gone" });
  expect(await a.extend(claim)).toEqual({ kind: "gone" });
  expect(await a.release(claim)).toEqual({ kind: "gone" });
  expect(await a.decline(claim)).toEqual({ kind: "gone" });
  expect(await a.ask(claim)).toEqual({ kind: "gone" });
});

test("only the holder of the live claim ends the try: another agent's handle is lost while the holder works (OnlyTheHolderEndsATry)", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 2);
  const b = await twin(srv, a);
  const mine = claimOf(await a.next());
  const theirs = claimOf(await b.next());
  // A handle names its request: B's handle with A's request id is no claim on it.
  const forged = `${mine.split(".")[0]}.${theirs.split(".")[1]}`;

  expect(await b.resolve(forged)).toEqual({ kind: "lost" });
  expect(await a.resolve(mine)).toEqual({ kind: "resolved" });
});

// ---- Tries ("a request no agent finishes"; TriesCountTriesWithNoOutcome,
// ARequestNeedsAPersonOnlyAfterTriesWithNoOutcome, ARequestThatNeedsAPersonIsNeverGiven)

test(`each claim counts one try; releases and leases that run out end tries with no outcome; after ${maxTries} the request needs a person, and next never gives it (TriesCountTriesWithNoOutcome, ARequestThatNeedsAPersonIsNeverGiven, ARequestWhoseLeaseRanOutIsTakenAgainOrNeedsAPerson)`, async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv, 2);
  const tab = watchQueue(bo);

  const one = await a.next({ canvas: "flow", n: 1 });
  expect(one.kind === "claimed" && one.request.tries).toBe(1);
  expect(await a.release(claimOf(one), "Shutting down.")).toEqual({ kind: "released" });
  // A release goes to the back: request 2 is first now.
  const two = await a.next();
  expect(two.kind === "claimed" && two.request.n).toBe(2);
  const again = await a.next();
  expect(again.kind === "claimed" && again.request).toMatchObject({ n: 1, tries: 2 });
  srv.clock.advance(leaseMs);
  const third = await a.next({ canvas: "flow", n: 1 });
  expect(third.kind === "claimed" && third.request.tries).toBe(maxTries);
  expect(await stateIn(a, srv, 1)).toBe("inWork");
  srv.clock.advance(leaseMs);

  expect(await stateIn(a, srv, 1)).toBe("person");
  expect(await a.next({ canvas: "flow", n: 1 })).toEqual({ kind: "empty" });
  const rest = await a.next();
  expect(rest.kind === "claimed" && rest.request.n).toBe(2);
  expect((await a.list({ state: "person" })).requests.map((r) => r.n)).toEqual([1]);
  await until(() => tab.messages().some((m) => m.kind === "release"));
  expect(tab.messages().find((m) => m.kind === "release")).toMatchObject({
    from: "ann",
    text: "Shutting down.",
  });
});

test("a release on the last try makes the request need a person: releases count (TriesCountTriesWithNoOutcome)", async () => {
  const srv = await boot();
  const { a } = await queued(srv);

  for (let i = 1; i <= maxTries; i++) {
    expect(await a.release(claimOf(await a.next()))).toEqual({ kind: "released" });
  }
  expect(await stateIn(a, srv, 1)).toBe("person");
  expect(await a.next()).toEqual({ kind: "empty" });
});

test("a waiting next does not wake for a lease that runs out on the last try: the request needs a person (ARequestThatNeedsAPersonIsNeverGiven)", async () => {
  const srv = await boot();
  const { a } = await queued(srv);
  for (let i = 1; i < maxTries; i++) await a.release(claimOf(await a.next()));
  await a.next({ lease: 30 });

  const waiting = a.next({ wait: 50 });
  await tick();
  srv.clock.advance(30_000);
  await tick();
  srv.clock.advance(20_000);
  expect(await waiting).toEqual({ kind: "empty" });
  expect(await stateIn(a, srv, 1)).toBe("person");
});

test("the claim writes claimedAt, the time of the claim, in its one write; extend keeps it; an outcome, a release, an edit and a close set it to null with the lease; a lease that runs out writes nothing, so it stays (judged rule 7)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv, 4);
  const tab = watchQueue(bo);
  const row = (n: number) => tab.requests().find((r) => r.n === n);
  const at = srv.clock.currentTimeMillis();

  const first = await a.next();
  if (first.kind !== "claimed") throw new Error(first.kind);
  expect(first.request.claimedAt).toBe(at);
  await until(() => row(1)?.claimedAt === at);
  srv.clock.advance(1_000);
  expect((await a.extend(claimOf(first))).kind).toBe("extended");
  await tick();
  expect(row(1)?.claimedAt).toBe(at);
  expect(await a.resolve(claimOf(first))).toEqual({ kind: "resolved" });
  await until(() => row(1)?.claimedAt === null);

  expect((await a.release(claimOf(await a.next()))).kind).toBe("released");
  await until(() => row(2)?.claimedAt === null);

  // A lease that runs out writes nothing: claimedBy and claimedAt stay, and say the last claim.
  const ranOut = srv.clock.currentTimeMillis();
  claimOf(await a.next({ n: 3, canvas: "flow" }));
  srv.clock.advance(leaseMs);
  expect(await stateIn(a, srv, 3)).toBe("waiting");
  expect(row(3)).toMatchObject({ claimedBy: "ann", claimedAt: ranOut });
  expect((await bo.edit("flow", 3)).kind).toBe("edited");
  await until(() => row(3)?.claimedAt === null);

  claimOf(await a.next({ n: 4, canvas: "flow" }));
  await until(() => row(4)?.claimedAt !== null);
  expect((await bo.close("flow", 4)).kind).toBe("closed");
  await until(() => row(4)?.claimedAt === null);
  expect(row(4)).toMatchObject({ claimedBy: null, claimedUntil: null });
});

test(
  "a store made before claimedAt gets the column at start: its requests load with claimedAt null, and a claim writes it",
  { timeout: 30_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "easel-queue-"));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "easel.db");
    const old = new Database(file, { create: true });
    old.exec(`CREATE TABLE queue_requests (id TEXT PRIMARY KEY NOT NULL, canvas TEXT NOT NULL,
    n INTEGER NOT NULL, frame_id TEXT, version INTEGER, x REAL NOT NULL, y REAL NOT NULL,
    author TEXT NOT NULL, key TEXT NOT NULL, status TEXT NOT NULL, claimed_by TEXT,
    claimed_until INTEGER, claim_digest TEXT, claim_version INTEGER, tries INTEGER NOT NULL,
    queued_at INTEGER NOT NULL, accepted_by TEXT, created INTEGER NOT NULL,
    updated INTEGER NOT NULL, UNIQUE (canvas, n), UNIQUE (canvas, key))`);
    old.exec(`INSERT INTO queue_requests VALUES ('aaaaaaaaaaaa', 'flow', 9, NULL, NULL, 1, 2, 'Bo',
    'key-old-0000000', 'closed', NULL, NULL, NULL, NULL, 0, 1, NULL, 1, 1)`);
    old.close();

    const srv = await boot(file);
    const { a, bo } = await queued(srv);
    const tab = watchQueue(bo);
    await until(() => tab.requests().length === 2);
    expect(tab.requests().find((r) => r.n === 9)).toMatchObject({ claimedAt: null });
    const got = await a.next();
    expect(got.kind === "claimed" && got.request.claimedAt).toBe(srv.clock.currentTimeMillis());
  },
);

test("the request on the board is the one the store wrote: queue.api and the board agree on tries and claimedBy", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);
  const tab = watchQueue(bo);
  await a.next();

  await until(() => tab.requests()[0]?.tries === 1);
  const listed = (await a.list()).requests[0];
  expect(tab.requests()[0]).toEqual(listed);
  expect(queue.api.addresses).toContain("request.next");
  expect(listed?.created).toBe(start);
});
