import { tag } from "@tinkered/core";
import { z } from "zod";

const positive = z.number().int().positive();

export const queueDefaults = {
  roundMs: 1000,
  maxAttempts: 3,
  retryAfter: [10_000, 30_000],
  githubTimeout: 10_000,
  natsTimeout: 10_000,
  silentAfterMs: 60_000,
  perPass: 10,
  perAddress: 30,
} as const;

export const roundMs = tag({
  label: "queue.roundMs",
  default: queueDefaults.roundMs,
  parse: positive,
});

export const maxAttempts = tag({
  label: "queue.maxAttempts",
  default: queueDefaults.maxAttempts,
  parse: positive,
});

export const retryAfter = tag({
  label: "queue.retryAfter",
  default: queueDefaults.retryAfter,
  parse: z.array(positive).readonly(),
});

export const githubTimeout = tag({
  label: "queue.githubTimeout",
  default: queueDefaults.githubTimeout,
  parse: positive,
});

export const natsTimeout = tag({
  label: "queue.natsTimeout",
  default: queueDefaults.natsTimeout,
  parse: positive,
});

export const silentAfterMs = tag({
  label: "queue.silentAfterMs",
  default: queueDefaults.silentAfterMs,
  parse: positive,
});

export const perPass = tag({
  label: "queue.perPass",
  default: queueDefaults.perPass,
  parse: positive,
});

export const perAddress = tag({
  label: "queue.perAddress",
  default: queueDefaults.perAddress,
  parse: positive,
});
