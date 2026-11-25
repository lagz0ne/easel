import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { run } from "@tinkered/bun";
import { createScope } from "@tinkered/core";

import { defineMain } from "~/base/main";

import { designedFile, mapCheckText, mapDesignLines } from "@/map/check";
import { checkArgs, derivedMaps, mapFindings, placedFindings } from "@/map/check-run.server";

const usage = `bun cmds/map-check.ts [--write] [--designed <file>]

Checks each map of src/live/screens.ts against ${designedFile} (SPEC-prototype rule 11, J8). The file
names each designed state and each designed answer of each map. A finding is one line, then its
fix: an answer that the file does not have (map/answer), a state that the file does not have
(map/state), or a line of the file that the code does not have now (map/gone).
--write writes the file from the maps of the code. Commit it: its diff is the sign-off.
--designed <file> reads and writes that file in place of ${designedFile}.

Exit: 0 when each state and each answer is designed, or after --write; 1 with a finding; 64 on a
wrong argument.`;

const main = defineMain(async ({ args, signal, stdout, stderr, exit }) => {
  const app = createScope({ signal });
  const root = join(import.meta.dir, "..");
  const asked = app.run(checkArgs, { input: { args: [...args], root } });
  if (asked.kind === "wrong") {
    stderr.write(`${usage}\n`);
    exit(64);
    return app;
  }

  const { write, designed, shown } = asked;
  const checked = await app.run(derivedMaps, { input: root });
  const lines = checked.flatMap(({ name, derived }) =>
    app.run(mapDesignLines, { input: { name, map: derived.map } }),
  );
  if (write) {
    const sorted = [...new Set(lines)].sort();
    writeFileSync(designed, `${sorted.join("\n")}\n`);
    stdout.write(`map check: wrote ${shown} (${sorted.length} lines)\n`);
    exit(0);
    return app;
  }

  const findings = app.run(mapFindings, { input: { checked, designed } });
  const placed = await app.run(placedFindings, { input: { root, findings, checked, designed } });
  const states = lines.filter((line) => line.includes(": state ")).length;
  const count = { maps: checked.length, states, answers: lines.length - states };
  stdout.write(app.run(mapCheckText, { input: { findings: placed, count } }));
  exit(findings.length ? 1 : 0);
  return app;
});

export default main;

if (import.meta.main) await run(main);
