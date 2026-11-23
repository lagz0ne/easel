import { createScope, operation } from "@tinkered/core";
import { definePlugin, defineRule } from "vite-plus/lint/plugins";
import { z } from "zod";

import { oxc, placesOf } from "./oxc.server.ts";

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
