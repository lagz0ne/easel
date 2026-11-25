import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { operation } from "@tinkered/core";
import { z } from "zod";

import { stateDir } from "./settings";

const startsFile = z.object({ day: z.string(), starts: z.number().int().nonnegative() });

export const utcDay = operation({
  label: "paseoAdapter.utcDay",
  run: (_, { clock }) => new Date(clock.currentTimeMillis()).toISOString().slice(0, 10),
});

export const startsOn = operation({
  label: "paseoAdapter.startsOn",
  input: z.string(),
  depends: { dir: stateDir },
  run: ({ dir }, { input: day }) => {
    const file = join(dir, "starts.json");
    if (!existsSync(file)) return 0;

    const read = startsFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return read.success && read.data.day === day ? read.data.starts : 0;
  },
});

export const countStart = operation({
  label: "paseoAdapter.countStart",
  input: z.string(),
  depends: { dir: stateDir, startsOn },
  run: ({ dir, startsOn }, { input: day }) => {
    const starts = startsOn.run({ input: day }) + 1;
    mkdirSync(dir, { recursive: true });

    const file = join(dir, "starts.json");
    writeFileSync(`${file}.next`, JSON.stringify({ day, starts }));
    renameSync(`${file}.next`, file);
    return starts;
  },
});
