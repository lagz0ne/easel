import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { run } from "@tinkered/bun";
import { createScope } from "@tinkered/core";

import { defineMain } from "~/base/main";
import { telemetryEnv } from "~/components/telemetry/env.server";
import { telemetry } from "~/components/telemetry/index.server";

import { adapterEnv } from "@/paseo-adapter/env.server";
import { paseoAdapter } from "@/paseo-adapter/index.server";

const main = defineMain(async ({ env, signal, stdout, stderr, exit }) => {
  const read = adapterEnv.safeParse({ ...env, HOME: env.HOME || homedir() });
  if (!read.success) {
    const issues = read.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`);
    stderr.write(`easel-paseo-adapter: ${issues.join("; ")}\n`);
    exit(78);
    return { closed: Promise.resolve() };
  }

  const { seedFile, easel, config } = read.data;
  const app = createScope({
    signal,
    capsules: [
      telemetry.server({
        ...telemetryEnv.parse(env),
        service: env.OTEL_SERVICE_NAME || "easel-paseo-adapter",
      }),
      paseoAdapter({
        ...config,
        seed: readFileSync(seedFile, "utf8"),
        easel: easel ? [easel] : [process.execPath, join(import.meta.dir, "easel.ts")],
        env,
        output: stdout,
        exit,
      }),
    ],
  });
  const live = await app.ready;
  await live.settle(paseoAdapter.serve, { signal });
  return app;
});

export default main;

if (import.meta.main) await run(main);
