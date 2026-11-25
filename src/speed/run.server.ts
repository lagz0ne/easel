import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { capsule, operation } from "@tinkered/core";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { z } from "zod";

import { speedArgs } from "./args";
import { speedFile } from "./budget";
import { coldOpen, localChromium, throttledOpen } from "./page.server";
import {
  budgetTests,
  chromiumFlags,
  panMs,
  panRuns,
  speedEnv,
  speedOutput,
  speedRoot,
  speedRuns,
  speedViewport,
  startMs,
} from "./settings";
import { baseTree, buildTree, startSide, stopSide } from "./side.server";
import type { Side } from "./side.server";
import { measureStep, msTexts, overBudget, rowLine, speedSteps } from "./steps.server";
import { hotName, hotPathFindings, speedGate } from "./verdict";

export const speedBudgets = operation({
  label: "speed.budgets",
  depends: { root: speedRoot },
  run: ({ root }) => speedFile.parse(JSON.parse(readFileSync(join(root, "speed.json"), "utf8"))),
});

export const serverBudgets = operation({
  label: "speed.serverBudgets",
  depends: { root: speedRoot, command: budgetTests, env: speedEnv, output: speedOutput },
  run: ({ root, command, env, output }) => {
    const ran = Bun.spawnSync(command, {
      cwd: root,
      env: { ...env, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const text = `${ran.stdout.toString()}${ran.stderr.toString()}`;
    const said = text.split("\n").filter((line) => line.startsWith("speed: "));

    const verdict = ran.exitCode === 0 ? ("inTime" as const) : ("overBudget" as const);
    const tail = verdict === "overBudget" ? [text.trimEnd().split("\n").slice(-60).join("\n")] : [];

    const last = `speed: server budgets (${command.slice(2).join(" ")})  ${verdict}`;
    output.write([...said, ...tail, last].map((line) => `${line}\n`).join(""));
    return verdict;
  },
});

const openNotes = operation({
  label: "speed.openNotes",
  input: z.object({ browser: z.custom<Browser>(), link: z.string() }),
  depends: { coldOpen, throttledOpen, msTexts },
  run: async (deps, { input }) => {
    const cold = await deps.coldOpen.run({ input });
    const longest = Math.max(0, ...cold.frames);
    const throttled = await deps.throttledOpen.run({ input });
    const [open, long, slow] = deps.msTexts.run({ input: [cold.open, longest, throttled] });

    const notes = [
      `open   20 frames  cold ${open}`,
      `before easel:open: ${cold.frames.length} long frames, the longest ${long}`,
      `open   20 frames  4x CPU, 40 ms round trip ${slow}`,
    ];
    return { notes, requests: cold.requests };
  },
});

const measuredLines = operation({
  label: "speed.measuredLines",
  input: z.object({
    sides: z.custom<readonly Side[]>(),
    browser: z.custom<Browser>(),
    budgets: z.custom<z.infer<typeof speedFile>>(),
    gate: z.boolean(),
  }),
  depends: { measureStep, overBudget, rowLine, output: speedOutput },
  run: async (deps, { input: { sides, browser, budgets, gate } }) => {
    const verdicts: Array<"inTime" | "overBudget" | "slowerThanBase"> = [];
    const lines: string[] = [];
    const alerts: string[] = [];
    const notes: string[] = [];

    for (const step of speedSteps) {
      const { rows } = step;
      let measured = await deps.measureStep.run({ input: { step, sides, browser } });
      if (deps.overBudget.run({ input: { rows, got: measured.got, budgets } })) {
        const names = rows.map((row) => `${row.step} at ${row.frames} frames`).join(", ");
        deps.output.write(`speed: ${names} is over its budget; it runs once again\n`);
        measured = await deps.measureStep.run({ input: { step, sides, browser } });
      }

      notes.push(...measured.notes);
      for (const row of rows) {
        const one = deps.rowLine.run({ input: { row, got: measured.got, budgets, gate } });
        verdicts.push(one.verdict);
        lines.push(one.line);
        if (one.alert) alerts.push(one.alert);
      }
    }

    return { verdicts, lines, alerts, notes };
  },
});

const hotPathLines = operation({
  label: "speed.hotPathLines",
  input: z.object({
    requests: z.array(z.string()),
    budgets: z.custom<z.infer<typeof speedFile>>(),
  }),
  depends: { hotName, hotPathFindings },
  run: (deps, { input: { requests, budgets } }) => {
    const seen = [...new Set(requests.map((url) => deps.hotName.run({ input: url })))];
    const findings = deps.hotPathFindings.run({
      input: { seen: seen.map((name) => ({ kind: "request", name })), list: budgets.hotPath },
    });
    const lines = [
      ...findings.map((finding) => `speed: ${finding.text}`),
      `speed: before easel:open: ${seen.join(", ")}`,
    ];
    return { lines, findings: findings.length };
  },
});

const sidesOf = operation({
  label: "speed.sidesOf",
  input: z.object({
    browser: z.custom<Browser>(),
    work: z.string(),
    base: z.string().nullable(),
    chromium: z.string(),
  }),
  depends: { startSide, root: speedRoot },
  run: async ({ startSide, root }, { input: { browser, work, base, chromium } }) => {
    const [based, tree] = await Promise.all([
      base ? startSide.run({ input: { browser, name: "base", dir: base, work, chromium } }) : null,
      startSide.run({ input: { browser, name: "tree", dir: root, work, chromium } }),
    ]);
    return based ? [based, tree] : [tree];
  },
});

const speedTrees = operation({
  label: "speed.trees",
  input: z.object({
    build: z.boolean(),
    gate: z.boolean(),
    base: z.string().optional(),
    baseDir: z.string().optional(),
    work: z.string(),
  }),
  depends: { baseTree, buildTree, root: speedRoot },
  run: ({ baseTree, buildTree, root }, { input }) => {
    const { gate, base: sha, baseDir: dir, work } = input;
    if (gate && !sha && !dir) {
      throw new Error("speed: --gate needs --base <sha> or --base-dir <dir>");
    }

    const base = gate ? baseTree.run({ input: { root, work, sha, dir } }) : null;
    if (input.build) buildTree.run({ input: { dir: root, packages: false } });
    if (base) buildTree.run({ input: { dir: base, packages: true } });
    return base;
  },
});

const speedReport = operation({
  label: "speed.report",
  input: z.object({
    sides: z.custom<readonly Side[]>(),
    browser: z.custom<Browser>(),
    budgets: z.custom<z.infer<typeof speedFile>>(),
    gate: z.boolean(),
    chromium: z.string(),
  }),
  depends: {
    openNotes,
    measuredLines,
    hotPathLines,
    serverBudgets,
    speedGate,
    viewport: speedViewport,
    output: speedOutput,
  },
  run: async (deps, { input: { sides, browser, budgets, gate, chromium } }) => {
    const tree = sides.at(-1);
    if (!tree) throw new Error("speed: no tree");

    const opened = await deps.openNotes.run({ input: { browser, link: tree.small.link } });
    const measured = await deps.measuredLines.run({ input: { sides, browser, budgets, gate } });
    const notes = [...opened.notes, ...measured.notes];
    const hot = deps.hotPathLines.run({ input: { requests: opened.requests, budgets } });
    const { width, height } = deps.viewport;
    const lines = [
      `speed: ${width}x${height}, ${chromium}`,
      ...notes.filter((n) => n.includes("live")).map((n) => `speed: ${n}`),
      ...measured.lines,
      ...notes.filter((n) => !n.includes("live")).map((n) => `speed: ${n}  (report only)`),
      ...hot.lines,
    ];
    deps.output.write(lines.map((line) => `${line}\n`).join(""));

    const steps = [...measured.verdicts, deps.serverBudgets.run()];
    const verdict = deps.speedGate.run({ input: { steps, findings: hot.findings } }).kind;
    const alert = `speed: alert, slower than the base by more than ${budgets.alert * 100}% and ${budgets.floor * 100}% of the budget: ${measured.alerts.join("; ")}\n`;
    if (verdict === "alert") deps.output.write(alert);
    deps.output.write(`speed: ${gate ? "gate" : "run"} ${verdict}\n`);
    return { verdict };
  },
});

export const speedRun = operation({
  label: "speed.run",
  input: z.object({
    build: z.boolean(),
    gate: z.boolean(),
    base: z.string().optional(),
    baseDir: z.string().optional(),
  }),
  depends: {
    speedBudgets,
    speedTrees,
    sidesOf,
    speedReport,
    stopSide,
    localChromium,
    flags: chromiumFlags,
  },
  run: async (deps, { input }) => {
    const budgets = deps.speedBudgets.run();
    const work = mkdtempSync(join(tmpdir(), "easel-speed-"));
    const base = deps.speedTrees.run({ input: { ...input, work } });

    const executablePath = deps.localChromium.run();
    const browser = await chromium.launch({ executablePath, args: deps.flags });
    const sides: Side[] = [];
    try {
      const at = { browser, chromium: executablePath };
      sides.push(...(await deps.sidesOf.run({ input: { ...at, work, base } })));
      return await deps.speedReport.run({ input: { ...at, sides, budgets, gate: input.gate } });
    } finally {
      await browser.close();
      for (const side of sides) await deps.stopSide.run({ input: side });
      rmSync(work, { recursive: true, force: true });
    }
  },
});

export const speed = capsule({
  label: "speed",
  config: {
    root: speedRoot,
    output: speedOutput,
    env: speedEnv,
    runs: speedRuns,
    panRuns,
    panMs,
    startMs,
    viewport: speedViewport,
    flags: chromiumFlags,
    budgetTests,
  },
  exports: { speedArgs, speedRun, serverBudgets },
});
