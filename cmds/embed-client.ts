import { join } from "node:path";

import { run } from "@tinkered/bun";
import { createScope } from "@tinkered/core";

import { defineMain } from "~/base/main";

import { embedClient } from "@/build/files.server";

const main = defineMain(async ({ signal, stdout, exit }) => {
  const app = createScope({ signal });
  const root = join(import.meta.dir, "..");

  const count = await app.run(embedClient, {
    input: {
      clientDir: join(root, "dist/client"),
      outFile: join(import.meta.dir, "client-files.gen.ts"),
      importDir: "../dist/client",
    },
  });
  stdout.write(`embedded ${count} client files\n`);
  exit(0);
  return app;
});

export default main;

if (import.meta.main) await run(main);
