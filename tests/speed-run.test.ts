import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterAll, expect, test } from "vite-plus/test";

import { speed } from "@/speed/run.server";
import { rowVerdict } from "@/speed/steps.server";
import type { Budgets } from "@/speed/steps.server";

const folder = mkdtempSync(join(tmpdir(), "speed-run-"));
const fake = join(import.meta.dirname, "support/fake-easel-server.ts");

const budgets: Budgets & { hotPath: never[] } = {
  alert: 0.1,
  floor: 0.05,
  budgets: {
    open: { ms: 60_000, of: "p50" },
    change: { ms: 60_000, of: "p50" },
    ask: { ms: 60_000, of: "p50" },
    pan: { ms: 60_000, of: "max" },
    panHandler: { ms: 60_000, of: "p95" },
  },
  hotPath: [],
};

const fakeTree = (name: string) => {
  const dir = join(folder, name);
  mkdirSync(join(dir, "dist"), { recursive: true });
  const server = join(dir, "dist/server");
  writeFileSync(server, `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`);
  chmodSync(server, 0o755);

  writeFileSync(join(dir, "speed.json"), JSON.stringify(budgets));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, scripts: { "build:client": "true", "build:server": "true" } }),
  );

  return dir;
};

const said: string[] = [];
const output = { write: (text: string) => said.push(text) };
const tree = fakeTree("tree");
const base = fakeTree("base");

const scopeOf = (budgetTests: string[]) =>
  createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      speed({ root: tree, output, env: process.env, runs: 1, panRuns: 1, panMs: 200, budgetTests }),
    ],
  }).ready;

const scope = await scopeOf(["true"]);

afterAll(async () => {
  await scope.close();
  rmSync(folder, { recursive: true, force: true });
});

test("the speed cmd takes --no-build, --gate with --base or --base-dir, and --help", () => {
  const ask = (args: string[]) => scope.run(speed.speedArgs, { input: args });

  expect(ask([])).toEqual({ kind: "run", build: true, gate: false });
  expect(ask(["--no-build", "--gate", "--base", "abc"])).toEqual({
    kind: "run",
    build: false,
    gate: true,
    base: "abc",
  });
  expect(ask(["--gate", "--base-dir", "/b"])).toMatchObject({ kind: "run", baseDir: "/b" });
  expect(ask(["--help"])).toEqual({ kind: "help" });
  expect(ask(["--gate"])).toEqual({ kind: "wrong" });
  expect(ask(["extra"])).toEqual({ kind: "wrong" });
});

test("the gate measures each step on the base and on the tree, and a run in its budgets is green", async () => {
  said.length = 0;
  const ran = await scope.run(speed.speedRun, {
    input: { build: false, gate: true, baseDir: base },
  });
  const lines = said.join("").split("\n");

  expect(ran).toEqual({ verdict: "green" });
  for (const step of ["open", "change", "change live", "ask", "open page", "pan", "panHandler"]) {
    expect(lines.some((line) => line.startsWith(`speed: ${step.padEnd(11)}`))).toBe(true);
  }
  expect(lines.filter((line) => / base +[\d.]+ ms /.test(line))).toHaveLength(9);
  expect(lines).toContain("speed: 20 frames at Fit: 0 live, zoom 10%");
  expect(lines).toContain("speed: 20 frames zoomed in: 0 live, zoom 40%");
  expect(lines.some((line) => line.endsWith("frames drawn  (report only)"))).toBe(true);
  expect(lines).toContain("speed: before easel:open: ");
  expect(lines.at(-2)).toBe("speed: gate green");
}, 180_000);

test("the server budgets are red when their tests fail, and the run says so with the tail of the tests", async () => {
  const failing = await scopeOf(["sh", "-c", "echo 'speed: one line'; echo boom; exit 1"]);
  said.length = 0;

  expect(failing.run(speed.serverBudgets)).toBe("overBudget");
  expect(said.join("")).toContain("speed: one line\n");
  expect(said.join("")).toContain("boom");
  expect(said.join("")).toContain(
    "speed: server budgets (echo 'speed: one line'; echo boom; exit 1)  overBudget\n",
  );
  await failing.close();
});

test("a line is over its budget, slower than the base, or in time", () => {
  const row = { key: "open20", step: "open", frames: 20 } as const;
  const verdictOf = (tree: number[], base: number[]) =>
    scope.run(rowVerdict, {
      input: { row, got: { tree: { open20: tree }, base: { open20: base } }, budgets },
    }).kind;

  expect(verdictOf([70_000], [])).toBe("overBudget");
  expect(verdictOf([50_000], [1_000])).toBe("slowerThanBase");
  expect(verdictOf([1_000], [1_000])).toBe("inTime");
});
