import { operation, rpc } from "@tinkered/core";
import { z } from "zod";

import { canvasKey, frame, frameId, frameInfo, version } from "@/frames/contract";

import { message, request } from "./cells";

// The queue's contract (SPEC-queue.md § Contract): the CLI and the page import it. `requestApi`
// holds the calls of a viewer (or a user): `mayAct` runs first, for the canvas that the call names
// (fact rule 1). `queueApi` holds the calls of an agent: the `user` guard runs first (fact rule
// 3). The cells are in `./cells`, on `easel.board`.

/** After this many tries with no outcome, a request needs a person (judged rule 11). */
export const maxTries = 3;

/** A canvas holds at most this many requests in `open`, `asking` or `person` (judged rule 14). */
export const maxOpen = 200;

/** The lease of a claim, in seconds: 30 to 3600, 300 when none is given. */
export const lease = z.number().int().min(30).max(3600);
export const defaultLease = 300;

/** How long `request.next` waits on the server, in seconds: 0 to 50 (judged rule 12). */
export const maxWait = 50;
export const wait = z.number().min(0).max(maxWait);

/** The largest HTML part: 256 KiB of UTF-8. */
export const maxHtmlBytes = 256 * 1024;

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

/** An HTML part: a full HTML document of at most 256 KiB of UTF-8. */
export const htmlPart = z
  .string()
  .refine((html) => new TextEncoder().encode(html).length <= maxHtmlBytes, "at most 256 KiB")
  .refine((html) => /^\s*(<!doctype html|<html[\s>])/i.test(html), "a full HTML document");

/** The options of a question: 2 to 6 of 1 to 200 characters. */
export const options = z.array(z.string().min(1).max(200)).min(2).max(6);

/** A request's number on its canvas. */
export const requestN = z.number().int().positive();

/** A claim: the request's id, a dot, and 128 random bits. The server keeps only its digest. */
export const claimHandle = z
  .string()
  .regex(/^[0-9a-f]{12}\.[0-9a-f]{32}$/, "not a claim: `easel next` prints it");

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

const one = { canvas: canvasKey, n: requestN };

const gone = z.object({ kind: z.literal("gone") });
const full = z.object({ kind: z.literal("full") });
const slow = z.object({ kind: z.literal("slow"), retryIn: z.number() });
const wrongState = z.object({ kind: z.literal("wrongState"), state });
const lost = z.object({ kind: z.literal("lost") });

/** A viewer's call that failed: the state now, a removed request, or too fast. */
const refused = [wrongState, gone, slow] as const;

/** An agent's call on a claim that failed: the state now, a lease that ran out, or no request. */
const lostOr = [wrongState, lost, gone] as const;

/**
 * What a claim allows (judged rule 15). The `request.next` answer carries it, and the CLI prints
 * it before the request.
 */
export const claimNote = z.string();

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
  "request.edit": {
    input: z.strictObject({ ...one, text }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("edited") }), ...refused]),
  },
  "request.answer": {
    input: z.strictObject({ ...one, text, option: z.number().int().min(0).max(5).optional() }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("answered") }), ...refused]),
  },
  "request.accept": {
    input: z.strictObject(one),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("accepted") }), ...refused]),
  },
  "request.reopen": {
    input: z.strictObject({ ...one, text }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("reopened") }),
      ...refused,
      full,
    ]),
  },
  "request.close": {
    input: z.strictObject({ ...one, text: text.optional() }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("closed") }), ...refused]),
  },
});

/** `request.next`'s input: `n` needs `canvas` (rule 21). */
export const nextInput = z
  .strictObject({
    canvas: canvasKey.optional(),
    n: requestN.optional(),
    lease: lease.optional(),
    wait: wait.optional(),
  })
  .refine((call) => call.n === undefined || call.canvas !== undefined, "n needs canvas");

/** The calls of an agent: the `user` guard runs first. */
export const queueApi = rpc({
  "request.next": {
    input: nextInput,
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("claimed"),
        request,
        messages: z.array(message),
        /** The frame now; `null` for a request on the canvas, or a frame that was removed. */
        frame: frame.nullable(),
        /** The version that the viewer saw, with its document; `null` when it is not kept. */
        saw: z.object({ version: z.number(), doc: z.string() }).nullable(),
        /** For a request on the canvas: its frames. Else `null`. */
        frames: z.array(frameInfo).nullable(),
        claim: z.string(),
        until: z.number(),
        now: z.number(),
        note: claimNote,
      }),
      z.object({ kind: z.literal("empty") }),
    ]),
  },
  "request.extend": {
    input: z.strictObject({ claim: claimHandle, lease: lease.optional() }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("extended"), until: z.number(), now: z.number() }),
      ...lostOr,
    ]),
  },
  "request.release": {
    input: z.strictObject({ claim: claimHandle, reason: text }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("released") }), ...lostOr]),
  },
  "request.decline": {
    input: z.strictObject({ claim: claimHandle, reason: text }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("declined") }), ...lostOr]),
  },
  "request.ask": {
    input: z.strictObject({
      claim: claimHandle,
      text,
      html: htmlPart.optional(),
      options: options.optional(),
    }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("asked") }), ...lostOr]),
  },
  "request.resolve": {
    input: z.strictObject({ claim: claimHandle, text, html: htmlPart.optional() }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("resolved") }), ...lostOr]),
  },
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
  "request.next": ["claimed", "empty"],
  "request.extend": ["extended"],
  "request.release": ["released"],
  "request.decline": ["declined"],
  "request.ask": ["asked"],
  "request.resolve": ["resolved"],
  "request.list": ["listed"],
} as const satisfies { readonly [A in QueueAddress]: readonly QueueKind<A>[] };

/** SPEC.md rule 1: the success kinds of a viewer's calls. */
export const requestSuccessKinds = {
  "request.add": ["added"],
  "request.edit": ["edited"],
  "request.answer": ["answered"],
  "request.accept": ["accepted"],
  "request.reopen": ["reopened"],
  "request.close": ["closed"],
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
