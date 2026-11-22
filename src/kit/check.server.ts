import { operation } from "@tinkered/core";
import { z } from "zod";

import { colorsIn, nearestColor, shownColor, type Spot } from "./colors.server";
import { judgeClass } from "./judge.server";
import { nearestName } from "./names.server";
import { type Prepared, prepare } from "./prepare.server";
import { type Part, scan } from "./scan.server";
import { type Finding, kitShape, type Rule } from "./schema";

// The K5 check (SPEC-kit.md § compose, `check`; judged rule 12): what is not in the look or the
// kit, at its line and column, with the fix. A class name of a class attribute is judged by the
// Tailwind design system of the kit version; a color in CSS is found by Lightning CSS.

/** A finding at an offset of the document, before its line and column are known. */
export type Found = { at: number; rule: Rule; what: string; fix: string };

const kitView = z.custom<Prepared>();
const partList = z.custom<Part[]>();

/** A write of a class from a script: the make step does not see it, so it gets no CSS. */
const classWrite =
  /\.(classList)\s*\.\s*(?:add|remove|toggle|replace)\s*\(|\.(className)\s*(?:\+=|=(?!=))|\.(setAttribute)\s*\(\s*["'`]class["'`]/g;

const scriptFix =
  "keep the state in hidden, aria-* or data-state, and style each state with a variant, as aria-expanded:bg-muted or data-[state=open]:flex";

/** Paint values that are no color, or a color that is allowed. */
const noPaint =
  /^\s*(?:none|currentcolor|transparent|inherit|context-fill|context-stroke|url\(.*|var\(.*)\s*$/i;

/** The class names of the class attributes: each finding, and the names to make (sorted, one time each). */
export const classFindings = operation({
  label: "kit.classFindings",
  input: z.object({ kit: kitView, parts: partList }),
  depends: { judgeClass },
  run: ({ judgeClass }, { input: { kit, parts } }) => {
    const found: Found[] = [];
    const classes = new Set<string>();

    for (const { text, at } of parts) {
      let offset = at;
      for (const name of text.split(/(\s+)/)) {
        // The white space between two names gives no verdict.
        const verdict = name.trim()
          ? (kit.verdicts.get(name) ?? judgeClass.run({ input: { kit, name } }))
          : ({ kind: "kit" } as const);
        if (verdict.kind === "make") classes.add(name);
        if (verdict.kind === "finding") found.push({ ...verdict, at: offset });
        offset += name.length;
      }
    }
    return { found, classes: [...classes].sort() };
  },
});

/** The finding of one spot that Lightning CSS found: a color, or a look value that a frame sets. */
export const spotFinding = operation({
  label: "kit.spotFinding",
  input: z.object({ kit: kitView, spot: z.custom<Spot>(), at: z.number(), where: z.string() }),
  depends: { nearestColor, shownColor },
  run: ({ nearestColor, shownColor }, { input: { kit, spot, at, where } }): Found | null => {
    if (spot.color) {
      const near = nearestColor.run({ input: { color: spot.color, colors: kit.colors } });
      const shown = shownColor.run({ input: spot.color });
      return {
        at,
        rule: "look/color",
        what: `the color ${shown} ${where} is not in the look`,
        fix: `use var(--${near})`,
      };
    }
    if (!spot.sets || !kit.look.has(spot.sets)) return null;

    return {
      at,
      rule: "look/override",
      what: `${spot.sets} is a look value: a frame does not set it`,
      fix: "remove it; change the look with easel look set",
    };
  },
});

/** The findings of the text of one style attribute, at offset 0: one for each color or look value. */
export const styleText = operation({
  label: "kit.styleText",
  input: z.object({ kit: kitView, text: z.string() }),
  depends: { colorsIn, spotFinding },
  run: ({ colorsIn, spotFinding }, { input: { kit, text } }) => {
    const found = new Map<string, Found>();

    for (const spot of colorsIn.run({ input: { css: text, attr: true } })) {
      const finding = spotFinding.run({
        input: { kit, spot, at: 0, where: "in a style attribute" },
      });
      if (finding && !found.has(finding.what)) found.set(finding.what, finding);
    }
    return [...found.values()];
  },
});

/** The colors and the look values in the style attributes. Each text is read one time. */
export const styleFindings = operation({
  label: "kit.styleFindings",
  input: z.object({ kit: kitView, parts: partList }),
  depends: { styleText },
  run: ({ styleText }, { input: { kit, parts } }) => {
    const read = new Map<string, Found[]>();
    const found: Found[] = [];

    for (const { text, at } of parts) {
      const once = read.get(text) ?? styleText.run({ input: { kit, text } });
      read.set(text, once);
      for (const finding of once) found.push({ ...finding, at });
    }
    return found;
  },
});

/** The offset of a line (from 0) and a column (from 1) of a text that starts at `at`. */
export const offsetIn = operation({
  label: "kit.offsetIn",
  input: z.object({ text: z.string(), at: z.number(), line: z.number(), column: z.number() }),
  run: (_, { input: { text, at, line, column } }) => {
    let start = 0;
    for (let passed = 0; passed < line && start >= 0; passed++) {
      start = text.indexOf("\n", start) + 1 || -1;
    }
    return at + Math.max(start, 0) + column - 1;
  },
});

/** The colors and the look values in each `<style>`, at the rule that holds them. */
export const sheetFindings = operation({
  label: "kit.sheetFindings",
  input: z.object({ kit: kitView, parts: partList }),
  depends: { colorsIn, spotFinding, offsetIn },
  run: ({ colorsIn, spotFinding, offsetIn }, { input: { kit, parts } }) => {
    const found: Found[] = [];
    const seen = new Set<string>();

    for (const { text, at } of parts) {
      for (const spot of colorsIn.run({ input: { css: text, attr: false } })) {
        const offset = offsetIn.run({ input: { text, at, line: spot.line, column: spot.column } });
        const finding = spotFinding.run({
          input: { kit, spot, at: offset, where: "in a <style>" },
        });
        const key = `${offset} ${finding?.what}`;
        if (finding && !seen.has(key)) found.push(finding);
        seen.add(key);
      }
    }
    return found;
  },
});

/** The colors of the SVG paints (`fill`, `stroke`, `stop-color`). */
export const paintFindings = operation({
  label: "kit.paintFindings",
  input: z.object({ kit: kitView, parts: partList }),
  depends: { colorsIn, spotFinding },
  run: ({ colorsIn, spotFinding }, { input: { kit, parts } }) =>
    parts
      .filter(({ text }) => !noPaint.test(text))
      .flatMap(({ text, at }) =>
        colorsIn
          .run({ input: { css: `color:${text}`, attr: true } })
          .slice(0, 1)
          .flatMap(
            (spot) => spotFinding.run({ input: { kit, spot, at, where: "of an SVG paint" } }) ?? [],
          ),
      ),
});

/** Each `k-` element that is not a piece of the kit. */
export const pieceFindings = operation({
  label: "kit.pieceFindings",
  input: z.object({ kit: kitView, parts: partList }),
  depends: { nearestName },
  run: ({ nearestName }, { input: { kit, parts } }) =>
    parts
      .filter(({ text }) => !kit.pieces.has(text))
      .map(({ text, at }): Found => {
        const near = nearestName.run({ input: { name: text, names: kit.pieces } });
        return {
          at,
          rule: "kit/piece",
          what: `<${text}> is not a piece of the kit`,
          fix: near
            ? `use <${near}>`
            : "use a piece of the guide (easel kit), or add one with easel kit put",
        };
      }),
});

/** Each write of a class in a script: the make step does not see a class that a script adds. */
export const scriptFindings = operation({
  label: "kit.scriptFindings",
  input: partList,
  run: (_, { input: parts }) =>
    parts.flatMap(({ text, at }) =>
      [...text.matchAll(classWrite)].map((write): Found => ({
        at: at + write.index + 1,
        rule: "kit/script",
        what: `a script writes the class with ${write[1] ?? write[2] ?? write[3]}: the make step does not see that class, so it gets no CSS`,
        fix: scriptFix,
      })),
    ),
});

/** The line and the column (both from 1) of each finding, in document order. */
export const placeFindings = operation({
  label: "kit.placeFindings",
  input: z.object({ html: z.string(), found: z.custom<Found[]>() }),
  run: (_, { input: { html, found } }): Finding[] => {
    const lines = [0];
    for (let at = html.indexOf("\n"); at >= 0; at = html.indexOf("\n", at + 1)) lines.push(at + 1);

    let line = 0;
    return [...found]
      .sort((a, b) => a.at - b.at)
      .map(({ at, rule, what, fix }) => {
        while ((lines[line + 1] ?? Infinity) <= at) line++;
        return { line: line + 1, col: at - (lines[line] ?? 0) + 1, rule, what, fix };
      });
  },
});

/**
 * K5: the findings of a document, in document order, and the class names to make. A class name
 * that is a finding is not to make: Tailwind has no setting that turns arbitrary values off. A
 * frame with `<meta name="easel-kit" content="off">` is not checked.
 */
export const check = operation({
  label: "kit.check",
  input: z.object({ html: z.string(), kit: kitShape }),
  depends: {
    scan,
    prepare,
    classFindings,
    styleFindings,
    sheetFindings,
    paintFindings,
    pieceFindings,
    scriptFindings,
    placeFindings,
  },
  run: async (units, { input }) => {
    const parts = units.scan.run({ input: input.html });
    if (parts.off) return { kind: "off" as const };

    const kit = await units.prepare.run({ input: input.kit });
    const classes = units.classFindings.run({ input: { kit, parts: parts.classes } });
    const found = [
      ...classes.found,
      ...units.styleFindings.run({ input: { kit, parts: parts.styles } }),
      ...units.sheetFindings.run({ input: { kit, parts: parts.sheets } }),
      ...units.paintFindings.run({ input: { kit, parts: parts.paints } }),
      ...units.pieceFindings.run({ input: { kit, parts: parts.pieces } }),
      ...units.scriptFindings.run({ input: parts.scripts }),
    ];

    const findings = units.placeFindings.run({ input: { html: input.html, found } });
    return { kind: "checked" as const, findings, classes: classes.classes };
  },
});
