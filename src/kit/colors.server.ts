import { operation, resource } from "@tinkered/core";
import type { CssColor, Visitor } from "lightningcss";
import { z } from "zod";

import { lightningcss } from "./lightningcss.server";

// Colors for the K5 check (judged rule 12): the colors in a CSS text, found by a Lightning CSS
// `Color` visitor, and the nearest look color by distance in OKLab (Björn Ottosson, 2020).

/** A point in OKLab. */
export type Lab = { l: number; a: number; b: number };

/** A color, or a custom property that is set, at a place in a CSS text: line from 0, column from 1. */
export type Spot = { line: number; column: number; color: CssColor | null; sets: string | null };

const encoder = new TextEncoder();

/** The color of each word that a CSS text uses, as Lightning CSS reads it: null for no color. */
export const colorWords = resource({
  label: "kit.colorWords",
  target: "scope",
  factory: () => new Map<string, CssColor | null>(),
});

/** A visitor that puts each color that Lightning CSS reads into `into`. */
export const colorCollector = operation({
  label: "kit.colorCollector",
  input: z.custom<CssColor[]>(),
  run: (_, { input: into }): Visitor<never> => ({
    Color: (color) => {
      into.push(color);
    },
  }),
});

/** The color of a word, if it is a CSS named color (`red`, `rebeccapurple`). */
export const colorOfWord = operation({
  label: "kit.colorOfWord",
  input: z.string(),
  depends: { words: colorWords, colorCollector },
  run: ({ words, colorCollector }, { input }) => {
    const key = input.toLowerCase();
    if (words.has(key)) return words.get(key) ?? null;

    const found: CssColor[] = [];
    if (/^[a-z]+$/.test(key)) {
      lightningcss.transformStyleAttribute({
        code: encoder.encode(`color:${key}`),
        errorRecovery: true,
        visitor: colorCollector.run({ input: found }),
      });
    }
    words.set(key, found[0] ?? null);
    return found[0] ?? null;
  },
});

/** A color that is always allowed: currentColor, a color with no alpha, white or black. */
export const plainColor = operation({
  label: "kit.plainColor",
  input: z.custom<CssColor>(),
  run: (_, { input: color }) => {
    if (typeof color !== "object" || color.type === "light-dark") return false;
    if (color.type === "currentcolor") return true;

    const rgb = color.type === "rgb" ? `${color.r} ${color.g} ${color.b}` : "";
    return color.alpha === 0 || rgb === "0 0 0" || rgb === "255 255 255";
  },
});

/** Where a rule of Lightning CSS starts. */
const ruleLoc = z.object({
  value: z.object({ loc: z.object({ line: z.number(), column: z.number() }) }),
});

/** The line and the column where a rule of Lightning CSS starts, if it has them. */
export const ruleStart = operation({
  label: "kit.ruleStart",
  input: z.unknown(),
  run: (_, { input: rule }) => {
    const read = ruleLoc.safeParse(rule);
    return read.success ? read.data.value.loc : null;
  },
});

/** The visitor of colorsIn: it puts each color that is not allowed, and each custom property, into `spots`. */
export const spotVisitor = operation({
  label: "kit.spotVisitor",
  input: z.custom<Spot[]>(),
  depends: { colorOfWord, plainColor, ruleStart },
  run: ({ colorOfWord, plainColor, ruleStart }, { input: spots }): Visitor<never> => {
    const origin = { line: 0, column: 1 };
    const starts = [origin];

    return {
      Rule: (rule) => {
        starts.push(ruleStart.run({ input: rule }) ?? starts.at(-1) ?? origin);
      },
      RuleExit: () => {
        starts.pop();
      },
      Color: (color) => {
        const parts =
          typeof color === "object" && color.type === "light-dark"
            ? [color.light, color.dark]
            : [color];
        if (!parts.every((part) => plainColor.run({ input: part }))) {
          spots.push({ ...(starts.at(-1) ?? origin), color, sets: null });
        }
      },
      Token: {
        ident: (token) => {
          const color = colorOfWord.run({ input: token.value });
          if (color && !plainColor.run({ input: color })) {
            spots.push({ ...(starts.at(-1) ?? origin), color, sets: null });
          }
        },
      },
      Declaration: {
        custom: (declaration) => {
          spots.push({ ...(starts.at(-1) ?? origin), color: null, sets: declaration.name });
        },
      },
    };
  },
});

/**
 * The colors in a CSS text (`attr`: the text of a style attribute), and each custom property that
 * it sets. An allowed color (plainColor) is not here. A word in a value that Lightning CSS keeps
 * as tokens (a custom property, a `var()` fallback) is a color when it is a CSS named color. CSS
 * that does not parse gives what Lightning CSS could read.
 */
export const colorsIn = operation({
  label: "kit.colorsIn",
  input: z.object({ css: z.string(), attr: z.boolean() }),
  depends: { spotVisitor },
  run: ({ spotVisitor }, { input }) => {
    const spots: Spot[] = [];
    const visitor = spotVisitor.run({ input: spots });
    const code = encoder.encode(input.css);

    try {
      if (input.attr) lightningcss.transformStyleAttribute({ code, errorRecovery: true, visitor });
      else lightningcss.transform({ filename: "frame.css", code, errorRecovery: true, visitor });
    } catch {
      // CSS that Lightning CSS cannot read at all: the spots found so far stay.
    }
    return spots;
  },
});

/** The first color of a CSS value, allowed or not, as Lightning CSS reads it. */
export const colorOf = operation({
  label: "kit.colorOf",
  input: z.string(),
  depends: { colorCollector, colorOfWord },
  run: ({ colorCollector, colorOfWord }, { input }) => {
    const found: CssColor[] = [];
    lightningcss.transformStyleAttribute({
      code: encoder.encode(`--x: ${input}`),
      errorRecovery: true,
      visitor: colorCollector.run({ input: found }),
    });
    return found[0] ?? colorOfWord.run({ input: input.trim() });
  },
});

/** A color as CSS text, to 4 decimals: `lab(50 40 30)`, `color(display-p3 1 0 0)`. */
export const colorText = operation({
  label: "kit.colorText",
  input: z.custom<Exclude<CssColor, string>>(),
  run: (_, { input: color }) => {
    const values = Object.entries(color)
      .filter(([key]) => key !== "type" && key !== "alpha")
      .map(([, value]) => String(typeof value === "number" ? Math.round(value * 1e4) / 1e4 : value))
      .join(" ");
    const named = ["rgb", "lab", "lch", "oklab", "oklch", "hsl", "hwb"].includes(color.type);
    return named ? `${color.type}(${values})` : `color(${color.type} ${values})`;
  },
});

/**
 * A color of any CSS color space as sRGB (0 to 255), by the fallback that Lightning CSS writes
 * for a browser of 2015. Null: no sRGB form (a system color, currentColor).
 */
export const srgbOf = operation({
  label: "kit.srgbOf",
  input: z.custom<Exclude<CssColor, string>>(),
  depends: { colorText, colorOf },
  run: ({ colorText, colorOf }, { input: color }) => {
    if (color.type === "currentcolor" || color.type === "light-dark") return null;
    if (color.type === "rgb" && Number.isInteger(color.r)) return color;

    const made = lightningcss.transformStyleAttribute({
      code: encoder.encode(`color:${colorText.run({ input: color })}`),
      minify: true,
      targets: { chrome: 40 << 16 },
    });
    const fallback = new TextDecoder().decode(made.code).split(";", 1).join("");
    const rgb = colorOf.run({ input: fallback.slice("color:".length) });
    return rgb && typeof rgb === "object" && rgb.type === "rgb" ? rgb : null;
  },
});

/** An sRGB color (0 to 255) in OKLab (Björn Ottosson, 2020). */
export const rgbToOklab = operation({
  label: "kit.rgbToOklab",
  input: z.custom<{ r: number; g: number; b: number }>(),
  run: (_, { input }): Lab => {
    const [r = 0, g = 0, b = 0] = [input.r, input.g, input.b].map((c) =>
      c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4,
    );
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

    return {
      l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    };
  },
});

/** A color in OKLab. OKLab and OKLCH are read as they are; any other color goes by sRGB. */
export const oklab = operation({
  label: "kit.oklab",
  input: z.custom<CssColor>(),
  depends: { srgbOf, rgbToOklab },
  run: ({ srgbOf, rgbToOklab }, { input }): Lab | null => {
    const color = typeof input === "object" && input.type === "light-dark" ? input.light : input;
    if (typeof color !== "object") return null;
    if (color.type === "oklab") return { l: color.l, a: color.a, b: color.b };
    if (color.type === "oklch") {
      const h = (color.h * Math.PI) / 180;
      return { l: color.l, a: color.c * Math.cos(h), b: color.c * Math.sin(h) };
    }

    const rgb = srgbOf.run({ input: color });
    return rgb ? rgbToOklab.run({ input: rgb }) : null;
  },
});

/**
 * A chart color is for data: as a fix it counts this many times as far as it is, so the
 * semantic colors (primary, destructive, warning, success, muted, ...) win when the distances are
 * close. `text-red-500` gives `text-destructive`, not `text-chart-1`; a yellow still gives
 * `chart-4`, as no semantic color is near it.
 */
export const chartWeight = 2.5;

/**
 * The name of the look color nearest to a color, by distance in OKLab, where a chart color's
 * distance counts `chartWeight` times.
 */
export const nearestColor = operation({
  label: "kit.nearestColor",
  input: z.object({
    color: z.custom<CssColor>(),
    colors: z.custom<Array<{ name: string; lab: Lab }>>(),
  }),
  depends: { oklab },
  run: ({ oklab }, { input }) => {
    const from = oklab.run({ input: input.color }) ?? { l: 0.5, a: 0, b: 0 };
    let best = input.colors[0]?.name ?? "primary";
    let least = Infinity;

    for (const { name, lab } of input.colors) {
      const weight = /^chart-\d+$/.test(name) ? chartWeight : 1;
      const distance = weight * Math.hypot(from.l - lab.l, from.a - lab.a, from.b - lab.b);
      if (distance < least) {
        least = distance;
        best = name;
      }
    }
    return best;
  },
});

/** A color as a finding shows it: sRGB as hex, any other color as CSS text (`lab(50 40 30)`). */
export const shownColor = operation({
  label: "kit.shownColor",
  input: z.custom<CssColor>(),
  depends: { colorText },
  run: ({ colorText }, { input: color }) => {
    if (typeof color !== "object") return color;
    if (color.type === "currentcolor" || color.type === "light-dark") return color.type;
    if (color.type !== "rgb") return colorText.run({ input: color });

    const alpha = color.alpha < 1 ? [Math.round(color.alpha * 255)] : [];
    const hex = [color.r, color.g, color.b, ...alpha].map((c) =>
      Math.round(c).toString(16).padStart(2, "0"),
    );
    return `#${hex.join("")}`;
  },
});
