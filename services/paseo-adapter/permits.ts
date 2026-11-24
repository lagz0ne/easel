import type { Config } from "./config";
import { log } from "./log";
import { isActive } from "./paseo";
import type { Paseo, Permit } from "./paseo";

export const denyMessage =
  "No person is here: this agent runs non-interactive. Do it another way within your rights, or release the request with `easel release <claim> --reason <why>`.";

export const designLabel = { "easel-loop": "design" };

type Round = "active" | "idle";

export function permitLoop({ paseo, config }: { paseo: Paseo; config: Config }) {
  const denyOne = async (permit: Permit) => {
    const denied = await paseo.deny(permit, denyMessage);
    if (denied.kind === "failed") {
      log("deny-failed", { agent: permit.agentId, request: permit.id, cause: denied.cause });
      return;
    }
    log("denied", { agent: permit.agentId, request: permit.id, tool: permit.name });
  };

  const round = async (): Promise<Round> => {
    const listed = await paseo.agents(designLabel);
    if (listed.kind === "failed") return "idle";

    const design = new Set(listed.value.map((agent) => agent.id));
    if (!listed.value.some(isActive)) return "idle";

    const pending = await paseo.permits();
    if (pending.kind === "failed") {
      log("paseo-failed", { call: "permit ls", exit: pending.exit, cause: pending.cause });
      return "active";
    }
    for (const permit of pending.value.filter((one) => design.has(one.agentId))) {
      await denyOne(permit);
    }
    return "active";
  };

  const safeRound = async (): Promise<Round> => {
    try {
      return await round();
    } catch (error) {
      log("permit-failed", { cause: error instanceof Error ? error.message : String(error) });
      return "idle";
    }
  };

  return async (stopped: () => boolean) => {
    while (!stopped()) {
      const seen = await safeRound();
      await Bun.sleep(seen === "active" ? config.permitMs : config.pollMs);
    }
  };
}
