import { operation, rpc } from "@tinkered/core";
import { z } from "zod";

import {
  badImage,
  canvasKey,
  frame,
  frameId,
  frameInfo,
  imageInput,
  imageType,
  maxPictureSide,
  pageKey,
  version,
} from "@/frames/contract";
import { kitVersion } from "@/kit/contract";

import { message, request } from "./cells";
import { delivery } from "./channels";

export const maxTries = 3;

export const maxOpen = 200;

export const lease = z.number().int().min(30).max(3600);
export const defaultLease = 300;

export const maxWait = 50;
export const wait = z.number().min(0).max(maxWait);

export const maxHtmlBytes = 256 * 1024;

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

export const text = z
  .string()
  .max(2000)
  .refine((t) => t.trim().length > 0, "1 to 2000 characters");

export const clientKey = z.string().min(16).max(64);

export const htmlPart = z
  .string()
  .refine((html) => new TextEncoder().encode(html).length <= maxHtmlBytes, "at most 256 KiB")
  .refine((html) => /^\s*(<!doctype html|<html[\s>])/i.test(html), "a full HTML document");

export const options = z.array(z.string().min(1).max(200)).min(2).max(6);

export const requestN = z.number().int().positive();

export const claimHandle = z
  .string()
  .regex(/^[0-9a-f]{12}\.[0-9a-f]{32}$/, "not a claim: `easel next` prints it");

const place = z.number().finite();

const imageShot = z.strictObject({ kind: z.literal("image"), image: imageInput });

const corner = z.number().int().min(0).max(maxPictureSide);
const side = z.number().int().min(1).max(maxPictureSide);

const regionShot = z.strictObject({
  kind: z.literal("region"),
  x: corner,
  y: corner,
  w: side,
  h: side,
});

export const frameShot = z.discriminatedUnion("kind", [imageShot, regionShot]);

export const shotInfo = z.object({
  mimeType: imageType,
  w: z.number(),
  h: z.number(),
  url: z.string(),
});

export type ShotInfo = z.infer<typeof shotInfo>;

export const addInput = z.union([
  z.strictObject({
    canvas: canvasKey,
    frameId,
    version,
    kit: kitVersion.optional(),
    x: place,
    y: place,
    text,
    key: clientKey,
    shot: frameShot.optional(),
  }),
  z.strictObject({
    canvas: canvasKey,
    frameId: z.null(),
    version: z.null(),
    kit: kitVersion.optional(),
    x: place,
    y: place,
    page: pageKey.optional(),
    text,
    key: clientKey,
    shot: imageShot.optional(),
  }),
]);

const one = { canvas: canvasKey, n: requestN };

const gone = z.object({ kind: z.literal("gone") });
const full = z.object({ kind: z.literal("full") });
const slow = z.object({ kind: z.literal("slow"), retryIn: z.number() });
const wrongState = z.object({ kind: z.literal("wrongState"), state });
const lost = z.object({ kind: z.literal("lost") });
const tooBig = z.object({ kind: z.literal("tooBig"), maxBytes: z.number() });
const offFrame = z.object({ kind: z.literal("offFrame") });

const refused = [wrongState, gone, slow] as const;

const lostOr = [wrongState, lost, gone] as const;

export const claimNote = z.string();

export const requestContracts = {
  "request.add": {
    input: addInput,
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("added"), n: z.number() }),
      gone,
      full,
      slow,
      tooBig,
      badImage,
      offFrame,
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
};

export const requestApi = rpc(requestContracts);

export const nextInput = z
  .strictObject({
    canvas: canvasKey.optional(),
    n: requestN.optional(),
    lease: lease.optional(),
    wait: wait.optional(),
  })
  .refine((call) => call.n === undefined || call.canvas !== undefined, "n needs canvas");

export const queueContracts = {
  "request.next": {
    input: nextInput,
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("claimed"),
        request,
        messages: z.array(message),
        frame: frame.nullable(),
        saw: z.object({ version: z.number(), kit: z.number(), doc: z.string() }).nullable(),
        frames: z.array(frameInfo).nullable(),
        shot: shotInfo.nullable(),
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
  "request.deliveries": {
    input: z.strictObject(one),
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("listed"),
        deliveries: z.array(delivery),
        channels: z.number(),
      }),
      gone,
    ]),
  },
};

export const queueApi = rpc(queueContracts);

export type QueueAddress = Extract<keyof typeof queueApi.contracts, string>;
export type RequestAddress = Extract<keyof typeof requestApi.contracts, string>;

type KindOf<O> = O extends { kind: infer K } ? K : never;
type QueueKind<A extends QueueAddress> = KindOf<Awaited<ReturnType<(typeof queueApi)[A]["run"]>>>;

type RequestKind<A extends RequestAddress> = KindOf<
  Awaited<ReturnType<(typeof requestApi)[A]["run"]>>
>;

export const queueSuccessKinds = {
  "request.next": ["claimed", "empty"],
  "request.extend": ["extended"],
  "request.release": ["released"],
  "request.decline": ["declined"],
  "request.ask": ["asked"],
  "request.resolve": ["resolved"],
  "request.list": ["listed"],
  "request.deliveries": ["listed"],
} as const satisfies { readonly [A in QueueAddress]: readonly QueueKind<A>[] };

export const requestSuccessKinds = {
  "request.add": ["added"],
  "request.edit": ["edited"],
  "request.answer": ["answered"],
  "request.accept": ["accepted"],
  "request.reopen": ["reopened"],
  "request.close": ["closed"],
} as const satisfies { readonly [A in RequestAddress]: readonly RequestKind<A>[] };

const stillStates = { person: "person", asking: "question", closed: "closed" } as const;

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
