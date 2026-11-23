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

export const controls = frameControls({
  add: { label: "Add a person", run: addPerson },
  clear: { label: "Remove all", run: removeAll },
  capitals: { label: "Names in capitals", run: setCapitals, value: capitals },
});

export const part = framePart({
  services: [board, api],
  serve: () => [
    board({ serve: true }),
    api({ implement: { "people.call.add": addNamed, "people.call.capitals": capitalsTo } }),
  ],
  reach: (link) => [board({ read: link }), api({ remote: link })],
});

export const panes = framePanes({ top: Toolbar, right: AddPanel });
