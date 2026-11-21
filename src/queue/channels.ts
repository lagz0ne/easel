import { rpc } from "@tinkered/core";
import { z } from "zod";

// The channels of the dispatcher, and its deliveries (SPEC-queue.md § A team lead sets the
// channels, § The dispatcher gets a request to the agents, § Contract). `channelApi` holds the
// calls of an owner: `user`, then `owner`, run first (fact rule 6). `request.deliveries` is an
// agent's call: it is in `queueApi`. The CLI and the server import this file.

/** The trigger of a channel when the team lead gives none: the mention of `claude-code-action`. */
export const defaultTrigger = "@claude";

/** A channel's name: 1 to 32 characters of `a-z`, `0-9` and `-`. */
export const channelName = z
  .string()
  .regex(/^[a-z0-9-]{1,32}$/, "1 to 32 characters of a-z, 0-9 and -");

/** A GitHub repository: `owner/name`. */
export const repoName = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, "owner/name, as acme/design");

/** A label or a trigger: 1 to 50 characters, not only spaces. */
const word = z
  .string()
  .max(50)
  .refine((typed) => typed.trim().length > 0, "1 to 50 characters");

/** A channel's token: 1 to 255 characters. No call answers it again. */
export const channelToken = z.string().min(1).max(255);

/** The kinds of channel. Only GitHub now; a webhook waits for a team that asks (E4.5). */
export const channelKind = z.enum(["github"]);

/** A channel, as `channel.list` shows it: the last 4 characters of the token, never the token. */
export const channelInfo = z.object({
  name: z.string(),
  kind: channelKind,
  repo: z.string(),
  label: z.string(),
  trigger: z.string(),
  tokenEnd: z.string(),
  created: z.number(),
});

export type ChannelInfo = z.infer<typeof channelInfo>;

/**
 * What a delivery does: `waiting` tells of a waiting period (it opens the issue, or writes on it
 * again); `out` makes the issue follow its request when it leaves the queue (a comment, then close).
 */
export const deliveryKind = z.enum(["waiting", "out"]);

/** A delivery's status: `pending` until it is sent, or until its attempts end. */
export const deliveryStatus = z.enum(["pending", "sent", "failed"]);

/** One delivery of a request to a channel, as `request.deliveries` shows it. */
export const delivery = z.object({
  request: z.string(),
  channel: z.string(),
  kind: deliveryKind,
  /** When the waiting period started, in ms since the epoch: it names the period. */
  period: z.number(),
  attempts: z.number(),
  status: deliveryStatus,
  /** Why the last attempt failed; `null` when none failed, or when it was sent. */
  cause: z.string().nullable(),
  /** The number of the GitHub issue; `null` before the first issue opens. */
  ref: z.number().nullable(),
  /** When the next attempt of a `pending` delivery runs; else `null`. */
  next: z.number().nullable(),
  created: z.number(),
  updated: z.number(),
});

export type Delivery = z.infer<typeof delivery>;

/** The calls of an owner on the channels, with their inputs and outputs. */
export const channelContracts = {
  "channel.set": {
    input: z.strictObject({
      name: channelName,
      kind: channelKind,
      repo: repoName,
      label: word,
      trigger: word.optional(),
      token: channelToken,
    }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("saved") }),
      z.object({ kind: z.literal("public") }),
      z.object({ kind: z.literal("refused"), status: z.number(), message: z.string() }),
    ]),
  },
  "channel.list": {
    input: z.strictObject({}),
    output: z.object({ kind: z.literal("listed"), channels: z.array(channelInfo) }),
  },
  "channel.remove": {
    input: z.strictObject({ name: channelName }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("removed") }),
      z.object({ kind: z.literal("gone") }),
    ]),
  },
};

/** The calls of an owner: `user`, then `owner`, run first (fact rule 6). */
export const channelApi = rpc(channelContracts);

export type ChannelAddress = Extract<keyof typeof channelApi.contracts, string>;

type KindOf<O> = O extends { kind: infer K } ? K : never;

type ChannelKind<A extends ChannelAddress> = KindOf<
  Awaited<ReturnType<(typeof channelApi)[A]["run"]>>
>;

/** SPEC.md rule 1: the success kinds of an owner's calls on the channels. */
export const channelSuccessKinds = {
  "channel.set": ["saved"],
  "channel.list": ["listed"],
  "channel.remove": ["removed"],
} as const satisfies { readonly [A in ChannelAddress]: readonly ChannelKind<A>[] };
