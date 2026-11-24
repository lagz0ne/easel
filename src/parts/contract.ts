import { rpc } from "@tinkered/core";
import { z } from "zod";

import { canvasKey, frameId } from "@/frames/contract";

const revision = z.number().int().nonnegative();

const partName = z.object({ id: z.string(), name: z.string(), rev: revision });

const partCopies = z.object({
  canvas: z.string(),
  id: z.string(),
  linked: z.number().int().nonnegative(),
  edited: z.number().int().nonnegative(),
});

const partRow = partName.extend({
  source: z.object({ canvas: z.string(), frame: z.string(), version: z.number() }),
  copies: z.array(partCopies),
});

export const partsContracts = {
  "parts.list": {
    input: z.object({}),
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("found"),
        kit: z.number(),
        rev: revision,
        parts: z.array(partRow),
      }),
    ]),
  },
  "parts.publish": {
    input: z.object({ canvas: canvasKey }),
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.enum(["updated", "unchanged"]),
        kit: z.number(),
        rev: revision,
        parts: z.array(partName),
      }),
      z.object({ kind: z.literal("gone") }),
    ]),
  },
  "parts.show": {
    input: z.object({ canvas: canvasKey, id: frameId }),
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("found"),
        kit: z.number(),
        version: z.number(),
        html: z.string(),
      }),
      z.object({ kind: z.literal("gone") }),
    ]),
  },
};

export const partsApi = rpc(partsContracts);

export type PartsAddress = Extract<keyof typeof partsApi.contracts, string>;

type KindOf<A extends PartsAddress> =
  Awaited<ReturnType<(typeof partsApi)[A]["run"]>> extends infer O
    ? O extends { kind: infer K }
      ? K
      : never
    : never;

export const partsSuccessKinds = {
  "parts.list": ["found"],
  "parts.publish": ["updated", "unchanged"],
  "parts.show": ["found"],
} as const satisfies { readonly [A in PartsAddress]: readonly KindOf<A>[] };
