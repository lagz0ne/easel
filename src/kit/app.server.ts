import { operation } from "@tinkered/core";
import { z } from "zod";

import { type Found, paintFindings, placeFindings, styleFindings } from "./check.server";
import { judgeClass } from "./judge.server";
import { oxc, placesOf } from "./oxc.server";
import type { Text } from "./places";
import { type Prepared, prepare } from "./prepare.server";
import { kitShape } from "./schema";

// The kit check of an app frame (SPEC-kit.md § App frames; judged rules 14 and 15). oxc-parser
// reads the TSX; the one walk of the class places (`places.ts`) gives each class, style and paint
// text with its offset. Each class name gets the K5 verdict of an HTML frame. A fix by position
// changes only the text of its class name, so the fixed text has the same places.

/** One fix by position: the text from `at` to `end` becomes `text`. */
type Edit = { at: number; end: number; text: string };

const builtFix =
  'write each class name whole: a map of whole names, as const tone = { info: "bg-info", danger: "bg-destructive" } and className={tone[kind]}';

const scriptFix =
  'keep the state in a Tinker cell of logic, and choose the class in className, as className={cn(open && "flex")}';

/** The source of an app frame as oxc-parser reads it, or its parse findings (`kit/parse`). */
export const parseApp = operation({
  label: "kit.parseApp",
  input: z.string(),
  depends: { oxc },
  run: ({ oxc }, { input: tsx }) => {
    const parsed = oxc.parseSync("frame.tsx", tsx, {
      lang: "tsx",
      sourceType: "module",
      preserveParens: false,
    });
    if (parsed.errors.length === 0) return { kind: "parsed" as const, program: parsed.program };

    const found = parsed.errors.map((error): Found => ({
      at: error.labels[0]?.start ?? 0,
      rule: "kit/parse",
      what: `the TSX does not parse: ${error.message}`,
      fix: error.helpMessage ?? "write TSX that parses: React 19 and TypeScript",
    }));
    return { kind: "unparsed" as const, found };
  },
});

/**
 * The class names of the class places: each finding, the fixes by position, and the names to
 * make (sorted, one time each). A finding with a class of the look (`to`) is replaced by it; any
 * other finding is removed, with the white space before it (or after it, when it is first).
 */
export const appClasses = operation({
  label: "kit.appClasses",
  input: z.object({ kit: z.custom<Prepared>(), parts: z.custom<Text[]>() }),
  depends: { judgeClass },
  run: ({ judgeClass }, { input: { kit, parts } }) => {
    const names = parts.flatMap(({ text, at }) =>
      [...text.matchAll(/\S+/g)].map(({ 0: name, index }) => ({
        text,
        name,
        index,
        start: at + index,
        verdict: kit.verdicts.get(name) ?? judgeClass.run({ input: { kit, name } }),
      })),
    );

    const classes = new Set<string>();
    const found: Found[] = [];
    for (const { name, start, verdict } of names) {
      if (verdict.kind === "make") classes.add(name);
      if (verdict.kind !== "finding") continue;

      found.push({ at: start, rule: verdict.rule, what: verdict.what, fix: verdict.fix });
      if (verdict.to) classes.add(verdict.to);
    }

    // The fix of each finding: its class of the look, or no name.
    const edits = names.flatMap(({ text, name, index, start, verdict }): Edit[] => {
      if (verdict.kind !== "finding") return [];
      if (verdict.to) return [{ at: start, end: start + name.length, text: verdict.to }];

      const before = /\s+$/.exec(text.slice(0, index))?.[0].length ?? 0;
      const after = before ? 0 : (/^\s+/.exec(text.slice(index + name.length))?.[0].length ?? 0);
      return [{ at: start - before, end: start + name.length + after, text: "" }];
    });
    return { found, edits, classes: [...classes].sort() };
  },
});

/** The text with each fix applied, from the last one back, so each offset still holds. */
export const applyEdits = operation({
  label: "kit.applyEdits",
  input: z.object({ text: z.string(), edits: z.custom<Edit[]>() }),
  run: (_, { input: { text, edits } }) => {
    let fixed = text;
    for (const edit of [...edits].sort((a, b) => b.at - a.at)) {
      fixed = fixed.slice(0, edit.at) + edit.text + fixed.slice(edit.end);
    }
    return fixed;
  },
});

/**
 * K5 on an app frame: the findings in document order, the class names to make, and the fixed text
 * (SPEC-kit.md § App frames, "Fixes by position"). A TSX that does not parse is `unparsed`, with
 * its `kit/parse` findings.
 */
export const checkApp = operation({
  label: "kit.checkApp",
  input: z.object({ tsx: z.string(), kit: kitShape }),
  depends: {
    parseApp,
    placesOf,
    prepare,
    appClasses,
    styleFindings,
    paintFindings,
    placeFindings,
    applyEdits,
  },
  run: async (units, { input }) => {
    const parsed = units.parseApp.run({ input: input.tsx });
    if (parsed.kind === "unparsed") {
      const findings = units.placeFindings.run({ input: { html: input.tsx, found: parsed.found } });
      return { kind: "unparsed" as const, findings };
    }

    const { program } = parsed;
    const places = units.placesOf.run({ input: { source: input.tsx, program } });
    const kit = await units.prepare.run({ input: input.kit });
    const classes = units.appClasses.run({ input: { kit, parts: places.classes } });
    const found: Found[] = [
      ...classes.found,
      ...units.styleFindings.run({ input: { kit, parts: places.styles } }),
      ...units.paintFindings.run({ input: { kit, parts: places.paints } }),
      ...places.built.map(({ text, at }): Found => ({
        at,
        rule: "kit/class-built",
        what: `code builds the class \`${text}\`: the make step does not see it, so it gets no CSS`,
        fix: builtFix,
      })),
      ...places.scripts.map(({ text, at }): Found => ({
        at,
        rule: "kit/script",
        what: `code writes the class with ${text}: the make step does not see that class, so it gets no CSS`,
        fix: scriptFix,
      })),
    ];

    const findings = units.placeFindings.run({ input: { html: input.tsx, found } });
    const fixed = units.applyEdits.run({ input: { text: input.tsx, edits: classes.edits } });
    return { kind: "checked" as const, findings, classes: classes.classes, fixed };
  },
});
