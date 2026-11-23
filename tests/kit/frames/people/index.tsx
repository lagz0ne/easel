// A capsule frame in a folder (SPEC-kit.md § App frames, "A folder"; § The capsules, "A capsule
// frame"): its entity and data states (entities.ts), its texts (copy.ts), its View (view.tsx), and
// its own capsule `frame` here, whose config is the data state, its `controls` for the viewer's
// panel, and its `panes` (panes.tsx), which reach the part of it that `part` names. The mount
// draws it in a scope of the kit's capsules.
import { frameControls, framePanes, framePart } from "@easel/frame";
import { capsule } from "@tinkered/core";
import { z } from "zod";

import {
  addNamed,
  addPerson,
  api,
  board,
  capitals,
  capitalsTo,
  person,
  people,
  remove,
  removeAll,
  sample,
  samples,
  setCapitals,
} from "./entities";
import { AddPanel, Toolbar } from "./panes";
import { View } from "./view";

export { View } from "./view";

export const frame = capsule({
  label: "people",
  config: { sample },
  exports: { View, people, remove },
  hooks: {
    async start({ config, load, raise, next }) {
      const rows = z.array(person).safeParse(samples[config.sample]);
      if (!rows.success) raise("SampleInvalid", { sample: config.sample });

      const setup = { role: "setup" as const, explain: "The rows of the data state" };
      load(people, setup).set(rows.data ?? []);
      await next();
    },
  },
});

// The controls of the panel: each runs an operation of the frame in its live scope.
export const controls = frameControls({
  add: { label: "Add a person", run: addPerson },
  clear: { label: "Remove all", run: removeAll },
  capitals: { label: "Names in capitals", run: setCapitals, value: capitals },
});

// The part of the frame that its panes reach: its cells live (`board`), and its calls (`api`).
export const part = framePart({
  services: [board, api],
  serve: () => [
    board({ serve: true }),
    api({ implement: { "people.call.add": addNamed, "people.call.capitals": capitalsTo } }),
  ],
  reach: (link) => [board({ read: link }), api({ remote: link })],
});

// The panes: a toolbar in the label row, and a form to add a person at the right edge.
export const panes = framePanes({ top: Toolbar, right: AddPanel });
