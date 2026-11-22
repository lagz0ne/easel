// The probe of the binary test (tests/kit-binary.test.ts): compiled with the flags of
// `build:server`, it reads { html, kit } on stdin and prints the result of makeFrame as JSON.
import { createScope } from "@tinkered/core";

import { makeFrame } from "@/kit/make.server";

const input = await new Response(Bun.stdin.stream()).json();
const scope = createScope();
process.stdout.write(JSON.stringify(await scope.run(makeFrame, { input })));
await scope.close();
