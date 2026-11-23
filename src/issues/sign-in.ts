import { data, operation } from "@tinkered/core";
import { z } from "zod";

export const me = data({ label: "issues.me", initial: "" });

export const signIn = operation({
  label: "issues.signIn",
  input: z.object({ name: z.string().trim().min(1) }),
  depends: { who: me.controller },
  run: ({ who }, { input }) => who.set(input.name),
});

export const whoMeta = operation({
  label: "issues.whoMeta",
  depends: { who: me },
  run: async ({ who }): Promise<Record<string, string>> => (who ? { who } : {}),
});
