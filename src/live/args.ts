import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { screens, takeKeys } from "./screens";

const env = z.record(z.string(), z.string().optional());

const fixtureHidden = ["EASEL_TOKEN", "EASEL_SERVER", "EASEL_CONFIG_HOME", "XDG_CONFIG_HOME"];

export const liveEnvs = env.transform((all) => {
  const signedIn = Boolean(all.EASEL_TOKEN && all.EASEL_SERVER);
  const agentHome = all.EASEL_CONFIG_HOME || join(all.HOME ?? "", ".config/easel-agent");
  return {
    writerEnv: signedIn ? all : { ...all, EASEL_CONFIG_HOME: agentHome },
    fixtureEnv: Object.fromEntries(
      Object.entries(all).filter(([key]) => !fixtureHidden.includes(key)),
    ),
    kept: all.RUNNER_TEMP || tmpdir(),
    warn: Boolean(all.GITHUB_ACTIONS),
  };
});

const chosen = z.object({
  build: z.coerce.number().int().positive(),
  commit: z.string().min(1),
  dry: z.string().optional(),
  screen: z
    .string()
    .refine((key) => screens.some((screen) => screen.key === key))
    .optional(),
  take: z.enum(takeKeys).optional(),
});

export const liveArgs = z
  .object({ root: z.string(), args: z.array(z.string()), env })
  .transform(({ root, args, env }) => {
    const { values } = parseArgs({
      args,
      options: {
        binary: { type: "string", default: join(root, "dist/server") },
        build: { type: "string" },
        commit: { type: "string" },
        dry: { type: "string" },
        screen: { type: "string" },
        take: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
    if (values.help) return { kind: "help" as const };

    const picked = chosen.safeParse({
      build:
        values.build ??
        env.BUILD ??
        Bun.spawnSync(["git", "-C", root, "rev-list", "--count", "HEAD"]).stdout.toString().trim(),
      commit:
        values.commit ??
        env.GIT_SHA ??
        Bun.spawnSync(["git", "-C", root, "rev-parse", "HEAD"]).stdout.toString().trim(),
      dry: values.dry,
      screen: values.screen,
      take: values.take,
    });
    if (!picked.success) return { kind: "wrong" as const };

    return {
      kind: "run" as const,
      binary: resolve(values.binary),
      input: picked.data,
      ...liveEnvs.parse(env),
    };
  });
