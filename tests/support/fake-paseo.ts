import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const agent = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  cwd: z.string(),
  labels: z.record(z.string(), z.string()),
  background: z.boolean().optional(),
});

type Agent = z.infer<typeof agent>;

const dir = process.env.FAKE_PASEO_DIR ?? "";
const agentsFile = join(dir, "agents.json");
const args = process.argv.slice(2);

const writeWhole = (file: string, text: string) => {
  const part = `${file}.${process.pid}.part`;
  writeFileSync(part, text);
  renameSync(part, file);
};

const agents = (): Agent[] =>
  existsSync(agentsFile) ? z.array(agent).parse(JSON.parse(readFileSync(agentsFile, "utf8"))) : [];

const valuesOf = (flag: string) =>
  args.flatMap((arg, index) => (args[index - 1] === flag ? [arg] : []));

const labelsOf = () =>
  Object.fromEntries(
    valuesOf("--label").map((label) => [
      label.slice(0, label.indexOf("=")),
      label.slice(label.indexOf("=") + 1),
    ]),
  );

const withBackground = args.includes("--background");

function list() {
  const wanted = Object.entries(labelsOf());
  const shown = agents()
    .filter((one) => withBackground || !one.background)
    .filter((one) => wanted.every(([key, value]) => one.labels[key] === value))
    .map(({ id, name, status, cwd }) => ({ id, name, status, cwd }));
  process.stdout.write(JSON.stringify(shown));
}

function run() {
  if (existsSync(join(dir, "fail"))) {
    process.stderr.write("Failed to create agent: the daemon is down\n");
    process.exit(1);
  }

  const id = `agent-${agents().length + 1}`;
  const title = valuesOf("--title")[0] ?? "";
  const cwd = valuesOf("--cwd")[0] ?? "";
  const home = workspaces().find((one) => one.workspaceId === valuesOf("--workspace")[0]);
  const made = {
    id,
    name: title,
    status: "running",
    cwd,
    labels: labelsOf(),
    background: home?.background ?? false,
  };
  writeWhole(agentsFile, JSON.stringify([...agents(), made]));
  process.stdout.write(JSON.stringify({ agentId: id, status: "running", title, cwd }));
}

const workspace = z.object({
  workspaceId: z.string(),
  name: z.string(),
  cwd: z.string(),
  isolation: z.string(),
  background: z.boolean(),
});

const workspacesFile = join(dir, "workspaces.json");

const firstWorkspaces = () => [
  {
    workspaceId: "wks_other",
    name: "other",
    cwd: "/elsewhere",
    isolation: "local",
    background: false,
  },
  {
    workspaceId: "wks_easel",
    name: "easel",
    cwd: process.env.FAKE_PASEO_WORKSPACE_DIR ?? "",
    isolation: "local",
    background: false,
  },
];

const workspaces = () =>
  existsSync(workspacesFile)
    ? z.array(workspace).parse(JSON.parse(readFileSync(workspacesFile, "utf8")))
    : firstWorkspaces();

function listWorkspaces() {
  const shown = workspaces().filter((one) => withBackground || !one.background);
  process.stdout.write(JSON.stringify(shown));
}

function createWorkspace() {
  if (existsSync(join(dir, "fail-workspace"))) {
    process.stderr.write("Failed to create workspace: the daemon is down\n");
    process.exit(1);
  }

  const made = {
    workspaceId: `wks_made_${workspaces().length + 1}`,
    name: valuesOf("--title")[0] ?? "",
    cwd: valuesOf("--path")[0] ?? "",
    isolation: valuesOf("--isolation")[0] ?? "",
    background: withBackground,
  };
  writeWhole(workspacesFile, JSON.stringify([...workspaces(), made]));
  process.stdout.write(JSON.stringify(made));
}

const permit = z.object({
  id: z.string(),
  agentId: z.string(),
  name: z.string(),
  description: z.string(),
});

const permitsFile = join(dir, "permits.json");

const permits = () =>
  existsSync(permitsFile)
    ? z.array(permit).parse(JSON.parse(readFileSync(permitsFile, "utf8")))
    : [];

function listPermits() {
  const shown = permits().map((one) => ({ ...one, agentShortId: one.agentId.slice(0, 7) }));
  process.stdout.write(JSON.stringify(shown));
}

function deny() {
  const [, , agentId, id] = args;
  const found = permits().find((one) => one.agentId === agentId && one.id === id);
  if (!found) {
    process.stderr.write(`Permission request ${id} not found\n`);
    process.exit(1);
  }

  writeWhole(
    permitsFile,
    JSON.stringify(permits().filter((one) => one !== found && one.id !== id)),
  );
  process.stdout.write(
    JSON.stringify([{ requestId: id, agentId, name: found.name, result: "denied" }]),
  );
}

appendFileSync(join(dir, "calls.jsonl"), `${JSON.stringify(args)}\n`);

if (args[0] === "ls") list();
else if (args[0] === "run") run();
else if (args[0] === "workspace" && args[1] === "ls") listWorkspaces();
else if (args[0] === "workspace" && args[1] === "create") createWorkspace();
else if (args[0] === "permit" && args[1] === "ls") listPermits();
else if (args[0] === "permit" && args[1] === "deny") deny();
else process.exit(2);
