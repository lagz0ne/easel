import { data, remoteData } from "@tinkered/core";
import { z } from "zod";

export const projectName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/, "1 to 40 of A-Z, a-z, 0-9, space, ., _ and -");

export const siteMeta = { mode: "easel-auth", project: "easel-project" } as const;

export const homeRow = z.object({
  canvas: z.string(),
  name: z.string(),
  frames: z.number(),
  pages: z.number(),
  changed: z.number(),
  inbox: z.number(),
});

export type HomeRow = z.infer<typeof homeRow>;

export const homeRows = data({
  label: "home.rows",
  mode: "keyed",
  parse: homeRow,
  key: (row) => ({ canvas: row.canvas }),
});

export const waitingCode = z.object({
  code: z.string(),
  name: z.string(),
  since: z.number(),
  expiresAt: z.number(),
  browser: z.boolean(),
  user: z.boolean(),
});

export type WaitingCode = z.infer<typeof waitingCode>;

export const waitingCodes = data({
  label: "home.codes",
  mode: "keyed",
  parse: waitingCode,
  key: (row) => ({ code: row.code }),
});

export const homeBoard = remoteData({ rows: homeRows });

export const codesBoard = remoteData({ codes: waitingCodes });
