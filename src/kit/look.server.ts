import { operation } from "@tinkered/core";
import { z } from "zod";

// The look in the DTCG format 2025.10 (SPEC-kit.md § Objective) and its CSS: each look value is a
// CSS custom property. A color's name drops its group (`color.primary` is `--primary`); the
// others join their path with `-` (`text.sm` is `--text-sm`, `spacing` is `--spacing`). An alias
// (`{font.sans}`) takes the value that it names. A type is the token's own `$type`, or that of the
// nearest group that has one.

const dimension = z.object({ value: z.number(), unit: z.enum(["px", "rem"]) });

const color = z.object({
  colorSpace: z.literal("srgb"),
  components: z.tuple([z.number(), z.number(), z.number()]),
  alpha: z.number().min(0).max(1).optional(),
  hex: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
});

const shadowLayer = z.object({
  color,
  offsetX: dimension,
  offsetY: dimension,
  blur: dimension,
  spread: dimension,
  inset: z.boolean().optional(),
});

const alias = z.string().regex(/^\{[^{}]+\}$/);

/** A look value's `$value`, by its type. */
const valueOf = {
  color,
  dimension,
  fontFamily: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  shadow: z.union([shadowLayer, z.array(shadowLayer).min(1)]),
};

const lookType = z.enum(["color", "dimension", "fontFamily", "shadow"]);

/** A DTCG file: groups and look values. Each key that starts with `$` is a property. */
export const dtcg = z.record(z.string(), z.unknown());

export type Dtcg = z.infer<typeof dtcg>;

/** One look value as the walk finds it: its path, its type and its `$value`. */
type Found = { path: string[]; type: string | undefined; value: unknown };

/** The look values of a DTCG file, in the order of the file, with the type that each one has. */
export const lookTokens = operation({
  label: "kit.lookTokens",
  input: dtcg,
  run: (_, { input }) => {
    const found: Found[] = [];
    const node = z.record(z.string(), z.unknown());
    const stack: Array<{ path: string[]; at: Dtcg; type: string | undefined }> = [
      { path: [], at: input, type: undefined },
    ];

    for (let next = stack.pop(); next; next = stack.pop()) {
      const type = typeof next.at.$type === "string" ? next.at.$type : next.type;
      if ("$value" in next.at) {
        found.push({ path: next.path, type, value: next.at.$value });
        continue;
      }
      const children = Object.entries(next.at).filter(([key]) => !key.startsWith("$"));
      for (const [key, child] of children.reverse()) {
        const read = node.safeParse(child);
        if (!read.success) throw new Error(`look: ${[...next.path, key].join(".")} is no group`);
        stack.push({ path: [...next.path, key], at: read.data, type });
      }
    }
    return found;
  },
});

/** A color's CSS: `#rrggbb`, with an alpha byte when it is not opaque. */
export const colorCss = operation({
  label: "kit.colorCss",
  input: color,
  run: (_, { input }) => {
    const alpha = input.alpha ?? 1;
    const bytes = [...input.components, alpha].map((unit) =>
      Math.round(Math.min(Math.max(unit, 0), 1) * 255)
        .toString(16)
        .padStart(2, "0"),
    );
    const rgb = input.hex ? input.hex.toLowerCase() : `#${bytes.slice(0, 3).join("")}`;
    return alpha === 1 ? rgb : `${rgb}${bytes.slice(3).join("")}`;
  },
});

/** A dimension's CSS: `14px`, `0.875rem`. */
export const lengthCss = operation({
  label: "kit.lengthCss",
  input: dimension,
  run: (_, { input }) => `${input.value}${input.unit}`,
});

/** A shadow's CSS: its layers, each `[inset] x y blur spread color`. */
export const shadowCss = operation({
  label: "kit.shadowCss",
  input: valueOf.shadow,
  depends: { lengthCss, colorCss },
  run: ({ lengthCss, colorCss }, { input }) =>
    [input]
      .flat()
      .map((layer) =>
        [
          layer.inset ? "inset" : "",
          ...[layer.offsetX, layer.offsetY, layer.blur, layer.spread].map((d) =>
            lengthCss.run({ input: d }),
          ),
          colorCss.run({ input: layer.color }),
        ]
          .filter(Boolean)
          .join(" "),
      )
      .join(", "),
});

/** A font family's CSS: its names, each quoted unless it is one word or a generic family. */
export const fontCss = operation({
  label: "kit.fontCss",
  input: valueOf.fontFamily,
  run: (_, { input }) => {
    const generic = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)$/;
    return [input]
      .flat()
      .map((name) => (generic.test(name) || /^[\w-]+$/.test(name) ? name : `"${name}"`))
      .join(", ");
  },
});

/** The CSS of one `$value` of a type. An alias answers null: its target gives its value. */
export const valueCss = operation({
  label: "kit.valueCss",
  input: z.object({ path: z.array(z.string()), type: z.string().optional(), value: z.unknown() }),
  depends: { colorCss, lengthCss, fontCss, shadowCss },
  run: ({ colorCss, lengthCss, fontCss, shadowCss }, { input: { path, type, value } }) => {
    if (alias.safeParse(value).success) return null;

    const kind = lookType.safeParse(type);
    if (!kind.success) throw new Error(`look: ${path.join(".")} has no type that the kit knows`);

    switch (kind.data) {
      case "color":
        return colorCss.run({ input: valueOf.color.parse(value) });
      case "dimension":
        return lengthCss.run({ input: valueOf.dimension.parse(value) });
      case "fontFamily":
        return fontCss.run({ input: valueOf.fontFamily.parse(value) });
      case "shadow":
        return shadowCss.run({ input: valueOf.shadow.parse(value) });
    }
  },
});

/** The look value that an alias names, through up to 10 aliases; the token itself when it is no alias. */
export const resolveAlias = operation({
  label: "kit.resolveAlias",
  input: z.custom<{ token: Found; byPath: Map<string, Found> }>(),
  run: (_, { input: { token, byPath } }) => {
    let target = token;
    for (let hops = 0; hops < 10; hops++) {
      const named = alias.safeParse(target.value);
      if (!named.success) return target;

      const to = byPath.get(named.data.slice(1, -1));
      if (!to) {
        throw new Error(`look: ${token.path.join(".")} names ${named.data}, not in the look`);
      }
      target = { ...to, type: to.type ?? token.type };
    }
    return target;
  },
});

/**
 * The look values of a DTCG look, by CSS name, in the order of the file. A value that does not fit
 * its type, a name that is no CSS name, or an alias to a missing value throws: the caller's look
 * is not valid.
 */
export const lookValues = operation({
  label: "kit.lookValues",
  input: dtcg,
  depends: { lookTokens, resolveAlias, valueCss },
  run: ({ lookTokens, resolveAlias, valueCss }, { input }) => {
    const tokens = lookTokens.run({ input });
    const byPath = new Map(tokens.map((token) => [token.path.join("."), token]));
    const values: Record<string, string> = {};

    for (const token of tokens) {
      const name = `--${(token.path[0] === "color" ? token.path.slice(1) : token.path).join("-")}`;
      if (!/^--[a-z][a-z0-9-]*$/.test(name)) throw new Error(`look: ${name} is no CSS name`);

      const css = valueCss.run({ input: resolveAlias.run({ input: { token, byPath } }) });
      if (css === null) throw new Error(`look: ${token.path.join(".")} is an alias loop`);
      values[name] = css;
    }
    return values;
  },
});

/** The look as one unlayered `:root` block of look values: what `compose` puts in `easel-look`. */
export const rootBlock = operation({
  label: "kit.rootBlock",
  input: z.record(z.string(), z.string()),
  run: (_, { input }) =>
    `:root {\n${Object.entries(input)
      .map(([name, value]) => `  ${name}: ${value};\n`)
      .join("")}}\n`,
});
