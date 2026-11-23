import { operation } from "@tinkered/core";
import { z } from "zod";

import { chosen } from "./entities";

export const choose = operation({
  label: "pricing.choose",
  input: z.string(),
  depends: { chosen: chosen.controller },
  run: ({ chosen }, { input }) => chosen.set(input),
});
