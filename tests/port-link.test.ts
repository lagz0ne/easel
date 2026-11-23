import { exits } from "@tinkered/cli/test";
import { capsule, createScope, data, operation, remoteData, rpc, transport } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { portClient, portServer } from "@/kit/port-link";

// A capsule across scopes (SPEC-kit.md § The capsules, "A capsule across scopes"): one scope
// serves a part of a capsule on a MessagePort, and a scope at the other end reads it live and
// calls it, as a frame and its controls will in two iframes.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/** The part of a frame that another scope can read: names in capitals or not. */
const capitals = data({ label: "test.capitals", parse: z.boolean(), initial: false });
const board = remoteData({ capitals });

const api = rpc({
  "capitals.set": { input: z.boolean(), output: z.object({ was: z.boolean() }) },
});

const shared = capsule({ label: "test.shared", exports: { board, api } });

/** An rpc whose server throws: the client gets `failed`. */
const broken = rpc({ "broken.call": { input: z.null(), output: z.null() } });
const brokenPart = capsule({ label: "test.broken", exports: { api: broken } });

const throws = operation({
  label: "test.throws",
  input: broken["broken.call"].input,
  run: (): null => {
    throw new Error("a bug in the frame");
  },
});

const setCapitals = operation({
  label: "test.setCapitals",
  input: api["capitals.set"].input,
  depends: { cell: capitals.controller },
  run: ({ cell }, { input }) => {
    const was = cell.get();
    cell.set(input);
    return { was };
  },
});

/** An rpc that the frame does not serve. */
const other = rpc({ "nope.call": { input: z.null(), output: z.null() } });
const lost = capsule({ label: "test.lost", exports: { api: other } });

/** A guard on the frame's side that refuses each call: the client gets `refused`. */
const closed = rpc({ "closed.call": { input: z.null(), output: z.null() } });
const closedPart = capsule({ label: "test.closed", exports: { api: closed } });

const refuseAll = operation({
  label: "test.refuseAll",
  input: transport.hook.start,
  run: (_, { input }) => input.refuse({ closed: true }),
});

const neverRuns = operation({
  label: "test.neverRuns",
  input: closed["closed.call"].input,
  run: () => null,
});

/** The frame's scope, which serves the part, and a scope at the other end of a port. */
async function pair() {
  const channel = new MessageChannel();
  const frame = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      shared.board({ serve: true }),
      shared.api({ implement: { "capitals.set": setCapitals } }),
      brokenPart.api({ implement: { "broken.call": throws } }),
      closedPart.api({ implement: { "closed.call": neverRuns }, onStart: [refuseAll] }),
      portServer({ services: [shared.board, shared.api, brokenPart.api, closedPart.api] }),
    ],
  }).ready;
  closers.push(() => frame.close());
  // It serves the port until `stop`, as a server's listen.
  const stop = new AbortController();
  const served = frame.run(portServer.accept, {
    input: { port: channel.port1, stop: stop.signal },
  });
  closers.push(() => {
    stop.abort();
    return served;
  });

  const control = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      portClient({ port: Promise.resolve(channel.port2) }),
      shared.board({ read: portClient }),
      shared.api({ remote: portClient }),
      lost.api({ remote: portClient }),
      brokenPart.api({ remote: portClient }),
      closedPart.api({ remote: portClient }),
    ],
  }).ready;
  closers.push(() => control.close());

  return { frame, control };
}

test("a scope at the other end of a port calls the frame's capsule and reads its part live", async () => {
  const { frame, control } = await pair();

  const seen: unknown[] = [];
  const reader = control.resolve(shared.board.capitals);
  const stop = reader.watch((value) => seen.push(value));
  closers.push(stop);
  await expect.poll(() => reader.get()).toBe(false);

  // A call runs in the frame's scope; its write reaches the reader on the other side.
  expect(await control.run(shared.api["capitals.set"], { input: true })).toEqual({ was: false });
  expect(frame.controller(capitals).get()).toBe(true);
  await expect.poll(() => reader.get()).toBe(true);

  // A write in the frame's own scope (its own button) reaches it too.
  await frame.run(setCapitals, { input: false });
  await expect.poll(() => reader.get()).toBe(false);
  expect(seen).toContain(true);
});

test("an address that no one serves on the port answers missing, and nothing runs", async () => {
  const { control } = await pair();
  const call = await control.settle(lost.api["nope.call"], { input: null });
  expect(call.status).toBe("failed");
  expect(call.status === "failed" && lost.api.fault.is(call.error) && call.error.fault).toBe(
    "missing",
  );
});

test("each fault of a call across the port: the frame throws, a guard refuses, a bad input, a value JSON cannot write", async () => {
  const { control } = await pair();
  const failed = await control.settle(brokenPart.api["broken.call"], { input: null });
  expect(
    failed.status === "failed" && brokenPart.api.fault.is(failed.error) && failed.error.fault,
  ).toBe("failed");

  const refused = await control.settle(closedPart.api["closed.call"], { input: null });
  expect(
    refused.status === "failed" && closedPart.api.fault.is(refused.error) && refused.error,
  ).toMatchObject({
    fault: "refused",
    payload: { closed: true },
  });

  // The client's own call, with no contract in front: the frame's protocol checks the input.
  const raw = (value: unknown) =>
    control.run(portClient.call, { input: { address: "capitals.set", value, meta: {} } });
  expect(await raw("yes")).toMatchObject({ ok: false, kind: "invalid" });
  expect(await raw(1n)).toMatchObject({ ok: false, kind: "encode", payload: { side: "client" } });
  expect(await raw(true)).toMatchObject({ ok: true, value: { was: false } });
});

test("a reply that is not one is a decode fault; a call with no reply stops as a link fault", async () => {
  // A port whose other end answers each call with a text that is not a reply, or not at all.
  const channel = new MessageChannel();
  channel.port1.addEventListener("message", (event: MessageEvent) => {
    const id = Reflect.get(Object(event.data), "id");
    if (id === 1) channel.port1.postMessage({ t: "reply", id, text: "not a reply" });
  });
  channel.port1.start();
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      portClient({ port: Promise.resolve(channel.port2) }),
    ],
  }).ready;
  closers.push(() => scope.close());
  const input = { address: "any.call", value: null, meta: {} };

  expect(await scope.run(portClient.call, { input })).toMatchObject({
    ok: false,
    kind: "decode",
    payload: { side: "client" },
  });
  // The caller stops waiting: the call ends, and its reply would be a link fault.
  const stop = new AbortController();
  const waits = scope.settle(portClient.call, { input, signal: stop.signal });
  stop.abort();
  expect((await waits).status).toBe("cancelled");
});

test("a watch of an address that no one serves ends; a watch value JSON cannot write ends at once", async () => {
  const { control } = await pair();
  const pushed: unknown[] = [];
  const watch = (address: string, value: unknown) =>
    control.run(portClient.watch, {
      input: { address, value, meta: {}, push: (reply) => pushed.push(reply) },
    });

  // Each ends, and pushes its fault: the frame serves no such address, or nothing left this side.
  await watch("nope.cell", null);
  await watch("test.capitals", 1n);
  expect(pushed).toMatchObject([
    { ok: false, kind: "missing" },
    { ok: false, kind: "link" },
  ]);
});

test("when the frame's side stops serving the port, a call and a watch on the way end as link faults", async () => {
  const channel = new MessageChannel();
  const frame = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      brokenPart.api({ implement: { "broken.call": throws } }),
      portServer({ services: [brokenPart.api] }),
    ],
  }).ready;
  closers.push(() => frame.close());
  const stop = new AbortController();
  const served = frame.run(portServer.accept, {
    input: { port: channel.port1, stop: stop.signal },
  });

  // A client whose messages do not reach the server yet: they wait on the way.
  const late = Promise.withResolvers<MessagePort>();
  const control = await createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS }), portClient({ port: late.promise })],
  }).ready;
  closers.push(() => control.close());
  const input = { address: "any.call", value: null, meta: {} };
  const call = control.run(portClient.call, { input });
  const pushed: unknown[] = [];
  const watch = control.run(portClient.watch, {
    input: { ...input, push: (reply) => pushed.push(reply) },
  });

  stop.abort();
  await served;
  late.resolve(channel.port2);
  expect(await call).toMatchObject({ ok: false, kind: "link", payload: { sent: true } });
  await watch;
  expect(pushed).toMatchObject([{ ok: false, kind: "link" }]);
});
