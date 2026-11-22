// The probe of the binary test (tests/kit-binary.test.ts): compiled by scripts/build-binary.ts,
// as dist/server is, it reads { html, kit } or { tsx, kit } on stdin and prints the result of
// makeFrame, or of makeApp (oxc-parser and its native file in the binary), as JSON.
import { createScope } from "@tinkered/core";

import { makeApp, makeFrame } from "@/kit/make.server";

const input = await new Response(Bun.stdin.stream()).json();
const scope = createScope();

const made =
  typeof input.tsx === "string"
    ? await scope.run(makeApp, { input })
    : await scope.run(makeFrame, { input });

process.stdout.write(JSON.stringify(made));
await scope.close();
