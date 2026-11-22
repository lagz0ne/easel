import { z } from "zod";

// The shapes of the kit module (SPEC-kit.md § Contract) that the make step and the check use.

/**
 * The rule of a finding. `kit/script`: a frame script writes a class (judged rule 12).
 * `kit/class-built`: code builds a class in a class place of an app frame; `kit/parse`: an app
 * frame does not parse; `kit/import`: it imports a name that the runtime does not have;
 * `kit/react-state`: it keeps state in React; `kit/shape`: it does not export `logic` and `View`,
 * and only them (SPEC-kit.md § App frames). The last four refuse the put (`offKit`).
 */
export const ruleShape = z.enum([
  "look/color",
  "look/size",
  "look/override",
  "kit/class",
  "kit/piece",
  "kit/script",
  "kit/class-built",
  "kit/parse",
  "kit/import",
  "kit/react-state",
  "kit/shape",
]);

/** The rules of an app frame that refuse its put with `offKit` (SPEC-kit.md § App frames, "The put"). */
export const refusingRules: ReadonlySet<Rule> = new Set<Rule>([
  "kit/parse",
  "kit/import",
  "kit/react-state",
  "kit/shape",
]);

export type Rule = z.infer<typeof ruleShape>;

/**
 * The largest app frame: 256 KiB of UTF-8 (SPEC-kit.md § App frames, "The file"). The parse of
 * 1 MiB of TSX alone takes 40 to 50 ms, all of the speed budget of a put.
 */
export const maxAppBytes = 256 * 1024;

/** The UTF-8 bytes of a text, as the size limits count them (in the page and in Bun). */
export const utf8Bytes = z.string().transform((text) => new TextEncoder().encode(text).length);

/** One place in a document that is not in the look or the kit, with the fix. */
export type Finding = { line: number; col: number; rule: Rule; what: string; fix: string };

/** A finding as a call answers it (`frame.put`, `kit.check`). */
export const findingShape = z.object({
  line: z.number(),
  col: z.number(),
  rule: ruleShape,
  what: z.string(),
  fix: z.string(),
});

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
