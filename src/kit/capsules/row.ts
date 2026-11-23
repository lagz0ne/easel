import { z } from "zod";

export const configRow = z.object({
  key: z.string(),
  tag: z.string(),
  required: z.boolean(),
  schema: z.unknown(),
});

export const edgeRow = z.object({
  as: z.string(),
  unit: z.string(),
  how: z.enum(["uses", "reads", "writes", "calls"]),
});

export const exportRow = z.object({
  name: z.string(),
  kind: z.enum(["resource", "operation", "cell", "tag", "value"]),
  does: z.string(),
  use: z.string(),
  depends: z.array(edgeRow),
  input: z.unknown().optional(),
  texts: z.record(z.string(), z.string()).optional(),
});

export const capsuleRow = z.object({
  label: z.string(),
  does: z.string(),
  install: z.string(),
  config: z.array(configRow),
  exports: z.array(exportRow),
});

export type CapsuleRow = z.infer<typeof capsuleRow>;

export const startRow = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started") }),
  z.object({ kind: z.literal("refused"), refused: z.string(), payload: z.unknown() }),
]);
