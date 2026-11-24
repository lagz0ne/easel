import type { Consumer, JsMsg } from "@nats-io/jetstream";

import type { Config } from "./config";
import type { Easel, Limits, StarterState } from "./easel";
import { log } from "./log";
import { isActive } from "./paseo";
import type { Failed, Paseo } from "./paseo";
import { designLabel } from "./permits";
import { agentPrompt, agentTitle, parseRequest, requestRef } from "./request";
import type { DesignRequest } from "./request";
import { countStart, startsOn, utcDay } from "./starts";

const minimumExpiresMs = 1000;

export type Adapter = { consumer: Consumer; paseo: Paseo; easel: Easel; config: Config };

type Step = "fetched" | "wait";

const sameState = (a: StarterState | null, b: StarterState) =>
  a !== null && a.running === b.running && a.today === b.today && a.at === b.at;

export function adapterLoop({ consumer, paseo, easel, config }: Adapter) {
  let dayLogged = "";
  let busy = false;
  let limits: Limits = { running: config.maxRunning, perDay: config.maxPerDay };
  let reported: StarterState | null = null;
  let reportedAt = 0;
  let reportFailed = false;

  const tookAnswer = (answer: Awaited<ReturnType<Easel["state"]>>, call: string) => {
    if (answer.kind === "failed") {
      if (!reportFailed) log("report-failed", { call, exit: answer.exit, cause: answer.cause });
      reportFailed = true;
      return false;
    }

    if (reportFailed) log("report-ok", { call });
    reportFailed = false;

    if (answer.limits.running !== limits.running || answer.limits.perDay !== limits.perDay) {
      log("limits", { running: answer.limits.running, perDay: answer.limits.perDay });
    }
    limits = answer.limits;
    return true;
  };

  const atOf = (running: number, today: number): StarterState["at"] => {
    if (today >= limits.perDay) return "day";
    return running >= limits.running ? "running" : null;
  };

  const reportState = async (running: number, today: number) => {
    const now: StarterState = { running, today, at: atOf(running, today) };
    if (sameState(reported, now) && Date.now() - reportedAt < config.reportMs) return;

    tookAnswer(await easel.state(now), "state");
    reported = now;
    reportedAt = Date.now();
  };

  const underDayLimit = (day: string, starts: number) => {
    if (starts < limits.perDay) return true;

    if (dayLogged !== day) log("day-limit", { day, starts, limit: limits.perDay });
    dayLogged = day;
    return false;
  };

  const underRunLimit = (running: number) => {
    if (running < limits.running) {
      busy = false;
      return true;
    }
    if (!busy) log("busy", { running, limit: limits.running });
    busy = true;
    return false;
  };

  const nakFailed = async (msg: JsMsg, ref: string, period: number | null, failed: Failed) => {
    msg.nak(config.nakMs);
    log("start-failed", { ref, exit: failed.exit, cause: failed.cause, retryMs: config.nakMs });
    if (period === null) return;
    tookAnswer(await easel.failed(`${ref}:${period}`, failed.cause, config.nakMs), "failed");
  };

  const start = async (msg: JsMsg, request: DesignRequest, ref: string) => {
    const workspace = await paseo.workspaceOf(config.workspaceDir);
    if (workspace.kind === "failed") return nakFailed(msg, ref, request.period, workspace);

    const started = await paseo.run({
      title: agentTitle(request),
      prompt: agentPrompt(request),
      cwd: config.workspaceDir,
      workspace: workspace.value,
      provider: config.provider,
      mode: config.mode,
      env: { EASEL_CONFIG_HOME: config.easelConfig },
      labels: { ...designLabel, "easel-request": ref },
    });
    if (started.kind === "failed") return nakFailed(msg, ref, request.period, started);

    const starts = countStart(config.stateDir, utcDay());
    msg.ack();
    log("started", {
      ref,
      agent: started.value.agentId,
      title: agentTitle(request),
      period: request.period,
      starts,
    });
    tookAnswer(await easel.started(`${ref}:${request.period}`, started.value.agentId), "started");
    reportedAt = 0;
  };

  const handle = async (msg: JsMsg) => {
    const parsed = parseRequest(msg.data);
    if (parsed.kind === "malformed") {
      msg.term(parsed.cause);
      log("malformed", { subject: msg.subject, seq: msg.seq, cause: parsed.cause });
      return;
    }

    const ref = requestRef(parsed.request);
    const same = await paseo.agents({ ...designLabel, "easel-request": ref });
    if (same.kind === "failed") return nakFailed(msg, ref, null, same);

    const live = same.value.find(isActive);
    if (!live) return start(msg, parsed.request, ref);
    msg.ack();
    log("repeat", { ref, agent: live.id, period: parsed.request.period });
  };

  const step = async (): Promise<Step> => {
    const day = utcDay();
    const today = startsOn(config.stateDir, day);
    const listed = await paseo.agents(designLabel);
    if (listed.kind === "failed") {
      log("paseo-failed", { call: "ls", exit: listed.exit, cause: listed.cause });
      return "wait";
    }
    const running = listed.value.filter(isActive).length;
    await reportState(running, today);
    if (!underDayLimit(day, today)) return "wait";
    if (!underRunLimit(running)) return "wait";

    const msg = await consumer.next({ expires: Math.max(config.pollMs, minimumExpiresMs) });
    if (msg) await handle(msg);
    return "fetched";
  };

  const safeStep = async (): Promise<Step> => {
    try {
      return await step();
    } catch (error) {
      log("step-failed", { cause: error instanceof Error ? error.message : String(error) });
      return "wait";
    }
  };

  return async (stopped: () => boolean) => {
    while (!stopped()) {
      if ((await safeStep()) === "wait") await Bun.sleep(config.pollMs);
    }
  };
}
