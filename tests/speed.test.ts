import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { speedFile } from "@/speed/budget";
import { panRuns, speedRuns } from "@/speed/settings";
import {
  comparedStat,
  hotName,
  hotPathFindings,
  normalTail,
  slowerByChance,
  speedGate,
  speedStats,
  speedVerdict,
} from "@/speed/verdict";

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
const pan = { ms: 100, of: "max" } as const;
const oneEach = (runs: number[]) => runs.map((ms) => [ms]);

const panFrames = (from: number, last: number) => [
  ...Array.from({ length: 18 }, () => from),
  ...Array.from({ length: 18 }, () => from + 1),
  from + 2,
  from + 2,
  from + 2,
  last,
];

test("the stats of a step's runs: p50 and p95 by nearest rank, and the longest", async () => {
  const app = await scope();
  const runs = [700, 100, 300, 500, 200, 600, 400];

  expect(app.run(speedStats, { input: runs })).toEqual({ p50: 400, p95: 700, max: 700 });
  expect(app.run(speedStats, { input: [9] })).toEqual({ p50: 9, p95: 9, max: 9 });
});

test("a step is in time, over its budget, or slower than the base by more than the alert and the floor; over the budget comes first", async () => {
  const app = await scope();
  const verdict = (runs: number[], base?: number[]) =>
    app.run(speedVerdict, {
      input: {
        runs: oneEach(runs),
        base: base && oneEach(base),
        budget: open,
        alert: 0.1,
        floor: 0.05,
      },
    });
  const five = (ms: number) => [ms, ms, ms, ms, ms];

  expect(verdict([900, 1000, 1100])).toEqual({ kind: "inTime", value: 1000, p50: 1000, p95: 1100 });
  expect(verdict([1000, 1090], [1000, 1000])).toMatchObject({ kind: "inTime", value: 1000 });
  expect(verdict([2100, 2200, 2300])).toEqual({
    kind: "overBudget",
    value: 2200,
    budget: 2000,
    p50: 2200,
    p95: 2300,
  });
  expect(verdict([1300, 1310, 1320, 1330, 1340], [1000, 1010, 1020, 1030, 1040])).toEqual({
    kind: "slowerThanBase",
    value: 1320,
    tree: 1320,
    base: 1020,
    p50: 1320,
    p95: 1340,
  });
  expect(verdict([2100], [1000])).toMatchObject({ kind: "overBudget" });
  expect(verdict(five(62), five(54))).toMatchObject({ kind: "inTime", value: 62 });
  expect(verdict(five(1150), five(1049))).toMatchObject({ kind: "inTime" });
  expect(verdict(five(1200), five(1050))).toMatchObject({ kind: "slowerThanBase", base: 1050 });

  const panned = app.run(speedVerdict, {
    input: { runs: [[16, 17, 120]], budget: pan, alert: 0.1, floor: 0.05 },
  });
  expect(panned).toMatchObject({ kind: "overBudget", value: 120, budget: 100 });
});

test("too few runs on a side cannot prove a step slower than the base, however far apart the two sides are", async () => {
  const app = await scope();
  const verdict = (runs: number[], base: number[]) =>
    app.run(speedVerdict, {
      input: { runs: oneEach(runs), base: oneEach(base), budget: open, alert: 0.1, floor: 0.05 },
    });

  expect(verdict([1300, 1300], [1000, 1100])).toMatchObject({ kind: "inTime", value: 1300 });
  expect(verdict([1200], [1050])).toMatchObject({ kind: "inTime" });
  expect(verdict([1300, 1310, 1320, 1330], [1000, 1010, 1020, 1030])).toMatchObject({
    kind: "inTime",
  });
});

test("the stat compared with the base is the p50 for a p50 budget, and the p95 for a p95 or a max budget, never the longest run", async () => {
  const app = await scope();
  const runs = [
    700, 100, 300, 500, 200, 600, 400, 900, 800, 1000, 950, 980, 970, 960, 990, 940, 930, 920, 910,
    5000,
  ];
  const compared = (of: "p50" | "p95" | "max") => app.run(comparedStat, { input: { runs, of } });

  expect(compared("p50")).toBe(910);
  expect(compared("p95")).toBe(1000);
  expect(compared("max")).toBe(1000);
});

test("a pan with a long last frame under its budget is in time when its p95 is that of the base", async () => {
  const app = await scope();
  const verdict = (runs: number[][], base: number[][]) =>
    app.run(speedVerdict, { input: { runs, base, budget: pan, alert: 0.1, floor: 0.05 } });
  const fiveOf = (run: number[]) => [run, run, run, run, run];
  const base = fiveOf(panFrames(16, 20));

  expect(verdict([...fiveOf(panFrames(16, 20)).slice(1), panFrames(16, 42)], base)).toEqual({
    kind: "inTime",
    value: 42,
    p50: 17,
    p95: 18,
  });
  expect(verdict(fiveOf(panFrames(26, 42)), base)).toEqual({
    kind: "slowerThanBase",
    value: 42,
    tree: 28,
    base: 18,
    p50: 27,
    p95: 28,
  });
});

test("the frames of one pan run are not independent: one slow run of the tree in five is no proof that the tree is slower", async () => {
  const app = await scope();
  const run = panFrames(16, 20);
  const slowRun = Array.from({ length: run.length }, () => 40);
  const input = {
    runs: [run, run, run, run, slowRun],
    base: [run, run, run, run, run],
    budget: pan,
    alert: 0.1,
    floor: 0.05,
  };

  expect(app.run(speedVerdict, { input })).toEqual({ kind: "inTime", value: 40, p50: 17, p95: 40 });
  expect(
    app.run(slowerByChance, { input: { tree: input.runs.flat(), base: input.base.flat() } }),
  ).toBeLessThan(0.01);
});

test("the default count of runs can prove a step slower: the smallest chance of speedRuns against speedRuns, and of panRuns against panRuns, is below 0.01", async () => {
  const app = await scope();
  const smallestChance = (count: number) => {
    const base = Array.from({ length: count }, (_, i) => i);
    return app.run(slowerByChance, { input: { tree: base.map((ms) => ms + count), base } });
  };

  expect(smallestChance(app.resolve(speedRuns))).toBeLessThan(0.01);
  expect(smallestChance(app.resolve(panRuns))).toBeLessThan(0.01);
});

test("runs of the tree that overlap the runs of the base are in time, also when the p50 of the tree is far above that of the base", async () => {
  const app = await scope();
  const change = { ms: 1000, of: "p50" } as const;
  const runs = [140, 190, 257, 280, 320];
  const base = [150, 180, 191, 260, 300];
  const input = {
    runs: oneEach(runs),
    base: oneEach(base),
    budget: change,
    alert: 0.1,
    floor: 0.05,
  };

  expect(app.run(speedVerdict, { input })).toEqual({
    kind: "inTime",
    value: 257,
    p50: 257,
    p95: 320,
  });
  expect(app.run(slowerByChance, { input: { tree: runs, base } })).toBeCloseTo(106 / 252, 12);
});

test("the chance that the tree is slower than the base only by chance: exact for small samples, with ties", async () => {
  const app = await scope();
  const chance = (tree: number[], base: number[]) =>
    app.run(slowerByChance, { input: { tree, base } });

  expect(chance([1300, 1310, 1320, 1330, 1340], [1000, 1010, 1020, 1030, 1040])).toBeCloseTo(
    1 / 252,
    12,
  );
  expect(chance([1000, 1010, 1020, 1030, 1040], [1300, 1310, 1320, 1330, 1340])).toBe(1);
  expect(chance([10, 20, 20, 30, 40], [5, 20, 25, 8, 9])).toBeCloseTo(18 / 252, 12);
  expect(chance([5, 5, 5, 5, 5], [5, 5, 5, 5, 5])).toBe(1);
  expect(chance([2], [1])).toBe(0.5);
});

test("the chance that the tree is slower than the base only by chance: the normal approximation with a tie correction for large samples", async () => {
  const app = await scope();
  const chance = (tree: number[], base: number[]) =>
    app.run(slowerByChance, { input: { tree, base } });
  const base = Array.from({ length: 30 }, (_, i) => i + 1);
  const shifted = base.map((ms) => ms + 10.5);

  expect(chance(shifted, base)).toBeCloseTo(0.0000623853, 6);
  expect(chance(base, shifted)).toBeGreaterThan(0.999);
  expect(
    chance(
      Array.from({ length: 30 }, () => 17),
      Array.from({ length: 30 }, () => 17),
    ),
  ).toBe(1);
  expect(
    chance(
      Array.from({ length: 30 }, () => 18),
      Array.from({ length: 30 }, () => 17),
    ),
  ).toBeLessThan(1e-6);
  expect(app.run(normalTail, { input: 0 })).toBeCloseTo(0.5, 6);
  expect(app.run(normalTail, { input: 1.6449 })).toBeCloseTo(0.0499952, 6);
  expect(app.run(normalTail, { input: -1.6449 })).toBeCloseTo(0.9500048, 6);
});

test("the gate is red when a step is over its budget or the hot path list has a finding, an alert when a step is only slower than the base, else green", async () => {
  const app = await scope();
  const gate = (steps: Array<"inTime" | "overBudget" | "slowerThanBase">, findings = 0) =>
    app.run(speedGate, { input: { steps, findings } });

  expect(gate(["inTime", "inTime"])).toEqual({ kind: "green" });
  expect(gate(["inTime", "slowerThanBase"])).toEqual({ kind: "alert" });
  expect(gate(["slowerThanBase", "overBudget"])).toEqual({ kind: "red" });
  expect(gate(["inTime", "slowerThanBase"], 1)).toEqual({ kind: "red" });
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

test("a request's name on the hot path list: its path, with each picture as one name and the hash of a built file as *", async () => {
  const app = await scope();
  const name = (url: string) => app.run(hotName, { input: url });

  expect(name("http://127.0.0.1:4000/assets/index-SEn1SACi.js")).toBe("/assets/index-*.js");
  expect(name("http://127.0.0.1:4000/assets/index-BwLHzdJv.css")).toBe("/assets/index-*.css");
  expect(name("http://127.0.0.1:4000/assets/extra-a_B-9xYz.js")).toBe("/assets/extra-*.js");
  expect(name("http://127.0.0.1:4000/assets/vendor-DiWcC4GS.js")).toBe("/assets/vendor-*.js");
  expect(name("http://127.0.0.1:4000/assets/rolldown-runtime-CbXtAM7H.js")).toBe(
    "/assets/rolldown-runtime-*.js",
  );
  expect(name("http://127.0.0.1:4000/api/pictures/home/75847ac7f859/1?s=0.5&k=u-e5&kit=1")).toBe(
    "/api/pictures/*",
  );
  expect(name("http://127.0.0.1:4000/api/telemetry")).toBe("/api/telemetry");
  expect(name("http://127.0.0.1:4000/api/fonts/geist/Geist-Regular.woff2")).toBe(
    "/api/fonts/geist/Geist-Regular.woff2",
  );
});

test("speed.json holds the budgets of SPEC-speed and of one move handler of a pan, the alert of 10% with its floor, and the hot path list", async () => {
  const read = speedFile.parse(await Bun.file(new URL("../speed.json", import.meta.url)).json());

  expect(read.budgets).toEqual({
    open: { ms: 2000, of: "p50" },
    change: { ms: 1000, of: "p50" },
    ask: { ms: 1000, of: "p50" },
    pan: { ms: 100, of: "max" },
    panHandler: { ms: 8, of: "p95" },
  });
  expect(read.alert).toBe(0.1);
  expect(read.floor).toBe(0.05);
  expect(read.hotPath.map((item) => `${item.kind} ${item.name}`)).toEqual([
    "request /assets/index-*.js",
    "request /assets/vendor-*.js",
    "request /assets/rolldown-runtime-*.js",
    "request /assets/index-*.css",
    "request /api/pictures/*",
    "request /api/fonts/inter-5.3.0/inter-latin-wght-normal.woff2",
  ]);
  const app = await scope();
  expect(app.run(hotPathFindings, { input: { seen: [], list: read.hotPath } })).toEqual([]);
});
