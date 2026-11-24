import { rpc } from "@tinkered/core";
import { z } from "zod";

import { canvasKey } from "@/frames/contract";

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

export const channelKind = z.enum(["github", "nats"]);

export const natsUrl = z
  .string()
  .max(255)
  .regex(
    /^((nats|tls):\/\/[A-Za-z0-9.-]+(:\d{1,5})?|wss?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~-]+)*\/?)$/,
    "nats://host:port, tls://host:port, or ws:// or wss:// with a host and a path, with no user in it",
  );

export const natsSubject = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/, "tokens of A-Z, a-z, 0-9, _ and -, with dots");

export const natsInbox = z
  .string()
  .max(100)
  .regex(/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/, "an inbox prefix, as _INBOX_easel_dispatch");

export const defaultInbox = "_INBOX";

export const natsSeed = z.string().regex(/^SU[A-Z2-7]{56}$/, "the seed of a user nkey: SU…");

export const maxChannelCanvases = 50;

export const githubInfo = z.object({
  name: z.string(),
  kind: z.literal("github"),
  repo: z.string(),
  label: z.string(),
  trigger: z.string(),
  tokenEnd: z.string(),
  created: z.number(),
});

export const natsInfo = z.object({
  name: z.string(),
  kind: z.literal("nats"),
  url: z.string(),
  subject: z.string(),
  inbox: z.string(),
  canvases: z.array(z.string()),
  key: z.string(),
  limits: z.object({ running: z.number(), perDay: z.number() }),
  created: z.number(),
});

export const channelInfo = z.discriminatedUnion("kind", [githubInfo, natsInfo]);

export type ChannelInfo = z.infer<typeof channelInfo>;

export const deliveryKind = z.enum(["waiting", "out"]);

export const deliveryStatus = z.enum(["pending", "sent", "failed"]);

export const deliveryStart = z.object({
  status: z.enum(["started", "failed"]),
  agent: z.string().nullable(),
  cause: z.string().nullable(),
  at: z.number(),
});

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
  start: deliveryStart.nullable(),
});

export type Delivery = z.infer<typeof delivery>;

export const githubChannelSet = z.strictObject({
  name: channelName,
  kind: z.literal("github"),
  repo: repoName,
  label: word,
  trigger: word.optional(),
  token: channelToken,
});

export const natsChannelSet = z.strictObject({
  name: channelName,
  kind: z.literal("nats"),
  url: natsUrl,
  subject: natsSubject,
  seed: natsSeed,
  inbox: natsInbox.optional(),
  canvases: z.array(canvasKey).max(maxChannelCanvases).optional(),
});

export const channelContracts = {
  "channel.set": {
    input: z.discriminatedUnion("kind", [githubChannelSet, natsChannelSet]),
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
