import { join } from "node:path";

import { run } from "@tinkered/bun";
import { createScope } from "@tinkered/core";

import { defineMain } from "~/base/main";

import { deriveOf } from "@/map/source.server";
import { mapText } from "@/map/text";

const usage = `bun cmds/map.ts <cell label> [--json]

Finds the cell with that label in src/, the view that switches on its kind, the actions of each
state, their calls and the answers of each call. It runs each action from each state with each
answer forced, and prints the map: each state in its place (the steps from the start as columns,
the main path on row 0, each other answer on a row below), each move and each stay (SPEC-prototype).
--json prints the map as JSON.

Exit: 0 with a map; 1 when no module of src/ exports a cell with that label; 64 on a wrong argument.`;

const main = defineMain(async ({ args, signal, stdout, stderr, exit }) => {
  const app = createScope({ signal });
  const json = args.includes("--json");
  const rest = args.filter((arg) => arg !== "--json");
  const [label] = rest;
  if (rest.length !== 1 || !label || label.startsWith("-")) {
    stderr.write(`${usage}\n`);
    exit(64);
    return app;
  }

  const found = await app.run(deriveOf, { input: { root: join(import.meta.dir, ".."), label } });
  switch (found.kind) {
    case "missing":
      stderr.write(`map: no cell ${label} in src/\n`);
      exit(1);
      break;
    case "derived": {
      const { map } = found.derived;
      const text = json ? JSON.stringify(map, null, 2) : app.run(mapText, { input: map });
      stdout.write(`${text}\n`);
      exit(0);
      break;
    }
  }
  return app;
});

export default main;

if (import.meta.main) await run(main);
