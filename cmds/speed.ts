import { join } from "node:path";

import { run } from "@tinkered/bun";
import { createScope } from "@tinkered/core";

import { defineMain } from "~/base/main";
import { telemetryEnv } from "~/components/telemetry/env.server";
import { telemetry } from "~/components/telemetry/index.server";

import { speed } from "@/speed/run.server";

const usage = `bun cmds/speed.ts [--no-build] [--gate --base <sha> | --gate --base-dir <dir>]

The speed run and the speed gate (SPEC-speed.md, The design 2 and 3). It builds the binary,
starts it with a new database, and seeds a canvas of 20 frames and one of 200 through MCP over
HTTP, as an agent does. Then it measures each step of the critical path in a real Chromium,
against the budgets of speed.json:
  open    from the start of the share link's load to the mark easel:open, warm. One cold open
          and one throttled open (4x CPU, 40 ms round trip) are only reported.
  change  from the answer of an agent's put to the mark easel:change:<id>:<version> in an open
          tab: at Fit, and zoomed in on a live document.
  ask     from the click on Send in one tab to the mark easel:ask:<id> in another tab.
  pan     a 2 s pan at 40% on 200 frames: the time of each frame (the budget is of the longest),
          and of each move's handler (panHandler, of the p95).
A step over its budget runs once again. If it is still over, the run is red.

--no-build      use the binary in dist/ as it is.
--gate          also build the base, start it beside the tree, and measure the two in turn. A step
                more than the alert (10%) slower than the base is an alert: one line, exit 0.
--base <sha>    the base is this commit, from git archive.
--base-dir <d>  the base is the files of this directory (where there is no .git).

On vibea2: offload -- bun run speed
Exit: 0 when green or an alert; 1 when red; 64 on a wrong argument.`;

const main = defineMain(async ({ args, env, signal, stdout, stderr, exit }) => {
  const app = createScope({
    signal,
    capsules: [
      telemetry.server({
        ...telemetryEnv.parse(env),
        service: env.OTEL_SERVICE_NAME || "easel-speed",
      }),
      speed({ root: join(import.meta.dir, ".."), output: stdout, env }),
    ],
  });
  const live = await app.ready;
  const asked = live.run(speed.speedArgs, { input: [...args] });
  switch (asked.kind) {
    case "help":
      stdout.write(`${usage}\n`);
      exit(0);
      return app;
    case "wrong":
      stderr.write(`${usage}\n`);
      exit(64);
      return app;
    case "run": {
      const ran = await live.run(speed.speedRun, { input: asked });
      exit(ran.verdict === "red" ? 1 : 0);
      return app;
    }
  }
});

export default main;

if (import.meta.main) await run(main);
