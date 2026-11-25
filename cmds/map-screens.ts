import { join } from "node:path";

import { run } from "@tinkered/bun";
import { createScope } from "@tinkered/core";

import { defineMain } from "~/base/main";
import { telemetryEnv } from "~/components/telemetry/env.server";
import { telemetry } from "~/components/telemetry/index.server";

import { designedFile } from "@/map/check";
import { screensArgs } from "@/map/screens-args";
import { mapScreens } from "@/map/screens.server";

const usage = `bun cmds/map-screens.ts [--binary <file>] [--dry <dir>] [--map <name>] [--designed <file>]

Puts each map of src/live/screens.ts on product (SPEC-prototype ship 2). For each map it derives
the map of its cell (bun cmds/map.ts), builds the page cmds/map-show.html with the view of the
cell, and takes one picture of each state: the real view, with the sample of the state as a preset
of the cell, and for a state of a run the press of its action with the answer of its move. Each
picture goes to the page "Map · <name>" as the frame "<name> · <state>", in the section of the map:
the steps from the start as columns, each column in the order of the rows of the map. Beside each
column of pictures, a column of cards: the frame "<name> · <state> · card" tells, from the code and
tinker.graph, what the state shows, its actions, each answer and the state that it leads to. The
frame "<name> · walk" (SPEC-prototype ship 4) is one HTML document with the real view, the cell
and the actions, and the map as JSON: the viewer walks the map in it. A picture with the same
pixels, and a card or a walk with the same text, put nothing; a changed one puts a new version of
the same frame. The frame "Maps" on the page Live lists each map with its first state, its count
of states, the check of the map (SPEC-prototype rule 11), and a button that starts its walk. The
card of each state that a finding of the check names gets the section Check.
--binary <file> is the easel that puts the frames (dist/server when not set).
--dry <dir> writes the pictures, the cards, the walks and the list there, and puts nothing.
--map <name> takes only that map.
--designed <file> checks the maps against that file in place of ${designedFile}.

The writes go to EASEL_SERVER with EASEL_TOKEN when both are set, else to the hosts file of
EASEL_CONFIG_HOME (~/.config/easel-agent when not set): the member vibea-claude.
Exit: 0 when each state has its picture; 1 when a picture failed; 64 on a wrong argument.`;

const main = defineMain(async ({ args, env, signal, stdout, stderr, exit }) => {
  const root = join(import.meta.dir, "..");
  const asked = screensArgs.parse({ root, args: [...args], env });
  switch (asked.kind) {
    case "help":
      stdout.write(`${usage}\n`);
      exit(0);
      return { closed: Promise.resolve() };
    case "wrong":
      stderr.write(`${usage}\n`);
      exit(64);
      return { closed: Promise.resolve() };
    case "run":
      break;
  }

  const app = createScope({
    signal,
    capsules: [
      telemetry.server({
        ...telemetryEnv.parse(env),
        service: env.OTEL_SERVICE_NAME || "easel-map-screens",
      }),
      mapScreens({ root, output: stdout, binary: asked.binary, env: asked.env }),
    ],
  });
  const live = await app.ready;
  const { failed } = await live.run(mapScreens.mapScreensRun, { input: asked.input });
  exit(failed ? 1 : 0);
  return app;
});

export default main;

if (import.meta.main) await run(main);
