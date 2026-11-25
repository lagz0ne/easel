import { join } from "node:path";

import { run } from "@tinkered/bun";
import { createScope } from "@tinkered/core";

import { defineMain } from "~/base/main";
import { telemetryEnv } from "~/components/telemetry/env.server";
import { telemetry } from "~/components/telemetry/index.server";

import { liveArgs } from "@/live/args";
import { liveScreens } from "@/live/run.server";

const usage = `bun cmds/live-screens.ts [--binary <file>] [--build <n>] [--commit <sha>] [--dry <dir>]
                           [--screen <key>] [--take <key>]

Takes each screen of src/live/screens.ts on the build of <file> (dist/server when none), in 4 takes,
on a new database with the fixture canvas "Shop redesign", and puts each take on the page Live of
product (SPEC-live-screens.md). --dry <dir> writes the takes and the status there, and puts nothing.
--screen <key> and --take <key> take only that screen or that take.
--build is BUILD when not set, else the count of commits; --commit is GIT_SHA, else HEAD.

The writes go to EASEL_SERVER with EASEL_TOKEN when both are set, else to the hosts file of
EASEL_CONFIG_HOME (~/.config/easel-agent when not set): the member vibea-claude.
Exit: 0 when each take is new, next or same; 1 when a take failed or differs; 64 on a wrong
argument. A value that the design system does not have is a warning here: bun run design:proof
fails on it (V6).`;

const main = defineMain(async ({ args, env, signal, stdout, stderr, exit }) => {
  const root = join(import.meta.dir, "..");
  const asked = liveArgs.parse({ root, args: [...args], env });
  switch (asked.kind) {
    case "help":
      stdout.write(`${usage}\n`);
      exit(0);
      return { closed: Promise.resolve() };
    case "wrong":
      stderr.write(`${usage}\n`);
      exit(64);
      return { closed: Promise.resolve() };
    case "run":
      break;
  }

  const app = createScope({
    signal,
    capsules: [
      telemetry.server({
        ...telemetryEnv.parse(env),
        service: env.OTEL_SERVICE_NAME || "easel-live-screens",
      }),
      liveScreens({
        output: stdout,
        binary: asked.binary,
        writerEnv: asked.writerEnv,
        fixtureEnv: asked.fixtureEnv,
        kept: asked.kept,
        warn: asked.warn,
      }),
    ],
  });
  const live = await app.ready;
  const { bad } = await live.run(liveScreens.liveScreensRun, { input: asked.input });
  exit(bad ? 1 : 0);
  return app;
});

export default main;

if (import.meta.main) await run(main);
