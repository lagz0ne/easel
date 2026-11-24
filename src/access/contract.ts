import { rpc } from "@tinkered/core";
import { z } from "zod";

export const codeLetters = "BCDFGHJKLMNPQRSTVWXZ";

export const code = z
  .string()
  .transform((raw) => raw.toUpperCase().replaceAll(/[\s-]/g, ""))
  .pipe(z.string().regex(new RegExp(`^[${codeLetters}]{8}$`), "not a code"))
  .transform((letters) => `${letters.slice(0, 4)}-${letters.slice(4)}`);

export const name = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, "1 to 32 of a-z, 0-9, - and _, not starting with - or _");

export const digest = z.string().regex(/^[0-9a-f]{64}$/, "not a SHA-256 hex digest");

export const request = z.string().regex(/^[0-9a-f]{32}$/, "not a request");

export const roles = ["owner", "member"] as const;

const user = z.object({ name: z.string(), role: z.enum(roles), since: z.number() });
export type User = z.infer<typeof user>;

const pendingRequest = z.object({
  code: z.string(),
  name: z.string(),
  since: z.number(),
  expiresAt: z.number(),
  browser: z.boolean(),
});

export type Request = z.infer<typeof pendingRequest>;

export const sessionId = z.string().regex(/^[0-9a-f]{12}$/, "not a session");

const browserSession = z.object({
  id: z.string(),
  name: z.string(),
  browser: z.string(),
  since: z.number(),
  used: z.number(),
});

export type Session = z.infer<typeof browserSession>;

export const sessionCookie = "easel_session_secret";

export const sessionSecret = z.string().regex(/^[0-9a-f]{64}$/, "not a session secret");

export const signInLink = z.string().regex(/^[0-9a-f]{64}$/, "not a sign-in link");

export const authPaths = { code: "/auth/code", open: "/auth/open", out: "/auth/out" } as const;

export const openPath = "/open";

const granted = z.object({ kind: z.literal("granted"), user });
const taken = z.object({ kind: z.literal("taken") });
const slow = z.object({ kind: z.literal("slow"), retryIn: z.number() });
const gone = z.object({ kind: z.literal("gone") });
const denied = z.object({ kind: z.literal("denied") });

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

export const browserApi = rpc({
  "browser.start": {
    input: z.object({ name }),
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("pending"),
        code: z.string(),
        request: z.string(),
        expiresAt: z.number(),
      }),
      slow,
    ]),
  },
  "browser.wait": {
    input: z.object({ request }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("approved") }),
      z.object({ kind: z.literal("pending") }),
      denied,
      z.object({ kind: z.literal("expired") }),
      slow,
    ]),
  },
});

export const openApi = rpc({
  "browser.link": {
    input: z.null(),
    output: z.object({ kind: z.literal("link"), link: z.string(), expiresAt: z.number() }),
  },
});

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

export const ownerContracts = {
  "users.add": {
    input: z.object({ name, digest, owner: z.boolean().optional() }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("added"), user }), taken]),
  },
  "users.list": {
    input: z.null(),
    output: z.object({
      users: z.array(user),
      requests: z.array(pendingRequest),
      sessions: z.array(browserSession),
    }),
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
  "users.end": {
    input: z.object({ session: sessionId }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("ended") }), gone]),
  },
};

export const ownerApi = rpc(ownerContracts);

type Api = typeof loginApi & typeof browserApi & typeof openApi & typeof userApi & typeof ownerApi;

type Address =
  | "login.start"
  | "login.setup"
  | "login.wait"
  | "browser.start"
  | "browser.wait"
  | "browser.link"
  | "users.me"
  | "login.end";

type OwnerAddress =
  | "users.add"
  | "users.list"
  | "users.approve"
  | "users.deny"
  | "users.revoke"
  | "users.end";

type KindOf<A extends Address | OwnerAddress> =
  Awaited<ReturnType<Api[A]["run"]>> extends infer O
    ? O extends { kind: infer K }
      ? K
      : never
    : never;

export const successKinds = {
  "login.start": ["pending", "granted"],
  "login.setup": ["granted"],
  "login.wait": ["granted", "pending"],
  "browser.start": ["pending"],
  "browser.wait": ["approved", "pending"],
  "browser.link": ["link"],
  "users.me": ["me"],
  "login.end": ["ended"],
  "users.add": ["added"],
  "users.list": "always",
  "users.approve": ["approved"],
  "users.deny": ["denied"],
  "users.revoke": ["revoked"],
  "users.end": ["ended"],
} as const satisfies {
  readonly [A in Address | OwnerAddress]: KindOf<A> extends never ? "always" : readonly KindOf<A>[];
};
