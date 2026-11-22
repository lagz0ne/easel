import { operation, resource } from "@tinkered/core";
import type { Visitor } from "lightningcss";
import { __unstable__loadDesignSystem } from "tailwindcss";
import { z } from "zod";

import { colorOf, type Lab, oklab } from "./colors.server";
import { lightningcss } from "./lightningcss.server";
import type { Rule } from "./schema";
import { kitShape } from "./schema";
import { sources } from "./source.server";

// The check's view of a kit version (SPEC-kit.md § compose, `check`): its Tailwind design system,
// the class names of its pieces, and the colors and sizes of its look. It is made one time for
// each kit version: a kit version never changes (judged rule 4), so its number is the key.

/** The Tailwind design system of a kit version. Not a stable API of Tailwind: the pin holds it. */
export type System = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;

/**
 * What the check says about one class name in one kit version. `to`: the class of the look that
 * a fix by position puts in its place (an app frame, SPEC-kit.md § App frames); with none, the
 * fix removes the name.
 */
export type Verdict =
  | { kind: "make" }
  | { kind: "kit" }
  | { kind: "finding"; rule: Rule; what: string; fix: string; to?: string };

/** All that the check needs of one kit version. */
export type Prepared = {
  system: System;
  kitClasses: Set<string>;
  pieces: Set<string>;
  look: Set<string>;
  colors: Array<{ name: string; lab: Lab }>;
  sizes: Array<{ name: string; px: number }>;
  verdicts: Map<string, Verdict>;
  names: string[];
};

/** The look's CSS names that are not colors (as in source.server.ts). */
const notColor = /^--(?:text|radius|shadow|font)-|^--spacing$/;

/** The kit versions that the check has made, and the colors of Tailwind's palette that it read. */
export const prepared = resource({
  label: "kit.prepared",
  target: "scope",
  factory: () => ({
    kits: new Map<number, Promise<Prepared>>(),
    palette: new Map<string, Lab | null>(),
  }),
});

/** A visitor that puts each class name of each selector that Lightning CSS reads into `into`. */
export const selectorVisitor = operation({
  label: "kit.selectorVisitor",
  input: z.custom<Set<string>>(),
  run: (_, { input: into }): Visitor<never> => ({
    Selector: (selector) => {
      for (const match of JSON.stringify(selector).matchAll(/"type":"class","name":"([^"]+)"/g)) {
        into.add(match[1] ?? "");
      }
    },
  }),
});

/** The class names that the kit's own CSS defines: its class pieces and the names they use. */
export const kitClasses = operation({
  label: "kit.kitClasses",
  input: z.string(),
  depends: { selectorVisitor },
  run: ({ selectorVisitor }, { input }) => {
    const found = new Set<string>();
    lightningcss.transform({
      filename: "kit.css",
      code: new TextEncoder().encode(input),
      errorRecovery: true,
      visitor: selectorVisitor.run({ input: found }),
    });
    return found;
  },
});

/** The colors of the look, in OKLab, by the name of their class (`primary` for `--primary`). */
export const lookColors = operation({
  label: "kit.lookColors",
  input: kitShape.shape.look,
  depends: { colorOf, oklab },
  run: ({ colorOf, oklab }, { input }) =>
    Object.entries(input)
      .filter(([name]) => !notColor.test(name))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .flatMap(([name, value]) => {
        const color = colorOf.run({ input: value });
        const lab = color ? oklab.run({ input: color }) : null;
        return lab ? [{ name: name.slice(2), lab }] : [];
      }),
});

/** The font sizes of the look in px, by the name of their class (`sm` for `--text-sm`). */
export const lookSizes = operation({
  label: "kit.lookSizes",
  input: kitShape.shape.look,
  run: (_, { input }) =>
    Object.entries(input).flatMap(([name, value]) => {
      const size = /^--text-([a-z0-9]+)$/.exec(name)?.[1];
      const px = /^([\d.]+)(px|rem)$/.exec(value.trim());
      const scale = px?.[2] === "rem" ? 16 : 1;
      return size && px ? [{ name: size, px: Number(px[1]) * scale }] : [];
    }),
});

/** The check's view of a kit version, made one time for each kit version. */
export const prepare = operation({
  label: "kit.prepare",
  input: kitShape,
  depends: { prepared, sources, kitClasses, lookColors, lookSizes },
  run: ({ prepared, sources, kitClasses, lookColors, lookSizes }, { input }) => {
    const known = prepared.kits.get(input.version);
    if (known) return known;

    const classes = kitClasses.run({ input: input.css });
    const made = __unstable__loadDesignSystem(sources.run({ input }).kit).then(
      (system): Prepared => ({
        system,
        kitClasses: classes,
        pieces: new Set(input.pieces),
        look: new Set(Object.keys(input.look)),
        colors: lookColors.run({ input: input.look }),
        sizes: lookSizes.run({ input: input.look }),
        verdicts: new Map(),
        names: [...classes, ...system.getClassList().map(([name]) => name)],
      }),
    );
    prepared.kits.set(input.version, made);
    return made;
  },
});
