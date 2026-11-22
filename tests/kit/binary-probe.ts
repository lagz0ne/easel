// The probe of the binary test (tests/kit-binary.test.ts): compiled by scripts/build-binary.ts,
// as dist/server is, it reads { html, kit } or { tsx, kit } on stdin and prints the result of
// makeFrame, or of makeApp (oxc-parser and its native file, and Bun.build in memory, in the binary), as
// JSON. For { runtime: true } it prints the SHA-256 of the runtime that the build put in it.
import { createScope } from "@tinkered/core";

import { makeApp, makeFrame } from "@/kit/make.server";
import { builtRuntime } from "@/kit/runtime.server";

/** The runtime that the build put in the binary, as cmds/runtime.ts reads it. */
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
