import { operation } from "@tinkered/core";
import { z } from "zod";

// What a capsule of the kit says about itself (docs/decisions/kit-capsules.md): each capsule has
// its own `<label>.about` tag among its fixed tags, so the scope's list of capsules
// (`scope.capsules`) shows it by its label. A tool reads that list, not a document.

/** What a capsule does, and what each of its exports does. */
export const aboutShape = z.object({
  does: z.string(),
  exports: z.record(z.string(), z.string()),
});

export type About = z.infer<typeof aboutShape>;

/** One config key of a capsule, as a tool shows it: its tag, if it needs a value, and its schema. */
type ConfigKey = { key: string; tag: string; required: boolean; schema: unknown };

/** One export of a capsule: its name, its kind, what it does, and the schema of its input. */
type ExportRow = { name: string; kind: string; does: string; input?: unknown };

/** A field of a unit: a tag is a function with fields, the other units are objects. */
const fieldOf = operation({
  label: "kit.capsules.fieldOf",
  input: z.object({ unit: z.unknown(), key: z.string() }),
  run: (_, { input: { unit, key } }): unknown =>
    (typeof unit === "object" || typeof unit === "function") && unit !== null
      ? Reflect.get(unit, key)
      : undefined,
});

/** The JSON Schema of a parser: a zod schema gives one; a parse function gives none. */
const schemaOf = operation({
  label: "kit.capsules.schemaOf",
  input: z.unknown(),
  run: (_, { input }) => (input instanceof z.ZodType ? z.toJSONSchema(input) : null),
});

/**
 * The kind of an export, by the fields that Tinker gives each kind of unit. An exported cell shows
 * as its reader (ADR 0123): others read it and cannot write it.
 */
const kinds = [
  { kind: "resource", fields: ["factory"] },
  { kind: "operation", fields: ["run", "depends"] },
  { kind: "cell", fields: ["initial"] },
  { kind: "tag", fields: ["parse", "label"] },
] as const;

const kindOf = operation({
  label: "kit.capsules.kindOf",
  input: z.unknown(),
  run: (_, { input: unit }) => {
    if ((typeof unit !== "object" && typeof unit !== "function") || unit === null) return "value";
    if (Reflect.get(unit, "kind") === "reader") return "cell";

    const found = kinds.find(({ fields }) => fields.every((field) => field in unit));
    return found?.kind ?? "value";
  },
});

/**
 * A capsule as a tool shows it (the MCP list of the kit): its label and what it does, each config
 * key with its schema, and each export with its kind, what it does, and its input schema. `record`
 * is the capsule's row of `scope.capsules`; `handle` is the capsule.
 */
export const describeCapsule = operation({
  label: "kit.capsules.describe",
  input: z.object({
    record: z.object({ label: z.string(), tags: z.record(z.string(), z.unknown()) }),
    handle: z.object({ config: z.record(z.string(), z.unknown()).optional() }).loose(),
  }),
  depends: { schemaOf, kindOf, fieldOf },
  run: ({ schemaOf, kindOf, fieldOf }, { input: { record, handle } }) => {
    const about = aboutShape.parse(record.tags[`${record.label}.about`]);

    const config: ConfigKey[] = Object.entries(handle.config ?? {}).map(([key, entry]) => {
      // A required key is an edge ({ kind: "required", target: tag }); a key with a default, the tag.
      const kind = fieldOf.run({ input: { unit: entry, key: "kind" } });
      const tag =
        kind === undefined ? entry : fieldOf.run({ input: { unit: entry, key: "target" } });
      return {
        key,
        tag: z.string().parse(fieldOf.run({ input: { unit: tag, key: "label" } })),
        required: kind === "required",
        schema: schemaOf.run({ input: fieldOf.run({ input: { unit: tag, key: "parse" } }) }),
      };
    });

    const exports: ExportRow[] = Object.entries(about.exports).map(([name, does]) => {
      const unit: unknown = Reflect.get(handle, name);
      const kind = kindOf.run({ input: unit });
      const parse =
        kind === "operation" ? fieldOf.run({ input: { unit: unit, key: "input" } }) : undefined;
      const schema = parse === undefined ? null : schemaOf.run({ input: parse });
      return schema === null ? { name, kind, does } : { name, kind, does, input: schema };
    });

    return { label: record.label, does: about.does, config, exports };
  },
});
