import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { maps } from "@/live/screens";

import { designedFile } from "./check";

export const screensArgs = z
  .object({
    root: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string().optional()),
  })
  .transform(({ root, args, env }) => {
    const { values } = parseArgs({
      args,
      options: {
        binary: { type: "string", default: join(root, "dist/server") },
        dry: { type: "string" },
        map: { type: "string" },
        designed: { type: "string", default: join(root, designedFile) },
        help: { type: "boolean", short: "h", default: false },
      },
    });
    if (values.help) return { kind: "help" as const };
    if (values.map && !maps.some((entry) => entry.name === values.map)) {
      return { kind: "wrong" as const };
    }

    const signedIn = Boolean(env.EASEL_TOKEN && env.EASEL_SERVER);
    const agentHome = env.EASEL_CONFIG_HOME || join(env.HOME ?? "", ".config/easel-agent");
    return {
      kind: "run" as const,
      binary: resolve(values.binary),
      env: signedIn ? env : { ...env, EASEL_CONFIG_HOME: agentHome },
      input: { dry: values.dry, only: values.map, designed: resolve(values.designed) },
    };
  });
