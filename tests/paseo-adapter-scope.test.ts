import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { adapterEnv } from "@/paseo-adapter/env.server";
import { paseoAdapter } from "@/paseo-adapter/index.server";
import { runCommand } from "@/paseo-adapter/paseo";

import { fakeMessage, paseoScope, paseoWorld } from "./support/paseo-scope";
import type { PaseoWorld } from "./support/paseo-scope";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const request = (canvas: string, n: number, period = 1000) => ({
  canvas,
  n,
  frame: "frm_1",
  page: "page-1",
  period,
});

async function setup(more: { reportMs?: number } = {}) {
  const paseo = paseoWorld();
  closers.push(paseo.close);
  const at = await paseoScope(paseo, more);
  closers.push(() => at.scope.close());
  return { paseo, world: paseo.world, ...at };
}

const step = (scope: Awaited<ReturnType<typeof setup>>["scope"]) =>
  scope.run(paseoAdapter.requestStep);

const runsOf = (world: PaseoWorld["world"]) => world.calls.filter((call) => call.key === "run");

test("a request starts one agent in a new background workspace, acks it, counts the start and reports it to easel", async () => {
  const { scope, world, messages, events } = await setup();
  const { msg, said } = fakeMessage(request("product", 7));
  messages.push(msg);

  expect(await step(scope)).toBe("fetched");

  expect(said.acked).toBe(1);
  expect(world.workspaces).toEqual([
    { workspaceId: "wks_1", cwd: world.workspaceDir, isolation: "local", background: true },
  ]);
  const [run] = runsOf(world);
  expect(run?.argv).toContain("--no-wait");
  expect(run?.argv.at(-1)).toContain("`easel next --canvas product --n 7`");
  expect(events("started")).toEqual([
    expect.objectContaining({ ref: "product:7", agent: "agent-1", period: 1000, starts: 1 }),
  ]);
  expect(JSON.parse(readFileSync(join(world.stateDir, "starts.json"), "utf8"))).toEqual({
    day: "2026-11-25",
    starts: 1,
  });
  expect(world.reports.map((args) => args.slice(3, 5))).toEqual([
    ["--running", "0"],
    ["--started", "product:7:1000"],
  ]);
  const report = world.calls.find((call) => call.key === "report");
  expect(report?.argv.slice(0, 4)).toEqual(["easel", "channel", "report", "loop"]);
  expect(report?.env).toEqual({ EASEL_CONFIG_HOME: join(world.dir, ".config/easel-agent") });
});

test("a background workspace already on the easel folder is used again, and no new one is made", async () => {
  const { scope, world, messages } = await setup();
  world.workspaces.push({
    workspaceId: "wks_easel",
    cwd: world.workspaceDir,
    isolation: "local",
    background: true,
  });
  messages.push(fakeMessage(request("product", 1)).msg);

  await step(scope);

  expect(world.made).toBe(0);
  expect(runsOf(world)[0]?.argv).toContain("wks_easel");
});

test("when paseo cannot list the workspaces, the message gets a nak with the cause, and the failed start is reported", async () => {
  const { scope, world, messages, events } = await setup();
  world.faults.set("workspace ls", "exit");
  const { msg, said } = fakeMessage(request("product", 2, 50));
  messages.push(msg);

  await step(scope);

  expect(said.naked).toEqual([60_000]);
  expect(events("start-failed")).toEqual([
    expect.objectContaining({ ref: "product:2", exit: 1, cause: "workspace ls: it broke" }),
  ]);
  expect(world.reports.at(-1)?.slice(3)).toEqual([
    "--failed",
    "product:2:50",
    "--cause",
    "workspace ls: it broke",
    "--retry",
    "60000",
    "--json",
  ]);
  expect(runsOf(world)).toEqual([]);
});

test("when paseo cannot make the background workspace, the message gets a nak and no agent starts", async () => {
  const { scope, world, messages, events } = await setup();
  world.faults.set("workspace create", "bad-shape");
  const { msg, said } = fakeMessage(request("product", 3));
  messages.push(msg);

  await step(scope);

  expect(said.naked).toEqual([60_000]);
  expect(events("start-failed")[0]).toMatchObject({
    cause: "paseo workspace printed no valid JSON",
  });
  expect(runsOf(world)).toEqual([]);
});

test("when paseo run prints no JSON and easel cannot be reached, the adapter logs both one time and keeps its limits", async () => {
  const { scope, world, messages, events } = await setup();
  world.faults.set("run", "no-json");
  const { msg, said } = fakeMessage(request("product", 4));
  messages.push(msg);
  world.faults.set("report", "exit");

  await step(scope);

  expect(said.naked).toEqual([60_000]);
  expect(events("start-failed")[0]).toMatchObject({ cause: "paseo run printed no valid JSON" });
  expect(events("report-failed")).toEqual([
    expect.objectContaining({ call: "state", exit: 1, cause: "report: it broke" }),
  ]);

  world.faults.delete("report");
  world.faults.delete("run");
  world.limits = { running: 1, perDay: 5 };
  messages.push(fakeMessage(request("product", 4)).msg);
  await step(scope);

  expect(events("report-ok")).toEqual([expect.objectContaining({ call: "started" })]);
  expect(events("limits")).toEqual([expect.objectContaining({ running: 1, perDay: 5 })]);
});

test("a start whose report to easel fails is still counted and acked", async () => {
  const { scope, world, messages, events } = await setup();
  messages.push(fakeMessage(request("product", 5)).msg);
  await step(scope);
  world.faults.set("report", "no-json");
  const { msg, said } = fakeMessage(request("product", 6));
  messages.push(msg);

  await step(scope);

  expect(said.acked).toBe(1);
  expect(events("started")).toHaveLength(2);
  expect(events("report-failed")).toEqual([
    expect.objectContaining({ call: "state", cause: "not json" }),
  ]);
});

test("a failed start whose report to easel also fails is logged one time", async () => {
  const { scope, world, messages, events } = await setup();
  world.faults.set("workspace ls", "exit");
  await step(scope);
  world.faults.set("report", "exit");
  messages.push(fakeMessage(request("product", 8)).msg);

  await step(scope);

  expect(events("start-failed")).toHaveLength(1);
  expect(events("report-failed")).toEqual([
    expect.objectContaining({ call: "failed", cause: "report: it broke" }),
  ]);
});

test("a repeat of a request whose agent still runs is acked, and starts no second agent", async () => {
  const { scope, world, messages, events } = await setup();
  world.agents.push({
    id: "agent-9",
    name: "design product#7",
    status: "running",
    labels: { "easel-loop": "design", "easel-request": "product:7" },
  });
  const { msg, said } = fakeMessage(request("product", 7, 2000));
  messages.push(msg);

  await step(scope);

  expect(said.acked).toBe(1);
  expect(events("repeat")).toEqual([
    expect.objectContaining({ ref: "product:7", agent: "agent-9", period: 2000 }),
  ]);
  expect(runsOf(world)).toEqual([]);
});

test("when paseo cannot list the agents of a request, the message gets a nak and no failed start is reported", async () => {
  const { scope, world, messages, events } = await setup();
  world.faultWhen = (argv) => (argv.includes("easel-request=product:7") ? "exit" : undefined);
  const { msg, said } = fakeMessage(request("product", 7));
  messages.push(msg);

  await step(scope);

  expect(said.naked).toEqual([60_000]);
  expect(events("start-failed")[0]).toMatchObject({ ref: "product:7", cause: "ls: it broke" });
  expect(world.reports.some((args) => args.includes("--failed"))).toBe(false);
  expect(runsOf(world)).toEqual([]);
});

test("a message that is not JSON, or not a request, is terminated with a log line, and starts no agent", async () => {
  const { scope, world, messages, events } = await setup();
  const notJson = fakeMessage("{not json", 3);
  const notRequest = fakeMessage({ canvas: "product", n: -1 }, 4);
  messages.push(notJson.msg, notRequest.msg);

  await step(scope);
  await step(scope);

  expect(notJson.said.termed).toEqual(["the body is not JSON"]);
  expect(notRequest.said.termed[0]).toContain("n: ");
  expect(events("malformed").map((line) => line.seq)).toEqual([3, 4]);
  expect(runsOf(world)).toEqual([]);
});

test("when paseo ls fails, the step waits and logs it", async () => {
  const { scope, world, events } = await setup();
  world.faults.set("ls", "exit");

  expect(await step(scope)).toBe("wait");
  expect(events("paseo-failed")).toEqual([
    expect.objectContaining({ call: "ls", exit: 1, cause: "ls: it broke" }),
  ]);
});

test("while 2 design agents run, the step fetches nothing and logs busy one time; when one ends, it fetches again", async () => {
  const { scope, world, messages, events } = await setup();
  for (const id of ["agent-1", "agent-2"]) {
    world.agents.push({ id, name: id, status: "running", labels: { "easel-loop": "design" } });
  }
  messages.push(fakeMessage(request("product", 1)).msg);

  expect(await step(scope)).toBe("wait");
  expect(await step(scope)).toBe("wait");
  expect(events("busy")).toEqual([expect.objectContaining({ running: 2, limit: 2 })]);
  expect(messages).toHaveLength(1);

  const [first] = world.agents;
  if (first) first.status = "idle";
  expect(await step(scope)).toBe("fetched");
  expect(messages).toHaveLength(0);
});

test("after the day limit of starts, the step fetches nothing and logs it one time, and the report says it is at the day limit", async () => {
  const { scope, world, messages, events } = await setup();
  mkdirSync(world.stateDir, { recursive: true });
  writeFileSync(
    join(world.stateDir, "starts.json"),
    JSON.stringify({ day: "2026-11-25", starts: 20 }),
  );
  messages.push(fakeMessage(request("product", 1)).msg);

  expect(await step(scope)).toBe("wait");
  expect(await step(scope)).toBe("wait");

  expect(events("day-limit")).toEqual([
    expect.objectContaining({ day: "2026-11-25", starts: 20, limit: 20 }),
  ]);
  expect(world.reports[0]).toContain("day");
  expect(messages).toHaveLength(1);
});

test("the starts of an earlier day do not count", async () => {
  const { scope, world, messages, events } = await setup();
  mkdirSync(world.stateDir, { recursive: true });
  writeFileSync(
    join(world.stateDir, "starts.json"),
    JSON.stringify({ day: "2026-11-24", starts: 20 }),
  );
  messages.push(fakeMessage(request("product", 1)).msg);

  expect(await step(scope)).toBe("fetched");
  expect(events("started")[0]).toMatchObject({ starts: 1 });
});

test("the same state goes to easel again only after reportMs", async () => {
  const { scope, world, clock } = await setup({ reportMs: 1000 });

  await step(scope);
  await step(scope);
  expect(world.reports).toHaveLength(1);

  clock.advance(1000);
  await step(scope);
  expect(world.reports).toHaveLength(2);
});

test("the permit round denies each pending request of a design agent, and leaves the requests of other agents alone", async () => {
  const { scope, world, events } = await setup();
  world.agents.push(
    { id: "agent-1", name: "d", status: "running", labels: { "easel-loop": "design" } },
    { id: "other", name: "o", status: "running", labels: {} },
  );
  world.permits.push(
    { id: "p1", agentId: "agent-1", name: "AskUserQuestion" },
    { id: "p2", agentId: "other", name: "Bash" },
  );

  expect(await scope.run(paseoAdapter.permitRound)).toBe("active");

  expect(world.denied).toEqual(["agent-1/p1"]);
  expect(events("denied")).toEqual([
    expect.objectContaining({ agent: "agent-1", request: "p1", tool: "AskUserQuestion" }),
  ]);
  const deny = world.calls.find((call) => call.key === "permit deny");
  expect(deny?.argv).toContain("--message");
  expect(JSON.stringify(events("denied"))).not.toContain("No person is here");
});

test("a permit that paseo cannot deny is logged, and the round goes on", async () => {
  const { scope, world, events } = await setup();
  world.agents.push({
    id: "agent-1",
    name: "d",
    status: "running",
    labels: { "easel-loop": "design" },
  });
  world.permits.push({ id: "p1", agentId: "agent-1", name: "Bash" });
  world.faults.set("permit deny", "exit");

  expect(await scope.run(paseoAdapter.permitRound)).toBe("active");
  expect(events("deny-failed")).toEqual([
    expect.objectContaining({ agent: "agent-1", request: "p1", cause: "permit deny: it broke" }),
  ]);
});

test("the permit round is idle with no design agent that runs, and active when paseo cannot list the permits", async () => {
  const { scope, world, events } = await setup();

  expect(await scope.run(paseoAdapter.permitRound)).toBe("idle");

  world.agents.push({
    id: "agent-1",
    name: "d",
    status: "running",
    labels: { "easel-loop": "design" },
  });
  world.faults.set("permit ls", "bad-shape");
  expect(await scope.run(paseoAdapter.permitRound)).toBe("active");
  world.faults.set("permit ls", "exit");
  expect(await scope.run(paseoAdapter.permitRound)).toBe("active");
  expect(events("paseo-failed").map((line) => line.cause)).toEqual([
    "paseo permit printed no valid JSON",
    "permit ls: it broke",
  ]);
});

test("serve runs both loops until its signal aborts, logs a failed step or round, and logs stopping", async () => {
  const { scope, world, clock, events } = await setup();
  mkdirSync(world.stateDir, { recursive: true });
  writeFileSync(join(world.stateDir, "starts.json"), "{broken");
  world.agents.push({
    id: "agent-1",
    name: "d",
    status: "running",
    labels: { "easel-loop": "design" },
  });
  world.faults.set("permit ls", "throw");
  const stop = new AbortController();

  const served = scope.settle(paseoAdapter.serve, { signal: stop.signal });
  for (let tick = 0; tick < 5; tick++) {
    await new Promise((done) => setImmediate(done));
    clock.advance(100);
  }
  stop.abort();
  expect((await served).status).toBe("cancelled");

  expect(events("step-failed").length).toBeGreaterThan(0);
  expect(events("permit-failed")[0]).toMatchObject({ cause: expect.stringContaining("threw") });
  expect(events("stopping")).toHaveLength(1);
});

test("runCommand gives the output and the exit code of a command, and exit -1 when it cannot start", async () => {
  const bare = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => bare.close());

  const ran = await bare.run(runCommand, {
    input: { argv: ["/bin/sh", "-c", "echo out; echo err >&2; exit 3"], env: {}, timeoutMs: 5000 },
  });
  expect(ran).toEqual({ out: "out\n", err: "err\n", exit: 3 });

  const missing = await bare.run(runCommand, {
    input: { argv: ["/no/such/easel-binary"], env: {}, timeoutMs: 5000 },
  });
  expect(missing.exit).toBe(-1);
});

test("the env gives the defaults of the hub unit, and refuses a number that is not above 0", () => {
  const read = adapterEnv.parse({ HOME: "/home/x", EASEL_PASEO_POLL_MS: "100" });
  expect(read.seedFile).toBe("/home/x/.config/secrets/hub-nats/easel-paseo.nk");
  expect(read.config).toMatchObject({
    workspaceDir: "/home/x/dev/easel",
    stateDir: "/home/x/.local/state/easel-paseo-adapter",
    pollMs: 100,
    maxRunning: undefined,
  });

  const bad = adapterEnv.safeParse({ HOME: "/home/x", EASEL_PASEO_MAX_RUNNING: "zero" });
  expect(bad.error?.issues[0]?.message).toBe('must be a number above 0, not "zero"');
});
