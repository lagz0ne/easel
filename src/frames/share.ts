import { rpc } from "@tinkered/core";
import { z } from "zod";

const secret = z.string().regex(/^[0-9a-f]{32}$/, "not a share link or pass");

export const shareLink = secret;

export const sharePath = z.string().regex(/^\/s\/[0-9a-f]{32}$/, "not a share link's path");

export const sharePass = secret;

export const sharePassword = z.string().min(8).max(1024);

export const typedPassword = z.string().min(1).max(1024);

export const viewerName = z.string().trim().min(1).max(40);

export const sharePrefix = "/s/";

export const passMeta = z.object({ pass: sharePass });

export const endedRefusal = { ended: true } as const;

export const lockedRefusal = { locked: true } as const;

export const shareApi = rpc({
  "share.open": {
    input: z.strictObject({
      link: shareLink,
      name: viewerName.optional(),
      password: typedPassword.optional(),
    }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("open"), canvas: z.string(), pass: z.string() }),
      z.object({ kind: z.literal("locked") }),
      z.object({ kind: z.literal("wrong") }),
      z.object({ kind: z.literal("slow"), retryIn: z.number() }),
      z.object({ kind: z.literal("gone") }),
    ]),
  },
});

export const shareSuccessKinds = { "share.open": ["open"] } as const;

export const passApi = rpc({
  "share.name": {
    input: z.strictObject({ canvas: z.string(), name: viewerName }),
    output: z.object({ kind: z.literal("named"), name: z.string() }),
  },
  "share.frame": {
    input: z.strictObject({ canvas: z.string(), id: z.string() }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("found"), page: z.string() }),
      z.object({ kind: z.literal("gone") }),
    ]),
  },
});

export const passSuccessKinds = { "share.name": ["named"], "share.frame": ["found"] } as const;
