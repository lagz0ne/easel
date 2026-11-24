import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const startsFile = z.object({ day: z.string(), starts: z.number().int().nonnegative() });

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

const fileOf = (stateDir: string) => join(stateDir, "starts.json");

export function startsOn(stateDir: string, day: string) {
  const file = fileOf(stateDir);
  if (!existsSync(file)) return 0;

  const read = startsFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
  return read.success && read.data.day === day ? read.data.starts : 0;
}

export function countStart(stateDir: string, day: string) {
  const starts = startsOn(stateDir, day) + 1;
  mkdirSync(stateDir, { recursive: true });

  const next = `${fileOf(stateDir)}.next`;
  writeFileSync(next, JSON.stringify({ day, starts }));
  renameSync(next, fileOf(stateDir));
  return starts;
}
