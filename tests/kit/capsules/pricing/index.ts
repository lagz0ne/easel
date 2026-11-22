import { capsule, tag } from "@tinkered/core";
import { z } from "zod";

import { aboutShape } from "@/kit/capsules/about";

import { text, texts } from "./copy";
import { planShape, plans, sample, samples } from "./entities";
import { choose } from "./logic";
import { View } from "./view";

// Form 2 of a frame (docs/decisions/kit-capsules.md): a capsule with its own files. Its config is
// its data state; its start writes the rows of that state, checked by the entity's schema; its
// exports are what a tool and another frame may use.

const about = tag({ label: "pricing.about", parse: aboutShape });

export const pricing = capsule({
  label: "pricing",
  config: { sample },
  tags: [
    about({
      does: "A pricing page: the plans of one data state, and the choice of one plan.",
      exports: {
        View: "The page.",
        plans: "The plans that the page shows.",
        choose: "Choose a plan, by its id.",
        text: "The t of the page, in the locale of the scope.",
        texts: "The texts of the page, in each locale.",
      },
    }),
  ],
  exports: { View, plans, choose, text, texts },
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
