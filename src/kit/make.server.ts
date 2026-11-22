import { operation } from "@tinkered/core";
import { compile } from "tailwindcss";
import { z } from "zod";

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
