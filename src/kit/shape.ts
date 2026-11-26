import { z } from "zod";

const dimension = z.object({ value: z.number(), unit: z.enum(["px", "rem"]) });

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

export const valueOf = {
  color,
  dimension,
  fontFamily: z.union([z.string().regex(/^[^{}]+$/), z.array(z.string().regex(/^[^{}]+$/)).min(1)]),
  shadow: z.union([shadowLayer, z.array(shadowLayer).min(1)]),
};

export const alias = z.string().regex(/^\{[^{}]+\}$/);

export const lookType = z.enum(["color", "dimension", "fontFamily", "shadow"]);

export type LookType = z.infer<typeof lookType>;

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

export const lookLeaves = { spacing: "dimension" } as const;

export const lookPaths: Array<{ path: string; type: LookType }> = [];

for (const [group, { type, names }] of Object.entries(lookGroups)) {
  for (const name of names) lookPaths.push({ path: `${group}.${name}`, type });
}

for (const [path, type] of Object.entries(lookLeaves)) lookPaths.push({ path, type });

const orderOf = new Map<string, number>();

for (const [at, { path }] of lookPaths.entries()) orderOf.set(path, at);

const aliasRule = { message: "an alias names an earlier look value of the same type" };

const valuePatches = new Map<string, z.ZodType<unknown>>();

const darkValuePatches = new Map<string, z.ZodType<unknown>>();

for (const [at, { path, type }] of lookPaths.entries()) {
  const plain: z.ZodType<unknown> = valueOf[type];
  const named = alias.refine((text) => {
    const to = orderOf.get(text.slice(1, -1)) ?? at;
    return to < at && lookPaths[to]?.type === type;
  }, aliasRule);

  const about = { $type: z.literal(type).optional(), $description: z.string().optional() };
  const darkValue = z.union([named, plain], {
    error: (issue) => (issue.input === undefined ? "a dark color needs its $value" : undefined),
  });
  valuePatches.set(path, z.strictObject({ $value: z.union([named, plain]).optional(), ...about }));
  darkValuePatches.set(path, z.strictObject({ $value: darkValue, ...about }));
}

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

export const resolverVersion = "2025.10";

export const resolverSchema = "https://www.designtokens.org/schemas/2025.10/resolver.json";

export const lookSet = "look";

export const themeModifier = "theme";

export const resolutionOrder = [
  { $ref: `#/sets/${lookSet}` },
  { $ref: `#/modifiers/${themeModifier}` },
] as const;

const tokenPatch = z
  .strictObject({
    $schema: z.string().optional(),
    $description: z.string().optional(),
    version: z.undefined().optional(),
  })
  .extend(groupPatches)
  .extend({ spacing: (valuePatches.get("spacing") ?? z.never()).optional() });

const darkColors: Record<string, z.ZodType<unknown>> = {};

for (const name of lookGroups.color.names) {
  darkColors[name] = (darkValuePatches.get(`color.${name}`) ?? z.never()).optional();
}

const darkPatch = z.strictObject({
  color: z
    .strictObject({ $type: z.literal(lookGroups.color.type).optional() })
    .extend(darkColors)
    .optional(),
});

const resolverPatch = z.strictObject({
  $schema: z.string().optional(),
  version: z.literal(resolverVersion),
  sets: z
    .strictObject({
      [lookSet]: z.strictObject({
        sources: z.tuple([tokenPatch.omit({ version: true })]),
      }),
    })
    .optional(),
  modifiers: z
    .strictObject({
      [themeModifier]: z.strictObject({
        contexts: z.strictObject({
          light: z.tuple([]).optional(),
          dark: z.array(darkPatch).max(1).optional(),
        }),
        default: z.literal("light").optional(),
      }),
    })
    .optional(),
  resolutionOrder: z
    .tuple([
      z.strictObject({ $ref: z.literal(resolutionOrder[0].$ref) }),
      z.strictObject({ $ref: z.literal(resolutionOrder[1].$ref) }),
    ])
    .optional(),
});

const lookPatchText = [
  'Give a DTCG token file to change light values, or a DTCG 2025.10 resolver document with `version` "2025.10", as `get_look` gives it.',
  "Put the dark colors at `modifiers.theme.contexts.dark[0].color`, each with a `$value`.",
  "The dark colors merge into the dark context: a dark color that the patch does not name stays, and the patch removes no dark value.",
  "A dark color that equals its light value adds nothing.",
].join(" ");

export const lookPatch: z.ZodType<Record<string, unknown>> = z
  .discriminatedUnion("version", [tokenPatch, resolverPatch])
  .describe(lookPatchText);
