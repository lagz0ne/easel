import { operation, rpc } from "@tinkered/core";
import { z } from "zod";

import { canvasKey, frameId, version } from "@/frames/contract";

import { request } from "./cells";

// The queue's contract (SPEC-queue.md § Contract): the CLI and the page import it. `requestApi`
// holds the calls of a viewer (or a user): `mayAct` runs first, for the canvas that the call names
// (fact rule 1). `queueApi` holds the calls of an agent: the `user` guard runs first (fact rule
// 3). The cells are in `./cells`, on `easel.board`.

/** After this many tries with no outcome, a request needs a person (judged rule 11). */
export const maxTries = 3;

/** A canvas holds at most this many requests in `open`, `asking` or `person` (judged rule 14). */
export const maxOpen = 200;

/** The state of a request, from the board and the time of the server (§ Contract, the table). */
export const state = z.enum([
  "waiting",
  "inWork",
  "person",
  "question",
  "result",
  "accepted",
  "closed",
]);

export type State = z.infer<typeof state>;

/** A request's text, a reason, a note: 1 to 2000 characters, not only spaces. */
export const text = z
  .string()
  .max(2000)
  .refine((t) => t.trim().length > 0, "1 to 2000 characters");

/** The client key of `request.add`: 16 to 64 characters (an idempotency key). */
export const clientKey = z.string().min(16).max(64);

/** A request's number on its canvas. */
export const requestN = z.number().int().positive();

/** A place on the board: finite numbers. */
const place = z.number().finite();

/**
 * `request.add`'s input: on a frame (its id and the version the viewer saw), or on the canvas
 * (both `null`).
 */
export const addInput = z.union([
  z.strictObject({
    canvas: canvasKey,
    frameId,
    version,
    x: place,
    y: place,
    text,
    key: clientKey,
  }),
  z.strictObject({
    canvas: canvasKey,
    frameId: z.null(),
    version: z.null(),
    x: place,
    y: place,
    text,
    key: clientKey,
  }),
]);

const gone = z.object({ kind: z.literal("gone") });
const full = z.object({ kind: z.literal("full") });
const slow = z.object({ kind: z.literal("slow"), retryIn: z.number() });

/** The calls of a viewer, or of a user: `mayAct` runs first. */
export const requestApi = rpc({
  "request.add": {
    input: addInput,
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("added"), n: z.number() }),
      gone,
      full,
      slow,
    ]),
  },
});

/** The calls of an agent: the `user` guard runs first. */
export const queueApi = rpc({
  "request.list": {
    input: z.strictObject({ canvas: canvasKey.optional(), state: state.optional() }),
    output: z.object({ kind: z.literal("listed"), requests: z.array(request) }),
  },
});

export type QueueAddress = Extract<keyof typeof queueApi.contracts, string>;
export type RequestAddress = Extract<keyof typeof requestApi.contracts, string>;

type KindOf<O> = O extends { kind: infer K } ? K : never;
type QueueKind<A extends QueueAddress> = KindOf<Awaited<ReturnType<(typeof queueApi)[A]["run"]>>>;

type RequestKind<A extends RequestAddress> = KindOf<
  Awaited<ReturnType<(typeof requestApi)[A]["run"]>>
>;

/** SPEC.md rule 1: the success kinds of an agent's calls. The CLI's exit code reads them. */
export const queueSuccessKinds = {
  "request.list": ["listed"],
} as const satisfies { readonly [A in QueueAddress]: readonly QueueKind<A>[] };

/** SPEC.md rule 1: the success kinds of a viewer's calls. */
export const requestSuccessKinds = {
  "request.add": ["added"],
} as const satisfies { readonly [A in RequestAddress]: readonly RequestKind<A>[] };

/** The state of a status that the time and the tries do not change. */
const stillStates = { person: "person", asking: "question", closed: "closed" } as const;

/**
 * The state of a request at `now`, the time of the server (§ Contract, the table). A lease ends
 * by time alone: past `claimedUntil`, an `open` request is waiting, or needs a person at 3 tries
 * (judged rules 7, 11). The page runs it with the clock offset of the board; the server, with its
 * clock.
 */
export const stateOf = operation({
  label: "queue.stateOf",
  input: z.object({
    request: request.pick({ status: true, claimedUntil: true, tries: true, acceptedBy: true }),
    now: z.number(),
  }),
  run: (_, { input: { request: r, now } }): State => {
    if (r.status === "open") {
      if ((r.claimedUntil ?? now) > now) return "inWork";
      return r.tries >= maxTries ? "person" : "waiting";
    }
    if (r.status === "resolved") return r.acceptedBy === null ? "result" : "accepted";
    return stillStates[r.status];
  },
});
