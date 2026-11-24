import { rpc } from "@tinkered/core";
import { z } from "zod";

import { canvasKey } from "@/frames/contract";
import { textKey, textShape } from "@/kit/texts";

export const textUse = z.object({
  canvas: z.string(),
  id: z.string(),
  name: z.string(),
  page: z.string(),
});

export type TextUse = z.infer<typeof textUse>;

export const usedText = z.object({
  key: textKey,
  en: textShape,
  vi: textShape.optional(),
  uses: z.array(textUse),
});

export type UsedText = z.infer<typeof usedText>;

export const unknownKey = z.object({ key: z.string(), uses: z.array(textUse) });

export const ownText = z.object({ text: z.string(), uses: z.array(textUse) });

export type OwnText = z.infer<typeof ownText>;

export const textsUsesOutput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("found"),
    kit: z.number(),
    rev: z.number(),
    frames: z.number(),
    pictures: z.number(),
    texts: z.array(usedText),
    unknown: z.array(unknownKey),
    own: z.array(ownText),
    missing: z.object({ vi: z.array(textKey) }),
  }),
]);

export type TextsUses = z.infer<typeof textsUsesOutput>;

export const wordsContracts = {
  "texts.uses": {
    input: z.object({ canvas: canvasKey.optional() }),
    output: textsUsesOutput,
  },
};

export const wordsApi = rpc(wordsContracts);

export const wordsSuccessKinds = { "texts.uses": ["found"] } as const;
