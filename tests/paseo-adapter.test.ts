import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, expect, test } from "vite-plus/test";

import { fakePaseo, hubNats, startAdapter } from "./support/paseo-adapter";

const closers: Array<() => unknown> = [];
const slow = 30_000;

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
}, slow);

async function setup(
  env: Record<string, string> = {},
  before?: (dir: string) => void,
  limits?: { running: number; perDay: number },
) {
  const nats = await hubNats();
  closers.push(() => nats.close());
  const paseo = fakePaseo();
  closers.push(() => paseo.close());
  before?.(join(paseo.dir, "state"));
  if (limits) paseo.setLimits(limits);
  const adapter = startAdapter(nats, paseo, env);
  closers.push(() => adapter.stop());
  await adapter.event("bound");

  return { nats, paseo, adapter };
}

const request = (canvas: string, n: number, period = 1000) => ({
  canvas,
  n,
  frame: "frm_1",
  page: "page-1",
  period,
});

const today = () => new Date().toISOString().slice(0, 10);

const valueAfter = (args: string[], flag: string) =>
  args.flatMap((arg, index) => (args[index - 1] === flag ? [arg] : []));

test(
  "the adapter binds to the hub's durable consumer EASEL_REQUESTS/paseo with the easel-paseo key, and its log never shows the seed",
  async () => {
    const { nats, adapter } = await setup();

    expect(adapter.lines.find((line) => line.event === "bound")).toMatchObject({
      stream: "EASEL_REQUESTS",
      consumer: "paseo",
      url: nats.url,
    });
    expect(adapter.raw.join("\n")).not.toContain(nats.seed);
  },
  slow,
);

test(
  "one message starts one agent with paseo run in the easel workspace, with the title, the labels and a prompt that says how to claim, then acks it and counts the start of the day",
  async () => {
    const { nats, paseo, adapter } = await setup();

    await nats.publish("product", request("product", 7), "product:7:1000");
    const started = await adapter.event("started");

    expect(started).toMatchObject({ ref: "product:7", agent: "agent-1", starts: 1 });
    const [run] = paseo.runs();
    expect(run).toBeDefined();
    const args = run ?? [];
    expect(args).toContain("--no-wait");
    expect(valueAfter(args, "--title")).toEqual(["design product#7"]);
    expect(valueAfter(args, "--workspace")).toEqual(["wks_easel"]);
    expect(valueAfter(args, "--cwd")).toEqual([paseo.workspaceDir]);
    expect(valueAfter(args, "--provider")).toEqual(["claude"]);
    expect(valueAfter(args, "--mode")).toEqual(["auto"]);
    expect(valueAfter(args, "--env")).toEqual([
      `EASEL_CONFIG_HOME=${join(paseo.dir, ".config/easel-agent")}`,
    ]);
    expect(valueAfter(args, "--label").sort()).toEqual([
      "easel-loop=design",
      "easel-request=product:7",
    ]);
    const prompt = args.at(-1) ?? "";
    expect(prompt).toContain("request product#7, on frame frm_1 on page page-1");
    expect(prompt).toContain("`easel next --canvas product --n 7`");
    expect(prompt).toContain("`easel release <claim> --reason <why>`");
    expect(prompt).toContain("/api/version");
    expect(prompt).toContain("You run non-interactive and unattended");
    expect(prompt).toContain("Never ask the user");
    expect(prompt).toContain("Run each wait in the foreground");
    expect(prompt).toContain("act as the member vibea-claude");
    expect(prompt).toContain("`easel whoami`");
    expect(prompt).toContain("Never use another login");

    await adapter.until(async () => (await nats.state()).unacked === 0, "the ack");
    expect(await nats.state()).toEqual({ waiting: 0, unacked: 0 });
    expect(JSON.parse(readFileSync(join(adapter.stateDir, "starts.json"), "utf8"))).toEqual({
      day: today(),
      starts: 1,
    });
  },
  slow,
);

test(
  "while 2 design agents run, the adapter fetches no message; when one of them ends, the third starts",
  async () => {
    const { nats, paseo, adapter } = await setup();

    for (const n of [1, 2, 3]) {
      await nats.publish("product", request("product", n), `product:${n}:1`);
    }
    await adapter.until(() => paseo.runs().length === 2, "2 starts");
    await adapter.event("busy");
    await Bun.sleep(600);

    expect(paseo.runs()).toHaveLength(2);
    expect(await nats.state()).toEqual({ waiting: 1, unacked: 0 });
    expect(adapter.lines.filter((line) => line.event === "busy")).toHaveLength(1);

    paseo.setAgents(paseo.agents().map((one, i) => (i === 0 ? { ...one, status: "idle" } : one)));
    await adapter.until(() => paseo.runs().length === 3, "the third start");
    expect(valueAfter(paseo.runs()[2] ?? [], "--title")).toEqual(["design product#3"]);
  },
  slow,
);

test(
  "after 20 starts in a UTC day, the adapter fetches no message, logs it one time, and the message waits in the stream",
  async () => {
    const { nats, paseo, adapter } = await setup({}, (stateDir) => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "starts.json"), JSON.stringify({ day: today(), starts: 20 }));
    });

    await nats.publish("product", request("product", 1), "product:1:1");
    expect(await adapter.event("day-limit")).toMatchObject({ day: today(), starts: 20, limit: 20 });
    await Bun.sleep(600);

    expect(paseo.runs()).toEqual([]);
    expect(await nats.state()).toEqual({ waiting: 1, unacked: 0 });
    expect(adapter.lines.filter((line) => line.event === "day-limit")).toHaveLength(1);
  },
  slow,
);

test(
  "the starts of an earlier day do not count: a new UTC day starts again at 0",
  async () => {
    const { nats, adapter } = await setup({}, (stateDir) => {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(
        join(stateDir, "starts.json"),
        JSON.stringify({ day: "2020-01-01", starts: 20 }),
      );
    });

    await nats.publish("product", request("product", 1), "product:1:1");
    expect(await adapter.event("started")).toMatchObject({ starts: 1 });
  },
  slow,
);

test(
  "a repeat of a request whose agent still runs is acked, and starts no second agent",
  async () => {
    const { nats, paseo, adapter } = await setup();
    paseo.setAgents([
      {
        id: "agent-old",
        name: "design product#4",
        status: "running",
        cwd: paseo.workspaceDir,
        labels: { "easel-loop": "design", "easel-request": "product:4" },
      },
    ]);

    await nats.publish("product", request("product", 4, 2000), "product:4:2000");
    expect(await adapter.event("repeat")).toMatchObject({ ref: "product:4", agent: "agent-old" });

    await adapter.until(async () => (await nats.state()).unacked === 0, "the ack");
    expect(paseo.runs()).toEqual([]);
    expect(await nats.state()).toEqual({ waiting: 0, unacked: 0 });
  },
  slow,
);

test(
  "a request whose last agent is done starts a new agent",
  async () => {
    const { nats, paseo, adapter } = await setup();
    paseo.setAgents([
      {
        id: "agent-old",
        name: "design product#4",
        status: "idle",
        cwd: paseo.workspaceDir,
        labels: { "easel-loop": "design", "easel-request": "product:4" },
      },
    ]);

    await nats.publish("product", request("product", 4, 2000), "product:4:2000");
    expect(await adapter.event("started")).toMatchObject({ ref: "product:4" });
  },
  slow,
);

test(
  "when paseo run fails, the adapter naks the message with a delay and logs the cause; the message comes again after the delay",
  async () => {
    const { nats, paseo, adapter } = await setup({ EASEL_PASEO_NAK_MS: "400" });
    paseo.failRuns(true);

    await nats.publish("product", request("product", 9), "product:9:1");
    expect(await adapter.event("start-failed")).toMatchObject({
      ref: "product:9",
      exit: 1,
      retryMs: 400,
      cause: "Failed to create agent: the daemon is down",
    });
    expect(adapter.lines.some((line) => line.event === "started")).toBe(false);

    paseo.failRuns(false);
    expect(await adapter.event("started")).toMatchObject({ ref: "product:9", starts: 1 });
    expect(paseo.runs()).toHaveLength(2);
  },
  slow,
);

test(
  "a malformed message is terminated with a log line, and starts no agent",
  async () => {
    const { nats, paseo, adapter } = await setup();

    await nats.publish("product", "not json", "bad:1");
    expect(await adapter.event("malformed")).toMatchObject({
      subject: "easel.requests.product",
      cause: "the body is not JSON",
    });
    await nats.publish("product", { canvas: "product", n: -1, page: "p" }, "bad:2");
    const second = await adapter.until(
      () => adapter.lines.filter((line) => line.event === "malformed")[1],
      "the second malformed line",
    );
    expect(String(second.cause)).toContain("n:");

    await adapter.until(async () => (await nats.state()).unacked === 0, "the term");
    expect(await nats.state()).toEqual({ waiting: 0, unacked: 0 });
    expect(paseo.runs()).toEqual([]);
  },
  slow,
);

test(
  "the adapter denies at once each pending permission request of a design agent, with a message that no person is here, and leaves the requests of other agents alone; the log names the agent and the tool, not the text",
  async () => {
    const { paseo, adapter } = await setup();
    paseo.setAgents([
      {
        id: "agent-design",
        name: "design product#5",
        status: "running",
        cwd: paseo.workspaceDir,
        labels: { "easel-loop": "design", "easel-request": "product:5" },
      },
      { id: "agent-other", name: "other work", status: "running", cwd: "/elsewhere", labels: {} },
    ]);
    paseo.setPermits([
      {
        id: "permission-1",
        agentId: "agent-design",
        name: "AskUserQuestion",
        description: "Red / Blue",
      },
      { id: "permission-2", agentId: "agent-other", name: "Bash", description: "rm -rf build" },
    ]);

    const denied = await adapter.event("denied");
    expect(denied).toMatchObject({
      agent: "agent-design",
      request: "permission-1",
      tool: "AskUserQuestion",
    });
    expect(adapter.raw.join("\n")).not.toContain("Red / Blue");

    const [args] = paseo.denies();
    expect(args?.slice(0, 4)).toEqual(["permit", "deny", "agent-design", "permission-1"]);
    expect(valueAfter(args ?? [], "--message")[0]).toContain("No person is here");
    expect(valueAfter(args ?? [], "--message")[0]).toContain("easel release <claim> --reason");

    await Bun.sleep(600);
    expect(paseo.permits().map((one) => one.id)).toEqual(["permission-2"]);
    expect(paseo.denies()).toHaveLength(1);
  },
  slow,
);

const reports = (paseo: { easelCalls: () => Array<{ args: string[] }> }) =>
  paseo.easelCalls().map((call) => call.args);

const stateReports = (paseo: { easelCalls: () => Array<{ args: string[] }> }) =>
  reports(paseo).filter((args) => args.includes("--running"));

test(
  "the adapter reports its state to easel with the easel CLI, for its channel, as the user of EASEL_PASEO_EASEL_CONFIG: the agents that run and the starts of the day",
  async () => {
    const { paseo, adapter } = await setup();

    await adapter.until(() => stateReports(paseo).length > 0, "a state report");
    const [first] = paseo.easelCalls();
    expect(first).toEqual({
      args: ["channel", "report", "loop", "--running", "0", "--today", "0", "--json"],
      configHome: join(paseo.dir, ".config/easel-agent"),
    });
  },
  slow,
);

test(
  "the adapter sends the same state again only after EASEL_PASEO_REPORT_MS, so easel knows that it is there",
  async () => {
    const { paseo, adapter } = await setup({ EASEL_PASEO_REPORT_MS: "400" });

    await adapter.until(() => stateReports(paseo).length >= 3, "3 state reports", 5000);
    await Bun.sleep(150);
    const count = stateReports(paseo).length;
    expect(count).toBeLessThan(10);
  },
  slow,
);

test(
  "the limits come from easel: with 1 agent at the same time, the second request waits, and the report says it is at the running limit",
  async () => {
    const { nats, paseo, adapter } = await setup({}, undefined, { running: 1, perDay: 20 });

    await adapter.event("limits");
    for (const n of [1, 2]) await nats.publish("product", request("product", n), `product:${n}:1`);
    await adapter.until(() => paseo.runs().length === 1, "1 start");
    expect(await adapter.event("busy")).toMatchObject({ running: 1, limit: 1 });
    await adapter.until(
      () => stateReports(paseo).some((args) => args.includes("--at")),
      "a report at the limit",
    );
    const atLimit = stateReports(paseo).find((args) => args.includes("--at")) ?? [];
    expect(valueAfter(atLimit, "--at")).toEqual(["running"]);
    expect(valueAfter(atLimit, "--running")).toEqual(["1"]);
    expect(paseo.runs()).toHaveLength(1);
    expect(await nats.state()).toEqual({ waiting: 1, unacked: 0 });
  },
  slow,
);

test(
  "a day limit from easel holds: with 1 start in a day, the next request waits, and the report says it is at the day limit",
  async () => {
    const { nats, paseo, adapter } = await setup({}, undefined, { running: 2, perDay: 1 });

    await adapter.event("limits");
    await nats.publish("product", request("product", 1), "product:1:1");
    await adapter.event("started");
    await nats.publish("product", request("product", 2), "product:2:1");
    expect(await adapter.event("day-limit")).toMatchObject({ starts: 1, limit: 1 });
    await adapter.until(
      () => stateReports(paseo).some((args) => valueAfter(args, "--at")[0] === "day"),
      "a report at the day limit",
    );
    expect(paseo.runs()).toHaveLength(1);
  },
  slow,
);

test(
  "each start is reported to easel with the request, its waiting period and the agent",
  async () => {
    const { nats, paseo, adapter } = await setup();

    await nats.publish("product", request("product", 7), "product:7:1000");
    await adapter.event("started");
    await adapter.until(
      () => reports(paseo).some((args) => args.includes("--started")),
      "the start report",
    );
    const started = reports(paseo).find((args) => args.includes("--started")) ?? [];
    expect(started).toEqual([
      "channel",
      "report",
      "loop",
      "--started",
      "product:7:1000",
      "--agent",
      "agent-1",
      "--json",
    ]);
  },
  slow,
);

test(
  "a failed start is reported to easel with the cause and the time until the next try",
  async () => {
    const { nats, paseo, adapter } = await setup({ EASEL_PASEO_NAK_MS: "60000" });
    paseo.failRuns(true);

    await nats.publish("product", request("product", 9), "product:9:1");
    await adapter.event("start-failed");
    await adapter.until(
      () => reports(paseo).some((args) => args.includes("--failed")),
      "the failure report",
    );
    const failed = reports(paseo).find((args) => args.includes("--failed")) ?? [];
    expect(valueAfter(failed, "--failed")).toEqual(["product:9:1000"]);
    expect(valueAfter(failed, "--cause")).toEqual(["Failed to create agent: the daemon is down"]);
    expect(valueAfter(failed, "--retry")).toEqual(["60000"]);
  },
  slow,
);

test(
  "when easel cannot be reached, the adapter logs it one time, keeps its limits, and still starts agents",
  async () => {
    const { nats, paseo, adapter } = await setup();
    paseo.failEasel(true);

    expect(await adapter.event("report-failed")).toMatchObject({
      call: "state",
      exit: 1,
      cause: "easel: the server cannot be reached",
    });
    await nats.publish("product", request("product", 3), "product:3:1");
    expect(await adapter.event("started")).toMatchObject({ ref: "product:3" });
    expect(adapter.lines.filter((line) => line.event === "report-failed")).toHaveLength(1);

    paseo.failEasel(false);
    await adapter.event("report-ok");
    expect(adapter.lines.filter((line) => line.event === "report-failed")).toHaveLength(1);
  },
  slow,
);
