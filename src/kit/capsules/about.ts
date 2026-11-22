import { operation } from "@tinkered/core";
import { z } from "zod";

import type { CapsuleRow } from "./row";

// What a capsule of the kit says about itself (docs/decisions/kit-capsules.md): each capsule has
// its own `<label>.about` tag among its fixed tags, so the scope's list of capsules
// (`scope.capsules`) shows it by its label. A tool reads that list, not a document.

/**
 * What a capsule does, how a frame installs it, and for each export what it does and one line of
 * code that uses it.
 */
export const aboutShape = z.object({
  does: z.string(),
  install: z.string(),
  exports: z.record(z.string(), z.object({ does: z.string(), use: z.string() })),
});

export type About = z.infer<typeof aboutShape>;

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
    if ((typeof unit !== "object" && typeof unit !== "function") || unit === null) {
      return "value" as const;
    }
    if (Reflect.get(unit, "kind") === "reader") return "cell" as const;

    const found = kinds.find(({ fields }) => fields.every((field) => field in unit));
    return found?.kind ?? ("value" as const);
  },
});

/** How a body uses a unit that it depends on: by the kind of the unit, or of an edge's target. */
const hows = {
  resource: "uses",
  operation: "calls",
  cell: "reads",
  tag: "reads",
  value: "uses",
} as const;

/**
 * The edges of a unit (`depends`): each unit it depends on, with its label and how. A controller
 * of a cell `writes`; a tag's `required` or `optional` edge `reads`.
 */
export const edgesOf = operation({
  label: "kit.capsules.edgesOf",
  input: z.unknown(),
  depends: { kindOf, fieldOf },
  run: ({ kindOf, fieldOf }, { input: unit }) => {
    const depends = z
      .record(z.string(), z.unknown())
      .catch({})
      .parse(fieldOf.run({ input: { unit, key: "depends" } }));

    return Object.entries(depends).map(([as, dep]) => {
      const edge = fieldOf.run({ input: { unit: dep, key: "kind" } });
      const target = edge === "controller" || edge === "required" || edge === "optional";
      const to = target ? fieldOf.run({ input: { unit: dep, key: "target" } }) : dep;

      const kind = kindOf.run({ input: to });
      const label = z
        .string()
        .catch("?")
        .parse(fieldOf.run({ input: { unit: to, key: "label" } }));
      const how: (typeof hows)[keyof typeof hows] | "writes" =
        edge === "controller" ? (kind === "cell" ? "writes" : "calls") : hows[kind];
      return { as, unit: label, how };
    });
  },
});

/** The texts of a part's `text` unit, from its `copy.texts` tag: each key with its English text. */
export const textsOf = operation({
  label: "kit.capsules.textsOf",
  input: z.unknown(),
  depends: { fieldOf },
  run: ({ fieldOf }, { input: unit }) => {
    const tags = z
      .array(z.object({ tag: z.unknown(), value: z.unknown() }))
      .catch([])
      .parse(fieldOf.run({ input: { unit, key: "tags" } }));
    const found = tags.find(
      ({ tag }) => fieldOf.run({ input: { unit: tag, key: "label" } }) === "copy.texts",
    );
    const en = z
      .object({
        en: z.record(
          z.string(),
          z.union([z.string(), z.object({ one: z.string(), other: z.string() })]),
        ),
      })
      .safeParse(found?.value);
    if (!en.success) return undefined;

    return Object.fromEntries(
      Object.entries(en.data.en).map(([key, text]) => [
        key,
        typeof text === "string" ? text : `${text.one} | ${text.other}`,
      ]),
    );
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
  depends: { schemaOf, kindOf, fieldOf, edgesOf, textsOf },
  run: (units, { input: { record, handle } }): CapsuleRow => {
    const { schemaOf, kindOf, fieldOf, edgesOf, textsOf } = units;
    const about = aboutShape.parse(record.tags[`${record.label}.about`]);

    const config = Object.entries(handle.config ?? {}).map(([key, entry]) => {
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

    const exports = Object.entries(about.exports).map(([name, { does, use }]) => {
      const unit: unknown = Reflect.get(handle, name);
      const kind = kindOf.run({ input: unit });
      const parse =
        kind === "operation" ? fieldOf.run({ input: { unit, key: "input" } }) : undefined;
      const input = parse === undefined ? null : schemaOf.run({ input: parse });

      const texts = textsOf.run({ input: unit });
      const depends = edgesOf.run({ input: unit });
      return {
        name,
        kind,
        does,
        use,
        depends,
        ...(input === null ? {} : { input }),
        ...(texts === undefined ? {} : { texts }),
      };
    });

    return { label: record.label, does: about.does, install: about.install, config, exports };
  },
});
