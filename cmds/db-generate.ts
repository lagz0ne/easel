import { run } from "@tinkered/bun";
import { createScope } from "@tinkered/core";

import { defineMain } from "~/base/main";

import { generateMigrations } from "@/build/files.server";

const main = defineMain(({ args, cwd, signal, stderr, exit }) => {
  const app = createScope({ signal });
  const [root = cwd] = args;

  const made = app.run(generateMigrations, { input: root });
  switch (made.kind) {
    case "failed":
      stderr.write(`db:generate: drizzle-kit failed for ${made.config}\n`);
      exit(made.code);
      break;
    case "generated":
      exit(0);
      break;
  }
  return app;
});

export default main;

if (import.meta.main) await run(main);
