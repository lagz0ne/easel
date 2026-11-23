import { operation, resource } from "@tinkered/core";
import type { Visitor } from "lightningcss";
import { __unstable__loadDesignSystem } from "tailwindcss";
import { z } from "zod";

import { colorOf, type Lab, oklab } from "./colors.server";
import { lightningcss } from "./lightningcss.server";
import type { Rule } from "./schema";
import { kitShape } from "./schema";
import { sources } from "./source.server";

export type System = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;

export type Verdict =
  | { kind: "make" }
  | { kind: "kit" }
  | { kind: "finding"; rule: Rule; what: string; fix: string; to?: string };

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

const notColor = /^--(?:text|radius|shadow|font)-|^--spacing$/;

export const prepared = resource({
  label: "kit.prepared",
  target: "scope",
  factory: () => ({
    kits: new Map<number, Promise<Prepared>>(),
    palette: new Map<string, Lab | null>(),
  }),
});

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
