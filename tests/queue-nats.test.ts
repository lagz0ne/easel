import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import type { Observe } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { frames } from "@/frames";
import { queue } from "@/queue";

import { inbox, natsServer } from "./support/nats";
import type { NatsServer } from "./support/nats";
import { boot, claimOf, closers, rounds, sharedFlow, viewer } from "./support/queue";
import type { Client } from "./support/queue";

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const subject = "easel.requests";

async function withNats(more: { observe?: Observe.Config } = {}) {
  const nats = await natsServer();
  closers.push(() => nats.close());
  const srv = await boot(":memory:", [], more.observe ? { observe: more.observe } : {});
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");

  return { nats, srv, a, bo, id, link };
}

const setNats = (
  agent: Client,
  nats: NatsServer,
  more: {
    name?: string;
    url?: string;
    subject?: string;
    seed?: string;
    inbox?: string;
    canvases?: string[];
  } = {},
) =>
  agent.scope.run(queue.channels["channel.set"], {
    input: { name: "loop", kind: "nats", url: nats.url, subject, seed: nats.seed, inbox, ...more },
  });

async function deliveriesOf(agent: Client, canvas = "flow", n = 1) {
  const answer = await agent.deliveries(canvas, n);
  if (answer.kind !== "listed") throw new Error(answer.kind);
  return answer.deliveries;
}

const pendingAgain = operation({
  label: "test.pendingAgain",
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }) =>
    connection.db.$client
      .query("UPDATE queue_deliveries SET status = 'pending', attempts = 0, next = 0")
      .run().changes,
});

async function untilMessages(nats: NatsServer, count: number) {
  for (let i = 0; i < 100; i++) {
    if ((await nats.messages()).length >= count) break;
    await Bun.sleep(20);
  }
  return nats.messages();
}

test("an owner sets a nats channel: easel connects with the nkey, and JetStream refuses a check publish to the subject, so the subject has a stream and the key may publish, and nothing is stored; channel.list shows the url, the subject, the canvases and the public key, never the seed", async () => {
  const { nats, a } = await withNats();

  expect(await setNats(a, nats)).toEqual({ kind: "saved" });
  expect(
    await setNats(a, nats, { name: "design", canvases: ["product", "design-system"] }),
  ).toEqual({ kind: "saved" });
  const listed = await a.channels();
  expect(listed).toMatchObject({
    kind: "listed",
    channels: [
      {
        name: "design",
        kind: "nats",
        url: nats.url,
        subject,
        canvases: ["product", "design-system"],
        key: nats.publicKey,
      },
      {
        name: "loop",
        kind: "nats",
        url: nats.url,
        subject,
        inbox,
        canvases: [],
        key: nats.publicKey,
      },
    ],
  });
  expect(JSON.stringify(listed)).not.toContain(nats.seed);
  expect(JSON.stringify(listed)).not.toContain(nats.seed.slice(0, -4));
  expect(await nats.messages()).toEqual([]);
});

test("a nats channel that cannot publish answers refused with status 0 and the cause, and saves nothing: a subject that the key may not publish to, a subject that no stream takes, a key that the server does not let in, a seed that is not a user seed, a server that cannot be reached", async () => {
  const { nats, a } = await withNats();

  expect(await setNats(a, nats, { subject: "easel.other" })).toEqual({
    kind: "refused",
    status: 0,
    message: "denied: this key may not publish to easel.other.check",
  });
  expect(await setNats(a, nats, { subject: "easel.lost", seed: nats.adminSeed })).toEqual({
    kind: "refused",
    status: 0,
    message: "no stream: no JetStream stream takes easel.lost.check",
  });
  expect(await setNats(a, nats, { seed: nats.strangerSeed })).toEqual({
    kind: "refused",
    status: 0,
    message: "key: NATS does not let this key in",
  });
  const brokenSeed = `${nats.seed.slice(0, -2)}${nats.seed.endsWith("AA") ? "BB" : "AA"}`;
  expect(await setNats(a, nats, { seed: brokenSeed })).toEqual({
    kind: "refused",
    status: 0,
    message: "seed: the seed is not the seed of a user nkey",
  });
  await nats.stop();
  expect(await setNats(a, nats)).toEqual({
    kind: "refused",
    status: 0,
    message: "network: NATS cannot be reached",
  });
  expect((await a.channels()).channels).toEqual([]);
});

test("the dispatcher publishes one JetStream message for each waiting period to <subject>.<canvas>, with Nats-Msg-Id <canvas>:<n>:<period>, and a body of the canvas, the number, the frame, the page and the period only, not the text; an ack makes the delivery sent", async () => {
  const { nats, srv, a, bo, id } = await withNats();
  expect(await setNats(a, nats)).toEqual({ kind: "saved" });
  expect((await bo.add("flow", id, "Make the dock smaller.")).kind).toBe("added");
  const asked = srv.clock.currentTimeMillis();

  await rounds(srv, 1000);
  const [message] = await untilMessages(nats, 1);
  expect(message).toEqual({
    subject: "easel.requests.flow",
    id: `flow:1:${asked}`,
    body: { canvas: "flow", n: 1, frame: id, page: "page-1", period: asked },
  });
  expect(JSON.stringify(message)).not.toContain("dock");
  expect(await deliveriesOf(a)).toMatchObject([
    {
      channel: "loop",
      kind: "waiting",
      period: asked,
      attempts: 1,
      status: "sent",
      cause: null,
      ref: null,
    },
  ]);

  await rounds(srv, 3000);
  expect(await nats.messages()).toHaveLength(1);
});

test("a request on the canvas publishes frame null and the page of the request", async () => {
  const { nats, srv, a, bo } = await withNats();
  expect(await setNats(a, nats)).toEqual({ kind: "saved" });
  expect((await bo.add("flow", null, "Add a page.")).kind).toBe("added");

  await rounds(srv, 1000);
  const [message] = await untilMessages(nats, 1);
  expect(message?.body).toMatchObject({ canvas: "flow", n: 1, frame: null, page: "page-1" });
});

test("a new waiting period publishes a new message with a new id; a request that leaves the queue needs no out delivery for NATS", async () => {
  const { nats, srv, a, bo, id } = await withNats();
  expect(await setNats(a, nats)).toEqual({ kind: "saved" });
  expect((await bo.add("flow", id)).kind).toBe("added");
  await rounds(srv, 1000);

  srv.clock.advance(10);
  const released = srv.clock.currentTimeMillis();
  expect((await a.release(claimOf(await a.next()))).kind).toBe("released");
  await rounds(srv, 1000);
  const both = await untilMessages(nats, 2);
  expect(both.map((m) => m.id)).toEqual([
    expect.stringMatching(/^flow:1:\d+$/),
    `flow:1:${released}`,
  ]);

  expect((await a.resolve(claimOf(await a.next()))).kind).toBe("resolved");
  await rounds(srv, 2000);
  expect((await deliveriesOf(a)).map((d) => [d.kind, d.status])).toEqual([
    ["waiting", "sent"],
    ["waiting", "sent"],
  ]);
  expect(await nats.messages()).toHaveLength(2);
});

test("a publish of the same waiting period again, as after a crash before endAttempt, has the same Nats-Msg-Id, and JetStream drops the repeat: the stream holds one message", async () => {
  const { nats, srv, a, bo, id } = await withNats();
  expect(await setNats(a, nats)).toEqual({ kind: "saved" });
  expect((await bo.add("flow", id)).kind).toBe("added");
  await rounds(srv, 1000);
  expect(await untilMessages(nats, 1)).toHaveLength(1);

  expect(await srv.server.run(pendingAgain)).toBe(1);
  await rounds(srv, 1000);
  expect(await deliveriesOf(a)).toMatchObject([{ status: "sent", attempts: 1 }]);
  expect(await nats.messages()).toHaveLength(1);
});

test("with the server down, an attempt fails with network, and is tried again after 10 s; with the server up again, the next attempt is sent", async () => {
  const { nats, srv, a, bo, id } = await withNats();
  expect(await setNats(a, nats)).toEqual({ kind: "saved" });
  await nats.stop();
  expect((await bo.add("flow", id)).kind).toBe("added");
  const asked = srv.clock.currentTimeMillis();

  await rounds(srv, 1000);
  expect(await deliveriesOf(a)).toMatchObject([
    {
      status: "pending",
      attempts: 1,
      cause: "network: NATS cannot be reached",
      next: asked + 1000 + 10_000,
    },
  ]);

  await nats.start();
  await rounds(srv, 10_000);
  expect(await deliveriesOf(a)).toMatchObject([{ status: "sent", attempts: 2, cause: null }]);
  expect(await untilMessages(nats, 1)).toHaveLength(1);
});

test("3 failed attempts give a failed delivery with its cause, after 10 s and 30 s; the request still waits for an agent that asks", async () => {
  const { nats, srv, a, bo, id } = await withNats();
  expect(await setNats(a, nats)).toEqual({ kind: "saved" });
  await nats.stop();
  expect((await bo.add("flow", id)).kind).toBe("added");

  await rounds(srv, 1000);
  await rounds(srv, 10_000);
  expect(await deliveriesOf(a)).toMatchObject([{ status: "pending", attempts: 2 }]);
  await rounds(srv, 30_000);
  expect(await deliveriesOf(a)).toMatchObject([
    { status: "failed", attempts: 3, cause: "network: NATS cannot be reached", next: null },
  ]);
  await rounds(srv, 60_000, 30_000);
  expect(await deliveriesOf(a)).toMatchObject([{ status: "failed", attempts: 3 }]);
  expect((await a.next()).kind).toBe("claimed");
});

const moveSubject = operation({
  label: "test.moveSubject",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: subject }) =>
    void connection.db.$client
      .query("UPDATE queue_channels SET subject = $subject")
      .run({ $subject: subject }),
});

test("a publish that gets no ack in 10 s fails with timeout: a listener that no stream backs takes the subject, and never answers", async () => {
  const { nats, srv, a, bo, id } = await withNats();
  expect(await setNats(a, nats)).toEqual({ kind: "saved" });
  await srv.server.run(moveSubject, { input: "easel.requests.slow" });
  const stop = await nats.silentListener("easel.requests.slow.>");
  closers.push(stop);
  expect((await bo.add("flow", id)).kind).toBe("added");

  await rounds(srv, 1000);
  await rounds(srv, 10_000, 10_000);
  expect(await deliveriesOf(a)).toMatchObject([
    { status: "pending", attempts: 1, cause: "timeout: NATS did not ack in 10 s" },
  ]);
});

test("a key that may no longer publish fails the attempt with denied, as the cause", async () => {
  const { nats, srv, a, bo, id } = await withNats();
  expect(await setNats(a, nats)).toEqual({ kind: "saved" });
  await srv.server.run(moveSubject, { input: "easel.other" });
  expect((await bo.add("flow", id)).kind).toBe("added");

  await rounds(srv, 1000);
  expect(await deliveriesOf(a)).toMatchObject([
    {
      status: "pending",
      attempts: 1,
      cause: "denied: this key may not publish to easel.other.flow",
    },
  ]);
});

test("a channel with canvases gets only the requests of those canvases; a channel with none gets each canvas", async () => {
  const { nats, srv, a, bo, id } = await withNats();
  expect(await setNats(a, nats, { name: "only", canvases: ["product"] })).toEqual({
    kind: "saved",
  });
  expect(await setNats(a, nats, { name: "all" })).toEqual({ kind: "saved" });
  await a.scope.run(frames.api["canvas.create"], { input: { name: "product" } });
  const made = await a.scope.run(frames.api["frame.put"], {
    input: { canvas: "product", html: "<p>2</p>", name: "Dock" },
  });
  if (made.kind !== "created") throw new Error(made.kind);
  const shared = await a.scope.run(frames.api["canvas.share"], { input: { canvas: "product" } });
  if (shared.kind !== "shared") throw new Error(shared.kind);
  const cy = await viewer(srv, shared.path.slice("/s/".length), "Cy");

  expect((await bo.add("flow", id)).kind).toBe("added");
  srv.clock.advance(10);
  expect((await cy.add("product", made.id)).kind).toBe("added");
  await rounds(srv, 1000);

  expect((await deliveriesOf(a, "flow")).map((d) => d.channel)).toEqual(["all"]);
  expect((await deliveriesOf(a, "product")).map((d) => d.channel).sort()).toEqual(["all", "only"]);
  const subjects = (await untilMessages(nats, 2)).map((m) => m.subject).sort();
  expect(subjects).toEqual(["easel.requests.flow", "easel.requests.product"]);
});

test("the seed of a nats channel is in no answer, log line, span or error", async () => {
  const spans: Observe.Span[] = [];
  const logs: Observe.Log[] = [];
  const observe = {
    export: (s: Observe.Span) => void spans.push(s),
    log: (l: Observe.Log) => void logs.push(l),
  };
  const { nats, srv, a, bo, id } = await withNats({ observe });
  const answers: unknown[] = [];
  answers.push(await setNats(a, nats), await setNats(a, nats, { name: "bad", subject: "x" }));
  expect((await bo.add("flow", id)).kind).toBe("added");
  await rounds(srv, 1000);
  await nats.stop();
  srv.clock.advance(10);
  expect((await a.release(claimOf(await a.next()))).kind).toBe("released");
  await rounds(srv, 1000);
  answers.push(await a.channels(), await a.deliveries("flow", 1));

  expect(spans.map((s) => s.name)).toContain("queue.natsCall");
  const seen = JSON.stringify([answers, spans, logs, srv.out]);
  expect(seen).not.toContain(nats.seed);
  expect(seen).not.toContain(nats.seed.slice(2, 30));
});

test("a nats channel needs a url of nats, tls, ws or wss with no user in it, a subject and an inbox prefix with no wildcard, and a seed of a user nkey: else the input is invalid", async () => {
  const { nats, a } = await withNats();
  const faults = [
    { url: "http://127.0.0.1:4222" },
    { url: "nats://ann:secret@127.0.0.1:4222" },
    { url: "ws://ann:secret@dokploy-traefik/hub-nats" },
    { inbox: "_INBOX.>" },
    { subject: "easel.requests.>" },
    { subject: "easel..requests" },
    { seed: "SAAB" },
    { canvases: ["Not A Key"] },
  ];
  for (const more of faults) {
    const answer = await Promise.resolve(more)
      .then((wrong) => setNats(a, nats, wrong))
      .then(
        () => "ran",
        (error: unknown) => String(error),
      );
    expect(answer).toContain("DataValidationFailed");
  }
  expect(z.array(z.unknown()).parse((await a.channels()).channels)).toEqual([]);
});

test("a nats channel on a websocket URL, as ws://dokploy-traefik/hub-nats, saves, and its deliveries are sent; a key that may read only its own inbox needs that inbox prefix", async () => {
  const { nats, srv, a, bo, id } = await withNats();

  expect(await setNats(a, nats, { url: nats.wsUrl, inbox: "_INBOX" })).toEqual({
    kind: "refused",
    status: 0,
    message: "inbox: this key may not read the replies on _INBOX.>",
  });
  expect(await setNats(a, nats, { url: nats.wsUrl })).toEqual({ kind: "saved" });
  expect((await bo.add("flow", id)).kind).toBe("added");
  await rounds(srv, 1000);

  expect(await deliveriesOf(a)).toMatchObject([{ status: "sent", attempts: 1 }]);
  expect(await untilMessages(nats, 1)).toHaveLength(1);
});

test("a nats channel with no inbox prefix uses _INBOX", async () => {
  const { nats, a } = await withNats();
  const plain = await a.scope.run(queue.channels["channel.set"], {
    input: { name: "loop", kind: "nats", url: nats.url, subject, seed: nats.adminSeed },
  });

  expect(plain).toEqual({ kind: "saved" });
  expect((await a.channels()).channels).toMatchObject([{ inbox: "_INBOX" }]);
});
