import type { Consumer, JsMsg } from "@nats-io/jetstream";

import type { Config } from "./config";
import { log } from "./log";
import { isActive } from "./paseo";
import type { Failed, Paseo } from "./paseo";
import { designLabel } from "./permits";
import { agentPrompt, agentTitle, parseRequest, requestRef } from "./request";
import type { DesignRequest } from "./request";
import { countStart, startsOn, utcDay } from "./starts";

const minimumExpiresMs = 1000;

export type Adapter = { consumer: Consumer; paseo: Paseo; config: Config };

type Step = "fetched" | "wait";

export function adapterLoop({ consumer, paseo, config }: Adapter) {
  let dayLogged = "";
  let busy = false;

  const underDayLimit = (day: string) => {
    const starts = startsOn(config.stateDir, day);
    if (starts < config.maxPerDay) return true;

    if (dayLogged !== day) log("day-limit", { day, starts, limit: config.maxPerDay });
    dayLogged = day;
    return false;
  };

  const underRunLimit = async () => {
    const listed = await paseo.agents(designLabel);
    if (listed.kind === "failed") {
      log("paseo-failed", { call: "ls", exit: listed.exit, cause: listed.cause });
      return false;
    }

    const running = listed.value.filter(isActive).length;
    if (running < config.maxRunning) {
      busy = false;
      return true;
    }
    if (!busy) log("busy", { running, limit: config.maxRunning });
    busy = true;
    return false;
  };

  const nakFailed = (msg: JsMsg, ref: string, failed: Failed) => {
    msg.nak(config.nakMs);
    log("start-failed", { ref, exit: failed.exit, cause: failed.cause, retryMs: config.nakMs });
  };

  const start = async (msg: JsMsg, request: DesignRequest, ref: string) => {
    const workspace = await paseo.workspaceOf(config.workspaceDir);
    if (workspace.kind === "failed") return nakFailed(msg, ref, workspace);

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
    if (started.kind === "failed") return nakFailed(msg, ref, started);

    const starts = countStart(config.stateDir, utcDay());
    msg.ack();
    log("started", {
      ref,
      agent: started.value.agentId,
      title: agentTitle(request),
      period: request.period,
      starts,
    });
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
    if (same.kind === "failed") return nakFailed(msg, ref, same);

    const live = same.value.find(isActive);
    if (!live) return start(msg, parsed.request, ref);
    msg.ack();
    log("repeat", { ref, agent: live.id, period: parsed.request.period });
  };

  const step = async (): Promise<Step> => {
    if (!underDayLimit(utcDay())) return "wait";
    if (!(await underRunLimit())) return "wait";

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
