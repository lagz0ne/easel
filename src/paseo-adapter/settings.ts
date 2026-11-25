import { tag } from "@tinkered/core";
import { z } from "zod";

export declare namespace PaseoAdapter {
  type Output = { write(text: string): unknown };
}

const positive = z.number().int().positive();

export const natsUrl = tag({
  label: "paseoAdapter.natsUrl",
  default: "nats://127.0.0.1:4222",
  parse: z.string().min(1),
});

export const natsSeed = tag({ label: "paseoAdapter.natsSeed", parse: z.string().min(1) });

export const natsInbox = tag({
  label: "paseoAdapter.natsInbox",
  default: "_INBOX_easel_paseo",
  parse: z.string().min(1),
});

export const requestStream = tag({
  label: "paseoAdapter.requestStream",
  default: "EASEL_REQUESTS",
  parse: z.string().min(1),
});

export const requestConsumer = tag({
  label: "paseoAdapter.requestConsumer",
  default: "paseo",
  parse: z.string().min(1),
});

export const paseoBin = tag({
  label: "paseoAdapter.paseoBin",
  default: "paseo",
  parse: z.string().min(1),
});

export const workspaceDir = tag({ label: "paseoAdapter.workspaceDir", parse: z.string().min(1) });

export const workspaceTitle = tag({
  label: "paseoAdapter.workspaceTitle",
  default: "easel design loop",
  parse: z.string().min(1),
});

export const provider = tag({
  label: "paseoAdapter.provider",
  default: "claude",
  parse: z.string().min(1),
});

export const agentMode = tag({
  label: "paseoAdapter.agentMode",
  default: "auto",
  parse: z.string().min(1),
});

export const agentConfigHome = tag({
  label: "paseoAdapter.agentConfigHome",
  parse: z.string().min(1),
});

export const easelCommand = tag<readonly string[]>({
  label: "paseoAdapter.easelCommand",
  parse: z.array(z.string().min(1)).min(1),
});

export const channel = tag({
  label: "paseoAdapter.channel",
  default: "loop",
  parse: z.string().min(1),
});

export const stateDir = tag({ label: "paseoAdapter.stateDir", parse: z.string().min(1) });

export const maxRunning = tag({ label: "paseoAdapter.maxRunning", default: 2, parse: positive });

export const maxPerDay = tag({ label: "paseoAdapter.maxPerDay", default: 20, parse: positive });

export const pollMs = tag({ label: "paseoAdapter.pollMs", default: 5000, parse: positive });

export const nakMs = tag({ label: "paseoAdapter.nakMs", default: 60_000, parse: positive });

export const permitMs = tag({ label: "paseoAdapter.permitMs", default: 3000, parse: positive });

export const reportMs = tag({ label: "paseoAdapter.reportMs", default: 30_000, parse: positive });

export const paseoTimeoutMs = tag({
  label: "paseoAdapter.paseoTimeoutMs",
  default: 60_000,
  parse: positive,
});

export const easelTimeoutMs = tag({
  label: "paseoAdapter.easelTimeoutMs",
  default: 15_000,
  parse: positive,
});

export const causeLimit = tag({ label: "paseoAdapter.causeLimit", default: 300, parse: positive });

export const denyMessage = tag({
  label: "paseoAdapter.denyMessage",
  default:
    "No person is here: this agent runs non-interactive. Do it another way within your rights, or release the request with `easel release <claim> --reason <why>`.",
  parse: z.string().min(1),
});

export const commandEnv = tag<Readonly<Record<string, string | undefined>>>({
  label: "paseoAdapter.commandEnv",
  default: {},
});

export const adapterOutput = tag<PaseoAdapter.Output>({ label: "paseoAdapter.output" });

export const adapterExit = tag<(code: number) => void>({ label: "paseoAdapter.exit" });

export const designLabel = { "easel-loop": "design" } as const;

export const natsMinimumExpiresMs = 1000;
