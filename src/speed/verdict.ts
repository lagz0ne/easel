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

export const comparedOf = operation({
  label: "speed.comparedOf",
  input: budget.shape.of,
  run: (_, { input: of }) => (of === "p50" ? "p50" : "p95"),
});

export const comparedStat = operation({
  label: "speed.comparedStat",
  input: z.object({ runs, of: budget.shape.of }),
  depends: { speedStats, comparedOf },
  run: ({ speedStats, comparedOf }, { input }) =>
    speedStats.run({ input: input.runs })[comparedOf.run({ input: input.of })],
});

const rankGroups = operation({
  label: "speed.rankGroups",
  input: z.object({ tree: runs, base: runs }),
  run: (_, { input: { tree, base } }) => {
    const inTree = new Map<number, number>();
    const inAll = new Map<number, number>();
    for (const ms of tree) inTree.set(ms, (inTree.get(ms) ?? 0) + 1);
    for (const ms of [...tree, ...base]) inAll.set(ms, (inAll.get(ms) ?? 0) + 1);

    let below = 0;
    return [...inAll.keys()]
      .sort((a, b) => a - b)
      .map((ms) => {
        const size = inAll.get(ms) ?? 0;
        const twiceRank = 2 * below + size + 1;
        below += size;
        return { twiceRank, size, inTree: inTree.get(ms) ?? 0 };
      });
  },
});

export const normalTail = operation({
  label: "speed.normalTail",
  input: z.number(),
  run: (_, { input: score }) => {
    const x = Math.abs(score) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const terms = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
    const sum = terms.reduceRight((acc, a) => (acc + a) * t, 0);
    const erfcOfX = sum * Math.exp(-x * x);

    return score >= 0 ? erfcOfX / 2 : 1 - erfcOfX / 2;
  },
});

const exactRankChance = operation({
  label: "speed.exactRankChance",
  input: z.object({ tree: runs, base: runs }),
  depends: { rankGroups },
  run: ({ rankGroups }, { input }) => {
    const n = input.tree.length;
    const groups = rankGroups.run({ input });
    const twiceRanks = groups.flatMap((g) => Array.from({ length: g.size }, () => g.twiceRank));
    const width = twiceRanks.reduce((sum, rank) => sum + rank, 0) + 1;
    const ways = new Float64Array((n + 1) * width);
    ways[0] = 1;

    twiceRanks.forEach((rank, before) => {
      for (let k = Math.min(before + 1, n); k >= 1; k--) {
        for (let s = width - 1; s >= rank; s--) {
          ways[k * width + s] =
            (ways[k * width + s] ?? 0) + (ways[(k - 1) * width + s - rank] ?? 0);
        }
      }
    });

    const observed = groups.reduce((sum, g) => sum + g.inTree * g.twiceRank, 0);
    const ofTree = ways.subarray(n * width);
    const atLeast = ofTree.subarray(observed).reduce((sum, w) => sum + w, 0);
    return atLeast / ofTree.reduce((sum, w) => sum + w, 0);
  },
});

const normalRankChance = operation({
  label: "speed.normalRankChance",
  input: z.object({ tree: runs, base: runs }),
  depends: { rankGroups, normalTail },
  run: ({ rankGroups, normalTail }, { input }) => {
    const n = input.tree.length;
    const m = input.base.length;
    const all = n + m;
    const groups = rankGroups.run({ input });
    const rankSum = groups.reduce((sum, g) => sum + (g.inTree * g.twiceRank) / 2, 0);
    const u = rankSum - (n * (n + 1)) / 2;

    const ties = groups.reduce((sum, g) => sum + g.size ** 3 - g.size, 0);
    const variance = ((n * m) / 12) * (all + 1 - ties / (all * (all - 1)));
    if (variance <= 0) return 1;

    return normalTail.run({ input: (u - (n * m) / 2 - 0.5) / Math.sqrt(variance) });
  },
});

const exactUpTo = 40;

export const slowerByChance = operation({
  label: "speed.slowerByChance",
  input: z.object({ tree: runs, base: runs }),
  depends: { exactRankChance, normalRankChance },
  run: ({ exactRankChance, normalRankChance }, { input }) =>
    input.tree.length + input.base.length <= exactUpTo
      ? exactRankChance.run({ input })
      : normalRankChance.run({ input }),
});

const slowerBelowChance = 0.01;

const eachRun = z.array(runs).min(1);

export const speedVerdict = operation({
  label: "speed.verdict",
  input: z.object({
    runs: eachRun,
    base: eachRun.optional(),
    budget,
    alert: z.number(),
    floor: z.number(),
  }),
  depends: { speedStats, comparedStat, slowerByChance },
  run: (deps, { input }) => {
    const all = input.runs.flat();
    const now = deps.speedStats.run({ input: all });
    const value = now[input.budget.of];
    const told = { value, p50: now.p50, p95: now.p95 };
    if (value > input.budget.ms) {
      return { kind: "overBudget", ...told, budget: input.budget.ms } as const;
    }
    if (!input.base) return { kind: "inTime", ...told } as const;

    const { of } = input.budget;
    const tree = deps.comparedStat.run({ input: { runs: all, of } });
    const base = deps.comparedStat.run({ input: { runs: input.base.flat(), of } });
    const clearlyMore =
      tree - base >= input.budget.ms * input.floor && tree > base * (1 + input.alert);
    const ranks = {
      tree: input.runs.map((run) => deps.comparedStat.run({ input: { runs: run, of } })),
      base: input.base.map((run) => deps.comparedStat.run({ input: { runs: run, of } })),
    };
    if (clearlyMore && deps.slowerByChance.run({ input: ranks }) < slowerBelowChance) {
      return { kind: "slowerThanBase", ...told, tree, base } as const;
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
