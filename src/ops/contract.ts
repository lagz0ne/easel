import { rpc } from "@tinkered/core";
import { z } from "zod";

// ops's contract (SPEC-ops.md § Contract): the CLI, MCP and the page import it. Two services, one
// per guard: `opsUserApi` runs `user`, `opsOwnerApi` runs `user` then `owner` (fact rule 2). The
// sample message is an owner's only: no user call carries it.

export const sides = ["server", "browser"] as const;

export const statuses = ["open", "resolved", "regressed", "human"] as const;

/** A group's fingerprint: a SHA-256, as 64 hex digits. */
export const fingerprint = z.string().regex(/^[0-9a-f]{64}$/, "not a fingerprint");

/** A W3C trace id, as a `failed` fault carries it: 32 hex digits. */
export const traceId = z.string().regex(/^[0-9a-f]{32}$/, "not a trace id");

/** A build number: the count of commits on main (SPEC-ops.md § The build number). */
export const build = z.number().int().nonnegative();

export const errorGroup = z.object({
  fingerprint: z.string(),
  side: z.enum(sides),
  label: z.string(),
  name: z.string(),
  /** The sample message, secrets removed (judged rule 1). */
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

/** One sighting kept for the reader: when, on which build, its trace, and its message. */
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

/** `ops.resolveError`'s answers: `resolved` is its one success. */
export const resolveAnswer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("resolved") }),
  z.object({ kind: z.literal("notLive"), live: z.number() }),
  z.object({ kind: z.literal("failing"), seen: z.number() }),
  held,
  gone,
]);

/** The call of any user: `easel status`. */
export const opsUserApi = rpc({
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
});

/** The calls of an owner: the groups, their samples, and the moves a person makes. */
export const opsOwnerApi = rpc({
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
});

type Api = typeof opsUserApi & typeof opsOwnerApi;

type Address = "ops.status" | "ops.errors" | "ops.error" | "ops.resolveError" | "ops.handOff";

type KindOf<A extends Address | "ops.fixerTick"> =
  Awaited<ReturnType<Api[A]["run"]>> extends infer O
    ? O extends { kind: infer K }
      ? K
      : never
    : never;

/**
 * SPEC.md rule 1: ops's success kinds, by call. The CLI's exit code and MCP's `isError` read it.
 * `held` is no success (fact rule 8): the CLI exits 1.
 */
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
