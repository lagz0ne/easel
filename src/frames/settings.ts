import { tag } from "@tinkered/core";
import { z } from "zod";

const positive = z.number().int().positive();

export const framesDefaults = {
  opensPerMinute: 30,
  passesPerLink: 1000,
  maxWrongTries: 5,
  tryWindow: 60_000,
  lockTime: 60_000,
  drawsAtOnce: 2,
  slotWaitMs: 5_000,
  drawLimitMs: 20_000,
  proxyWaitMs: 10_000,
  proxyHeadBytes: 8 * 1024,
  frameGap: 80,
  sectionSpace: 160,
  clearance: 80,
  touchSpace: 16,
} as const;

export const opensPerMinute = tag({
  label: "frames.opensPerMinute",
  default: framesDefaults.opensPerMinute,
  parse: positive,
});

export const passesPerLink = tag({
  label: "frames.passesPerLink",
  default: framesDefaults.passesPerLink,
  parse: positive,
});

export const maxWrongTries = tag({
  label: "frames.maxWrongTries",
  default: framesDefaults.maxWrongTries,
  parse: positive,
});

export const tryWindow = tag({
  label: "frames.tryWindow",
  default: framesDefaults.tryWindow,
  parse: positive,
});

export const lockTime = tag({
  label: "frames.lockTime",
  default: framesDefaults.lockTime,
  parse: positive,
});

export const drawsAtOnce = tag({
  label: "pictures.drawsAtOnce",
  default: framesDefaults.drawsAtOnce,
  parse: positive,
});

export const slotWaitMs = tag({
  label: "pictures.slotWaitMs",
  default: framesDefaults.slotWaitMs,
  parse: positive,
});

export const drawLimitMs = tag({
  label: "pictures.drawLimitMs",
  default: framesDefaults.drawLimitMs,
  parse: positive,
});

export const proxyWaitMs = tag({
  label: "pictures.proxyWaitMs",
  default: framesDefaults.proxyWaitMs,
  parse: positive,
});

export const proxyHeadBytes = tag({
  label: "pictures.proxyHeadBytes",
  default: framesDefaults.proxyHeadBytes,
  parse: positive,
});

export const frameGap = tag({
  label: "frames.frameGap",
  default: framesDefaults.frameGap,
  parse: positive,
});

export const sectionSpace = tag({
  label: "frames.sectionSpace",
  default: framesDefaults.sectionSpace,
  parse: positive,
});

export const clearance = tag({
  label: "frames.clearance",
  default: framesDefaults.clearance,
  parse: positive,
});

export const touchSpace = tag({
  label: "frames.touchSpace",
  default: framesDefaults.touchSpace,
  parse: positive,
});
