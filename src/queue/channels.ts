import { rpc } from "@tinkered/core";
import { z } from "zod";

export const defaultTrigger = "@claude";

export const channelName = z
  .string()
  .regex(/^[a-z0-9-]{1,32}$/, "1 to 32 characters of a-z, 0-9 and -");

export const repoName = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, "owner/name, as acme/design");

const word = z
  .string()
  .max(50)
  .refine((typed) => typed.trim().length > 0, "1 to 50 characters");

export const channelToken = z.string().min(1).max(255);

export const channelKind = z.enum(["github"]);

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

export const deliveryKind = z.enum(["waiting", "out"]);

export const deliveryStatus = z.enum(["pending", "sent", "failed"]);

export const delivery = z.object({
  request: z.string(),
  channel: z.string(),
  kind: deliveryKind,
  period: z.number(),
  attempts: z.number(),
  status: deliveryStatus,
  cause: z.string().nullable(),
  ref: z.number().nullable(),
  next: z.number().nullable(),
  created: z.number(),
  updated: z.number(),
});

export type Delivery = z.infer<typeof delivery>;

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

export const channelApi = rpc(channelContracts);

export type ChannelAddress = Extract<keyof typeof channelApi.contracts, string>;

type KindOf<O> = O extends { kind: infer K } ? K : never;

type ChannelKind<A extends ChannelAddress> = KindOf<
  Awaited<ReturnType<(typeof channelApi)[A]["run"]>>
>;

export const channelSuccessKinds = {
  "channel.set": ["saved"],
  "channel.list": ["listed"],
  "channel.remove": ["removed"],
} as const satisfies { readonly [A in ChannelAddress]: readonly ChannelKind<A>[] };
