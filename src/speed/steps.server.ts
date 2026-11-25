import { operation } from "@tinkered/core";
import type { Browser, BrowserContext, Page } from "playwright";
import { z } from "zod";

import type { budget } from "./budget";
import {
  askMarks,
  centreFrame,
  drawnOf,
  markOf,
  opened,
  opens,
  pan,
  shownAt,
  zoomTo,
} from "./page.server";
import { panMs, panRuns, speedRuns, speedViewport } from "./settings";
import { frameDoc, toolCall } from "./side.server";
import type { Seeded, Side } from "./side.server";
import { speedVerdict } from "./verdict";

export type Budgeted = "open" | "change" | "ask" | "pan" | "panHandler";

export type Row = { key: string; step: Budgeted; frames: number; where?: string };

export type Plan =
  | { kind: "open"; context: "warm" | "many"; seeded: "small" | "big" | "paged"; drawn: boolean }
  | { kind: "change"; big: boolean; zoom: boolean; what: string }
  | { kind: "ask" }
  | { kind: "pan" };

export type Step = { key: string; rows: readonly Row[]; plan: Plan };

export type Budgets = {
  alert: number;
  floor: number;
  budgets: Record<Budgeted, z.infer<typeof budget>>;
};

export type Got = Record<"base" | "tree", Record<string, number[]>>;

type Runner = {
  once: (i: number) => Promise<Record<string, number[]>>;
  done: () => Promise<unknown>;
  note: string | null;
};

export const speedSteps: readonly Step[] = [
  {
    key: "open20",
    rows: [{ key: "open20", step: "open", frames: 20 }],
    plan: { kind: "open", context: "warm", seeded: "small", drawn: false },
  },
  {
    key: "change20",
    rows: [{ key: "change20", step: "change", frames: 20 }],
    plan: { kind: "change", big: false, zoom: false, what: "20 frames at Fit" },
  },
  {
    key: "live20",
    rows: [{ key: "live20", step: "change", frames: 20, where: "live" }],
    plan: { kind: "change", big: false, zoom: true, what: "20 frames zoomed in" },
  },
  { key: "ask20", rows: [{ key: "ask20", step: "ask", frames: 20 }], plan: { kind: "ask" } },
  {
    key: "openPage",
    rows: [{ key: "openPage", step: "open", frames: 20, where: "page" }],
    plan: { kind: "open", context: "warm", seeded: "paged", drawn: true },
  },
  {
    key: "open200",
    rows: [{ key: "open200", step: "open", frames: 200 }],
    plan: { kind: "open", context: "many", seeded: "big", drawn: false },
  },
  {
    key: "change200",
    rows: [{ key: "change200", step: "change", frames: 200 }],
    plan: { kind: "change", big: true, zoom: false, what: "200 frames at Fit" },
  },
  {
    key: "pan200",
    rows: [
      { key: "pan200", step: "pan", frames: 200 },
      { key: "handler200", step: "panHandler", frames: 200 },
    ],
    plan: { kind: "pan" },
  },
];

const side = z.custom<Side>();
const page = z.custom<Page>();

export const putChange = operation({
  label: "speed.putChange",
  input: z.object({ page, side, seeded: z.custom<Seeded>(), id: z.string() }),
  depends: { toolCall, frameDoc, markOf },
  run: async ({ toolCall, frameDoc, markOf }, { input: { page, side, seeded, id } }) => {
    const version = seeded.versions.get(id) ?? 1;
    const html = frameDoc.run({ input: { id, version: version + 1 } });
    const put = await toolCall.run({
      input: {
        url: side.url,
        token: side.token,
        name: "put_frame",
        args: { canvas: seeded.canvas, id, base: version, html },
      },
    });

    const next = z.object({ version: z.number() }).parse(put.answer).version;
    seeded.versions.set(id, next);
    const name = `easel:change:${id}:${next}`;
    return (await markOf.run({ input: { page, name, timeout: 10_000 } })) - put.at;
  },
});

export type Asker = { sender: Page; watcher: Page; own: BrowserContext };

export const askOnce = operation({
  label: "speed.askOnce",
  input: z.object({ asker: z.custom<Asker>(), side, named: z.boolean() }),
  depends: { askMarks },
  run: async ({ askMarks }, { input: { asker, side, named } }) => {
    const { sender, watcher } = asker;
    side.asked += 1;
    const frame = `Screen ${((side.asked - 1) % 20) + 1}`;
    const before = await askMarks.run({ input: watcher });
    await sender.getByRole("button", { name: "Request", exact: true }).click();
    await sender.getByRole("group", { name: frame, exact: true }).click();
    await sender.getByRole("textbox", { name: "Request" }).fill(`Make ${frame} blue.`);
    await sender.getByRole("button", { name: "Send" }).click();
    if (!named) {
      await sender.getByRole("textbox", { name: "Your name" }).fill("Speed");
      await sender.getByRole("button", { name: "Send" }).click();
    }

    await watcher.waitForFunction(
      (n) =>
        performance.getEntriesByType("mark").filter((m) => m.name.startsWith("easel:ask:")).length >
        n,
      before,
      { timeout: 10_000, polling: 10 },
    );
    const shown = await watcher.evaluate(
      () =>
        performance.timeOrigin +
        (performance
          .getEntriesByType("mark")
          .filter((m) => m.name.startsWith("easel:ask:"))
          .at(-1)?.startTime ?? 0),
    );
    const sent = Number(await sender.evaluate(() => Reflect.get(window, "easelSentAt")));
    await sender.keyboard.press("Escape");
    return shown - sent;
  },
});

export const askSetup = operation({
  label: "speed.askSetup",
  input: z.object({ browser: z.custom<Browser>(), side }),
  depends: { opened, askOnce, viewport: speedViewport },
  run: async ({ opened, askOnce, viewport }, { input: { browser, side } }): Promise<Asker> => {
    const own = await browser.newContext({ viewport });
    const sender = await opened.run({ input: { context: own, link: side.small.link } });
    const watcher = await opened.run({ input: { context: side.warm, link: side.small.link } });
    await sender.evaluate(() =>
      document.addEventListener(
        "click",
        (event) => {
          const button = event.target instanceof Element ? event.target.closest("button") : null;
          const name = button?.getAttribute("aria-label") ?? button?.textContent?.trim();
          if (name === "Send") {
            Reflect.set(window, "easelSentAt", performance.timeOrigin + event.timeStamp);
          }
        },
        true,
      ),
    );

    const asker = { sender, watcher, own };
    await askOnce.run({ input: { asker, side, named: false } });
    return asker;
  },
});

const openRunner = operation({
  label: "speed.openRunner",
  input: z.object({ key: z.string(), side, plan: z.custom<Extract<Plan, { kind: "open" }>>() }),
  depends: { opens, drawnOf },
  run: async ({ opens, drawnOf }, { input: { key, side, plan } }): Promise<Runner> => {
    const context = side[plan.context];
    const link = side[plan.seeded].link;
    const note = plan.drawn ? await drawnOf.run({ input: { context, link } }) : null;
    return {
      once: async () => ({ [key]: await opens.run({ input: { context, link } }) }),
      done: async () => undefined,
      note,
    };
  },
});

const changeRunner = operation({
  label: "speed.changeRunner",
  input: z.object({
    key: z.string(),
    side,
    big: z.boolean(),
    zoom: z.boolean(),
    what: z.string(),
  }),
  depends: { opened, zoomTo, shownAt, centreFrame, putChange },
  run: async (deps, { input: { key, side, big, zoom, what } }): Promise<Runner> => {
    const seeded = big ? side.big : side.small;
    const tab = await deps.opened.run({
      input: { context: big ? side.many : side.warm, link: seeded.link },
    });
    if (zoom) await deps.zoomTo.run({ input: { page: tab, pct: 40 } });
    const note = await deps.shownAt.run({ input: { page: tab, what } });
    const id = await deps.centreFrame.run({ input: tab });

    return {
      once: async () => ({
        [key]: [await deps.putChange.run({ input: { page: tab, side, seeded, id } })],
      }),
      done: () => tab.close(),
      note,
    };
  },
});

const askRunner = operation({
  label: "speed.askRunner",
  input: z.object({ browser: z.custom<Browser>(), side }),
  depends: { askSetup, askOnce },
  run: async ({ askSetup, askOnce }, { input: { browser, side } }): Promise<Runner> => {
    const asker = await askSetup.run({ input: { browser, side } });
    return {
      once: async () => ({ ask20: [await askOnce.run({ input: { asker, side, named: true } })] }),
      done: async () => {
        await asker.watcher.close();
        await asker.own.close();
      },
      note: null,
    };
  },
});

const panRunner = operation({
  label: "speed.panRunner",
  input: side,
  depends: { opened, zoomTo, shownAt, pan, ms: panMs },
  run: async (deps, { input: side }): Promise<Runner> => {
    const tab = await deps.opened.run({ input: { context: side.many, link: side.big.link } });
    await deps.zoomTo.run({ input: { page: tab, pct: 40 } });
    const note = await deps.shownAt.run({ input: { page: tab, what: "200 frames for the pan" } });

    return {
      once: async (i) => {
        const dx = i % 2 === 0 ? -10 : 10;
        const panned = await deps.pan.run({ input: { page: tab, dx, ms: deps.ms } });
        return { pan200: panned.frames, handler200: panned.handlers };
      },
      done: () => tab.close(),
      note,
    };
  },
});

export const stepRunner = operation({
  label: "speed.stepRunner",
  input: z.object({ step: z.custom<Step>(), side, browser: z.custom<Browser>() }),
  depends: { openRunner, changeRunner, askRunner, panRunner },
  run: async (deps, { input: { step, side, browser } }): Promise<Runner> => {
    const { key, plan } = step;
    switch (plan.kind) {
      case "open":
        return deps.openRunner.run({ input: { key, side, plan } });
      case "change":
        return deps.changeRunner.run({ input: { key, side, ...plan } });
      case "ask":
        return deps.askRunner.run({ input: { browser, side } });
      case "pan":
        return deps.panRunner.run({ input: side });
    }
  },
});

type Pair = { side: Side; runner: Runner };

const measureRounds = operation({
  label: "speed.measureRounds",
  input: z.object({ pairs: z.custom<readonly Pair[]>(), count: z.number() }),
  run: async (_, { input: { pairs, count } }) => {
    const got: Got = { base: {}, tree: {} };
    for (let i = 0; i < count; i++) {
      for (const { side, runner } of i % 2 === 0 ? pairs : [...pairs].reverse()) {
        const kept = got[side.name];
        for (const [name, values] of Object.entries(await runner.once(i))) {
          kept[name] = [...(kept[name] ?? []), ...values];
        }
      }
    }
    return got;
  },
});

export const measureStep = operation({
  label: "speed.measureStep",
  input: z.object({
    step: z.custom<Step>(),
    sides: z.custom<readonly Side[]>(),
    browser: z.custom<Browser>(),
  }),
  depends: { stepRunner, measureRounds, runs: speedRuns, panRuns },
  run: async (deps, { input: { step, sides, browser } }) => {
    const pairs: Pair[] = [];
    for (const side of sides) {
      pairs.push({ side, runner: await deps.stepRunner.run({ input: { step, side, browser } }) });
    }

    const count = step.plan.kind === "pan" ? deps.panRuns : deps.runs;
    const got = await deps.measureRounds.run({ input: { pairs, count } });

    for (const { runner } of pairs) await runner.done();
    const notes = pairs.flatMap(({ side, runner }) =>
      side.name === "tree" && runner.note ? [runner.note] : [],
    );
    return { got, notes };
  },
});

export const msText = operation({
  label: "speed.msText",
  input: z.number(),
  run: (_, { input: n }) => `${n < 10 ? n.toFixed(1) : Math.round(n)} ms`.padStart(7),
});

export const msTexts = operation({
  label: "speed.msTexts",
  input: z.array(z.number()),
  depends: { msText },
  run: ({ msText }, { input }) => input.map((n) => msText.run({ input: n })),
});

export const rowVerdict = operation({
  label: "speed.rowVerdict",
  input: z.object({ row: z.custom<Row>(), got: z.custom<Got>(), budgets: z.custom<Budgets>() }),
  depends: { speedVerdict },
  run: ({ speedVerdict }, { input: { row, got, budgets } }) => {
    const base = got.base[row.key];
    return speedVerdict.run({
      input: {
        runs: got.tree[row.key] ?? [],
        base: base && base.length > 0 ? base : undefined,
        budget: budgets.budgets[row.step],
        alert: budgets.alert,
        floor: budgets.floor,
      },
    });
  },
});

export const overBudget = operation({
  label: "speed.overBudget",
  input: z.object({
    rows: z.custom<readonly Row[]>(),
    got: z.custom<Got>(),
    budgets: z.custom<Budgets>(),
  }),
  depends: { rowVerdict },
  run: ({ rowVerdict }, { input: { rows, got, budgets } }) =>
    rows.some((row) => rowVerdict.run({ input: { row, got, budgets } }).kind === "overBudget"),
});

export const baseStat = operation({
  label: "speed.baseStat",
  input: z.object({
    row: z.custom<Row>(),
    values: z.array(z.number()),
    budgets: z.custom<Budgets>(),
  }),
  depends: { speedVerdict },
  run: ({ speedVerdict }, { input: { row, values, budgets } }) => {
    if (values.length === 0) return 0;
    const { alert, floor } = budgets;
    const budget = budgets.budgets[row.step];
    return speedVerdict.run({ input: { runs: values, budget, alert, floor } }).value;
  },
});

const rowTimes = operation({
  label: "speed.rowTimes",
  input: z.object({
    row: z.custom<Row>(),
    got: z.custom<Got>(),
    budgets: z.custom<Budgets>(),
  }),
  depends: { rowVerdict, baseStat, msText },
  run: (deps, { input: { row, got, budgets } }) => {
    const v = deps.rowVerdict.run({ input: { row, got, budgets } });
    const values = got.base[row.key] ?? [];
    const was = deps.baseStat.run({ input: { row, values, budgets } });
    const base = v.kind === "slowerThanBase" ? v.base : 0;
    const budget = budgets.budgets[row.step].ms;

    const { msText } = deps;
    return {
      verdict: v.kind,
      value: msText.run({ input: v.value }),
      p50: msText.run({ input: v.p50 }),
      p95: msText.run({ input: v.p95 }),
      was: msText.run({ input: was }),
      budget: msText.run({ input: budget }),
      base: msText.run({ input: base }),
    };
  },
});

export const rowLine = operation({
  label: "speed.rowLine",
  input: z.object({
    row: z.custom<Row>(),
    got: z.custom<Got>(),
    budgets: z.custom<Budgets>(),
    gate: z.boolean(),
  }),
  depends: { rowTimes },
  run: ({ rowTimes }, { input: { row, got, budgets, gate } }) => {
    const t = rowTimes.run({ input: { row, got, budgets } });
    const name = `${row.step}${row.where ? ` ${row.where}` : ""}`.padEnd(11);
    const stat = row.step === "pan" ? `  max ${t.value}` : "";
    const was = gate ? `  base ${t.was}` : "";
    const of = budgets.budgets[row.step].of;

    const line = `speed: ${name} ${String(row.frames).padStart(3)} frames  p50 ${t.p50}  p95 ${t.p95}${stat}${was}  budget ${t.budget} (${of})  ${t.verdict}`;
    const slower = t.verdict === "slowerThanBase";
    const alert = slower
      ? `${name.trim()} at ${row.frames} frames: ${t.value.trim()}, base ${t.base.trim()}`
      : null;
    return { line, verdict: t.verdict, alert };
  },
});
