import { parseArgs } from "node:util";

import { run } from "@tinkered/bun";
import { createScope } from "@tinkered/core";

import { defineMain } from "~/base/main";

import { bindingOf, compileBinary } from "@/build/binary.server";

const main = defineMain(async ({ args, signal, stdout, stderr, exit }) => {
  const app = createScope({ signal });
  const { values } = parseArgs({
    args: [...args],
    options: {
      outfile: { type: "string" },
      target: { type: "string" },
      sourcemap: { type: "boolean", default: false },
      metafile: { type: "string" },
      entry: { type: "string", multiple: true },
    },
  });
  const outfile = values.outfile;
  if (!outfile) {
    stderr.write("usage: bun cmds/build-binary.ts --outfile <file> [--target <bun target>]\n");
    exit(64);
    return app;
  }

  const host = `${process.platform}-${process.arch}`;
  const picked = app.run(bindingOf, { input: { target: values.target, host } });
  if (picked.kind === "unknown") {
    stderr.write(`build-binary: no oxc-parser binding for ${values.target ?? process.platform}\n`);
    exit(64);
    return app;
  }

  const built = await app.run(compileBinary, {
    input: {
      entries: values.entry ?? ["cmds/easel.ts", "cmds/telemetry-worker.ts"],
      outfile,
      target: picked.target,
      binding: picked.binding,
      sourcemap: values.sourcemap,
      metafile: values.metafile,
    },
  });
  stderr.write(built.logs.map((log) => `${log}\n`).join(""));
  switch (built.kind) {
    case "failed":
      exit(1);
      break;
    case "built":
      stdout.write(`${built.line}\n`);
      exit(0);
      break;
  }
  return app;
});

export default main;

if (import.meta.main) await run(main);
