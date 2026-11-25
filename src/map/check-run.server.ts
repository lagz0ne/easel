import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { operation } from "@tinkered/core";
import { z } from "zod";

import { maps } from "@/live/screens";

import { designedFile, mapCheck } from "./check";
import type { MapFinding } from "./check";
import { deriveOf, fieldOf } from "./source.server";
import type { Derived } from "./source.server";

export type Checked = { name: string; derived: Derived };

const checked = z.custom<readonly Checked[]>();

export const derivedMaps = operation({
  label: "map.derivedMaps",
  input: z.string(),
  depends: { deriveOf },
  run: async ({ deriveOf }, { input: root }) => {
    const found: Checked[] = [];
    for (const entry of maps) {
      const one = await deriveOf.run({ input: { root, label: entry.cell } });
      if (one.kind === "missing") throw new Error(`map-check: no cell ${entry.cell} in src/`);
      found.push({ name: entry.name, derived: one.derived });
    }
    return found;
  },
});

export const readDesigned = operation({
  label: "map.readDesigned",
  input: z.string(),
  run: (_, { input: file }) => {
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .map((text, at) => ({ line: at + 1, text: text.trim() }))
      .filter((each) => each.text);
  },
});

const lineIn = operation({
  label: "map.lineIn",
  input: z.object({ file: z.string(), needles: z.array(z.string()) }),
  run: (_, { input: { file, needles } }) => {
    if (!existsSync(file)) return null;
    const lines = readFileSync(file, "utf8").split("\n");
    for (const needle of needles) {
      const at = lines.findIndex((line) => line.includes(needle));
      if (at >= 0) return at + 1;
    }
    return null;
  },
});

const answerLine = operation({
  label: "map.answerLine",
  input: z.object({ file: z.string(), callLine: z.number(), kind: z.string() }),
  run: (_, { input: { file, callLine, kind } }) => {
    const lines = readFileSync(file, "utf8").split("\n");
    const named = new RegExp(`"${kind}"|^\\s*${kind},`);
    for (let at = callLine; at < lines.length; at += 1) {
      const line = lines[at] ?? "";
      if (/^\s*"[^"]+": \{/.test(line) || /^\S/.test(line)) return null;
      if (named.test(line)) return at + 1;
    }
    return null;
  },
});

const callPlace = operation({
  label: "map.callPlace",
  input: z.object({ src: z.string(), call: z.string(), answer: z.string(), fallback: z.string() }),
  depends: { lineIn, answerLine },
  run: async ({ lineIn, answerLine }, { input: { src, call, answer, fallback } }) => {
    for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: src, absolute: true })) {
      if (file.includes(".server.")) continue;
      const callLine = lineIn.run({ input: { file, needles: [`"${call}": {`] } });
      if (!callLine) continue;

      const line = answerLine.run({ input: { file, callLine, kind: answer } });
      return { file, line: line ?? callLine };
    }
    return { file: fallback, line: 1 };
  },
});

const actionPlace = operation({
  label: "map.actionPlace",
  input: z.object({
    derived: z.custom<Derived>().optional(),
    action: z.string(),
    fallback: z.string(),
  }),
  depends: { lineIn, fieldOf },
  run: ({ lineIn, fieldOf }, { input: { derived, action, fallback } }) => {
    const offered = derived?.actions.find(
      (each) => fieldOf.run({ input: { value: each.unit, key: "label" } }) === action,
    );
    const file = offered?.file ?? fallback;
    const line = lineIn.run({ input: { file, needles: [`label: "${action}"`] } });
    return { file, line: line ?? 1 };
  },
});

const statePlace = operation({
  label: "map.statePlace",
  input: z.object({
    view: z.string().nullable(),
    state: z.string(),
    press: z.string().nullable(),
    fallback: z.string(),
  }),
  depends: { lineIn },
  run: ({ lineIn }, { input: { view, state, press, fallback } }) => {
    if (press && view) {
      return { file: view, line: lineIn.run({ input: { file: view, needles: [press] } }) ?? 1 };
    }

    const needles = [`z.literal("${state}")`, `"${state}"`];
    return { file: fallback, line: lineIn.run({ input: { file: fallback, needles } }) ?? 1 };
  },
});

const findingFiles = operation({
  label: "map.findingFiles",
  input: z.object({ root: z.string(), map: z.string(), checked }),
  run: (_, { input: { root, map, checked } }) => {
    const src = join(root, "src");
    const derived = checked.find((each) => each.name === map)?.derived;
    const fallback = derived?.cell.file ?? join(src, "live/screens.ts");
    return { src, derived, fallback, view: derived?.view ?? null };
  },
});

const placeOf = operation({
  label: "map.placeOf",
  input: z.object({
    root: z.string(),
    finding: z.custom<MapFinding>(),
    checked,
    designed: z.string(),
  }),
  depends: { findingFiles, callPlace, actionPlace, statePlace },
  run: async (deps, { input: { root, finding, checked, designed } }) => {
    const files = deps.findingFiles.run({ input: { root, map: finding.map, checked } });
    const { src, derived, fallback, view } = files;

    const at = finding.at;
    switch (at.kind) {
      case "record":
        return { file: designed, line: at.line };
      case "call":
        return deps.callPlace.run({ input: { src, call: at.call, answer: at.answer, fallback } });
      case "action":
        return deps.actionPlace.run({ input: { derived, action: at.action, fallback } });
      case "state":
        return deps.statePlace.run({
          input: { view, state: at.state, press: at.press, fallback },
        });
    }
  },
});

export const checkArgs = operation({
  label: "map.checkArgs",
  input: z.object({ args: z.array(z.string()), root: z.string() }),
  run: (_, { input: { args, root } }) => {
    const at = args.indexOf("--designed");
    const named = at >= 0 ? args[at + 1] : undefined;
    const rest = args.filter(
      (arg, index) => arg !== "--write" && (at < 0 || index < at || index > at + 1),
    );
    if (rest.length > 0 || (at >= 0 && (!named || named.startsWith("-")))) {
      return { kind: "wrong" as const };
    }

    const designed = named ?? join(root, designedFile);
    const path = relative(root, designed);
    const shown = path.startsWith("..") ? designed : path;
    return { kind: "check" as const, write: args.includes("--write"), designed, shown };
  },
});

export const mapFindings = operation({
  label: "map.mapFindings",
  input: z.object({ checked, designed: z.string() }),
  depends: { readDesigned, mapCheck },
  run: ({ readDesigned, mapCheck }, { input }) =>
    mapCheck.run({
      input: {
        maps: input.checked.map(({ name, derived }) => ({ name, map: derived.map })),
        designed: readDesigned.run({ input: input.designed }),
      },
    }),
});

export const placedFindings = operation({
  label: "map.placedFindings",
  input: z.object({
    root: z.string(),
    findings: z.custom<readonly MapFinding[]>(),
    checked,
    designed: z.string(),
  }),
  depends: { placeOf },
  run: async ({ placeOf }, { input: { root, findings, checked, designed } }) => {
    const placed = [];
    for (const finding of findings) {
      const place = await placeOf.run({ input: { root, finding, checked, designed } });
      const path = relative(root, place.file);
      placed.push({
        path: path.startsWith("..") ? place.file : path,
        line: place.line,
        rule: finding.rule,
        what: finding.what,
      });
    }
    return placed;
  },
});
