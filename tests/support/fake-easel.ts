import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const dir = process.env.FAKE_PASEO_DIR ?? "";
const args = process.argv.slice(2);

appendFileSync(
  join(dir, "easel-calls.jsonl"),
  `${JSON.stringify({ args, configHome: process.env.EASEL_CONFIG_HOME ?? null })}\n`,
);

if (existsSync(join(dir, "easel-fail"))) {
  process.stderr.write("easel: the server cannot be reached\n");
  process.exit(1);
}

const limitsFile = join(dir, "easel-limits.json");

const limits = existsSync(limitsFile)
  ? z
      .object({ running: z.number(), perDay: z.number() })
      .parse(JSON.parse(readFileSync(limitsFile, "utf8")))
  : { running: 2, perDay: 20 };

process.stdout.write(`${JSON.stringify({ kind: "noted", limits })}\n`);
