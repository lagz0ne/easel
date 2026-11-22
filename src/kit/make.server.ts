import { operation } from "@tinkered/core";
import { compile } from "tailwindcss";
import { z } from "zod";

import { appJs, checkApp } from "./app.server";
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
 * The made CSS and the JS of an app frame (SPEC-kit.md § App frames): its check first, then the
 * make of exactly the class names of the fixed text, with the frame source, and the JS of the
 * fixed text (Bun.Transpiler). With `names` (the runtime's), the findings of the module too. A TSX
 * that does not parse makes nothing.
 */
export const makeApp = operation({
  label: "kit.makeApp",
  input: z.object({ tsx: z.string(), kit: kitShape, names: z.array(z.string()).optional() }),
  depends: { checkApp, make, sources, appJs },
  run: async ({ checkApp, make, sources, appJs }, { input }) => {
    const checked = await checkApp.run({ input });
    if (checked.kind === "unparsed") return checked;

    const { frame } = sources.run({ input: input.kit });
    const css = await make.run({ input: { source: frame, classNames: checked.classes } });
    const js = appJs.run({ input: checked.fixed });
    return { kind: "made" as const, css, js, findings: checked.findings, fixed: checked.fixed };
  },
});
