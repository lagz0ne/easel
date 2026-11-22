// A capsule frame in a folder (SPEC-kit.md § App frames, "A folder"; § The capsules, "A capsule
// frame"): its entity and data states (entities.ts), its texts (copy.ts), its View (view.tsx), and
// its own capsule `frame` here, whose config is the data state, and its `controls` for the
// viewer's panel. The mount draws it in a scope of the kit's capsules.
import { frameControls } from "@easel/frame";
import { capsule } from "@tinkered/core";
import { z } from "zod";

import {
  addPerson,
  capitals,
  person,
  people,
  remove,
  removeAll,
  sample,
  samples,
  setCapitals,
} from "./entities";
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

export const controls = frameControls({
  add: { label: "Add a person", run: addPerson },
  clear: { label: "Remove all", run: removeAll },
  capitals: { label: "Names in capitals", run: setCapitals, value: capitals },
});
