import { operation } from "@tinkered/core";
import { z } from "zod";

import type { CapsuleRow } from "./row";

export const aboutShape = z.object({
  does: z.string(),
  install: z.string(),
  exports: z.record(z.string(), z.object({ does: z.string(), use: z.string() })),
});

export type About = z.infer<typeof aboutShape>;

const fieldOf = operation({
  label: "kit.capsules.fieldOf",
  input: z.object({ unit: z.unknown(), key: z.string() }),
  run: (_, { input: { unit, key } }): unknown =>
    (typeof unit === "object" || typeof unit === "function") && unit !== null
      ? Reflect.get(unit, key)
      : undefined,
});

const schemaOf = operation({
  label: "kit.capsules.schemaOf",
  input: z.unknown(),
  run: (_, { input }) => (input instanceof z.ZodType ? z.toJSONSchema(input) : null),
});

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

const hows = {
  resource: "uses",
  operation: "calls",
  cell: "reads",
  tag: "reads",
  value: "uses",
} as const;

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
