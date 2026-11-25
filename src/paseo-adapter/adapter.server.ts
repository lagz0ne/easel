import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { reportFailed, reportStarted, reportState, starterState } from "./easel";
import type { Limits, StarterState } from "./easel";
import { adapterLog } from "./log";
import { activeStatuses, listAgents, startAgent, workspaceOf } from "./paseo";
import { parseRequest, requestTexts } from "./request";
import type { DesignRequest } from "./request";
import {
  agentConfigHome,
  agentMode,
  designLabel,
  maxPerDay,
  maxRunning,
  nakMs,
  natsMinimumExpiresMs,
  pollMs,
  provider,
  reportMs,
  workspaceDir,
} from "./settings";
import { requestSource } from "./source.server";
import type { RequestMessage } from "./source.server";
import { countStart, startsOn, utcDay } from "./starts.server";

type StarterMemory = {
  dayLogged: string;
  busy: boolean;
  limits: Limits;
  reported: StarterState | null;
  reportedAt: number;
  reportFailed: boolean;
};

export const starterMemory = resource({
  label: "paseoAdapter.starterMemory",
  target: "scope",
  depends: { maxRunning, maxPerDay },
  factory: ({ maxRunning, maxPerDay }): StarterMemory => ({
    dayLogged: "",
    busy: false,
    limits: { running: maxRunning, perDay: maxPerDay },
    reported: null,
    reportedAt: 0,
    reportFailed: false,
  }),
});

const easelAnswer = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ok"),
    limits: z.object({ running: z.number(), perDay: z.number() }),
  }),
  z.object({ kind: z.literal("failed"), exit: z.number(), cause: z.string() }),
]);

const failed = z.object({ kind: z.literal("failed"), exit: z.number(), cause: z.string() });

const message = z.custom<RequestMessage>();

export const tookAnswer = operation({
  label: "paseoAdapter.tookAnswer",
  input: z.object({ answer: easelAnswer, call: z.string() }),
  depends: { memory: starterMemory, log: adapterLog },
  run: ({ memory, log }, { input: { answer, call } }) => {
    if (answer.kind === "failed") {
      if (!memory.reportFailed) {
        log.write("report-failed", { call, exit: answer.exit, cause: answer.cause });
      }
      memory.reportFailed = true;
      return false;
    }

    if (memory.reportFailed) log.write("report-ok", { call });
    memory.reportFailed = false;

    const was = memory.limits;
    if (answer.limits.running !== was.running || answer.limits.perDay !== was.perDay) {
      log.write("limits", { running: answer.limits.running, perDay: answer.limits.perDay });
    }
    memory.limits = answer.limits;
    return true;
  },
});

export const reportNow = operation({
  label: "paseoAdapter.reportNow",
  input: z.object({ running: z.number(), today: z.number() }),
  depends: { memory: starterMemory, every: reportMs, reportState, tookAnswer },
  run: async ({ memory, every, reportState, tookAnswer }, { input, clock }) => {
    const { limits, reported } = memory;
    const at =
      input.today >= limits.perDay ? "day" : input.running >= limits.running ? "running" : null;
    const now = starterState.parse({ ...input, at });
    const same =
      reported !== null &&
      reported.running === now.running &&
      reported.today === now.today &&
      reported.at === now.at;
    if (same && clock.currentTimeMillis() - memory.reportedAt < every) return;

    const answer = await reportState.run({ input: now });
    tookAnswer.run({ input: { answer, call: "state" } });
    memory.reported = now;
    memory.reportedAt = clock.currentTimeMillis();
  },
});

export const underDayLimit = operation({
  label: "paseoAdapter.underDayLimit",
  input: z.object({ day: z.string(), starts: z.number() }),
  depends: { memory: starterMemory, log: adapterLog },
  run: ({ memory, log }, { input: { day, starts } }) => {
    if (starts < memory.limits.perDay) return true;

    if (memory.dayLogged !== day) {
      log.write("day-limit", { day, starts, limit: memory.limits.perDay });
    }
    memory.dayLogged = day;
    return false;
  },
});

export const underRunLimit = operation({
  label: "paseoAdapter.underRunLimit",
  input: z.number(),
  depends: { memory: starterMemory, log: adapterLog },
  run: ({ memory, log }, { input: running }) => {
    if (running < memory.limits.running) {
      memory.busy = false;
      return true;
    }
    if (!memory.busy) log.write("busy", { running, limit: memory.limits.running });
    memory.busy = true;
    return false;
  },
});

export const nakFailed = operation({
  label: "paseoAdapter.nakFailed",
  input: z.object({
    msg: message,
    ref: z.string(),
    period: z.number().nullable(),
    failed,
  }),
  depends: { retryMs: nakMs, log: adapterLog, reportFailed, tookAnswer },
  run: async ({ retryMs, log, reportFailed, tookAnswer }, { input }) => {
    const { msg, ref, period, failed } = input;
    msg.nak(retryMs);
    log.write("start-failed", { ref, exit: failed.exit, cause: failed.cause, retryMs });
    if (period === null) return;

    const answer = await reportFailed.run({
      input: { ref: `${ref}:${period}`, cause: failed.cause, retryMs },
    });
    tookAnswer.run({ input: { answer, call: "failed" } });
  },
});

export const startRequest = operation({
  label: "paseoAdapter.startRequest",
  input: z.object({ msg: message, request: z.custom<DesignRequest>() }),
  depends: {
    dir: workspaceDir,
    provider,
    mode: agentMode,
    configHome: agentConfigHome,
    memory: starterMemory,
    log: adapterLog,
    requestTexts,
    workspaceOf,
    startAgent,
    nakFailed,
    countStart,
    utcDay,
    reportStarted,
    tookAnswer,
  },
  run: async (deps, { input: { msg, request } }) => {
    const texts = deps.requestTexts.run({ input: request });
    const { ref, title, prompt } = texts;
    const period = request.period;

    const workspace = await deps.workspaceOf.run({ input: deps.dir });
    if (workspace.kind === "failed") {
      return deps.nakFailed.run({ input: { msg, ref, period, failed: workspace } });
    }

    const started = await deps.startAgent.run({
      input: {
        title,
        prompt,
        cwd: deps.dir,
        workspace: workspace.value,
        provider: deps.provider,
        mode: deps.mode,
        env: { EASEL_CONFIG_HOME: deps.configHome },
        labels: { ...designLabel, "easel-request": ref },
      },
    });
    if (started.kind === "failed") {
      return deps.nakFailed.run({ input: { msg, ref, period, failed: started } });
    }

    const starts = deps.countStart.run({ input: deps.utcDay.run() });
    msg.ack();
    const agent = started.value.agentId;
    deps.log.write("started", { ref, agent, title, period, starts });
    const answer = await deps.reportStarted.run({ input: { ref: `${ref}:${period}`, agent } });
    deps.tookAnswer.run({ input: { answer, call: "started" } });
    deps.memory.reportedAt = 0;
  },
});

export const handleMessage = operation({
  label: "paseoAdapter.handleMessage",
  input: message,
  depends: { log: adapterLog, parseRequest, requestTexts, listAgents, nakFailed, startRequest },
  run: async (deps, { input: msg }) => {
    const parsed = deps.parseRequest.run({ input: msg.data });
    if (parsed.kind === "malformed") {
      msg.term(parsed.cause);
      deps.log.write("malformed", { subject: msg.subject, seq: msg.seq, cause: parsed.cause });
      return;
    }

    const { request } = parsed;
    const { ref } = deps.requestTexts.run({ input: request });
    const same = await deps.listAgents.run({ input: { ...designLabel, "easel-request": ref } });
    if (same.kind === "failed") {
      return deps.nakFailed.run({ input: { msg, ref, period: null, failed: same } });
    }

    const live = same.value.find((agent) => activeStatuses.has(agent.status));
    if (!live) return deps.startRequest.run({ input: { msg, request } });
    msg.ack();
    deps.log.write("repeat", { ref, agent: live.id, period: request.period });
  },
});

export const requestStep = operation({
  label: "paseoAdapter.requestStep",
  depends: {
    every: pollMs,
    source: requestSource,
    log: adapterLog,
    utcDay,
    startsOn,
    listAgents,
    reportNow,
    underDayLimit,
    underRunLimit,
    handleMessage,
  },
  run: async (deps) => {
    const day = deps.utcDay.run();
    const today = deps.startsOn.run({ input: day });
    const listed = await deps.listAgents.run({ input: designLabel });
    if (listed.kind === "failed") {
      deps.log.write("paseo-failed", { call: "ls", exit: listed.exit, cause: listed.cause });
      return "wait" as const;
    }
    const running = listed.value.filter((agent) => activeStatuses.has(agent.status)).length;
    await deps.reportNow.run({ input: { running, today } });
    if (!deps.underDayLimit.run({ input: { day, starts: today } })) return "wait" as const;
    if (!deps.underRunLimit.run({ input: running })) return "wait" as const;

    const msg = await deps.source.next(Math.max(deps.every, natsMinimumExpiresMs));
    if (msg) await deps.handleMessage.run({ input: msg });
    return "fetched" as const;
  },
});
