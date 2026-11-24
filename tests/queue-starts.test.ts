import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { frames } from "@/frames";
import { queue } from "@/queue";

import { githubDouble } from "./support/github";
import { inbox, natsServer } from "./support/nats";
import type { NatsServer } from "./support/nats";
import {
  boot,
  claimOf,
  client,
  closers,
  faultOf,
  rounds,
  sharedFlow,
  until,
  viewer,
} from "./support/queue";
import type { Client, Server } from "./support/queue";

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const subject = "easel.requests";

const token = `ghp_${randomBytes(18).toString("hex")}`;

async function withStarts(file = ":memory:") {
  const nats = await natsServer();
  closers.push(() => nats.close());
  const srv = await boot(file, [], { github: githubDouble(token).fetch, agreement: true });
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  const saved = await a.scope.run(queue.channels["channel.set"], {
    input: { name: "loop", kind: "nats", url: nats.url, subject, seed: nats.seed, inbox },
  });
  expect(saved).toEqual({ kind: "saved" });

  return { nats, srv, a, bo, id, link };
}

async function messagesAfter(srv: Server, nats: NatsServer, ms = 1000) {
  await rounds(srv, ms);
  await Bun.sleep(50);
  return nats.messages();
}

function holdsOf(tab: Client, canvas = "flow") {
  const list = tab.scope.resolve(frames.board.holds.where({ canvas }));
  closers.push(list.watch(() => undefined));
  return () => list.get().map((one) => one.hold);
}

async function deliveriesOf(agent: Client, canvas = "flow", n = 1) {
  const answer = await agent.deliveries(canvas, n);
  if (answer.kind !== "listed") throw new Error(answer.kind);
  return answer.deliveries;
}

async function memberOf(srv: Server, owner: Client) {
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const cy = await client(srv.server, {}, "198.51.100.7");
  const started = await cy.scope.run(access.login["login.start"], {
    input: { name: "cy", digest },
  });
  if (started.kind !== "pending") throw new Error(started.kind);
  await owner.scope.run(access.owner["users.approve"], { input: { code: started.code } });
  const waited = await cy.scope.run(access.login["login.wait"], {
    input: { request: started.request },
  });
  expect(waited.kind).toBe("granted");
  cy.held.token = text;

  return cy;
}

test("a request of a viewer waits for the person: the dispatcher publishes nothing, easel next gives nothing, and the board shows the hold agreement; the person agrees, and the next round publishes it and the hold goes (AnAgentWorksOnlyOnAnAgreedRequest, OnlyAnAgreedRequestIsPublished)", async () => {
  const { nats, srv, a, bo, id } = await withStarts();
  const shown = holdsOf(bo);
  expect((await bo.add("flow", id, "Make the dock smaller.")).kind).toBe("added");
  const asked = srv.clock.currentTimeMillis();

  expect(await messagesAfter(srv, nats, 2000)).toEqual([]);
  expect(await a.next()).toEqual({ kind: "empty" });
  expect(await a.next({ canvas: "flow", n: 1 })).toEqual({ kind: "empty" });
  await until(() => shown().length === 1);
  expect(shown()).toEqual([{ kind: "agreement" }]);

  expect(await a.agree("flow", 1)).toEqual({ kind: "agreed" });
  await until(() => shown().length === 0);
  const published = await messagesAfter(srv, nats);
  expect(published.map((m) => m.id)).toEqual([`flow:1:${asked}`]);
  expect((await a.next()).kind).toBe("claimed");
});

test("a request of the person is agreed when it is made: the dispatcher publishes it in the next round and the board shows no hold (ARequestOfThePersonIsAgreed)", async () => {
  const { nats, srv, a, bo, id } = await withStarts();
  const shown = holdsOf(bo);
  expect((await a.add("flow", id, "Make the dock smaller.")).kind).toBe("added");

  expect(await messagesAfter(srv, nats)).toHaveLength(1);
  expect(shown()).toEqual([]);
  expect(await a.agree("flow", 1)).toEqual({ kind: "agreed" });
});

test("request.agree answers notPerson to a member, gone for no request, and wrongState for a request that does not wait and is not in work; nothing changes", async () => {
  const { nats, srv, a, bo, id } = await withStarts();
  const cy = await memberOf(srv, a);
  expect((await bo.add("flow", id)).kind).toBe("added");

  expect(await cy.agree("flow", 1)).toEqual({ kind: "notPerson" });
  expect(await a.agree("flow", 9)).toEqual({ kind: "gone" });
  expect(await messagesAfter(srv, nats)).toEqual([]);

  expect((await bo.close("flow", 1)).kind).toBe("closed");
  expect(await a.agree("flow", 1)).toEqual({ kind: "wrongState", state: "closed" });
});

test("a viewer on a share link cannot agree: the call is refused, as a pass does not reach queue.starts", async () => {
  const { nats, srv, bo, id } = await withStarts();
  expect((await bo.add("flow", id)).kind).toBe("added");

  expect((await faultOf(bo.agree("flow", 1)))?.fault).toBe("refused");
  expect(await messagesAfter(srv, nats)).toEqual([]);
});

test("a new text of a viewer ends the agreement: an edit makes a new period that the dispatcher does not publish, and the hold is agreement again; a new text of the person agrees (ARequestThatWaitsForThePersonSaysSo)", async () => {
  const { nats, srv, a, bo, id } = await withStarts();
  const shown = holdsOf(bo);
  expect((await bo.add("flow", id)).kind).toBe("added");
  expect(await a.agree("flow", 1)).toEqual({ kind: "agreed" });
  expect(await messagesAfter(srv, nats)).toHaveLength(1);

  srv.clock.advance(10);
  expect((await bo.edit("flow", 1, "Move it to the right.")).kind).toBe("edited");
  expect(await messagesAfter(srv, nats, 2000)).toHaveLength(1);
  expect(await a.next()).toEqual({ kind: "empty" });
  await until(() => shown().length === 1);
  expect(shown()).toEqual([{ kind: "agreement" }]);

  srv.clock.advance(10);
  expect((await a.edit("flow", 1, "Move it to the left.")).kind).toBe("edited");
  expect(await messagesAfter(srv, nats)).toHaveLength(2);
  await until(() => shown().length === 0);
});

test("a note of a viewer on a request in work ends the agreement: the agent's extend gives no new note, and after the release the request waits for the person", async () => {
  const { nats, srv, a, bo, id } = await withStarts();
  expect((await bo.add("flow", id)).kind).toBe("added");
  expect(await a.agree("flow", 1)).toEqual({ kind: "agreed" });
  const claim = claimOf(await a.next());

  srv.clock.advance(10);
  expect((await bo.note("flow", 1, "Also delete the footer.")).kind).toBe("noted");
  const extended = await a.extend(claim);
  expect(JSON.stringify(extended)).not.toContain("footer");

  expect((await a.release(claim)).kind).toBe("released");
  expect(await a.next()).toEqual({ kind: "empty" });
  expect(await messagesAfter(srv, nats, 2000)).toEqual([]);

  expect(await a.agree("flow", 1)).toEqual({ kind: "agreed" });
  const again = await a.next();
  expect(again.kind).toBe("claimed");
  expect(JSON.stringify(again)).toContain("footer");
});

test("the person sets the limits of a nats channel: channel.limits saves 1 to 20 at the same time and 1 to 500 in a day, keeps a limit it does not get, and channel.list shows them; the defaults are 2 and 20", async () => {
  const { a } = await withStarts();
  expect((await a.channels()).channels).toMatchObject([
    { name: "loop", limits: { running: 2, perDay: 20 } },
  ]);

  expect(await a.limits({ name: "loop", running: 3 })).toEqual({
    kind: "saved",
    limits: { running: 3, perDay: 20 },
  });
  expect(await a.limits({ name: "loop", perDay: 500 })).toEqual({
    kind: "saved",
    limits: { running: 3, perDay: 500 },
  });
  expect((await a.channels()).channels).toMatchObject([
    { name: "loop", limits: { running: 3, perDay: 500 } },
  ]);

  for (const wrong of [{ running: 0 }, { running: 21 }, { perDay: 501 }]) {
    await expect(
      Promise.resolve().then(() => a.limits({ name: "loop", ...wrong })),
    ).rejects.toThrow("DataValidationFailed");
  }
});

test("channel.limits answers gone for no channel, notNats for a github channel, and notPerson for a member; nothing changes; channel.report to a github channel answers notNats", async () => {
  const { srv, a } = await withStarts();
  const cy = await memberOf(srv, a);
  expect(await a.setChannel(token)).toEqual({ kind: "saved" });

  expect(await a.limits({ name: "lost", running: 1 })).toEqual({ kind: "gone" });
  expect(await a.limits({ name: "gh", running: 1 })).toEqual({ kind: "notNats" });
  expect(await a.report({ kind: "state", channel: "gh", running: 0, today: 0, at: null })).toEqual({
    kind: "notNats",
  });
  expect(await cy.limits({ name: "loop", running: 1 })).toEqual({ kind: "notPerson" });
  expect((await a.channels()).channels).toContainEqual(
    expect.objectContaining({ name: "loop", limits: { running: 2, perDay: 20 } }),
  );
});

test("the starter reports its state and easel answers the limits; a starter at its running limit gives a waiting request the hold limit, with the count and the limit (NoStartOverALimit, AShownLimitIsTrue)", async () => {
  const { nats, srv, a, bo, id } = await withStarts();
  const shown = holdsOf(bo);
  expect((await bo.add("flow", id)).kind).toBe("added");
  expect(await a.agree("flow", 1)).toEqual({ kind: "agreed" });
  expect(await messagesAfter(srv, nats)).toHaveLength(1);

  expect(
    await a.report({ kind: "state", channel: "loop", running: 2, today: 5, at: "running" }),
  ).toEqual({ kind: "noted", limits: { running: 2, perDay: 20 } });
  await rounds(srv, 1000);
  await until(() => shown().length === 1);
  expect(shown()).toEqual([{ kind: "limit", which: "running", count: 2, limit: 2 }]);

  expect(
    await a.report({ kind: "state", channel: "loop", running: 1, today: 20, at: "day" }),
  ).toMatchObject({ kind: "noted" });
  await rounds(srv, 1000);
  await until(() => {
    const [first] = shown();
    return first?.kind === "limit" && first.which === "day";
  });
  expect(shown()).toEqual([{ kind: "limit", which: "day", count: 20, limit: 20 }]);

  expect(
    await a.report({ kind: "state", channel: "loop", running: 1, today: 6, at: null }),
  ).toMatchObject({ kind: "noted" });
  await rounds(srv, 1000);
  await until(() => shown().length === 0);
});

test("a start that the starter reports clears the hold, and easel deliveries shows the agent; a failed start shows the hold failed with its retry time, and the cause in deliveries (AShownFailureIsTrue)", async () => {
  const { nats, srv, a, bo, id } = await withStarts();
  const shown = holdsOf(bo);
  expect((await bo.add("flow", id)).kind).toBe("added");
  const asked = srv.clock.currentTimeMillis();
  expect(await a.agree("flow", 1)).toEqual({ kind: "agreed" });
  expect(await messagesAfter(srv, nats)).toHaveLength(1);

  const failedAt = srv.clock.currentTimeMillis();
  expect(
    await a.report({
      kind: "failed",
      channel: "loop",
      ref: `flow:1:${asked}`,
      cause: "paseo run: no provider",
      retryMs: 60_000,
    }),
  ).toMatchObject({ kind: "noted" });
  await rounds(srv, 1000);
  await until(() => shown().length === 1);
  expect(shown()).toEqual([{ kind: "failed", retryAt: failedAt + 60_000 }]);
  expect(await deliveriesOf(a)).toMatchObject([
    {
      kind: "waiting",
      status: "sent",
      start: { status: "failed", cause: "paseo run: no provider" },
    },
  ]);

  expect(
    await a.report({ kind: "started", channel: "loop", ref: `flow:1:${asked}`, agent: "agent-7" }),
  ).toMatchObject({ kind: "noted" });
  await rounds(srv, 1000);
  await until(() => shown().length === 0);
  expect(await deliveriesOf(a)).toMatchObject([
    { kind: "waiting", status: "sent", start: { status: "started", agent: "agent-7" } },
  ]);
});

test("a starter that has not reported for 60 s after the publish gives the hold silent; a report clears it", async () => {
  const { nats, srv, a, bo, id } = await withStarts();
  const shown = holdsOf(bo);
  expect((await bo.add("flow", id)).kind).toBe("added");
  expect(await a.agree("flow", 1)).toEqual({ kind: "agreed" });
  expect(await messagesAfter(srv, nats)).toHaveLength(1);

  await rounds(srv, 59_000, 10_000);
  expect(shown()).toEqual([]);
  await rounds(srv, 3000);
  await until(() => shown().length === 1);
  expect(shown()).toMatchObject([{ kind: "silent" }]);

  await a.report({ kind: "state", channel: "loop", running: 0, today: 0, at: null });
  await rounds(srv, 1000);
  await until(() => shown().length === 0);
});

test("a channel that refuses the delivery 3 times gives the hold refused (AShownRefusalIsTrue)", async () => {
  const { nats, srv, a, bo, id } = await withStarts();
  const shown = holdsOf(bo);
  await nats.stop();
  expect((await bo.add("flow", id)).kind).toBe("added");
  expect(await a.agree("flow", 1)).toEqual({ kind: "agreed" });

  await rounds(srv, 1000);
  await rounds(srv, 10_000);
  await rounds(srv, 30_000);
  await rounds(srv, 1000);
  await until(() => shown().length === 1);
  expect(shown()).toEqual([{ kind: "refused" }]);
});

test("a report of a start that names no request, or a ref of a wrong form, is noted and changes nothing; a report to no channel answers gone", async () => {
  const { a } = await withStarts();

  for (const ref of ["flow:9:1000", "not-a-ref"]) {
    expect(await a.report({ kind: "started", channel: "loop", ref, agent: "agent-1" })).toEqual({
      kind: "noted",
      limits: { running: 2, perDay: 20 },
    });
  }
  expect(
    await a.report({ kind: "state", channel: "lost", running: 0, today: 0, at: null }),
  ).toEqual({ kind: "gone" });
});

test("with the rule off, a request of a viewer goes to the agents with no agreement, as before", async () => {
  const nats = await natsServer();
  closers.push(() => nats.close());
  const srv = await boot();
  const { a, link, id } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  await a.scope.run(queue.channels["channel.set"], {
    input: { name: "loop", kind: "nats", url: nats.url, subject, seed: nats.seed, inbox },
  });
  expect((await bo.add("flow", id)).kind).toBe("added");

  expect(await messagesAfter(srv, nats)).toHaveLength(1);
  expect((await a.next()).kind).toBe("claimed");
});

test("the first start of the new version agrees each request that is there, as its author made it: the open requests of before go on to the agents", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-starts-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "easel.db");
  const first = await boot(file, [], { agreement: true });
  const { a, id, link } = await sharedFlow(first);
  const bo = await viewer(first, link, "Bo");
  expect((await bo.add("flow", id)).kind).toBe("added");
  await first.server.close();

  const db = new Database(file);
  db.exec("ALTER TABLE queue_requests DROP COLUMN agreed_at");
  db.exec("ALTER TABLE queue_requests DROP COLUMN agreed_by");
  db.close();

  const srv = await boot(file, [], { agreement: true });
  const again = await client(srv.server, a.held);
  expect((await again.next()).kind).toBe("claimed");
}, 30_000);
