import { operation } from "@tinkered/core";
import type { EcmaScriptModule, Program } from "oxc-parser";
import { z } from "zod";

import { type Found, paintFindings, placeFindings, styleFindings } from "./check.server";
import { judgeClass } from "./judge.server";
import { oxc, placesOf } from "./oxc.server";
import type { Text } from "./places";
import { type Prepared, prepare } from "./prepare.server";
import { entryFile, kitShape } from "./schema";

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
  "export function View() with export const logic = frameLogic({ cells, ops }), or a capsule frame: export const View = resource({ ... }) and, if the frame has its own capsule, export const frame = capsule({ ... }); export no other name from the entry, and keep the other names in the file or in other files of the frame";

const moduleShape = z.custom<EcmaScriptModule>();

/**
 * The file of a folder frame that an import names (SPEC-kit.md § App frames, "A folder"): a path
 * from the importing file `from`, as written or with `.ts`, `.tsx`, `/index.ts` or `/index.tsx`.
 * Null for a name, or a path that no file of the frame has.
 */
export const localPath = operation({
  label: "kit.localPath",
  input: z.object({
    from: z.string(),
    value: z.string(),
    paths: z.array(z.string()).optional(),
  }),
  run: (_, { input: { from, value, paths } }) => {
    if (!/^\.\.?\//.test(value)) return null;

    const base = new URL(value, `file:///frame/${from}`).pathname;
    if (!base.startsWith("/frame/")) return null;
    const path = base.slice("/frame/".length);
    const tries = [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`, `${path}/index.tsx`];
    return tries.find((one) => paths?.includes(one)) ?? null;
  },
});

/**
 * The JS of an app frame (SPEC-kit.md § App frames, "The JS"): one ES module, from its fixed
 * files, made by `Bun.build` in memory. Its entry is easel's own: it imports the entry file and
 * calls `mount` of `@easel/frame` with its `View` and `frame`, so a bundler that renames a name
 * cannot break the mount. Each import of a name stays an import, for the runtime's import map;
 * an import of a file of the frame is resolved in `files`. The white space is minified, so the
 * JS has no comment that holds a path of the host. A build that fails throws: the check found
 * each import that it cannot resolve.
 */
export const appBundle = operation({
  label: "kit.appBundle",
  input: z.record(z.string(), z.string()),
  depends: { localPath },
  run: async ({ localPath }, { input: files }) => {
    const entry =
      `import * as app from "./${entryFile}";\nimport { mount } from "@easel/frame";\n` +
      "mount({ View: app.View, frame: app.frame });\n";

    const paths = Object.keys(files);
    const inMemory = Object.fromEntries([
      ...Object.entries(files).map(([path, text]) => [`/frame/${path}`, text]),
      ["/frame/__easel.ts", entry],
    ]);

    const built = await Bun.build({
      entrypoints: ["/frame/__easel.ts"],
      files: inMemory,
      external: ["*"],
      target: "browser",
      format: "esm",
      minify: { whitespace: true },
      jsx: { runtime: "automatic", importSource: "react", development: false },
      plugins: [
        {
          name: "easel-frame-files",
          setup: (build) => {
            build.onResolve({ filter: /^\.\.?\// }, (args) => {
              const from = args.importer.replace(/^\/frame\//, "");
              const path = localPath.run({ input: { from, value: args.path, paths } });
              return path === null ? undefined : { path: `/frame/${path}` };
            });
          },
        },
      ],
    });

    const [js] = built.outputs;
    if (!built.success || !js) {
      const logs = built.logs.map((log) => log.message).join("; ");
      throw new Error(`kit: the JS of a frame does not build: ${logs}`);
    }
    return js.text();
  },
});

/**
 * `kit/import`: each import that the runtime of the kit version does not have (`names`): another
 * package, an address, or a path that no file of the frame has; and each dynamic `import()`. A
 * re-export from a module (`export * from "./parts"`) loads it too.
 */
export const importFindings = operation({
  label: "kit.importFindings",
  input: z.object({
    module: moduleShape,
    names: z.array(z.string()),
    path: z.string().optional(),
    paths: z.array(z.string()).optional(),
  }),
  depends: { localPath },
  run: ({ localPath }, { input: { module, names, path, paths } }) => {
    const known = new Set(names);
    const fix = `import only the names of the runtime (${names.join(", ")}) and the files of the frame, by a path from this file, as "./copy"`;
    // The modules that the file loads: each import, and each re-export from a module.
    const requests = [
      ...module.staticImports.map((one) => one.moduleRequest),
      ...module.staticExports.flatMap((one) => one.entries.flatMap((e) => e.moduleRequest ?? [])),
    ];
    const found: Found[] = requests
      .filter(({ value }) => !known.has(value))
      .filter(
        ({ value }) => localPath.run({ input: { from: path ?? entryFile, value, paths } }) === null,
      )
      .filter((one, i, all) => all.findIndex((other) => other.start === one.start) === i)
      .map((one) => ({
        at: one.start,
        rule: "kit/import",
        what: /^\.\.?\//.test(one.value)
          ? `the frame imports "${one.value}": no file of the frame has this path`
          : `the frame imports "${one.value}": the runtime of this kit version does not have it`,
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

/** How a finding of `kit/shape` names an export: a default, all the names of a module, or a name. */
const exportTold = operation({
  label: "kit.exportTold",
  input: z.custom<ExportEntry>(),
  run: (_, { input: entry }) => {
    if (entry.exportName.kind === "Default") return "a default";
    if (entry.moduleRequest && entry.exportName.name === null) {
      return `all the names of "${entry.moduleRequest.value}"`;
    }
    return `the ${entry.isType ? "type " : ""}name ${entry.exportName.name ?? ""}`;
  },
});

/**
 * `kit/shape`: each export other than `View`, `logic` and `frame`, and `View` when it is missing.
 * A frame of the first form exports `View` and `logic`; a capsule frame exports `View` (a
 * resource) and, if it has one, its own capsule `frame` (SPEC-kit.md § The capsules). A name can
 * come from another file of the frame (`export { View } from "./view"`): the entry of the JS
 * imports the module as a whole (`appBundle`).
 */
export const shapeFindings = operation({
  label: "kit.shapeFindings",
  input: moduleShape,
  depends: { exportTold },
  run: ({ exportTold }, { input: module }) => {
    const exported = new Set<string>();
    const found: Found[] = [];
    for (const entry of module.staticExports.flatMap((one) => one.entries)) {
      const name = entry.exportName.name ?? "";
      const shown =
        !entry.isType && ["logic", "View", "frame"].includes(name) && !exported.has(name);
      if (shown) {
        exported.add(name);
        continue;
      }

      const what = `the frame exports ${exportTold.run({ input: entry })}: an app frame exports View, and logic or frame, and no other name`;
      found.push({ at: entry.start, rule: "kit/shape", what, fix: shapeFix });
    }

    if (!exported.has("View")) {
      found.push({
        at: 0,
        rule: "kit/shape",
        what: "the frame does not export View",
        fix: shapeFix,
      });
    }
    return found;
  },
});

/**
 * The module of an app frame (SPEC-kit.md § App frames, "The file", "The runtime", "A folder"):
 * `kit/import`, `kit/react-state`, and `kit/shape` for the entry only. `names` are the names of
 * the kit version's runtime; `path` is the file's path in a folder frame, `paths` all its paths.
 */
export const moduleFindings = operation({
  label: "kit.moduleFindings",
  input: z.object({
    program: z.custom<Program>(),
    module: moduleShape,
    names: z.array(z.string()),
    path: z.string().optional(),
    paths: z.array(z.string()).optional(),
  }),
  depends: { importFindings, stateFindings, shapeFindings },
  run: (units, { input: { program, module, names, path, paths } }) => [
    ...units.importFindings.run({ input: { module, names, path, paths } }),
    ...units.stateFindings.run({ input: { program, module } }),
    ...((path ?? entryFile) === entryFile ? units.shapeFindings.run({ input: module }) : []),
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
 * A TSX that does not parse is `unparsed`, with its `kit/parse` findings. In a folder frame,
 * `path` is the file's path and `paths` the paths of all its files: an import of one of them is
 * not `kit/import`, and only the entry has `kit/shape`.
 */
export const checkApp = operation({
  label: "kit.checkApp",
  input: z.object({
    tsx: z.string(),
    kit: kitShape,
    names: z.array(z.string()).optional(),
    path: z.string().optional(),
    paths: z.array(z.string()).optional(),
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
    const { names, path, paths } = input;
    const kit = await units.prepare.run({ input: input.kit });
    const classes = units.appClasses.run({ input: { kit, parts: places.classes } });
    const found: Found[] = [
      ...(names
        ? units.moduleFindings.run({ input: { program, module, names, path, paths } })
        : []),
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
