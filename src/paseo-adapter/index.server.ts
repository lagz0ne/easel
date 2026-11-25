import { capsule, operation } from "@tinkered/core";

import { requestStep } from "./adapter.server";
import { adapterLog } from "./log";
import { permitRound } from "./permits.server";
import {
  adapterExit,
  adapterOutput,
  agentConfigHome,
  agentMode,
  causeLimit,
  channel,
  commandEnv,
  denyMessage,
  easelCommand,
  easelTimeoutMs,
  maxPerDay,
  maxRunning,
  nakMs,
  natsInbox,
  natsSeed,
  natsUrl,
  paseoBin,
  paseoTimeoutMs,
  permitMs,
  pollMs,
  provider,
  reportMs,
  requestConsumer,
  requestStream,
  stateDir,
  workspaceDir,
  workspaceTitle,
} from "./settings";
import { requestSource } from "./source.server";

const serveRequests = operation({
  label: "paseoAdapter.serveRequests",
  depends: { requestStep, every: pollMs, log: adapterLog },
  run: async ({ requestStep, every, log }, { clock, signal }) => {
    while (!signal.aborted) {
      const step = await requestStep.settle();
      if (step.status === "failed") {
        const cause = step.error instanceof Error ? step.error.message : String(step.error);
        log.write("step-failed", { cause });
      }
      if (step.status !== "success" || step.value === "wait") {
        await clock.sleep(every, signal).catch(() => undefined);
      }
    }
  },
});

const servePermits = operation({
  label: "paseoAdapter.servePermits",
  depends: { permitRound, active: permitMs, idle: pollMs, log: adapterLog },
  run: async ({ permitRound, active, idle, log }, { clock, signal }) => {
    while (!signal.aborted) {
      const round = await permitRound.settle();
      if (round.status === "failed") {
        const cause = round.error instanceof Error ? round.error.message : String(round.error);
        log.write("permit-failed", { cause });
      }
      const seen = round.status === "success" ? round.value : "idle";
      await clock.sleep(seen === "active" ? active : idle, signal).catch(() => undefined);
    }
  },
});

export const serve = operation({
  label: "paseoAdapter.serve",
  depends: { serveRequests, servePermits, log: adapterLog },
  run: async ({ serveRequests, servePermits, log }, { signal }) => {
    signal.addEventListener("abort", () => log.write("stopping"), { once: true });
    await Promise.all([serveRequests.settle({ signal }), servePermits.settle({ signal })]);
  },
});

export const paseoAdapter = capsule({
  label: "paseoAdapter",
  config: {
    url: natsUrl,
    seed: natsSeed,
    inbox: natsInbox,
    stream: requestStream,
    consumer: requestConsumer,
    paseo: paseoBin,
    workspaceDir,
    workspaceTitle,
    provider,
    mode: agentMode,
    agentConfigHome,
    easel: easelCommand,
    channel,
    stateDir,
    maxRunning,
    maxPerDay,
    pollMs,
    nakMs,
    permitMs,
    reportMs,
    paseoTimeoutMs,
    easelTimeoutMs,
    causeLimit,
    denyMessage,
    env: commandEnv,
    output: adapterOutput,
    exit: adapterExit,
  },
  exports: { serve, requestStep, permitRound },
  hooks: {
    async start({ load, next }) {
      await load(requestSource, {
        role: "state",
        explain: "Binds to the durable consumer of the design requests",
      });
      await next();
    },
  },
});
