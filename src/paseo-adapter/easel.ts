import { operation } from "@tinkered/core";
import { z } from "zod";

import { lastLine, runCommand } from "./paseo";
import type { Failed } from "./paseo";
import { agentConfigHome, causeLimit, channel, easelCommand, easelTimeoutMs } from "./settings";

export type Limits = { running: number; perDay: number };

export const starterState = z.object({
  running: z.number(),
  today: z.number(),
  at: z.enum(["running", "day"]).nullable(),
});

export type StarterState = z.infer<typeof starterState>;

const noted = z.looseObject({
  kind: z.literal("noted"),
  limits: z.object({ running: z.number().int().positive(), perDay: z.number().int().positive() }),
});

const lastJson = z.string().transform((out, ctx) => {
  try {
    return z.unknown().parse(JSON.parse(out.trim().split("\n").at(-1) ?? ""));
  } catch {
    ctx.addIssue({ code: "custom", message: "no JSON" });
    return z.NEVER;
  }
});

export const reportToEasel = operation({
  label: "paseoAdapter.reportToEasel",
  input: z.array(z.string()),
  depends: {
    command: easelCommand,
    configHome: agentConfigHome,
    channel,
    timeoutMs: easelTimeoutMs,
    runCommand,
    lastLine,
  },
  run: async (deps, { input: flags }) => {
    const { command, configHome, channel, timeoutMs, runCommand, lastLine } = deps;
    const ran = await runCommand.run({
      input: {
        argv: [...command, "channel", "report", channel, ...flags, "--json"],
        env: { EASEL_CONFIG_HOME: configHome },
        timeoutMs,
      },
    });

    const read = lastJson.pipe(noted).safeParse(ran.out);
    if (ran.exit === 0 && read.success) return { kind: "ok" as const, limits: read.data.limits };
    const cause =
      lastLine.run({ input: ran.err }) ||
      lastLine.run({ input: ran.out }) ||
      "easel printed no answer";
    return { kind: "failed", exit: ran.exit, cause } satisfies Failed;
  },
});

export const reportState = operation({
  label: "paseoAdapter.reportStateToEasel",
  input: starterState,
  depends: { reportToEasel },
  run: async ({ reportToEasel }, { input: now }) =>
    reportToEasel.run({
      input: [
        "--running",
        String(now.running),
        "--today",
        String(now.today),
        ...(now.at === null ? [] : ["--at", now.at]),
      ],
    }),
});

export const reportStarted = operation({
  label: "paseoAdapter.reportStarted",
  input: z.object({ ref: z.string(), agent: z.string() }),
  depends: { reportToEasel },
  run: async ({ reportToEasel }, { input }) =>
    reportToEasel.run({ input: ["--started", input.ref, "--agent", input.agent] }),
});

export const reportFailed = operation({
  label: "paseoAdapter.reportFailed",
  input: z.object({ ref: z.string(), cause: z.string(), retryMs: z.number() }),
  depends: { reportToEasel, limit: causeLimit },
  run: async ({ reportToEasel, limit }, { input }) =>
    reportToEasel.run({
      input: [
        "--failed",
        input.ref,
        "--cause",
        input.cause.slice(0, limit) || "paseo run failed",
        "--retry",
        String(input.retryMs),
      ],
    }),
});
