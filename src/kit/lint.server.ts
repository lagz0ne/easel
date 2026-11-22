import { createScope, operation } from "@tinkered/core";
import { definePlugin, defineRule } from "vite-plus/lint/plugins";
import { z } from "zod";

import { oxc, placesOf } from "./oxc.server.ts";

// The rule `kit/class-built` as an Oxlint JS plugin (SPEC-kit.md § App frames; fact rule 9), for
// an agent's own app frame files, as the Tinker rules are a plugin: `jsPlugins: [{ name: "easel",
// specifier: "<this file>" }]`, then `"easel/class-built": "error"`. It reads the file with the
// one oxc-parser and the one walk of the class places (`places.ts`) of the server check, so a
// frame that passes it has no `kit/class-built` at the put. (Oxlint's own tree is oxc's too, but
// its node types come from another version of the types.) The K5 verdicts need the kit version,
// so they stay on the server (`easel kit check`).

/** The places that are built, in a source: none when it does not parse (the put says why). */
export const builtPlaces = operation({
  label: "kit.builtPlaces",
  input: z.string(),
  depends: { oxc, placesOf },
  run: ({ oxc, placesOf }, { input: source }) => {
    const parsed = oxc.parseSync("frame.tsx", source, { lang: "tsx", sourceType: "module" });
    if (parsed.errors.length > 0) return [];

    return placesOf.run({ input: { source, program: parsed.program } }).built;
  },
});

/** A scope for the rule: it has no capsules, so its runs are sync, as a rule's visit is. */
const scope = createScope();

const classBuilt = defineRule({
  meta: {
    type: "problem",
    docs: { description: "A class name in a class place of an app frame is a whole string." },
    messages: {
      built:
        'Code builds a class name ({{what}}): the make step does not see it, so it gets no CSS. Write each class name whole: a map of whole names, as const tone = { info: "bg-info", danger: "bg-destructive" } and className={tone[kind]}.',
    },
  },
  create: (context) => ({
    Program: () => {
      const code = context.sourceCode;
      for (const { text, at } of scope.run(builtPlaces, { input: code.text })) {
        const start = code.getLocFromIndex(at);
        context.report({ messageId: "built", data: { what: text }, loc: { start, end: start } });
      }
    },
  }),
});

export default definePlugin({ meta: { name: "easel" }, rules: { "class-built": classBuilt } });
