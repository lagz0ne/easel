import { data } from "@tinkered/core";
import { z } from "zod";

// The kit's board cell (SPEC-kit.md § Contract): `kit`, keyed by canvas, with the same value for
// each canvas. It rides `easel.board` (`framesBoard`), so the one `mayRead` guard covers it. This
// file imports nothing from frames, so frames' contract can import it. Only the kit store writes
// it, at scope (`kit.atScope`): a write in a call's request session stays in that session.

/** An element piece on the board: its name and its template. */
export const boardPiece = z.object({ name: z.string(), template: z.string() });

/**
 * A canvas's kit: the kit version, the look as an unlayered `:root` block of look values, the
 * kit's made CSS (theme, base, components, the classes of the templates) and the element pieces.
 */
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
