import { z } from "zod";

// The shapes of the list of capsules (SPEC-kit.md § The capsules): what `kit.capsules` answers,
// and what the CLI and the MCP show. The page, the CLI and the server share them, so this file
// imports no server code.

/** One config key of a capsule: its tag, if the install must give it, and its JSON Schema. */
export const configRow = z.object({
  key: z.string(),
  tag: z.string(),
  required: z.boolean(),
  schema: z.unknown(),
});

/**
 * One edge of the graph: the unit that an export depends on, by the name that its body reads it
 * under (`as`), and how: it `uses` a resource, `reads` a cell or a tag, `writes` a cell, or
 * `calls` an operation.
 */
export const edgeRow = z.object({
  as: z.string(),
  unit: z.string(),
  how: z.enum(["uses", "reads", "writes", "calls"]),
});

/**
 * One export of a capsule: its name, its kind, what it does, a line of code that uses it, the
 * units it depends on, the JSON Schema of an operation's input, and the texts of a part's `text`
 * (each key with its English text).
 */
export const exportRow = z.object({
  name: z.string(),
  kind: z.enum(["resource", "operation", "cell", "tag", "value"]),
  does: z.string(),
  use: z.string(),
  depends: z.array(edgeRow),
  input: z.unknown().optional(),
  texts: z.record(z.string(), z.string()).optional(),
});

/** One capsule: its label, what it does, how a frame installs it, its config and its exports. */
export const capsuleRow = z.object({
  label: z.string(),
  does: z.string(),
  install: z.string(),
  config: z.array(configRow),
  exports: z.array(exportRow),
});

export type CapsuleRow = z.infer<typeof capsuleRow>;

/** The start of the kit's capsules with the look of a kit version: `started`, or its refusal. */
export const startRow = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started") }),
  z.object({ kind: z.literal("refused"), refused: z.string(), payload: z.unknown() }),
]);
