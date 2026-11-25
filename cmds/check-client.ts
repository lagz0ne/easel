import { run } from "@tinkered/bun";
import { createScope } from "@tinkered/core";

import { defineMain } from "~/base/main";

import { serverLeaks } from "@/build/leaks.server";

const main = defineMain(async ({ args, signal, stdout, stderr, exit }) => {
  const app = createScope({ signal });
  const [metafile = "dist/meta.json"] = args;

  const found = await app.run(serverLeaks, { input: metafile });
  switch (found.kind) {
    case "leaks":
      stderr.write(found.lines.map((line) => `${line}\n`).join(""));
      exit(1);
      break;
    case "clean":
      stdout.write(`${found.text}\n`);
      exit(0);
      break;
  }
  return app;
});

export default main;

if (import.meta.main) await run(main);
