import { tag } from "@tinkered/core";
import { z } from "zod";

const positive = z.number().int().positive();

const day = 24 * 60 * 60_000;

export const accessDefaults = {
  codeLife: 10 * 60_000,
  waitMax: 50_000,
  linkLife: 5 * 60_000,
  cookieLifeSeconds: 400 * 24 * 60 * 60,
  maxFormBytes: 4096,
  idleLife: 30 * day,
  usedStep: 60 * 60_000,
  keepEnded: day,
  limits: {
    "login.start": 5,
    "login.setup": 5,
    "login.wait": 30,
    "browser.start": 5,
    "browser.wait": 30,
    "browser.peek": 30,
  },
  maxPending: { all: 20, address: 3 },
} as const;

export const codeLife = tag({
  label: "access.codeLife",
  default: accessDefaults.codeLife,
  parse: positive,
});

export const waitMax = tag({
  label: "access.waitMax",
  default: accessDefaults.waitMax,
  parse: positive,
});

export const linkLife = tag({
  label: "access.linkLife",
  default: accessDefaults.linkLife,
  parse: positive,
});

export const cookieLifeSeconds = tag({
  label: "access.cookieLifeSeconds",
  default: accessDefaults.cookieLifeSeconds,
  parse: positive,
});

export const maxFormBytes = tag({
  label: "access.maxFormBytes",
  default: accessDefaults.maxFormBytes,
  parse: positive,
});

export const idleLife = tag({
  label: "access.idleLife",
  default: accessDefaults.idleLife,
  parse: positive,
});

export const usedStep = tag({
  label: "access.usedStep",
  default: accessDefaults.usedStep,
  parse: positive,
});

export const keepEnded = tag({
  label: "access.keepEnded",
  default: accessDefaults.keepEnded,
  parse: positive,
});

export const callLimits = tag({
  label: "access.callLimits",
  default: accessDefaults.limits,
  parse: z.object({
    "login.start": positive,
    "login.setup": positive,
    "login.wait": positive,
    "browser.start": positive,
    "browser.wait": positive,
    "browser.peek": positive,
  }),
});

export const maxPending = tag({
  label: "access.maxPending",
  default: accessDefaults.maxPending,
  parse: z.object({ all: positive, address: positive }),
});
