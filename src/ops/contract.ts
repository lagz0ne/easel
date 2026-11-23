import { rpc } from "@tinkered/core";
import { z } from "zod";

export const sides = ["server", "browser"] as const;

export const statuses = ["open", "resolved", "regressed", "human"] as const;

export const fingerprint = z.string().regex(/^[0-9a-f]{64}$/, "not a fingerprint");

export const traceId = z.string().regex(/^[0-9a-f]{32}$/, "not a trace id");

export const build = z.number().int().nonnegative();

export const errorGroup = z.object({
  fingerprint: z.string(),
  side: z.enum(sides),
  label: z.string(),
  name: z.string(),
  message: z.string(),
  count: z.number(),
  firstSeen: z.number(),
  lastSeen: z.number(),
  builds: z.array(z.number()),
  lastBuild: z.number(),
  traceId: z.string().nullable(),
  status: z.enum(statuses),
  fixedIn: z.number().nullable(),
  reason: z.string().nullable(),
});

export type ErrorGroup = z.infer<typeof errorGroup>;

export const sample = z.object({
  at: z.number(),
  build: z.number(),
  traceId: z.string().nullable(),
  message: z.string(),
});

export type Sample = z.infer<typeof sample>;

export const check = z.object({ name: z.string(), ok: z.boolean(), detail: z.string() });

export type Check = z.infer<typeof check>;

const gone = z.object({ kind: z.literal("gone") });
const held = z.object({ kind: z.literal("held") });

export const resolveAnswer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resolved") }),
  z.object({ kind: z.literal("notLive"), live: z.number() }),
  z.object({ kind: z.literal("failing"), seen: z.number() }),
  held,
  gone,
]);

export const opsUserContracts = {
  "ops.status": {
    input: z.null(),
    output: z.object({
      commit: z.string(),
      build: z.number(),
      uptime: z.number(),
      checks: z.array(check),
      counters: z.record(z.string(), z.number()),
      errors: z.object({
        hour: z.number(),
        day: z.number(),
        open: z.number(),
        unconfirmed: z.number(),
        dropped: z.number(),
      }),
      fixerSeen: z.number().nullable(),
      fixerSilent: z.boolean(),
    }),
  },
};

export const opsUserApi = rpc(opsUserContracts);

export const opsOwnerContracts = {
  "ops.errors": {
    input: z.object({
      open: z.boolean().optional(),
      side: z.enum(sides).optional(),
      since: z.number().optional(),
    }),
    output: z.object({ errors: z.array(errorGroup) }),
  },
  "ops.error": {
    input: z.union([z.object({ fingerprint }), z.object({ trace: traceId })]),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("found"), error: errorGroup, samples: z.array(sample) }),
      gone,
    ]),
  },
  "ops.resolveError": {
    input: z.object({ fingerprint, build: build.positive() }),
    output: resolveAnswer,
  },
  "ops.handOff": {
    input: z.object({ fingerprint, reason: z.string().trim().min(1).max(500) }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("handed") }), held, gone]),
  },
  "ops.fixerTick": {
    input: z.null(),
    output: z.object({ kind: z.literal("stamped"), at: z.number() }),
  },
};

export const opsOwnerApi = rpc(opsOwnerContracts);

type Api = typeof opsUserApi & typeof opsOwnerApi;

type Address = "ops.status" | "ops.errors" | "ops.error" | "ops.resolveError" | "ops.handOff";

type KindOf<A extends Address | "ops.fixerTick"> =
  Awaited<ReturnType<Api[A]["run"]>> extends infer O
    ? O extends { kind: infer K }
      ? K
      : never
    : never;

export const opsSuccessKinds = {
  "ops.status": "always",
  "ops.errors": "always",
  "ops.error": ["found"],
  "ops.resolveError": ["resolved"],
  "ops.handOff": ["handed"],
  "ops.fixerTick": ["stamped"],
} as const satisfies {
  readonly [A in Address | "ops.fixerTick"]: KindOf<A> extends never
    ? "always"
    : readonly KindOf<A>[];
};
