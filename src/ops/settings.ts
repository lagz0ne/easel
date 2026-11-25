import { tag } from "@tinkered/core";
import { z } from "zod";

const positive = z.number().int().positive();

export const opsDefaults = {
  silentAfter: 30 * 60_000,
  checkDeadline: 5_000,
  messageCap: 1000,
  sampleCap: 5,
  buildCap: 50,
} as const;

export const silentAfter = tag({
  label: "ops.silentAfter",
  default: opsDefaults.silentAfter,
  parse: positive,
});

export const checkDeadline = tag({
  label: "ops.checkDeadline",
  default: opsDefaults.checkDeadline,
  parse: positive,
});

export const messageCap = tag({
  label: "ops.messageCap",
  default: opsDefaults.messageCap,
  parse: positive,
});

export const sampleCap = tag({
  label: "ops.sampleCap",
  default: opsDefaults.sampleCap,
  parse: positive,
});

export const buildCap = tag({
  label: "ops.buildCap",
  default: opsDefaults.buildCap,
  parse: positive,
});
