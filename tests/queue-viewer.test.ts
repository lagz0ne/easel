import { afterEach, expect, test } from "vite-plus/test";

import { frames } from "@/frames";
import { defaultLease, maxOpen, maxTries, stateOf } from "@/queue/contract";
import { queueDefaults } from "@/queue/settings";

import {
  boot,
  claimOf,
  closers,
  faultOf,
  sharedFlow,
  tick,
  twin,
  until,
  viewer,
  watchQueue,
} from "./support/queue";
import type { Client, Server } from "./support/queue";

const { perPass } = queueDefaults;

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const leaseMs = defaultLease * 1000;

async function queued(srv: Server, count = 1) {
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  for (let i = 0; i < count; i++) {
    expect((await bo.add("flow", id, `Request ${i + 1}.`)).kind).toBe("added");
    srv.clock.advance(10);
  }
  return { a, bo, id, link };
}

async function rowOf(agent: Client, srv: Server, n: number) {
  const { requests } = await agent.list({ canvas: "flow" });
  const row = requests.find((r) => r.n === n);
  if (!row) throw new Error(`no request ${n}`);
  const now = srv.clock.currentTimeMillis();
  return { ...row, state: agent.scope.run(stateOf, { input: { request: row, now } }) };
}

async function resolved(agent: Client) {
  expect(await agent.resolve(claimOf(await agent.next()))).toEqual({ kind: "resolved" });
}

test("a viewer edits a request that waits: edited, a message edit with the text, tries 0, and the request goes to the back of the queue", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv, 2);
  const tab = watchQueue(a);

  expect(await bo.edit("flow", 1, "Move it to the left.")).toEqual({ kind: "edited" });
  const row = await rowOf(a, srv, 1);
  expect(row).toMatchObject({ status: "open", tries: 0, state: "waiting" });
  expect(row.queuedAt).toBe(srv.clock.currentTimeMillis());
  await until(() => tab.messages().some((m) => m.kind === "edit"));
  expect(tab.messages().find((m) => m.kind === "edit")).toMatchObject({
    from: "Bo",
    text: "Move it to the left.",
  });
  const first = await a.next();
  expect(first.kind === "claimed" && first.request.n).toBe(2);
});

test("a note to a request that waits appends to it: noted, a message note with the text, tries 0, and the request keeps its place in the queue (product#7)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv, 2);
  await a.release(claimOf(await a.next({ canvas: "flow", n: 1 })));
  srv.clock.advance(10);
  const before = await rowOf(a, srv, 1);
  const tab = watchQueue(a);

  expect(await bo.note("flow", 1, "Also the footer.")).toEqual({ kind: "noted" });
  const row = await rowOf(a, srv, 1);
  expect(row).toMatchObject({ status: "open", tries: 0, state: "waiting" });
  expect(row.queuedAt).toBe(before.queuedAt);
  await until(() => tab.messages().some((m) => m.kind === "note"));
  expect(tab.messages().find((m) => m.kind === "note")).toMatchObject({
    from: "Bo",
    text: "Also the footer.",
  });
  const first = await a.next();
  expect(first.kind === "claimed" && first.request.n).toBe(2);
});

test("a note to a request in work steers the agent: the claim, the lease and the tries stay, and each extend gives the notes since the claim (ANoteKeepsTheAgentAtWork)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);
  expect(await bo.note("flow", 1, "Before the claim.")).toEqual({ kind: "noted" });
  srv.clock.advance(10);
  const claim = claimOf(await a.next());
  const held = await rowOf(a, srv, 1);
  srv.clock.advance(10);

  expect(await bo.note("flow", 1, "Make it blue, too.")).toEqual({ kind: "noted" });
  expect(await rowOf(a, srv, 1)).toMatchObject({
    state: "inWork",
    tries: 1,
    claimedBy: held.claimedBy,
    claimedUntil: held.claimedUntil,
  });
  const extended = await a.extend(claim);
  expect(extended.kind === "extended" && extended.notes.map((m) => [m.from, m.text])).toEqual([
    ["Bo", "Make it blue, too."],
  ]);
  expect(await a.resolve(claim)).toEqual({ kind: "resolved" });
});

test("a note to a request that needs a person makes it wait again with tries 0; a note to a question, a result or a closed request answers wrongState (OnlyAPersonActsOnARequestThatNeedsAPerson)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv, 4);
  await a.decline(claimOf(await a.next({ canvas: "flow", n: 1 })), "Unclear.");
  await a.ask(claimOf(await a.next({ canvas: "flow", n: 2 })), "Which?");
  await a.resolve(claimOf(await a.next({ canvas: "flow", n: 3 })));
  await bo.close("flow", 4);

  expect(await bo.note("flow", 1, "The blue button.")).toEqual({ kind: "noted" });
  expect(await rowOf(a, srv, 1)).toMatchObject({ status: "open", state: "waiting", tries: 0 });
  expect(await bo.note("flow", 2)).toEqual({ kind: "wrongState", state: "question" });
  expect(await bo.note("flow", 3)).toEqual({ kind: "wrongState", state: "result" });
  expect(await bo.note("flow", 4)).toEqual({ kind: "wrongState", state: "closed" });
  expect(await bo.note("flow", 9)).toEqual({ kind: "gone" });
});

test("a viewer call on a request in work answers wrongState inWork and writes nothing; only a close takes it back (AViewerOnlyTakesBackARequestInWork)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);
  await a.next();

  expect(await bo.edit("flow", 1)).toEqual({ kind: "wrongState", state: "inWork" });
  expect(await bo.answer("flow", 1)).toEqual({ kind: "wrongState", state: "inWork" });
  expect(await bo.accept("flow", 1)).toEqual({ kind: "wrongState", state: "inWork" });
  expect(await bo.reopen("flow", 1)).toEqual({ kind: "wrongState", state: "inWork" });
  expect(await rowOf(a, srv, 1)).toMatchObject({ state: "inWork", tries: 1 });
});

test(`${maxTries} tries with no outcome make a request need a person; an edit by a viewer, or by a user, makes it waiting again with tries 0 (ARequestComesBackWithNoTries, OnlyAPersonActsOnARequestThatNeedsAPerson)`, async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv, 2);
  for (let i = 1; i <= maxTries; i++) {
    await a.next({ canvas: "flow", n: 1 });
    srv.clock.advance(leaseMs);
  }
  expect(await rowOf(a, srv, 1)).toMatchObject({ state: "person", tries: maxTries });
  expect(await bo.answer("flow", 1)).toEqual({ kind: "wrongState", state: "person" });
  expect(await bo.accept("flow", 1)).toEqual({ kind: "wrongState", state: "person" });
  expect(await bo.reopen("flow", 1)).toEqual({ kind: "wrongState", state: "person" });

  expect(await bo.edit("flow", 1, "The blue button, top left.")).toEqual({ kind: "edited" });
  expect(await rowOf(a, srv, 1)).toMatchObject({ state: "waiting", tries: 0 });
  await a.decline(claimOf(await a.next({ canvas: "flow", n: 2 })), "No such button.");
  expect(await rowOf(a, srv, 2)).toMatchObject({ state: "person", status: "person" });
  expect(await a.edit("flow", 2, "The other button.")).toEqual({ kind: "edited" });
  expect(await rowOf(a, srv, 2)).toMatchObject({ state: "waiting", status: "open", tries: 0 });
});

test("an edit, an answer and a reopen wake a waiting next (AWaitingAgentIsWokenWhenARequestCanBeTaken)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv, 3);
  await a.decline(claimOf(await a.next()), "Unclear.");
  await a.ask(claimOf(await a.next()), "Which?");
  await resolved(a);

  for (const call of [
    () => bo.edit("flow", 1),
    () => bo.answer("flow", 2),
    () => bo.reopen("flow", 3),
  ]) {
    const waiting = a.next({ wait: 50 });
    await tick();
    expect((await call()).kind).not.toBe("wrongState");
    const got = await waiting;
    expect(got.kind).toBe("claimed");
  }
});

test("an answer puts the request back in its first place, before a request asked after it, with tries 0 (E4.2 M19, ARequestComesBackWithNoTries)", async () => {
  const srv = await boot();
  const { a, bo, id } = await queued(srv);
  await a.ask(claimOf(await a.next()), "Which blue?", { options: ["Navy", "Sky"] });
  srv.clock.advance(1_000);
  await bo.add("flow", id, "Asked after it.");

  expect(await bo.answer("flow", 1, "Navy.", 0)).toEqual({ kind: "answered" });
  const row = await rowOf(a, srv, 1);
  expect(row).toMatchObject({ status: "open", tries: 0, state: "waiting" });
  expect(row.queuedAt).toBe(row.created);
  const got = await a.next();
  expect(got.kind === "claimed" && got.request.n).toBe(1);
  expect(got.kind === "claimed" && got.messages.map((m) => [m.kind, m.from, m.option])).toEqual([
    ["ask", "Bo", null],
    ["question", "ann", null],
    ["answer", "Bo", 0],
  ]);
});

test("an option out of the question's options is not kept: the answer keeps its text only", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);
  const tab = watchQueue(a);
  await a.ask(claimOf(await a.next()), "Which blue?", { options: ["Navy", "Sky"] });

  expect(await bo.answer("flow", 1, "Teal.", 5)).toEqual({ kind: "answered" });
  await until(() => tab.messages().some((m) => m.kind === "answer"));
  expect(tab.messages().find((m) => m.kind === "answer")).toMatchObject({
    text: "Teal.",
    option: null,
  });
});

test("an answer to a request with no question answers wrongState with the state now", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);

  expect(await bo.answer("flow", 1)).toEqual({ kind: "wrongState", state: "waiting" });
  await resolved(a);
  expect(await bo.answer("flow", 1)).toEqual({ kind: "wrongState", state: "result" });
});

test("a viewer accepts a result: accepted, with the name; a second accept answers wrongState accepted; the result stays resolved until reopened (AResultStaysResolvedUntilReopened)", async () => {
  const srv = await boot();
  const { a, bo, link } = await queued(srv);
  const cy = await viewer(srv, link, "Cy", "198.51.100.2");
  await resolved(a);
  srv.clock.advance(leaseMs * 100);
  expect(await rowOf(a, srv, 1)).toMatchObject({ state: "result" });

  const both = await Promise.all([bo.accept("flow", 1), cy.accept("flow", 1)]);
  expect(both.map((answer) => answer.kind).toSorted()).toEqual(["accepted", "wrongState"]);
  const row = await rowOf(a, srv, 1);
  expect(row).toMatchObject({ status: "resolved", state: "accepted" });
  expect(["Bo", "Cy"]).toContain(row.acceptedBy);
  expect(await bo.edit("flow", 1)).toEqual({ kind: "wrongState", state: "accepted" });
  expect(await bo.close("flow", 1)).toEqual({ kind: "wrongState", state: "accepted" });
});

test("a viewer opens a result again, accepted or not, with a note: open, tries 0, acceptedBy null, at the back of the queue (ARequestComesBackWithNoTries)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv, 2);
  const tab = watchQueue(a);
  await resolved(a);
  await bo.accept("flow", 1);
  srv.clock.advance(1_000);

  expect(await bo.reopen("flow", 1, "Still too low.")).toEqual({ kind: "reopened" });
  const row = await rowOf(a, srv, 1);
  expect(row).toMatchObject({ status: "open", tries: 0, acceptedBy: null, state: "waiting" });
  expect(row.queuedAt).toBe(srv.clock.currentTimeMillis());
  const got = await a.next();
  expect(got.kind === "claimed" && got.request.n).toBe(2);
  await until(() => tab.messages().some((m) => m.kind === "reopen"));
  expect(tab.messages().find((m) => m.kind === "reopen")).toMatchObject({
    from: "Bo",
    text: "Still too low.",
  });
  expect(tab.messages().find((m) => m.kind === "accept")).toMatchObject({ from: "Bo", text: null });
  expect(await bo.reopen("flow", 2)).toEqual({ kind: "wrongState", state: "inWork" });
});

test(
  `a reopen on a canvas with ${maxOpen} open requests answers full, and writes nothing (judged rule 14)`,
  { timeout: 30_000 },
  async () => {
    const srv = await boot();
    const { a, bo } = await queued(srv);
    await resolved(a);
    for (let i = 1; i <= maxOpen; i++) {
      if (i % perPass === 0) srv.clock.advance(60_000);
      expect((await a.add("flow", null, `Request ${i}.`)).kind).toBe("added");
    }

    srv.clock.advance(60_000);
    expect(await bo.reopen("flow", 1)).toEqual({ kind: "full" });
    expect(await rowOf(a, srv, 1)).toMatchObject({ state: "result" });
    await bo.close("flow", 2);
    expect(await bo.reopen("flow", 1)).toEqual({ kind: "reopened" });
  },
);

test("a viewer takes back a request in work: closed, the lease ends, and the agent's next call answers wrongState closed, so no result comes (ATakenBackRequestNeverShowsAResult)", async () => {
  const srv = await boot();
  const { a, bo, id } = await queued(srv);
  const tab = watchQueue(bo);
  const claim = claimOf(await a.next());
  await a.scope.run(frames.api["frame.put"], {
    input: { canvas: "flow", id, html: "<p>2</p>", base: 1 },
  });

  expect(await bo.close("flow", 1, "Not needed now.")).toEqual({ kind: "closed" });
  await until(() => tab.requests()[0]?.status === "closed");
  expect(tab.requests()[0]).toMatchObject({ claimedBy: null, claimedUntil: null });
  expect(await a.resolve(claim)).toEqual({ kind: "wrongState", state: "closed" });
  expect(await a.extend(claim)).toEqual({ kind: "wrongState", state: "closed" });
  expect(tab.messages().map((m) => m.kind)).toEqual(["ask", "close"]);
  const got = await a.scope.run(frames.api["frame.get"], { input: { canvas: "flow", id } });
  expect(got.kind === "found" && got.frame.version).toBe(2);
});

test("a close takes a request that waits, a question, or one that needs a person; a closed request stays closed (AClosedRequestStaysClosed)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv, 3);
  await a.ask(claimOf(await a.next({ canvas: "flow", n: 2 })), "Which?");
  await a.decline(claimOf(await a.next({ canvas: "flow", n: 3 })), "Unclear.");

  expect(await bo.close("flow", 1)).toEqual({ kind: "closed" });
  expect(await bo.close("flow", 2)).toEqual({ kind: "closed" });
  expect(await a.close("flow", 3, "Done by hand.")).toEqual({ kind: "closed" });
  for (const n of [1, 2, 3]) {
    srv.clock.advance(60_000);
    expect(await rowOf(a, srv, n)).toMatchObject({ status: "closed", state: "closed" });
    for (const call of [bo.edit, bo.answer, bo.accept, bo.reopen, bo.close]) {
      expect(await call("flow", n)).toEqual({ kind: "wrongState", state: "closed" });
    }
  }
  expect(await a.next()).toEqual({ kind: "empty" });
});

test("a close of a result answers wrongState result: a result is done", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);
  await resolved(a);

  expect(await bo.close("flow", 1)).toEqual({ kind: "wrongState", state: "result" });
});

test("a call on a request that does not exist answers gone", async () => {
  const srv = await boot();
  const { bo } = await queued(srv);

  for (const call of [bo.edit, bo.answer, bo.accept, bo.reopen, bo.close]) {
    expect(await call("flow", 9)).toEqual({ kind: "gone" });
  }
});

test(`a viewer's calls count in the limits of the pass: past ${perPass} a minute, each answers slow and writes nothing (judged rule 14)`, async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);
  for (let i = 1; i < perPass; i++) await bo.edit("flow", 1);
  expect((await bo.edit("flow", 1)).kind).toBe("slow");

  for (const call of [bo.edit, bo.note, bo.answer, bo.accept, bo.reopen, bo.close]) {
    expect((await call("flow", 1)).kind).toBe("slow");
  }
  expect(await rowOf(a, srv, 1)).toMatchObject({ status: "open" });
});

test("a viewer's call runs mayAct for the canvas that it names: a pass for another canvas is refused ended", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);
  await a.scope.run(frames.api["canvas.create"], { input: { name: "other" } });
  await a.add("other", null);

  expect(await faultOf(bo.close("other", 1))).toEqual({
    fault: "refused",
    payload: { ended: true },
  });
  expect(await rowOf(a, srv, 1)).toMatchObject({ status: "open" });
});

test("two agents and a viewer: the request ends with one outcome (ARequestEndsWithAnOutcomeOrAPerson)", async () => {
  const srv = await boot();
  const { a, bo } = await queued(srv);
  const b = await twin(srv, a);
  const claim = claimOf(await a.next());

  const answers = await Promise.all([a.resolve(claim), bo.close("flow", 1), b.next()]);
  const done = answers.filter((x) => x.kind === "resolved" || x.kind === "closed");
  expect(done).toHaveLength(1);
  expect((await rowOf(a, srv, 1)).state).toMatch(/^(result|closed)$/);
});
