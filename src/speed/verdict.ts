import { operation } from "@tinkered/core";
import { z } from "zod";

import { budget, hotItem } from "./budget";

// The logic of the speed gate (SPEC-speed.md § The design 3 and 4): the stats of a step's runs,
// its verdict against its budget and the base, and the findings of the hot path list. The script
// `scripts/speed.ts` is the thin host around them.

const runs = z.array(z.number()).min(1);

/** p50 and p95 of a step's runs by nearest rank, and the longest. */
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

/**
 * A step's verdict: over its budget; else more than `alert` over the base's value (an alert, not
 * a failure); else in time. The value is the stat that the budget is of.
 */
export const speedVerdict = operation({
  label: "speed.verdict",
  input: z.object({ runs, base: runs.optional(), budget, alert: z.number() }),
  depends: { speedStats },
  run: ({ speedStats }, { input }) => {
    const now = speedStats.run({ input: input.runs });
    const value = now[input.budget.of];
    const told = { value, p50: now.p50, p95: now.p95 };
    if (value > input.budget.ms) {
      return { kind: "overBudget", ...told, budget: input.budget.ms } as const;
    }

    const base = input.base ? speedStats.run({ input: input.base })[input.budget.of] : undefined;
    if (base !== undefined && value > base * (1 + input.alert)) {
      return { kind: "slowerThanBase", ...told, base } as const;
    }

    return { kind: "inTime", ...told } as const;
  },
});

const seenItem = hotItem.pick({ kind: true, name: true });

/**
 * The findings of the hot path list: each item that came before `easel:open` and is not on the
 * list, then each item of the list with no reason. Each says what to do.
 */
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
