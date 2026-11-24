import { z } from "zod";

const agentList = z.array(z.looseObject({ id: z.string(), name: z.string(), status: z.string() }));

const workspaceList = z.array(
  z.looseObject({
    workspaceId: z.string(),
    cwd: z.string().nullish(),
    isolation: z.string().nullish(),
    background: z.boolean().nullish(),
  }),
);

const runAnswer = z.looseObject({ agentId: z.string() });

const permitList = z.array(
  z.looseObject({ id: z.string(), agentId: z.string(), name: z.string() }),
);

export type Permit = z.infer<typeof permitList>[number];

export type Agent = z.infer<typeof agentList>[number];

export type Failed = { kind: "failed"; exit: number; cause: string };

const activeStatuses = new Set(["initializing", "running"]);

export const isActive = (agent: Agent) => activeStatuses.has(agent.status);

const callTimeoutMs = 60_000;

const lastLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 300) ?? "";

async function call(bin: string, args: string[]) {
  const child = Bun.spawn([bin, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    timeout: callTimeoutMs,
  });
  const [out, err, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { out, err, exit };
}

async function json<T>(bin: string, args: string[], shape: z.ZodType<T>) {
  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(bin, args);
  } catch (error) {
    return { kind: "failed", exit: -1, cause: String(error) } satisfies Failed;
  }

  if (answer.exit !== 0) {
    return {
      kind: "failed",
      exit: answer.exit,
      cause: lastLine(answer.err) || lastLine(answer.out),
    } satisfies Failed;
  }
  try {
    return { kind: "ok", value: shape.parse(JSON.parse(answer.out)) } as const;
  } catch {
    return {
      kind: "failed",
      exit: 0,
      cause: `paseo ${args[0]} printed no valid JSON`,
    } satisfies Failed;
  }
}

const labelFlags = (labels: Record<string, string>) =>
  Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);

export type RunInput = {
  title: string;
  prompt: string;
  cwd: string;
  workspace: string;
  provider: string;
  mode: string;
  env: Record<string, string>;
  labels: Record<string, string>;
};

export function paseoCli(bin: string) {
  const agents = async (labels: Record<string, string>) =>
    json(bin, ["ls", "-g", "--json", ...labelFlags(labels)], agentList);

  const workspaceOf = async (dir: string) => {
    const listed = await json(bin, ["workspace", "ls", "--json"], workspaceList);
    if (listed.kind === "failed") return listed;

    const found = listed.value.find(
      (one) => one.cwd === dir && one.isolation === "local" && !one.background,
    );
    if (found) return { kind: "ok", value: found.workspaceId } as const;
    return {
      kind: "failed",
      exit: 0,
      cause: `no local Paseo workspace has the folder ${dir}`,
    } satisfies Failed;
  };

  const run = async (input: RunInput) =>
    json(
      bin,
      [
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
        ...labelFlags(input.labels),
        input.prompt,
      ],
      runAnswer,
    );

  const permits = async () => json(bin, ["permit", "ls", "--json"], permitList);

  const deny = async (permit: Permit, message: string) =>
    json(
      bin,
      ["permit", "deny", permit.agentId, permit.id, "--message", message, "--json"],
      z.unknown(),
    );

  return { agents, workspaceOf, run, permits, deny };
}

export type Paseo = ReturnType<typeof paseoCli>;
