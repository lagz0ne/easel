import { operation } from "@tinkered/core";
import { z } from "zod";

import { clientAddress } from "@/access/guards.server";
import { addressKey, limiter } from "@/access/login.server";

import { requests } from "./cells";
import type { Request } from "./cells";
import { queueApi, requestApi, stateOf } from "./contract";
import { whoActs } from "./guards.server";
import { saveRequest, seenKey } from "./store.server";

// The queue's calls (SPEC-queue.md). A viewer's calls run after `mayAct`; an agent's after
// `user`. All take the time from the `clock` of the run (fact rule 3, judged rule 3).

/** A viewer's calls in a minute, for each pass (or user), and for each client address. */
export const perPass = 10;
export const perAddress = 30;

/** A new id for a request or a message: 48 random bits, as 12 hex digits. */
const newId = operation({
  label: "queue.newId",
  run: (_, { random }) => random.uuid().replaceAll("-", "").slice(0, 12),
});

/**
 * A viewer's limits (judged rule 14): 10 calls a minute for each pass, then 30 for each client
 * address (the trusted `X-Forwarded-For`, by `clientAddress`). Null when the call may go on, else
 * `slow` with the ms until it may. The same limiter and sliding minute as `login.start`.
 */
const viewerLimit = operation({
  label: "queue.viewerLimit",
  input: z.string(),
  depends: { limiter, clientAddress, addressKey },
  run: ({ limiter, clientAddress, addressKey }, { input: key, clock }) => {
    const now = clock.currentTimeMillis();
    const byPass = limiter.hit(`request ${key}`, perPass, now);
    if (byPass !== null) return { kind: "slow" as const, retryIn: byPass };

    const address = addressKey.run({ input: clientAddress.run() });
    const byAddress = limiter.hit(`request address ${address}`, perAddress, now);
    return byAddress === null ? null : { kind: "slow" as const, retryIn: byAddress };
  },
});

/**
 * `request.add`: a key seen on the canvas answers `added` with its `n` first, before the limits
 * and the frame (the viewer-pin-post chart); then `slow`, then the write (`saveRequest`): `gone`,
 * `full` or `added`. The name is the sender's, from the pass or the user (fact rule 2).
 */
export const addRequest = operation({
  label: "request.add.do",
  input: requestApi["request.add"].input,
  depends: { whoActs, seenKey, viewerLimit, saveRequest, newId },
  run: async ({ whoActs, seenKey, viewerLimit, saveRequest, newId }, { input, clock }) => {
    const who = whoActs.run();
    const seen = await seenKey.run({ input: { canvas: input.canvas, key: input.key } });
    if (seen !== null) return { kind: "added" as const, n: seen };

    const slow = viewerLimit.run({ input: who.key });
    if (slow) return slow;

    return saveRequest.run({
      input: {
        ...input,
        id: newId.run(),
        author: who.name,
        message: newId.run(),
        now: clock.currentTimeMillis(),
      },
    });
  },
});

/** `request.list`: the requests of one canvas or of all, in one state or all, in queue order. */
export const listRequests = operation({
  label: "request.list.do",
  input: queueApi["request.list"].input,
  depends: { all: requests.atScope.controller, stateOf },
  run: ({ all, stateOf }, { input, clock }) => {
    const now = clock.currentTimeMillis();
    const rows: readonly Request[] = input.canvas
      ? all.where({ canvas: input.canvas }).get()
      : all.get();
    const kept = rows.filter(
      (row) => !input.state || stateOf.run({ input: { request: row, now } }) === input.state,
    );
    const sorted = kept.toSorted(
      (a, b) => a.queuedAt - b.queuedAt || a.canvas.localeCompare(b.canvas) || a.n - b.n,
    );
    return { kind: "listed" as const, requests: sorted };
  },
});

/** The server's side of `requestApi`: `queue.viewer({ implement: requestOps, onStart: [mayAct] })`. */
export const requestOps = {
  "request.add": addRequest,
} as const;

/** The server's side of `queueApi`: `queue.api({ implement: queueOps, onStart: [user] })`. */
export const queueOps = {
  "request.list": listRequests,
} as const;
