import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { speedFile } from "@/speed/budget";
import { hotPathFindings, speedStats, speedVerdict } from "@/speed/verdict";

// SPEC-speed.md § The design 3 and 4: the verdict of each step (its value against its budget, then
// against the base), and the findings of the hot path list. `speed.json` holds the budgets.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function scope() {
  const app = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => app.close());
  return app;
}

const open = { ms: 2000, of: "p50" } as const;

test("the stats of a step's runs: p50 and p95 by nearest rank, and the longest", async () => {
  const app = await scope();
  const runs = [700, 100, 300, 500, 200, 600, 400];

  expect(app.run(speedStats, { input: runs })).toEqual({ p50: 400, p95: 700, max: 700 });
  expect(app.run(speedStats, { input: [9] })).toEqual({ p50: 9, p95: 9, max: 9 });
});

test("a step is in time, over its budget, or slower than the base by more than the alert; over the budget comes first", async () => {
  const app = await scope();
  const verdict = (runs: number[], base?: number[]) =>
    app.run(speedVerdict, { input: { runs, base, budget: open, alert: 0.1 } });

  expect(verdict([900, 1000, 1100])).toEqual({ kind: "inTime", value: 1000, p50: 1000, p95: 1100 });
  expect(verdict([1000, 1090], [1000, 1000])).toMatchObject({ kind: "inTime", value: 1000 });
  expect(verdict([2100, 2200, 2300])).toEqual({
    kind: "overBudget",
    value: 2200,
    budget: 2000,
    p50: 2200,
    p95: 2300,
  });
  expect(verdict([1300, 1300], [1000, 1100])).toEqual({
    kind: "slowerThanBase",
    value: 1300,
    base: 1000,
    p50: 1300,
    p95: 1300,
  });
  expect(verdict([2100], [1000])).toMatchObject({ kind: "overBudget" });

  // The pan's budget is of its longest frame.
  const pan = { ms: 100, of: "max" } as const;
  const panned = app.run(speedVerdict, {
    input: { runs: [16, 17, 120], budget: pan, alert: 0.1 },
  });
  expect(panned).toMatchObject({ kind: "overBudget", value: 120, budget: 100 });
});

test("the hot path: an item that loads before easel:open and is not on the list is a finding, and so is an item of the list with no reason", async () => {
  const app = await scope();
  const list = [
    { kind: "request", name: "/assets/index.js", reason: "The canvas draws with it." },
    { kind: "request", name: "/assets/index.css", reason: " " },
  ] as const;
  const seen = [
    { kind: "request", name: "/assets/index.js" },
    { kind: "request", name: "/assets/index.css" },
    { kind: "longTask", name: "longtask at 120 ms, 64 ms" },
  ] as const;

  expect(app.run(hotPathFindings, { input: { seen: [...seen], list: [...list] } })).toEqual([
    {
      kind: "notListed",
      text: "longTask longtask at 120 ms, 64 ms comes before easel:open and is not on the hot path list. Fix: do it after easel:open, or add it to speed.json with its reason.",
    },
    {
      kind: "noReason",
      text: "speed.json: request /assets/index.css has no reason. Fix: say why the first view needs it.",
    },
  ]);
  expect(
    app.run(hotPathFindings, { input: { seen: seen.slice(0, 1), list: list.slice(0, 1) } }),
  ).toEqual([]);
});

test("speed.json holds the budgets of SPEC-speed, the alert of 10%, and the hot path list", async () => {
  const read = speedFile.parse(await Bun.file(new URL("../speed.json", import.meta.url)).json());

  expect(read.budgets).toEqual({
    open: { ms: 2000, of: "p50" },
    change: { ms: 1000, of: "p50" },
    ask: { ms: 1000, of: "p50" },
    pan: { ms: 100, of: "max" },
  });
  expect(read.alert).toBe(0.1);
  expect(read.hotPath).toEqual([]);
});
