import { operation } from "@tinkered/core";
import { z } from "zod";

import { takeKeys } from "./screens";

export const liveChannel = operation({
  label: "live.channel",
  input: z.object({ raw: z.string(), full: z.number(), scale: z.number() }),
  run: (_, { input }) => {
    if (input.raw === "") return Number.NaN;

    if (input.raw.endsWith("%")) return (Number.parseFloat(input.raw) / 100) * input.full;

    return Number(input.raw) * input.scale;
  },
});

export const liveChannels = operation({
  label: "live.channels",
  input: z.object({ parts: z.array(z.string()), unit: z.enum(["byte", "fraction"]) }),
  depends: { liveChannel },
  run: ({ liveChannel }, { input }) => {
    const [r = "", g = "", b = "", a = "1"] = input.parts;
    const scale = input.unit === "fraction" ? 255 : 1;
    const rgb = [r, g, b].map((raw) => liveChannel.run({ input: { raw, full: 255, scale } }));

    return [...rgb, liveChannel.run({ input: { raw: a, full: 1, scale: 1 } })];
  },
});

const hexPattern = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;

export const liveHexColor = operation({
  label: "live.hexColor",
  input: z.string(),
  run: (_, { input }) => {
    const digits = hexPattern.exec(input)?.[1];
    if (digits === undefined) return null;

    const short = digits.length <= 4;
    const pairs = short ? digits.split("").map((c) => c + c) : (digits.match(/../g) ?? []);
    const values = pairs.map((p) => Number.parseInt(p, 16));

    return [...values.slice(0, 3), (values[3] ?? 255) / 255];
  },
});

const functionPattern = /^(rgba?|color)\((srgb )?([^)]*)\)$/;

export const liveFunctionColor = operation({
  label: "live.functionColor",
  input: z.string(),
  depends: { liveChannels },
  run: ({ liveChannels }, { input }) => {
    const call = functionPattern.exec(input);
    const isColor = call?.[1] === "color";
    if (!call || isColor !== (call[2] !== undefined)) return null;

    const parts = (call[3] ?? "").split(/[\s,/]+/).filter((p) => p !== "");

    return liveChannels.run({ input: { parts, unit: isColor ? "fraction" : "byte" } });
  },
});

export const liveColorParts = operation({
  label: "live.colorParts",
  input: z.string(),
  depends: { liveHexColor, liveFunctionColor },
  run: ({ liveHexColor, liveFunctionColor }, { input }) => {
    if (input === "transparent") return [0, 0, 0, 0];

    return liveHexColor.run({ input }) ?? liveFunctionColor.run({ input }) ?? [];
  },
});

const fourChannels = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const liveColor = operation({
  label: "live.color",
  input: z.string(),
  depends: { liveColorParts },
  run: ({ liveColorParts }, { input }) => {
    const parts = fourChannels.safeParse(liveColorParts.run({ input: input.trim().toLowerCase() }));
    if (!parts.success || parts.data.some((p) => Number.isNaN(p))) {
      return { kind: "unknown" } as const;
    }

    const [r, g, b, a] = parts.data;
    if (a === 0) return { kind: "none" } as const;

    const key = `${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.round(a * 100) / 100}`;

    return { kind: "color", key } as const;
  },
});

export const look = z.object({
  colors: z.array(z.string()),
  sizes: z.array(z.string()),
  fonts: z.array(z.string()),
});

export type Look = z.infer<typeof look>;

const valueKind = z.enum(["color", "size", "font"]);

export const liveFont = operation({
  label: "live.font",
  input: z.string(),
  run: (_, { input }) =>
    (input.split(",")[0] ?? "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .toLowerCase(),
});

export const liveValueKey = operation({
  label: "live.valueKey",
  input: z.object({ kind: valueKind, value: z.string() }),
  depends: { liveColor, liveFont },
  run: ({ liveColor, liveFont }, { input }) => {
    if (input.kind === "size") return input.value.trim();

    if (input.kind === "font") return liveFont.run({ input: input.value });

    const color = liveColor.run({ input: input.value });

    return color.kind === "color" ? color.key : color.kind;
  },
});

export const liveToken = operation({
  label: "live.token",
  input: z.object({ name: z.string(), value: z.string() }),
  depends: { liveValueKey },
  run: ({ liveValueKey }, { input }) => {
    const { name, value } = input;
    const color = liveValueKey.run({ input: { kind: "color", value } });
    if (color !== "unknown" && color !== "none") return { kind: "color", key: color } as const;

    if (name.startsWith("--e-size-") && /^\d+(\.\d+)?px$/.test(value)) {
      return { kind: "size", key: value } as const;
    }

    if (/font|mono/.test(name) && /sans|serif|mono/.test(value)) {
      return { kind: "font", key: liveValueKey.run({ input: { kind: "font", value } }) } as const;
    }

    return { kind: "other" } as const;
  },
});

const tokenPattern = /(--[a-z0-9-]+)\s*:\s*([^;{}]+)/g;

export const liveLook = operation({
  label: "live.look",
  input: z.string(),
  depends: { liveToken },
  run: ({ liveToken }, { input }) => {
    const found = { color: new Set<string>(), size: new Set<string>(), font: new Set<string>() };
    for (const [, name = "", raw = ""] of input.matchAll(tokenPattern)) {
      const token = liveToken.run({ input: { name, value: raw.trim() } });
      if (token.kind !== "other") found[token.kind].add(token.key);
    }

    return {
      colors: [...found.color].sort(),
      sizes: [...found.size].sort(),
      fonts: [...found.font].sort(),
    };
  },
});

export const takeValues = z.object({
  screen: z.string(),
  take: z.enum(takeKeys),
  colors: z.array(z.string()),
  sizes: z.array(z.string()),
  fonts: z.array(z.string()),
  where: z.record(z.string(), z.string()).optional(),
});

export type TakeValues = z.infer<typeof takeValues>;

export const valueFinding = z.object({
  screen: z.string(),
  take: z.enum(takeKeys),
  kind: valueKind,
  value: z.string(),
  where: z.string().optional(),
});

export type ValueFinding = z.infer<typeof valueFinding>;

export const liveFindings = operation({
  label: "live.findings",
  input: z.object({ look, values: z.array(takeValues) }),
  depends: { liveValueKey },
  run: ({ liveValueKey }, { input }) => {
    const known = {
      color: new Set([...input.look.colors, "none"]),
      size: new Set(input.look.sizes),
      font: new Set(input.look.fonts),
    };
    const found: Array<ValueFinding> = [];
    for (const v of input.values) {
      const used = { color: v.colors, size: v.sizes, font: v.fonts };
      for (const kind of valueKind.options) {
        const strange = [...new Set(used[kind])].filter(
          (value) => !known[kind].has(liveValueKey.run({ input: { kind, value } })),
        );
        for (const value of strange) {
          const where = v.where?.[value];
          found.push({ screen: v.screen, take: v.take, kind, value, ...(where ? { where } : {}) });
        }
      }
    }

    return found;
  },
});

export const elementStyle = z.object({
  name: z.string(),
  text: z.boolean(),
  svg: z.boolean(),
  style: z.record(z.string(), z.string()),
});

export type ElementStyle = z.infer<typeof elementStyle>;

export const styleProps = [
  "color",
  "font-size",
  "font-family",
  "background-color",
  "outline-style",
  "outline-width",
  "outline-color",
  "fill",
  "stroke",
  "border-top-width",
  "border-top-style",
  "border-top-color",
  "border-right-width",
  "border-right-style",
  "border-right-color",
  "border-bottom-width",
  "border-bottom-style",
  "border-bottom-color",
  "border-left-width",
  "border-left-style",
  "border-left-color",
];

const usedValue = z.object({ kind: valueKind, value: z.string(), what: z.string() });

type UsedValue = z.infer<typeof usedValue>;

const line = z.enum(["border-top", "border-right", "border-bottom", "border-left", "outline"]);

const styleRecord = z.record(z.string(), z.string());

export const liveLineColor = operation({
  label: "live.lineColor",
  input: z.object({ style: styleRecord, line }),
  run: (_, { input }) => {
    const width = Number.parseFloat(input.style[`${input.line}-width`] ?? "");
    const drawn = width > 0 && input.style[`${input.line}-style`] !== "none";
    const value = input.style[`${input.line}-color`];
    if (!drawn || value === undefined) return null;

    return { kind: "color", value, what: input.line === "outline" ? "outline" : "border" } as const;
  },
});

export const livePaint = operation({
  label: "live.paint",
  input: z.object({ style: styleRecord, prop: z.enum(["fill", "stroke"]) }),
  run: (_, { input }) => {
    const value = input.style[input.prop] ?? "";

    return /^(none|url|$)/.test(value) ? null : value;
  },
});

export const liveTextValues = operation({
  label: "live.textValues",
  input: styleRecord,
  run: (_, { input }): Array<UsedValue> => [
    { kind: "color", value: input.color ?? "", what: "color" },
    { kind: "size", value: input["font-size"] ?? "", what: "font-size" },
    { kind: "font", value: input["font-family"] ?? "", what: "font-family" },
  ],
});

export const liveElementValues = operation({
  label: "live.elementValues",
  input: elementStyle,
  depends: { liveLineColor, livePaint, liveTextValues },
  run: ({ liveLineColor, livePaint, liveTextValues }, { input }) => {
    const { style } = input;
    const used = input.text ? liveTextValues.run({ input: style }) : [];
    used.push({ kind: "color", value: style["background-color"] ?? "", what: "background-color" });

    for (const one of line.options) {
      const drawn = liveLineColor.run({ input: { style, line: one } });
      if (drawn !== null) used.push(drawn);
    }

    const paints = input.svg ? (["fill", "stroke"] as const) : [];
    for (const prop of paints) {
      const value = livePaint.run({ input: { style, prop } });
      if (value !== null) used.push({ kind: "color", value, what: prop });
    }

    return used;
  },
});

export const liveUsed = operation({
  label: "live.used",
  input: z.array(elementStyle),
  depends: { liveElementValues },
  run: ({ liveElementValues }, { input }) => {
    const found = { color: new Set<string>(), size: new Set<string>(), font: new Set<string>() };
    const where: Record<string, string> = {};
    for (const element of input) {
      for (const used of liveElementValues.run({ input: element })) {
        found[used.kind].add(used.value);
        where[used.value] ??= `${element.name} ${used.what}`;
      }
    }

    return {
      colors: [...found.color].sort(),
      sizes: [...found.size].sort(),
      fonts: [...found.font].sort(),
      where,
    };
  },
});
