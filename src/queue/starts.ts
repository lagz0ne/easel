import { rpc } from "@tinkered/core";
import { z } from "zod";

import { canvasKey } from "@/frames/contract";

import { channelName } from "./channels";
import { limitKind } from "./holds";

export const maxRunningLimit = 20;
export const maxPerDayLimit = 500;
export const defaultLimits = { running: 2, perDay: 20 } as const;
export const silentAfterMs = 60_000;
export const maxCause = 300;

export const limits = z.object({
  running: z.number().int().min(1).max(maxRunningLimit),
  perDay: z.number().int().min(1).max(maxPerDayLimit),
});

export type Limits = z.infer<typeof limits>;

export const startRef = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}:\d{1,9}:\d{1,16}$/, "<canvas>:<n>:<period>")
  .transform((ref) => {
    const [canvas = "", n = "0", period = "0"] = ref.split(":");
    return { canvas, n: Number(n), period: Number(period) };
  });

const count = z.number().int().min(0).max(1_000_000);

export const reportInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("state"),
    channel: channelName,
    running: count,
    today: count,
    at: limitKind.nullable(),
  }),
  z.strictObject({
    kind: z.literal("started"),
    channel: channelName,
    ref: z.string(),
    agent: z.string().min(1).max(100),
  }),
  z.strictObject({
    kind: z.literal("failed"),
    channel: channelName,
    ref: z.string(),
    cause: z.string().min(1).max(maxCause),
    retryMs: z.number().int().min(0).max(86_400_000),
  }),
]);

const gone = z.object({ kind: z.literal("gone") });
const notNats = z.object({ kind: z.literal("notNats") });
const notPerson = z.object({ kind: z.literal("notPerson") });

export const startsContracts = {
  "request.agree": {
    input: z.strictObject({ canvas: canvasKey, n: z.number().int().positive() }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("agreed") }),
      z.object({ kind: z.literal("wrongState"), state: z.string() }),
      gone,
      notPerson,
    ]),
  },
  "channel.limits": {
    input: z.strictObject({
      name: channelName,
      running: limits.shape.running.optional(),
      perDay: limits.shape.perDay.optional(),
    }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("saved"), limits }),
      gone,
      notNats,
      notPerson,
    ]),
  },
  "channel.report": {
    input: reportInput,
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("noted"), limits }),
      gone,
      notNats,
    ]),
  },
};

export const startsApi = rpc(startsContracts);

export type StartsAddress = Extract<keyof typeof startsApi.contracts, string>;

type KindOf<O> = O extends { kind: infer K } ? K : never;

type StartsKind<A extends StartsAddress> = KindOf<
  Awaited<ReturnType<(typeof startsApi)[A]["run"]>>
>;

export const startsSuccessKinds = {
  "request.agree": ["agreed"],
  "channel.limits": ["saved"],
  "channel.report": ["noted"],
} as const satisfies { readonly [A in StartsAddress]: readonly StartsKind<A>[] };
