import { operation } from "@tinkered/core";

import { greetApi } from "./contract";

export const greetHere = operation({
  label: "greet.here",
  input: greetApi.greet.input,
  run: async (_deps, { input }) => ({ text: `Hello, ${input.name}.` }),
});

export const greetOps = { greet: greetHere } as const;
