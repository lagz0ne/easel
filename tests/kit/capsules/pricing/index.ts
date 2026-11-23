import { capsule, tag } from "@tinkered/core";
import { z } from "zod";

import { aboutShape } from "@/kit/capsules/about";

import { text } from "./copy";
import { planShape, plans, sample, samples } from "./entities";
import { choose } from "./logic";
import { View } from "./view";

const about = tag({ label: "pricing.about", parse: aboutShape });

export const pricing = capsule({
  label: "pricing",
  config: { sample },
  tags: [
    about({
      does: "A pricing page: the plans of one data state, and the choice of one plan.",
      install: 'pricing({ sample: "empty" | "one" | "many" | "long" }), after the kit.',
      exports: {
        View: { does: "The page.", use: "the frame's View" },
        plans: { does: "The plans that the page shows.", use: "depends: { plans: pricing.plans }" },
        choose: {
          does: "Choose a plan, by its id.",
          use: 'useRun(pricing.choose).run({ input: "pro" })',
        },
        text: {
          does: "The t of the page, in the locale of the scope.",
          use: "depends: { t: pricing.text }",
        },
      },
    }),
  ],
  exports: { View, plans, choose, text },
  hooks: {
    async start({ config, load, raise, next }) {
      const rows = z.array(planShape).safeParse(samples[config.sample]);
      if (!rows.success) {
        raise("SampleInvalid", { sample: config.sample, issues: rows.error.issues });
      }

      const setup = { role: "setup" as const, explain: "The rows of the data state" };
      load(plans, setup).set(rows.data ?? []);
      await next();
    },
  },
});
