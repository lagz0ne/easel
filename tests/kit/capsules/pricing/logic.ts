import { operation } from "@tinkered/core";
import { z } from "zod";

import { chosen } from "./entities";

/** The viewer chooses a plan, by its id. */
export const choose = operation({
  label: "pricing.choose",
  input: z.string(),
  depends: { chosen: chosen.controller },
  run: ({ chosen }, { input }) => chosen.set(input),
});
