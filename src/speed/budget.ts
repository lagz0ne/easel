import { z } from "zod";

// The budgets and the hot path list of the speed gate (SPEC-speed.md § Objective, § The design 4),
// as `speed.json` holds them. A budget is of a stat of a step's runs: the p50, or for `pan` the
// longest frame.

export const budget = z.object({ ms: z.number().positive(), of: z.enum(["p50", "p95", "max"]) });

/** What the page may load (`request`) or run (`longTask`) before `easel:open`, and why. */
export const hotItem = z.object({
  kind: z.enum(["request", "longTask"]),
  name: z.string(),
  reason: z.string().default(""),
});

export const speedFile = z.object({
  /** A step whose value is more than this part over the base's gives an alert (0.1: 10%). */
  alert: z.number().positive(),
  budgets: z.object({ open: budget, change: budget, ask: budget, pan: budget }),
  hotPath: z.array(hotItem),
});
