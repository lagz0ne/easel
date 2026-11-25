import { join } from "node:path";

import { z } from "zod";

const text = z
  .string()
  .optional()
  .transform((raw) => raw?.trim() || undefined);

const aboveZero = z
  .string()
  .optional()
  .refine(
    (raw) => raw === undefined || raw === "" || (Number.isFinite(Number(raw)) && Number(raw) > 0),
    { error: (issue) => `must be a number above 0, not "${String(issue.input)}"` },
  )
  .transform((raw) => (raw === undefined || raw === "" ? undefined : Number(raw)));

export const adapterEnv = z
  .object({
    HOME: z.string().min(1),
    EASEL_PASEO_NATS_URL: text,
    EASEL_PASEO_SEED_FILE: text,
    EASEL_PASEO_INBOX: text,
    EASEL_PASEO_STREAM: text,
    EASEL_PASEO_CONSUMER: text,
    EASEL_PASEO_BIN: text,
    EASEL_PASEO_WORKSPACE_DIR: text,
    EASEL_PASEO_PROVIDER: text,
    EASEL_PASEO_MODE: text,
    EASEL_PASEO_EASEL_CONFIG: text,
    EASEL_PASEO_EASEL: text,
    EASEL_PASEO_CHANNEL: text,
    EASEL_PASEO_STATE_DIR: text,
    EASEL_PASEO_MAX_RUNNING: aboveZero,
    EASEL_PASEO_MAX_PER_DAY: aboveZero,
    EASEL_PASEO_POLL_MS: aboveZero,
    EASEL_PASEO_NAK_MS: aboveZero,
    EASEL_PASEO_PERMIT_MS: aboveZero,
    EASEL_PASEO_REPORT_MS: aboveZero,
  })
  .transform((env) => ({
    seedFile:
      env.EASEL_PASEO_SEED_FILE ?? join(env.HOME, ".config/secrets/hub-nats/easel-paseo.nk"),
    easel: env.EASEL_PASEO_EASEL,
    config: {
      url: env.EASEL_PASEO_NATS_URL,
      inbox: env.EASEL_PASEO_INBOX,
      stream: env.EASEL_PASEO_STREAM,
      consumer: env.EASEL_PASEO_CONSUMER,
      paseo: env.EASEL_PASEO_BIN,
      workspaceDir: env.EASEL_PASEO_WORKSPACE_DIR ?? join(env.HOME, "dev/easel"),
      provider: env.EASEL_PASEO_PROVIDER,
      mode: env.EASEL_PASEO_MODE,
      agentConfigHome: env.EASEL_PASEO_EASEL_CONFIG ?? join(env.HOME, ".config/easel-agent"),
      channel: env.EASEL_PASEO_CHANNEL,
      stateDir: env.EASEL_PASEO_STATE_DIR ?? join(env.HOME, ".local/state/easel-paseo-adapter"),
      maxRunning: env.EASEL_PASEO_MAX_RUNNING,
      maxPerDay: env.EASEL_PASEO_MAX_PER_DAY,
      pollMs: env.EASEL_PASEO_POLL_MS,
      nakMs: env.EASEL_PASEO_NAK_MS,
      permitMs: env.EASEL_PASEO_PERMIT_MS,
      reportMs: env.EASEL_PASEO_REPORT_MS,
    },
  }));
