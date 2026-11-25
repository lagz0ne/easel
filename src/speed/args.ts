import { parseArgs } from "node:util";

import { operation } from "@tinkered/core";
import { z } from "zod";

export const speedArgs = operation({
  label: "speed.args",
  input: z.array(z.string()),
  run: (_, { input: args }) => {
    const parsed = parseArgs({
      args,
      strict: false,
      options: {
        "no-build": { type: "boolean", default: false },
        gate: { type: "boolean", default: false },
        base: { type: "string" },
        "base-dir": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
    const { values, positionals } = parsed;
    if (values.help === true) return { kind: "help" as const };

    const base = typeof values.base === "string" ? values.base : undefined;
    const baseDir = typeof values["base-dir"] === "string" ? values["base-dir"] : undefined;
    const gate = values.gate === true;
    if (positionals.length > 0 || (gate && !base && !baseDir)) return { kind: "wrong" as const };

    return { kind: "run" as const, build: values["no-build"] !== true, gate, base, baseDir };
  },
});
