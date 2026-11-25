import { operation } from "@tinkered/core";
import { z } from "zod";

import { adapterLog } from "./log";
import { activeStatuses, denyPermit, listAgents, listPermits } from "./paseo";
import { denyMessage, designLabel } from "./settings";

export const denyOne = operation({
  label: "paseoAdapter.denyOne",
  input: z.object({ id: z.string(), agentId: z.string(), name: z.string() }),
  depends: { message: denyMessage, log: adapterLog, denyPermit },
  run: async ({ message, log, denyPermit }, { input: permit }) => {
    const denied = await denyPermit.run({
      input: { agentId: permit.agentId, id: permit.id, message },
    });
    if (denied.kind === "failed") {
      log.write("deny-failed", { agent: permit.agentId, request: permit.id, cause: denied.cause });
      return;
    }
    log.write("denied", { agent: permit.agentId, request: permit.id, tool: permit.name });
  },
});

export const permitRound = operation({
  label: "paseoAdapter.permitRound",
  depends: { log: adapterLog, listAgents, listPermits, denyOne },
  run: async ({ log, listAgents, listPermits, denyOne }) => {
    const listed = await listAgents.run({ input: designLabel });
    if (listed.kind === "failed") return "idle" as const;
    if (!listed.value.some((agent) => activeStatuses.has(agent.status))) return "idle" as const;

    const design = new Set(listed.value.map((agent) => agent.id));
    const pending = await listPermits.run();
    if (pending.kind === "failed") {
      log.write("paseo-failed", { call: "permit ls", exit: pending.exit, cause: pending.cause });
      return "active" as const;
    }
    for (const permit of pending.value.filter((one) => design.has(one.agentId))) {
      await denyOne.run({ input: permit });
    }
    return "active" as const;
  },
});
