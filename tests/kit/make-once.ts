// A new process for the make test: reads { source, classNames } on stdin, prints the made CSS.
import { createScope } from "@tinkered/core";

import { make } from "@/kit/make.server";

const input = await new Response(Bun.stdin.stream()).json();
const scope = createScope();
process.stdout.write(await scope.run(make, { input }));
await scope.close();
