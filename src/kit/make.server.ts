import { operation } from "@tinkered/core";
import { compile } from "tailwindcss";
import { z } from "zod";

import { appBundle, checkApp } from "./app.server";
import { check } from "./check.server";
import { type Finding, kitShape } from "./schema";
import { sources } from "./source.server";
import type { TeamTexts } from "./texts";

export const make = operation({
  label: "kit.make",
  input: z.object({ source: z.string(), classNames: z.array(z.string()) }),
  run: async (_, { input }) => {
    const compiler = await compile(input.source);
    return compiler.build([...new Set(input.classNames)].sort());
  },
});

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

export const makeApp = operation({
  label: "kit.makeApp",
  input: z.object({
    files: z.record(z.string(), z.string()),
    kit: kitShape,
    names: z.array(z.string()).optional(),
    texts: z.custom<TeamTexts>().optional(),
    exploring: z.boolean().optional(),
  }),
  depends: { checkApp, make, sources, appBundle },
  run: async ({ checkApp, make, sources, appBundle }, { input }) => {
    const { files, kit, names, texts, exploring } = input;
    const paths = Object.keys(files).sort();
    const named = paths.length > 1;
    const checked = [];
    for (const path of paths) {
      const tsx = files[path] ?? "";
      const one = await checkApp.run({ input: { tsx, kit, names, path, paths, texts } });
      checked.push({
        path,
        ...one,
        findings: one.findings.map((f) => (named ? { ...f, file: path } : f)),
        unfixed: (one.kind === "checked" ? one.unfixed : []).map((f): Finding =>
          named ? { ...f, file: path } : f,
        ),
      });
    }

    const findings = checked.flatMap((one) => one.findings);
    const unfixed = checked.flatMap((one) => one.unfixed);
    const parsed = checked.flatMap((one) => (one.kind === "checked" ? [one] : []));
    if (parsed.length < checked.length) return { kind: "unparsed" as const, findings };

    const { frame } = sources.run({ input: kit });
    const classNames = [
      ...new Set(parsed.flatMap((one) => (exploring ? one.written : one.classes))),
    ].sort();
    const css = await make.run({ input: { source: frame, classNames } });
    const fixed = exploring
      ? Object.fromEntries(parsed.map((one) => [one.path, files[one.path] ?? ""]))
      : Object.fromEntries(parsed.map((one) => [one.path, one.fixed]));
    const js = await appBundle.run({ input: fixed });
    return { kind: "made" as const, css, js, findings, unfixed, fixed };
  },
});
