import { operation } from "@tinkered/core";
import type { CssColor } from "lightningcss";
import palette from "tailwindcss/colors";
import { z } from "zod";

import { colorOf, colorsIn, nearestColor, oklab } from "./colors.server";
import { nearestName } from "./names.server";
import { type Prepared, prepared, type System, type Verdict } from "./prepare.server";

// What the K5 check says about one class name (judged rule 12): a name to make, a kit class, or a
// finding with its fix. A palette color, an arbitrary color or font size, and a name that gives no
// CSS are findings; an arbitrary layout value (`w-[420px]`) is not.

/** The input of each verdict: the kit version, the class name, its variants and its utility. */
type Asked = { kit: Prepared; name: string; variants: string; utility: string };

/** A verdict that is a finding. */
type Found = Extract<Verdict, { kind: "finding" }>;

const asked = z.custom<Asked>();

/** The colors of Tailwind's palette by hue and shade (`red-500`), and its hues. */
const paletteValues = new Map<string, string>();
const hues: string[] = [];

for (const [hue, shades] of Object.entries(palette)) {
  if (typeof shades === "object") hues.push(hue);
  for (const [shade, value] of typeof shades === "object" ? Object.entries(shades) : []) {
    paletteValues.set(`${hue}-${shade}`, value);
  }
}

/** A palette class: what comes before the hue, the hue, the shade, and an opacity. */
const paletteClass = new RegExp(`^(.*?)(${hues.join("|")})-(\\d+)(/.*)?$`);

/** A class name in two: its variants (`md:hover:`) and the utility (`bg-primary/50`). */
export const splitClass = operation({
  label: "kit.splitClass",
  input: z.string(),
  run: (_, { input: name }) => {
    let depth = 0;
    let cut = 0;

    for (let at = 0; at < name.length; at++) {
      const char = name[at];
      if (char === "[" || char === "(") depth++;
      else if (char === "]" || char === ")") depth--;
      else if (char === ":" && depth === 0) cut = at + 1;
    }
    return { variants: name.slice(0, cut), utility: name.slice(cut).replace(/^!|!$/g, "") };
  },
});

/** A palette class (`hover:text-red-500/50`) in parts, with the palette's value of its color. */
export const paletteShade = operation({
  label: "kit.paletteShade",
  input: z.string(),
  run: (_, { input: utility }) => {
    const match = paletteClass.exec(utility);
    const key = `${match?.[2]}-${match?.[3]}`;
    const value = paletteValues.get(key);
    if (!match || !value) return null;

    return { before: `${match[1]}`, key, opacity: match[4] ?? "", value };
  },
});

/** A color of Tailwind's palette in OKLab, kept for the life of the scope. */
export const paletteLab = operation({
  label: "kit.paletteLab",
  input: z.object({ key: z.string(), value: z.string() }),
  depends: { prepared, colorOf, oklab },
  run: ({ prepared, colorOf, oklab }, { input }) => {
    if (!prepared.palette.has(input.key)) {
      const color = colorOf.run({ input: input.value });
      prepared.palette.set(input.key, color ? oklab.run({ input: color }) : null);
    }
    return prepared.palette.get(input.key) ?? { l: 0.5, a: 0, b: 0 };
  },
});

/** A palette color (`text-red-500`): a finding, with the nearest look color as the fix. */
export const paletteVerdict = operation({
  label: "kit.paletteVerdict",
  input: asked,
  depends: { paletteShade, paletteLab, nearestColor },
  run: ({ paletteShade, paletteLab, nearestColor }, { input }): Found | null => {
    const shade = paletteShade.run({ input: input.utility });
    if (!shade) return null;

    const lab = paletteLab.run({ input: shade });
    const color = { type: "oklab" as const, ...lab, alpha: 1 };
    const near = nearestColor.run({ input: { color, colors: input.kit.colors } });
    const fix = `${input.variants}${shade.before}${near}${shade.opacity}`;
    const gives = Boolean(input.kit.system.candidatesToCss([fix])[0]);
    const names = input.kit.colors.map((c) => c.name).join(", ");

    return {
      kind: "finding",
      rule: "look/color",
      what: `"${input.name}" is a color of Tailwind's palette, not of the look`,
      fix: gives ? `use ${fix}` : `use a color of the look: ${names}`,
    };
  },
});

/** A class name that gives no CSS: a palette color, a kit class with a variant, or a name to fix. */
export const unknownVerdict = operation({
  label: "kit.unknownVerdict",
  input: asked,
  depends: { paletteVerdict, nearestName },
  run: ({ paletteVerdict, nearestName }, { input }): Found => {
    if (input.kit.kitClasses.has(input.utility)) {
      return {
        kind: "finding",
        rule: "kit/class",
        what: `"${input.name}": a kit class takes no variant`,
        fix: `use ${input.utility} with no variant, or utilities with the variant`,
      };
    }

    const color = paletteVerdict.run({ input });
    if (color) return color;

    const near = nearestName.run({ input: { name: input.utility, names: input.kit.names } });
    return {
      kind: "finding",
      rule: "kit/class",
      what: `"${input.name}" is not a class of the kit or of the look`,
      fix: near ? `use ${input.variants}${near}` : "use a class of the guide (easel kit)",
    };
  },
});

/** An arbitrary font size (`text-[13px]`): a finding, with the nearest look size as the fix. */
export const sizeVerdict = operation({
  label: "kit.sizeVerdict",
  input: z.custom<Asked & { value: string }>(),
  run: (_, { input }): Found => {
    const px = /^([\d.]+)(px|rem)$/.exec(input.value.trim());
    const want = Number(px?.[1]) * (px?.[2] === "rem" ? 16 : 1);
    const sizes = [...input.kit.sizes].sort(
      (a, b) => Math.abs(a.px - want) - Math.abs(b.px - want),
    );
    const fix = `${input.variants}text-${sizes[0]?.name ?? "base"}`;
    const gives = Number.isFinite(want) && Boolean(input.kit.system.candidatesToCss([fix])[0]);

    return {
      kind: "finding",
      rule: "look/size",
      what: `"${input.name}" is a font size that is not in the look`,
      fix: gives
        ? `use ${fix}`
        : `use a size of the look: ${input.kit.sizes.map((s) => `text-${s.name}`).join(", ")}`,
    };
  },
});

/** The arbitrary value of a class name: `#f00` of `bg-[#f00]`, `red` of `[color:red]`. Null: none. */
export const arbitraryOf = operation({
  label: "kit.arbitraryOf",
  input: z.custom<{ system: System; name: string }>(),
  run: (_, { input: { system, name } }) => {
    for (const candidate of system.parseCandidate(name)) {
      if (candidate.kind === "arbitrary") {
        return { value: candidate.value, property: candidate.property, root: null };
      }
      if (candidate.kind === "functional" && candidate.value?.kind === "arbitrary") {
        return { value: candidate.value.value, property: null, root: candidate.root };
      }
    }
    return null;
  },
});

/** An arbitrary color (`bg-[#f00]`, `[color:red]`): a finding, with the nearest look color. */
export const colorVerdict = operation({
  label: "kit.colorVerdict",
  input: z.custom<Asked & { color: CssColor; property: string | null; root: string | null }>(),
  depends: { nearestColor },
  run: ({ nearestColor }, { input }): Found => {
    const near = nearestColor.run({ input: { color: input.color, colors: input.kit.colors } });
    const fix = input.property
      ? `${input.variants}[${input.property}:var(--${near})]`
      : `${input.variants}${input.root}-${near}`;
    const gives = Boolean(input.kit.system.candidatesToCss([fix])[0]);

    return {
      kind: "finding",
      rule: "look/color",
      what: `"${input.name}" is a color that is not in the look`,
      fix: gives ? `use ${fix}` : `use var(--${near})`,
    };
  },
});

/** A class name with an arbitrary value: a color or a font size is a finding; layout is made. */
export const arbitraryVerdict = operation({
  label: "kit.arbitraryVerdict",
  input: z.custom<Asked & { css: string }>(),
  depends: { arbitraryOf, colorsIn, colorVerdict, sizeVerdict },
  run: (
    { arbitraryOf, colorsIn, colorVerdict, sizeVerdict },
    { input },
  ): Found | { kind: "make" } => {
    const arbitrary = arbitraryOf.run({ input: { system: input.kit.system, name: input.name } });
    if (!arbitrary) return { kind: "make" };

    const css = `--x: ${arbitrary.value}`;
    const color = colorsIn.run({ input: { css, attr: true } }).find((spot) => spot.color)?.color;
    if (color) return colorVerdict.run({ input: { ...input, ...arbitrary, color } });

    const size = arbitrary.property === "font-size" || /font-size:/.test(input.css);
    return size && !arbitrary.value.includes("var(")
      ? sizeVerdict.run({ input: { ...input, value: arbitrary.value } })
      : { kind: "make" };
  },
});

/** The verdict on one class name in one kit version, kept with the kit version. */
export const judgeClass = operation({
  label: "kit.judgeClass",
  input: z.custom<{ kit: Prepared; name: string }>(),
  depends: { splitClass, unknownVerdict, arbitraryVerdict },
  run: ({ splitClass, unknownVerdict, arbitraryVerdict }, { input: { kit, name } }): Verdict => {
    const known = kit.verdicts.get(name);
    if (known) return known;

    const { variants, utility } = splitClass.run({ input: name });
    const css = kit.kitClasses.has(name) ? null : kit.system.candidatesToCss([name])[0];
    const verdict: Verdict = kit.kitClasses.has(name)
      ? { kind: "kit" }
      : css
        ? arbitraryVerdict.run({ input: { kit, name, variants, utility, css } })
        : unknownVerdict.run({ input: { kit, name, variants, utility } });
    kit.verdicts.set(name, verdict);
    return verdict;
  },
});
