import { operation, resource } from "@tinkered/core";
import type { EcmaScriptModule, Program } from "oxc-parser";
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

/**
 * JS from TSX (frame-apps decision 7): Bun.Transpiler, built into Bun, with React's JSX runtime
 * imported (`react/jsx-runtime`, a name of the runtime), so the JS needs no bundler.
 */
export const transpiler = resource({
  label: "kit.transpiler",
  target: "scope",
  factory: () =>
    new Bun.Transpiler({
      loader: "tsx",
      target: "browser",
      autoImportJSX: true,
      tsconfig: { compilerOptions: { jsx: "react-jsx", jsxImportSource: "react" } },
    }),
});

/** The JS of the fixed text of an app frame: its types removed and its JSX made calls. */
export const appJs = operation({
  label: "kit.appJs",
  input: z.string(),
  depends: { transpiler },
  run: ({ transpiler }, { input }) => transpiler.transformSync(input),
});

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
    if (parsed.errors.length === 0) {
      return { kind: "parsed" as const, program: parsed.program, module: parsed.module };
    }

    const found = parsed.errors.map((error): Found => ({
      at: error.labels[0]?.start ?? 0,
      rule: "kit/parse",
      what: `the TSX does not parse: ${error.message}`,
      fix: error.helpMessage ?? "write TSX that parses: React 19 and TypeScript",
    }));
    return { kind: "unparsed" as const, found };
  },
});

/** The React hooks that keep state or run an effect (`kit/react-state`, as `tinker/react-state`). */
const stateHooks = new Set([
  "useState",
  "useReducer",
  "useActionState",
  "useOptimistic",
  "useSyncExternalStore",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);

const stateFix =
  "keep each state in a Tinker cell of logic: data() and operation() in logic, useData() and useRun() in View; a text field that keeps each key uses defaultValue";

const shapeFix =
  "export const logic = frameLogic({ cells, ops }) and export function View(), and no other name; keep the other names in the file, not exported";

const moduleShape = z.custom<EcmaScriptModule>();

/**
 * `kit/import`: each import that the runtime of the kit version does not have (`names`): another
 * package, a relative import or an address; and each dynamic `import()`.
 */
export const importFindings = operation({
  label: "kit.importFindings",
  input: z.object({ module: moduleShape, names: z.array(z.string()) }),
  run: (_, { input: { module, names } }) => {
    const known = new Set(names);
    const fix = `import only the names of the runtime: ${names.join(", ")}; keep all code of the frame in this one file`;
    const found: Found[] = module.staticImports
      .filter((one) => !known.has(one.moduleRequest.value))
      .map((one) => ({
        at: one.moduleRequest.start,
        rule: "kit/import",
        what: `the frame imports "${one.moduleRequest.value}": the runtime of this kit version does not have it`,
        fix,
      }));

    for (const one of module.dynamicImports) {
      const what = "the frame loads code with import(): the check cannot see what it loads";
      found.push({ at: one.start, rule: "kit/import", what, fix });
    }
    return found;
  },
});

/**
 * `kit/react-state`: each React hook that keeps state or runs an effect, imported by its name from
 * `react`, or read from a namespace or a default import (`React.useState`).
 */
export const stateFindings = operation({
  label: "kit.stateFindings",
  input: z.object({ program: z.custom<Program>(), module: moduleShape }),
  depends: { oxc },
  run: ({ oxc }, { input: { program, module } }) => {
    const hooks: Array<{ name: string; at: number }> = [];
    for (const one of module.staticImports) {
      if (one.moduleRequest.value !== "react") continue;
      for (const { importName } of one.entries) {
        if (importName.name !== null && stateHooks.has(importName.name)) {
          hooks.push({ name: importName.name, at: importName.start ?? one.start });
        }
      }
    }

    // `React.useState`: a hook read from a namespace or a default import.
    hooks.push(...oxc.members(program, stateHooks));
    return hooks.map(({ name, at }): Found => ({
      at,
      rule: "kit/react-state",
      what: `the frame keeps state in React with ${name}`,
      fix: stateFix,
    }));
  },
});

type ExportEntry = EcmaScriptModule["staticExports"][number]["entries"][number];

/** How a finding of `kit/shape` names an export: a name, a default, or a re-export. */
const exportTold = operation({
  label: "kit.exportTold",
  input: z.custom<ExportEntry>(),
  run: (_, { input: entry }) => {
    if (entry.moduleRequest) return `the names of "${entry.moduleRequest.value}"`;
    if (entry.exportName.kind === "Default") return "a default";
    if (entry.localName.name !== entry.exportName.name) {
      return `${entry.localName.name ?? ""} as ${entry.exportName.name ?? ""}: export logic and View by their own names`;
    }
    return `the ${entry.isType ? "type " : ""}name ${entry.exportName.name ?? ""}`;
  },
});

/** `kit/shape`: each export other than `logic` and `View`, and each of the two that is missing. */
export const shapeFindings = operation({
  label: "kit.shapeFindings",
  input: moduleShape,
  depends: { exportTold },
  run: ({ exportTold }, { input: module }) => {
    const exported = new Set<string>();
    const found: Found[] = [];
    for (const entry of module.staticExports.flatMap((one) => one.entries)) {
      const name = entry.exportName.name ?? "";
      // By its own name (`export const logic`), so the composed document can mount it.
      const own = [
        !entry.moduleRequest,
        !entry.isType,
        entry.localName.name === name,
        ["logic", "View"].includes(name),
        !exported.has(name),
      ].every(Boolean);
      if (own) {
        exported.add(name);
        continue;
      }

      const what = `the frame exports ${exportTold.run({ input: entry })}: an app frame exports logic and View, and only them`;
      found.push({ at: entry.start, rule: "kit/shape", what, fix: shapeFix });
    }

    for (const name of ["logic", "View"].filter((one) => !exported.has(one))) {
      const what = `the frame does not export ${name}`;
      found.push({ at: 0, rule: "kit/shape", what, fix: shapeFix });
    }
    return found;
  },
});

/**
 * The module of an app frame (SPEC-kit.md § App frames, "The file", "The runtime"): `kit/import`,
 * `kit/react-state` and `kit/shape`. `names` are the names of the kit version's runtime.
 */
export const moduleFindings = operation({
  label: "kit.moduleFindings",
  input: z.object({
    program: z.custom<Program>(),
    module: moduleShape,
    names: z.array(z.string()),
  }),
  depends: { importFindings, stateFindings, shapeFindings },
  run: (units, { input: { program, module, names } }) => [
    ...units.importFindings.run({ input: { module, names } }),
    ...units.stateFindings.run({ input: { program, module } }),
    ...units.shapeFindings.run({ input: module }),
  ],
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
 * (SPEC-kit.md § App frames, "Fixes by position"). With `names` (the names of the kit version's
 * runtime), the findings of its module too (`moduleFindings`): what the put and `kit.check` give.
 * A TSX that does not parse is `unparsed`, with its `kit/parse` findings.
 */
export const checkApp = operation({
  label: "kit.checkApp",
  input: z.object({
    tsx: z.string(),
    kit: kitShape,
    names: z.array(z.string()).optional(),
  }),
  depends: {
    parseApp,
    moduleFindings,
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

    const { program, module } = parsed;
    const places = units.placesOf.run({ input: { source: input.tsx, program } });
    const { names } = input;
    const kit = await units.prepare.run({ input: input.kit });
    const classes = units.appClasses.run({ input: { kit, parts: places.classes } });
    const found: Found[] = [
      ...(names ? units.moduleFindings.run({ input: { program, module, names } }) : []),
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
