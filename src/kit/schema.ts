import { z } from "zod";

// The shapes of the kit module (SPEC-kit.md § Contract) that the make step and the check use.

/** The rule of a finding. `kit/script`: a frame script writes a class (judged rule 12). */
export type Rule =
  | "look/color"
  | "look/size"
  | "look/override"
  | "kit/class"
  | "kit/piece"
  | "kit/script";

/** One place in a document that is not in the look or the kit, with the fix. */
export type Finding = { line: number; col: number; rule: Rule; what: string; fix: string };

/**
 * One kit version, as the make step and the check read it. `look` holds the look values by CSS
 * name (`--primary`, `--text-sm`, `--radius-md`, `--spacing`); `css` is the kit's own CSS (its
 * base rules and its class pieces, in Tailwind's syntax); `pieces` names the element pieces.
 * A kit version never changes, so its number is the key of all that is made from it.
 */
export const kitShape = z.object({
  version: z.number().int().positive(),
  look: z.record(z.string().regex(/^--[a-z][a-z0-9-]*$/), z.string().min(1)),
  css: z.string(),
  pieces: z.array(z.string().regex(/^k-[a-z0-9-]+$/)),
});

export type Kit = z.infer<typeof kitShape>;
