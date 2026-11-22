import { z } from "zod";

// The look's names and types (SPEC-kit.md § The look and the kit versions). They are fixed: the
// seed gives a value to each, a change of the look changes only values, and a new name is
// deferred (§ Out of Scope). The CLI and the server both read this file, so `look.set` refuses a
// patch with a name that the look does not have, a `$type` that does not match, or a value that
// does not fit its type, as `invalid` with its path, before it sends.

const dimension = z.object({ value: z.number(), unit: z.enum(["px", "rem"]) });

/**
 * A DTCG 2025.10 sRGB color. A `hex` must be the color of the components: DTCG keeps it as a
 * fallback for the same color, and `colorCss` writes it as it is.
 */
const color = z
  .object({
    colorSpace: z.literal("srgb"),
    components: z.tuple([z.number(), z.number(), z.number()]),
    alpha: z.number().min(0).max(1).optional(),
    hex: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.hex === undefined) return;

    // Each component as its byte, as `colorCss` writes it.
    const bytes = value.components.map((unit) =>
      Math.round(Math.min(Math.max(unit, 0), 1) * 255)
        .toString(16)
        .padStart(2, "0"),
    );
    if (`#${bytes.join("")}` !== value.hex.toLowerCase()) {
      ctx.addIssue({
        code: "custom",
        path: ["hex"],
        message: `hex ${value.hex} is not the color of the components #${bytes.join("")}`,
      });
    }
  });

const shadowLayer = z.object({
  color,
  offsetX: dimension,
  offsetY: dimension,
  blur: dimension,
  spread: dimension,
  inset: z.boolean().optional(),
});

/** A look value's `$value`, by its type. */
export const valueOf = {
  color,
  dimension,
  // A font's name has no brace: `{font.sans}` is an alias.
  fontFamily: z.union([z.string().regex(/^[^{}]+$/), z.array(z.string().regex(/^[^{}]+$/)).min(1)]),
  shadow: z.union([shadowLayer, z.array(shadowLayer).min(1)]),
};

/** An alias: `{font.sans}` names the look value at that path. */
export const alias = z.string().regex(/^\{[^{}]+\}$/);

export const lookType = z.enum(["color", "dimension", "fontFamily", "shadow"]);

export type LookType = z.infer<typeof lookType>;

/** Each group of the look: its type and the names of its look values, in the seed's order. */
export const lookGroups = {
  color: {
    type: "color",
    names: [
      "background",
      "foreground",
      "card",
      "card-foreground",
      "popover",
      "popover-foreground",
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "muted",
      "muted-foreground",
      "accent",
      "accent-foreground",
      "destructive",
      "destructive-soft",
      "success",
      "success-soft",
      "warning",
      "warning-soft",
      "border",
      "input",
      "ring",
      "chart-1",
      "chart-2",
      "chart-3",
      "chart-4",
      "chart-5",
      "white",
      "black",
    ],
  },
  font: { type: "fontFamily", names: ["sans", "mono", "display"] },
  text: {
    type: "dimension",
    names: ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"],
  },
  radius: { type: "dimension", names: ["sm", "md", "lg", "xl", "2xl", "3xl", "4xl"] },
  shadow: { type: "shadow", names: ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"] },
} as const;

/** The one look value with no group: `spacing`, a dimension. */
export const lookLeaves = { spacing: "dimension" } as const;

/** Each look value's path and type, in the order of the look. */
export const lookPaths: Array<{ path: string; type: LookType }> = [];

for (const [group, { type, names }] of Object.entries(lookGroups)) {
  for (const name of names) lookPaths.push({ path: `${group}.${name}`, type });
}

for (const [path, type] of Object.entries(lookLeaves)) lookPaths.push({ path, type });

/** Each look value's place in the order of the look, by path. */
const orderOf = new Map<string, number>();

for (const [at, { path }] of lookPaths.entries()) orderOf.set(path, at);

/** The message of an alias that does not name an earlier look value of the same type. */
const aliasRule = { message: "an alias names an earlier look value of the same type" };

/**
 * One look value in a patch, by path: a new `$value` of its type, or an alias. A patch gives
 * values only (SPEC-kit § Change the look, step 2): a `null` (a removal in RFC 7386) or a new key
 * is `invalid`. A `$type` must be the look value's own; a `$description` is kept as stored. An
 * alias names a look value of the same type that comes earlier in the order of the look
 * (`font.display` may name `font.sans`), so aliases never make a loop, whatever the stored look
 * holds.
 */
const valuePatches = new Map<string, z.ZodType<unknown>>();

for (const [at, { path, type }] of lookPaths.entries()) {
  const plain: z.ZodType<unknown> = valueOf[type];
  const named = alias.refine((text) => {
    const to = orderOf.get(text.slice(1, -1)) ?? at;
    return to < at && lookPaths[to]?.type === type;
  }, aliasRule);
  valuePatches.set(
    path,
    z.strictObject({
      $value: z.union([named, plain]).optional(),
      $type: z.literal(type).optional(),
      $description: z.string().optional(),
    }),
  );
}

/** Each group in a patch: its look values by name, each optional. */
const groupPatches: Record<string, z.ZodType<unknown>> = {};

for (const [group, { type, names }] of Object.entries(lookGroups)) {
  const shape: Record<string, z.ZodType<unknown>> = {};
  for (const name of names) {
    shape[name] = (valuePatches.get(`${group}.${name}`) ?? z.never()).optional();
  }
  groupPatches[group] = z
    .strictObject({ $type: z.literal(type).optional(), $description: z.string().optional() })
    .extend(shape)
    .optional();
}

/**
 * A change of the look: a JSON Merge Patch (RFC 7386) of the stored DTCG file, of values only.
 * The whole file that `look.get` gives is a patch too. Each `$value` replaces the stored one as a
 * whole: a value is not merged into the old value.
 */
export const lookPatch: z.ZodType<Record<string, unknown>> = z
  .strictObject({ $schema: z.string().optional(), $description: z.string().optional() })
  .extend(groupPatches)
  .extend({ spacing: (valuePatches.get("spacing") ?? z.never()).optional() });
