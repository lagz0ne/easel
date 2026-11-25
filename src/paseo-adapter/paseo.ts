import { operation } from "@tinkered/core";
import { z } from "zod";

import { causeLimit, commandEnv, paseoBin, paseoTimeoutMs, workspaceTitle } from "./settings";

export type Failed = { kind: "failed"; exit: number; cause: string };

const agentList = z.array(z.looseObject({ id: z.string(), name: z.string(), status: z.string() }));

export type Agent = z.infer<typeof agentList>[number];

const workspaceOne = z.looseObject({
  workspaceId: z.string(),
  cwd: z.string().nullish(),
  isolation: z.string().nullish(),
  background: z.boolean().nullish(),
});

const runAnswer = z.looseObject({ agentId: z.string() });

const permitList = z.array(
  z.looseObject({ id: z.string(), agentId: z.string(), name: z.string() }),
);

export type Permit = z.infer<typeof permitList>[number];

const labels = z.record(z.string(), z.string());

export const activeStatuses: ReadonlySet<string> = new Set(["initializing", "running"]);

export const lastLine = operation({
  label: "paseoAdapter.lastLine",
  input: z.string(),
  depends: { limit: causeLimit },
  run: ({ limit }, { input }) =>
    input
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1)
      ?.slice(0, limit) ?? "",
});

export const runCommand = operation({
  label: "paseoAdapter.runCommand",
  input: z.object({
    argv: z.array(z.string()),
    env: labels,
    timeoutMs: z.number(),
  }),
  depends: { base: commandEnv },
  run: async ({ base }, { input }) => {
    try {
      const child = Bun.spawn(input.argv, {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        timeout: input.timeoutMs,
        env: { ...base, ...input.env },
      });
      const [out, err, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { out, err, exit };
    } catch (error) {
      return { out: "", err: String(error), exit: -1 };
    }
  },
});

const paseoJson = operation({
  label: "paseoAdapter.paseoJson",
  input: z.array(z.string()).min(1),
  depends: { bin: paseoBin, timeoutMs: paseoTimeoutMs, runCommand, lastLine },
  run: async ({ bin, timeoutMs, runCommand, lastLine }, { input: args }) => {
    const ran = await runCommand.run({ input: { argv: [bin, ...args], env: {}, timeoutMs } });
    if (ran.exit !== 0) {
      const cause = lastLine.run({ input: ran.err }) || lastLine.run({ input: ran.out });
      return { kind: "failed", exit: ran.exit, cause } satisfies Failed;
    }
    try {
      return { kind: "json" as const, value: z.unknown().parse(JSON.parse(ran.out)) };
    } catch {
      return {
        kind: "failed",
        exit: 0,
        cause: `paseo ${args[0]} printed no valid JSON`,
      } satisfies Failed;
    }
  },
});

export const listAgents = operation({
  label: "paseoAdapter.listAgents",
  input: labels,
  depends: { paseoJson },
  run: async ({ paseoJson }, { input }) => {
    const flags = Object.entries(input).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
    const read = await paseoJson.run({ input: ["ls", "-g", "--background", "--json", ...flags] });
    if (read.kind === "failed") return read;

    const agents = agentList.safeParse(read.value);
    if (!agents.success) {
      return { kind: "failed", exit: 0, cause: "paseo ls printed no valid JSON" } satisfies Failed;
    }
    return { kind: "ok" as const, value: agents.data };
  },
});

export const listWorkspaces = operation({
  label: "paseoAdapter.listWorkspaces",
  depends: { paseoJson },
  run: async ({ paseoJson }) => {
    const read = await paseoJson.run({ input: ["workspace", "ls", "--background", "--json"] });
    if (read.kind === "failed") return read;

    const listed = z.array(workspaceOne).safeParse(read.value);
    if (!listed.success) {
      return {
        kind: "failed",
        exit: 0,
        cause: "paseo workspace printed no valid JSON",
      } satisfies Failed;
    }
    return { kind: "ok" as const, value: listed.data };
  },
});

export const makeWorkspace = operation({
  label: "paseoAdapter.makeWorkspace",
  input: z.string(),
  depends: { paseoJson, title: workspaceTitle },
  run: async ({ paseoJson, title }, { input: dir }) => {
    const made = await paseoJson.run({
      input: [
        "workspace",
        "create",
        "--isolation",
        "local",
        "--path",
        dir,
        "--background",
        "--title",
        title,
        "--json",
      ],
    });
    if (made.kind === "failed") return made;

    const one = workspaceOne.safeParse(made.value);
    if (!one.success) {
      return {
        kind: "failed",
        exit: 0,
        cause: "paseo workspace printed no valid JSON",
      } satisfies Failed;
    }
    return { kind: "ok" as const, value: one.data.workspaceId };
  },
});

export const workspaceOf = operation({
  label: "paseoAdapter.workspaceOf",
  input: z.string(),
  depends: { listWorkspaces, makeWorkspace },
  run: async ({ listWorkspaces, makeWorkspace }, { input: dir }) => {
    const listed = await listWorkspaces.run();
    if (listed.kind === "failed") return listed;

    const found = listed.value.find(
      (one) => one.cwd === dir && one.isolation === "local" && one.background === true,
    );
    if (found) return { kind: "ok" as const, value: found.workspaceId };
    return makeWorkspace.run({ input: dir });
  },
});

export const startAgent = operation({
  label: "paseoAdapter.startAgent",
  input: z.object({
    title: z.string(),
    prompt: z.string(),
    cwd: z.string(),
    workspace: z.string(),
    provider: z.string(),
    mode: z.string(),
    env: labels,
    labels,
  }),
  depends: { paseoJson },
  run: async ({ paseoJson }, { input }) => {
    const started = await paseoJson.run({
      input: [
        "run",
        "--no-wait",
        "--json",
        "--title",
        input.title,
        "--provider",
        input.provider,
        "--mode",
        input.mode,
        "--workspace",
        input.workspace,
        "--cwd",
        input.cwd,
        ...Object.entries(input.env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
        ...Object.entries(input.labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
        input.prompt,
      ],
    });
    if (started.kind === "failed") return started;

    const answer = runAnswer.safeParse(started.value);
    if (!answer.success) {
      return { kind: "failed", exit: 0, cause: "paseo run printed no valid JSON" } satisfies Failed;
    }
    return { kind: "ok" as const, value: answer.data };
  },
});

export const listPermits = operation({
  label: "paseoAdapter.listPermits",
  depends: { paseoJson },
  run: async ({ paseoJson }) => {
    const read = await paseoJson.run({ input: ["permit", "ls", "--json"] });
    if (read.kind === "failed") return read;

    const permits = permitList.safeParse(read.value);
    if (!permits.success) {
      return {
        kind: "failed",
        exit: 0,
        cause: "paseo permit printed no valid JSON",
      } satisfies Failed;
    }
    return { kind: "ok" as const, value: permits.data };
  },
});

export const denyPermit = operation({
  label: "paseoAdapter.denyPermit",
  input: z.object({ agentId: z.string(), id: z.string(), message: z.string() }),
  depends: { paseoJson },
  run: async ({ paseoJson }, { input }) => {
    const denied = await paseoJson.run({
      input: ["permit", "deny", input.agentId, input.id, "--message", input.message, "--json"],
    });
    if (denied.kind === "failed") return denied;
    return { kind: "ok" as const };
  },
});
