import { createScope } from "@tinkered/core";

import { makeApp, makeFrame } from "@/kit/make.server";
import { builtRuntime } from "@/kit/runtime.server";

const runtime = builtRuntime.parse((await import("easel:runtime")).default);

const input = await new Response(Bun.stdin.stream()).json();
const scope = createScope();

const made =
  input.runtime === true
    ? { sha: runtime.sha, files: Object.keys(runtime.files).length }
    : typeof input.tsx === "string"
      ? await scope.run(makeApp, { input: { files: { "index.tsx": input.tsx }, kit: input.kit } })
      : await scope.run(makeFrame, { input });

process.stdout.write(JSON.stringify(made));
await scope.close();
