import { operation } from "@tinkered/core";
import { z } from "zod";

import { budget, hotItem } from "./budget";

const runs = z.array(z.number()).min(1);

export const speedStats = operation({
  label: "speed.stats",
  input: runs,
  run: (_, { input }) => {
    const sorted = [...input].sort((a, b) => a - b);
    const [p50 = 0, p95 = 0] = [0.5, 0.95].map(
      (p) => sorted[Math.max(Math.ceil(p * sorted.length) - 1, 0)] ?? 0,
    );

    return { p50, p95, max: sorted.at(-1) ?? 0 };
  },
});

export const speedVerdict = operation({
  label: "speed.verdict",
  input: z.object({ runs, base: runs.optional(), budget, alert: z.number(), floor: z.number() }),
  depends: { speedStats },
  run: ({ speedStats }, { input }) => {
    const now = speedStats.run({ input: input.runs });
    const value = now[input.budget.of];
    const told = { value, p50: now.p50, p95: now.p95 };
    if (value > input.budget.ms) {
      return { kind: "overBudget", ...told, budget: input.budget.ms } as const;
    }

    const base = input.base ? speedStats.run({ input: input.base })[input.budget.of] : undefined;
    const seen = base !== undefined && value - base >= input.budget.ms * input.floor;
    if (base !== undefined && seen && value > base * (1 + input.alert)) {
      return { kind: "slowerThanBase", ...told, base } as const;
    }

    return { kind: "inTime", ...told } as const;
  },
});

export const speedGate = operation({
  label: "speed.gate",
  input: z.object({
    steps: z.array(z.enum(["inTime", "overBudget", "slowerThanBase"])),
    findings: z.number(),
  }),
  run: (_, { input }) => {
    if (input.steps.includes("overBudget") || input.findings > 0) return { kind: "red" } as const;
    if (input.steps.includes("slowerThanBase")) return { kind: "alert" } as const;

    return { kind: "green" } as const;
  },
});

export const hotName = operation({
  label: "speed.hotName",
  input: z.string(),
  run: (_, { input }) => {
    const path = new URL(input, "http://easel.invalid").pathname;
    if (path.startsWith("/api/pictures/")) return "/api/pictures/*";

    return path.replace(/-[\w-]{8}(?=\.\w+$)/, "-*");
  },
});

const seenItem = hotItem.pick({ kind: true, name: true });

export const hotPathFindings = operation({
  label: "speed.hotPathFindings",
  input: z.object({ seen: z.array(seenItem), list: z.array(hotItem) }),
  run: (_, { input: { seen, list } }) => {
    const listed = new Set(list.map((item) => `${item.kind} ${item.name}`));
    const notListed = seen
      .filter((item) => !listed.has(`${item.kind} ${item.name}`))
      .map((item) => ({
        kind: "notListed" as const,
        text: `${item.kind} ${item.name} comes before easel:open and is not on the hot path list. Fix: do it after easel:open, or add it to speed.json with its reason.`,
      }));
    const noReason = list
      .filter((item) => !item.reason.trim())
      .map((item) => ({
        kind: "noReason" as const,
        text: `speed.json: ${item.kind} ${item.name} has no reason. Fix: say why the first view needs it.`,
      }));

    return [...notListed, ...noReason];
  },
});
