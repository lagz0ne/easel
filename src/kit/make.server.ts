import { operation } from "@tinkered/core";
import { compile } from "tailwindcss";
import { z } from "zod";

import { appBundle, checkApp } from "./app.server";
import { check } from "./check.server";
import { kitShape } from "./schema";
import { sources } from "./source.server";

// The make step (SPEC-kit.md § The make step): the only place that makes CSS (fact rule 4).

/**
 * `make(source, classNames)`: the CSS of the class names, made by Tailwind CSS v4 `compile()` at
 * the one pinned version (4.3.5; fact rule 5). Each call makes a new compiler: `build()` keeps
 * each class that it saw before, so a shared compiler makes CSS that depends on the order of the
 * puts. The same inputs give the same bytes, in any order of calls and in any process.
 */
export const make = operation({
  label: "kit.make",
  input: z.object({ source: z.string(), classNames: z.array(z.string()) }),
  run: async (_, { input }) => {
    const compiler = await compile(input.source);
    return compiler.build([...new Set(input.classNames)].sort());
  },
});

/**
 * The made CSS of a frame version: the check first, then the make of only the class names that
 * pass it, with the frame source (the layer `utilities` only). Tailwind has no setting that turns
 * arbitrary values off, so the check removes them. A frame with `<meta name="easel-kit"
 * content="off">` gets no CSS and no finding.
 */
export const makeFrame = operation({
  label: "kit.makeFrame",
  input: z.object({ html: z.string(), kit: kitShape }),
  depends: { check, make, sources },
  run: async ({ check, make, sources }, { input }) => {
    const checked = await check.run({ input });
    if (checked.kind === "off") return { kind: "off" as const };

    const { frame } = sources.run({ input: input.kit });
    const css = await make.run({ input: { source: frame, classNames: checked.classes } });
    return { kind: "made" as const, css, findings: checked.findings };
  },
});

/**
 * The made CSS and the JS of an app frame (SPEC-kit.md § App frames): the check of each of its
 * files first (`files`: one TSX is `{ "index.tsx": tsx }`), then the make of exactly the class
 * names of the fixed files, with the frame source, and the JS of the fixed files (`appBundle`).
 * With `names` (the runtime's), the findings of each module too. In a frame of more than one
 * file, each finding names its file. A file that does not parse makes nothing.
 */
export const makeApp = operation({
  label: "kit.makeApp",
  input: z.object({
    files: z.record(z.string(), z.string()),
    kit: kitShape,
    names: z.array(z.string()).optional(),
  }),
  depends: { checkApp, make, sources, appBundle },
  run: async ({ checkApp, make, sources, appBundle }, { input: { files, kit, names } }) => {
    const paths = Object.keys(files).sort();
    const named = paths.length > 1;
    const checked = [];
    for (const path of paths) {
      const tsx = files[path] ?? "";
      const one = await checkApp.run({ input: { tsx, kit, names, path, paths } });
      checked.push({
        path,
        ...one,
        findings: one.findings.map((f) => (named ? { ...f, file: path } : f)),
      });
    }

    const findings = checked.flatMap((one) => one.findings);
    const parsed = checked.flatMap((one) => (one.kind === "checked" ? [one] : []));
    if (parsed.length < checked.length) return { kind: "unparsed" as const, findings };

    const { frame } = sources.run({ input: kit });
    const classNames = [...new Set(parsed.flatMap((one) => one.classes))].sort();
    const css = await make.run({ input: { source: frame, classNames } });
    const fixed = Object.fromEntries(parsed.map((one) => [one.path, one.fixed]));
    const js = await appBundle.run({ input: fixed });
    return { kind: "made" as const, css, js, findings, fixed };
  },
});
