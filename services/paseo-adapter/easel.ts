import { z } from "zod";

import type { Failed } from "./paseo";

export type Limits = { running: number; perDay: number };

export type StarterState = { running: number; today: number; at: "running" | "day" | null };

const noted = z.looseObject({
  kind: z.literal("noted"),
  limits: z.object({ running: z.number().int().positive(), perDay: z.number().int().positive() }),
});

const callTimeoutMs = 15_000;

const causeLimit = 300;

const lastLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 300) ?? "";

export type EaselCli = { command: string[]; configHome: string; channel: string };

export function easelCli({ command, configHome, channel }: EaselCli) {
  const report = async (flags: string[]) => {
    let answer: { out: string; err: string; exit: number };
    try {
      const child = Bun.spawn([...command, "channel", "report", channel, ...flags, "--json"], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        timeout: callTimeoutMs,
        env: { ...process.env, EASEL_CONFIG_HOME: configHome },
      });
      const [out, err, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      answer = { out, err, exit };
    } catch (error) {
      return { kind: "failed", exit: -1, cause: String(error) } satisfies Failed;
    }

    const read = noted.safeParse(jsonOf(answer.out.trim().split("\n").at(-1) ?? ""));
    if (answer.exit === 0 && read.success) return { kind: "ok", limits: read.data.limits } as const;
    return {
      kind: "failed",
      exit: answer.exit,
      cause: lastLine(answer.err) || lastLine(answer.out) || "easel printed no answer",
    } satisfies Failed;
  };

  const state = (now: StarterState) =>
    report([
      "--running",
      String(now.running),
      "--today",
      String(now.today),
      ...(now.at === null ? [] : ["--at", now.at]),
    ]);

  const started = (ref: string, agent: string) => report(["--started", ref, "--agent", agent]);

  const failed = (ref: string, cause: string, retryMs: number) =>
    report([
      "--failed",
      ref,
      "--cause",
      cause.slice(0, causeLimit) || "paseo run failed",
      "--retry",
      String(retryMs),
    ]);

  return { state, started, failed };
}

const jsonOf = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export type Easel = ReturnType<typeof easelCli>;
