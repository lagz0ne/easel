import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { createScope } from "@tinkered/core";

import { maps } from "@/live/screens";
import { designedFile, mapCheck, mapCheckText, mapDesignLines } from "@/map/check";
import type { MapFinding } from "@/map/check";

import { deriveOf } from "./map";
import type { Derived } from "./map";

const usage = `bun scripts/map-check.ts [--write] [--designed <file>]

Checks each map of src/live/screens.ts against ${designedFile} (SPEC-prototype rule 11, J8). The file
names each designed state and each designed answer of each map. A finding is one line, then its
fix: an answer that the file does not have (map/answer), a state that the file does not have
(map/state), or a line of the file that the code does not have now (map/gone).
--write writes the file from the maps of the code. Commit it: its diff is the sign-off.
--designed <file> reads and writes that file in place of ${designedFile}.

Exit: 0 when each state and each answer is designed, or after --write; 1 with a finding; 64 on a
wrong argument.`;

const root = join(import.meta.dir, "..");
const src = join(root, "src");

export type Checked = { name: string; derived: Derived };

export async function derivedMaps(): Promise<Checked[]> {
  const found: Checked[] = [];
  for (const entry of maps) {
    const derived = await deriveOf(entry.cell);
    if (!derived) throw new Error(`map-check: no cell ${entry.cell} in src/`);
    found.push({ name: entry.name, derived });
  }
  return found;
}

export function readDesigned(file: string) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((text, at) => ({ line: at + 1, text: text.trim() }))
    .filter((each) => each.text);
}

function lineIn(file: string, needles: readonly string[], from = 0) {
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, "utf8").split("\n");
  for (const needle of needles) {
    const at = lines.findIndex((line, index) => index >= from && line.includes(needle));
    if (at >= 0) return at + 1;
  }
  return null;
}

function answerLine(file: string, callLine: number, kind: string) {
  const lines = readFileSync(file, "utf8").split("\n");
  const named = new RegExp(`"${kind}"|^\\s*${kind},`);
  for (let at = callLine; at < lines.length; at += 1) {
    const line = lines[at] ?? "";
    if (/^\s*"[^"]+": \{/.test(line) || /^\S/.test(line)) return null;
    if (named.test(line)) return at + 1;
  }
  return null;
}

async function contractFileOf(call: string) {
  for await (const file of new Bun.Glob("**/*.ts").scan({ cwd: src, absolute: true })) {
    if (file.includes(".server.")) continue;
    const line = lineIn(file, [`"${call}": {`]);
    if (line) return { file, line };
  }
  return null;
}

async function callPlace(call: string, answer: string, fallback: string) {
  const contract = await contractFileOf(call);
  if (!contract) return { file: fallback, line: 1 };

  const line = answerLine(contract.file, contract.line, answer);
  return { file: contract.file, line: line ?? contract.line };
}

function actionPlace(derived: Derived | undefined, action: string, fallback: string) {
  const offered = derived?.actions.find((each) => fieldLabel(each.unit) === action);
  const file = offered?.file ?? fallback;
  return { file, line: lineIn(file, [`label: "${action}"`]) ?? 1 };
}

function statePlace(
  cellFile: string,
  view: string | null,
  at: { state: string; press: string | null },
) {
  if (at.press && view) return { file: view, line: lineIn(view, [at.press]) ?? 1 };

  const line = lineIn(cellFile, [`z.literal("${at.state}")`, `"${at.state}"`]);
  return { file: cellFile, line: line ?? 1 };
}

function filesOf(derived: Derived | undefined) {
  const fallback = derived?.cell.file ?? join(src, "live/screens.ts");
  const view = derived?.view ? join(root, derived.view) : null;
  return { fallback, view };
}

async function placeOf(finding: MapFinding, checked: readonly Checked[], designed: string) {
  const derived = checked.find((each) => each.name === finding.map)?.derived;
  const { fallback, view } = filesOf(derived);
  const at = finding.at;
  switch (at.kind) {
    case "record":
      return { file: designed, line: at.line };
    case "call":
      return callPlace(at.call, at.answer, fallback);
    case "action":
      return actionPlace(derived, at.action, fallback);
    case "state":
      return statePlace(fallback, view, at);
  }
}

function fieldLabel(unit: unknown) {
  const holder = (typeof unit === "object" || typeof unit === "function") && unit !== null;
  return holder ? Reflect.get(unit, "label") : undefined;
}

function shown(file: string) {
  const path = relative(root, file);
  return path.startsWith("..") ? file : path;
}

export async function findingsOf(checked: readonly Checked[], designed: string) {
  const scope = createScope();
  try {
    const input = {
      maps: checked.map(({ name, derived }) => ({ name, map: derived.map })),
      designed: readDesigned(designed),
    };
    return scope.run(mapCheck, { input });
  } finally {
    await scope.close();
  }
}

function countOf(lines: readonly string[], maps: number) {
  const states = lines.filter((line) => line.includes(": state ")).length;
  return { maps, states, answers: lines.length - states };
}

function argsOf(args: readonly string[]) {
  const write = args.includes("--write");
  const at = args.indexOf("--designed");
  const named = at >= 0 ? args[at + 1] : undefined;

  const rest = args.filter(
    (arg, index) => arg !== "--write" && (at < 0 || index < at || index > at + 1),
  );
  const wrong = rest.length > 0 || (at >= 0 && (!named || named.startsWith("-")));
  return wrong ? null : { write, designed: named ?? join(root, designedFile) };
}

async function located(
  findings: readonly MapFinding[],
  checked: readonly Checked[],
  designed: string,
) {
  const placed = [];
  for (const finding of findings) {
    const place = await placeOf(finding, checked, designed);
    placed.push({
      path: shown(place.file),
      line: place.line,
      rule: finding.rule,
      what: finding.what,
    });
  }
  return placed;
}

async function main(args: readonly string[]) {
  const asked = argsOf(args);
  if (!asked) {
    process.stderr.write(`${usage}\n`);
    return 64;
  }

  const { write, designed } = asked;
  const checked = await derivedMaps();
  const scope = createScope();
  try {
    const lines = checked.flatMap(({ name, derived }) =>
      scope.run(mapDesignLines, { input: { name, map: derived.map } }),
    );
    if (write) {
      const sorted = [...new Set(lines)].sort();
      writeFileSync(designed, `${sorted.join("\n")}\n`);
      process.stdout.write(`map check: wrote ${shown(designed)} (${sorted.length} lines)\n`);
      return 0;
    }

    const findings = await findingsOf(checked, designed);
    const placed = await located(findings, checked, designed);
    const count = countOf(lines, checked.length);
    process.stdout.write(scope.run(mapCheckText, { input: { findings: placed, count } }));
    return findings.length ? 1 : 0;
  } finally {
    await scope.close();
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
