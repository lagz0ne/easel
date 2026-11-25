import { resource } from "@tinkered/core";

import { adapterOutput } from "./settings";

export type LogFields = Record<string, string | number | boolean | null>;

export const adapterLog = resource({
  label: "paseoAdapter.log",
  target: "scope",
  depends: { output: adapterOutput },
  factory: ({ output }, ctx) => ({
    write: (event: string, fields: LogFields = {}) =>
      void output.write(
        `${JSON.stringify({ at: new Date(ctx.clock.currentTimeMillis()).toISOString(), event, ...fields })}\n`,
      ),
  }),
});
