import { data } from "@tinkered/core";
import { z } from "zod";

import { kitFixtures } from "./fixtures";
import { teamTexts } from "./texts";

export const boardPiece = z.object({ name: z.string(), template: z.string() });

export const boardKit = z.object({
  canvas: z.string(),
  kit: z.number(),
  look: z.string(),
  css: z.string(),
  pieces: z.array(boardPiece),
  texts: teamTexts,
  fixtures: kitFixtures.optional(),
});

export type BoardKit = z.infer<typeof boardKit>;

export const kit = data({
  label: "kit.kit",
  mode: "keyed",
  parse: boardKit,
  key: (k) => ({ canvas: k.canvas }),
});
