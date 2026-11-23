import { data } from "@tinkered/core";
import { z } from "zod";

export const boardPiece = z.object({ name: z.string(), template: z.string() });

export const boardKit = z.object({
  canvas: z.string(),
  kit: z.number(),
  look: z.string(),
  css: z.string(),
  pieces: z.array(boardPiece),
});

export type BoardKit = z.infer<typeof boardKit>;

export const kit = data({
  label: "kit.kit",
  mode: "keyed",
  parse: boardKit,
  key: (k) => ({ canvas: k.canvas }),
});
