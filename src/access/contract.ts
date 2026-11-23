import { rpc } from "@tinkered/core";
import { z } from "zod";

// access's contract: the CLI, MCP and the page import it. Three services, one per guard:
// `loginApi` runs no guard, `userApi` runs `user`, `ownerApi` runs `user` then `owner`
// (SPEC-access.md, fact rules 1-3). No answer carries a token or a digest.

/** RFC 8628 section 6.1: consonants only, so no look-alikes and no words. */
export const codeLetters = "BCDFGHJKLMNPQRSTVWXZ";

/** A code as typed: case, spaces and the hyphen do not matter. It reads back as `XXXX-XXXX`. */
export const code = z
  .string()
  .transform((raw) => raw.toUpperCase().replaceAll(/[\s-]/g, ""))
  .pipe(z.string().regex(new RegExp(`^[${codeLetters}]{8}$`), "not a code"))
  .transform((letters) => `${letters.slice(0, 4)}-${letters.slice(4)}`);

/** A user's name: as a Unix login, lower case, so `Ann` and `ann` are one name. */
export const name = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, "1 to 32 of a-z, 0-9, - and _, not starting with - or _");

/** The SHA-256 of the token the CLI made, as 64 hex digits. */
export const digest = z.string().regex(/^[0-9a-f]{64}$/, "not a SHA-256 hex digest");

/** A login's own name for `login.wait`: 128 random bits, as 32 hex digits. */
export const request = z.string().regex(/^[0-9a-f]{32}$/, "not a request");

export const roles = ["owner", "member"] as const;

const user = z.object({ name: z.string(), role: z.enum(roles), since: z.number() });
export type User = z.infer<typeof user>;

const pendingRequest = z.object({
  code: z.string(),
  name: z.string(),
  since: z.number(),
  expiresAt: z.number(),
});

export type Request = z.infer<typeof pendingRequest>;

const granted = z.object({ kind: z.literal("granted"), user });
const taken = z.object({ kind: z.literal("taken") });
/** `retryIn`: milliseconds until the call is let through again. */
const slow = z.object({ kind: z.literal("slow"), retryIn: z.number() });
const gone = z.object({ kind: z.literal("gone") });
const denied = z.object({ kind: z.literal("denied") });

/** The calls with no token. */
export const loginApi = rpc({
  "login.start": {
    input: z.object({ name, digest }),
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("pending"),
        code: z.string(),
        request: z.string(),
        expiresAt: z.number(),
      }),
      granted,
      taken,
      slow,
    ]),
  },
  "login.setup": {
    input: z.object({ name, code, digest }),
    output: z.discriminatedUnion("kind", [
      granted,
      taken,
      z.object({ kind: z.literal("wrong") }),
      slow,
    ]),
  },
  "login.wait": {
    input: z.object({ request }),
    output: z.discriminatedUnion("kind", [
      granted,
      z.object({ kind: z.literal("pending") }),
      denied,
      z.object({ kind: z.literal("expired") }),
      slow,
    ]),
  },
});

/** The calls of any user: `easel whoami` and `easel logout`. */
export const userApi = rpc({
  "users.me": {
    input: z.null(),
    output: z.object({ kind: z.literal("me"), name: z.string(), owner: z.boolean() }),
  },
  "login.end": {
    input: z.null(),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ended") }),
      z.object({ kind: z.literal("last") }),
    ]),
  },
});

/** The calls of an owner. */
/** The calls of `ownerApi`, as written: MCP reads their schemas (rpc keeps no output schema). */
export const ownerContracts = {
  "users.list": {
    input: z.null(),
    output: z.object({ users: z.array(user), requests: z.array(pendingRequest) }),
  },
  "users.approve": {
    input: z.object({ code, owner: z.boolean().optional() }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("approved"), user }), gone]),
  },
  "users.deny": {
    input: z.object({ code }),
    output: z.discriminatedUnion("kind", [denied, gone]),
  },
  "users.revoke": {
    input: z.object({ name }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("revoked") }),
      z.object({ kind: z.literal("last") }),
      gone,
    ]),
  },
};

export const ownerApi = rpc(ownerContracts);

type Api = typeof loginApi & typeof userApi & typeof ownerApi;

type Address = "login.start" | "login.setup" | "login.wait" | "users.me" | "login.end";

type OwnerAddress = "users.list" | "users.approve" | "users.deny" | "users.revoke";

type KindOf<A extends Address | OwnerAddress> =
  Awaited<ReturnType<Api[A]["run"]>> extends infer O
    ? O extends { kind: infer K }
      ? K
      : never
    : never;

/**
 * SPEC.md rule 1: the one list of success kinds, by call. The CLI's exit code and MCP's
 * `isError` read it, and nothing else decides. `always`: the call answers no kind, and is a
 * success.
 */
export const successKinds = {
  "login.start": ["pending", "granted"],
  "login.setup": ["granted"],
  "login.wait": ["granted", "pending"],
  "users.me": ["me"],
  "login.end": ["ended"],
  "users.list": "always",
  "users.approve": ["approved"],
  "users.deny": ["denied"],
  "users.revoke": ["revoked"],
} as const satisfies {
  readonly [A in Address | OwnerAddress]: KindOf<A> extends never ? "always" : readonly KindOf<A>[];
};
