import { operation } from "@tinkered/core";
import { z } from "zod";

import { readHome } from "@/home/signin";

import { words } from "./index";

export const readTextsPage = operation({
  label: "words.readTextsPage",
  input: z.object({ stop: z.instanceof(AbortSignal).optional() }),
  depends: { readHome, uses: words.api["texts.uses"] },
  run: async ({ readHome, uses }, { input }) => {
    const home = await readHome.run({ input });
    if (home.who.kind !== "in") return { ...home, uses: null };

    const reply = await uses.settle({ input: {}, signal: input.stop });
    return { ...home, uses: reply.status === "success" ? reply.value : null };
  },
});
