import { z } from "zod";

export const budget = z.object({ ms: z.number().positive(), of: z.enum(["p50", "p95", "max"]) });

export const hotItem = z.object({
  kind: z.enum(["request", "longTask"]),
  name: z.string(),
  reason: z.string().default(""),
});

export const speedFile = z.object({
  alert: z.number().positive(),
  floor: z.number().nonnegative(),
  budgets: z.object({ open: budget, change: budget, ask: budget, pan: budget, panHandler: budget }),
  hotPath: z.array(hotItem),
});
