import { resource } from "@tinkered/core";
import { z } from "zod";

export const jsonSchema = z
  .object({
    const: z.unknown().optional(),
    enum: z.array(z.unknown()).optional(),
    examples: z.array(z.unknown()).optional(),
    type: z.union([z.string(), z.array(z.string())]).optional(),
    pattern: z.string().optional(),
    minLength: z.number().optional(),
    minimum: z.number().optional(),
    required: z.array(z.string()).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    anyOf: z.array(z.unknown()).optional(),
    oneOf: z.array(z.unknown()).optional(),
  })
  .loose();

export type JsonSchema = z.infer<typeof jsonSchema>;

export const sampler = resource({
  label: "map.sampler",
  target: "scope",
  factory: () => {
    const atom = /^(\\.|\[(?:\\.|[^\]])*\]|\(\?:|\(|\)|\||[^?*+{])(?:\{(\d+)(?:,\d*)?\}|([?*+]))?/;
    const firstInClass = /^\[\^?(\\.|.)/;
    const listKeys = ["enum", "examples"] as const;
    const counts: Readonly<Record<string, number>> = { "": 1, "?": 0, "*": 0, "+": 1 };
    const letters: Readonly<Record<string, string>> = {
      "\\d": "0",
      "\\w": "a",
      "\\s": " ",
      "(": "",
      "(?:": "",
      ")": "",
    };

    const sampler = {
      letterOf: (part: string): string => {
        const one = part.startsWith("[") ? (firstInClass.exec(part)?.[1] ?? "x") : part;
        return letters[one] ?? one.replace(/^\\/, "");
      },

      textOf: (pattern: string): string => {
        let rest = pattern.replace(/^\^/, "").replace(/\$$/, "");
        let text = "";
        for (let found = atom.exec(rest); found && found[1] !== "|"; found = atom.exec(rest)) {
          rest = rest.slice(found[0].length);
          const times = found[2] ? Number(found[2]) : (counts[found[3] ?? ""] ?? 1);
          text += sampler.letterOf(found[1] ?? "").repeat(times);
        }
        return text;
      },

      listedOf: (node: JsonSchema): { value: unknown } | null => {
        const list = listKeys.map((key) => node[key] ?? []).find((each) => each.length > 0);
        return list ? { value: list[0] } : null;
      },

      fixedOf: (node: JsonSchema): { value: unknown } | null => {
        if ("const" in node) return { value: node.const };

        const listed = sampler.listedOf(node);
        if (listed) return listed;

        const first = node.anyOf?.[0] ?? node.oneOf?.[0];
        return first === undefined ? null : { value: sampler.sampleOf(first) };
      },

      byType: {
        object: (node: JsonSchema): unknown =>
          Object.fromEntries(
            (node.required ?? []).map((key) => [key, sampler.sampleOf(node.properties?.[key])]),
          ),
        string: (node: JsonSchema): unknown =>
          node.pattern ? sampler.textOf(node.pattern) : "x".repeat(node.minLength ?? 0),
        number: (node: JsonSchema): unknown => node.minimum ?? 0,
        integer: (node: JsonSchema): unknown => node.minimum ?? 0,
        boolean: (): unknown => false,
        array: (): unknown => [],
      },

      sampleOf: (raw: unknown): unknown => {
        const read = jsonSchema.safeParse(raw);
        if (!read.success) return null;

        const fixed = sampler.fixedOf(read.data);
        if (fixed) return fixed.value;

        const type = [read.data.type].flat()[0] ?? "";
        const make = Object.entries(sampler.byType).find(([name]) => name === type)?.[1];
        return make ? make(read.data) : null;
      },
    };

    return sampler;
  },
});
