// The speed run and the speed gate (SPEC-speed.md § The design 2 and 3): the time of each step of
// the critical path, on the BUILT binary, in a real Chromium, against the budgets of speed.json.
//
// It builds the binary, starts it with a new database, and seeds a canvas of 20 frames and one of
// 200 through MCP over HTTP, as an agent does. Then it measures, 7 times each:
//   open    from the start of the share link's load to the page's mark `easel:open` (warm: the
//           browser has the files). One cold open (an empty cache) and one throttled open (4x
//           CPU, 40 ms round trip) are only reported.
//   change  from the answer of an agent's put to the mark `easel:change:<id>:<version>` in an
//           open tab: at Fit, and zoomed in on a live document.
//   ask     from the click on Send in one tab to the mark `easel:ask:<id>` in another tab.
//   pan     a 2 s pan at 40% on 200 frames: the time of each frame (its budget is of the longest),
//           and of each move's handler (`panHandler`, of the p95).
// One line for each step: p50, p95, the budget and the verdict. A step over its budget runs once
// again; if it is still over, the run is red and its exit is 1.
//
// The gate (`--gate`) also builds the base, starts it beside the tree, and measures the two in
// turn, the order swapped each run. A step more than the alert (10%) slower than the base is an
// alert: one line, and the exit stays 0. The base is a commit (`--base <sha>`, from
// `git archive`), or a directory with its files where there is no .git (`--base-dir <dir>`, as
// `offload --dir` sends). Chromium has the flags of docs/canvas-speed.md "How to measure".
//
// Usage: bun scripts/speed.ts [--no-build] [--gate --base <sha> | --gate --base-dir <dir>]
//        (bun run speed; on vibea2: offload -- bun run speed)

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createScope } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { z } from "zod";

import { speedFile } from "@/speed/budget";
import { hotName, hotPathFindings, speedGate, speedVerdict } from "@/speed/verdict";

const root = join(import.meta.dir, "..");
const runs = 7;

const flags = [
  "--enable-unsafe-swiftshader",
  "--use-angle=swiftshader",
  "--enable-gpu-rasterization",
];

const viewport = { width: 1280, height: 800 };

const toolAnswer = z.object({
  result: z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.unknown(),
      content: z.unknown(),
    })
    .optional(),
  error: z.unknown().optional(),
});

type Budgeted = "open" | "change" | "ask" | "pan" | "panHandler";

/** One line of the output: a stat of a step, at a canvas size, at a place. */
type Row = { key: string; step: Budgeted; frames: number; where?: string };

/** A step's runner on one side: one run, then the end. */
type Runner = {
  once: (i: number) => Promise<Record<string, number[]>>;
  done?: () => Promise<void>;
};

/** A step: its lines, and the runner that it makes on a side. */
type Step = { rows: Row[]; make: (side: Side) => Promise<Runner> };

type Side = Awaited<ReturnType<typeof start>>;
type Mcp = ReturnType<typeof tools>;
type Seeded = Awaited<ReturnType<typeof seed>>;

const budgets = speedFile.parse(JSON.parse(readFileSync(join(root, "speed.json"), "utf8")));

const gate = process.argv.includes("--gate");
const baseSha = argOf("--base");
const baseDir = argOf("--base-dir");

if (gate && !baseSha && !baseDir) {
  throw new Error("speed: --gate needs --base <sha> or --base-dir <dir>");
}

// The Chromium of the browser tests, found as the smoke finds it (tests/support/chromium.ts).
const found = Bun.spawnSync(
  [
    "bun",
    "-e",
    'import { localChromium } from "./tests/support/chromium"; console.log(localChromium() ?? "")',
  ],
  { cwd: root },
);

const chromiumPath = found.stdout.toString().trim();
if (!chromiumPath) throw new Error("speed: no local Chromium (bunx playwright install chromium)");

const work = mkdtempSync(join(tmpdir(), "easel-speed-"));
const baseRoot = gate ? baseTree() : null;
if (!process.argv.includes("--no-build")) build(root);
if (baseRoot) build(baseRoot);

const browser = await chromium.launch({ executablePath: chromiumPath, args: flags });
const sides: Side[] = [];
const notes: string[] = [];

try {
  if (baseRoot) sides.push(await start(browser, "base", baseRoot));
  sides.push(await start(browser, "tree", root));
  const tree = sides.at(-1);
  if (!tree) throw new Error("speed: no tree");

  const cold = await coldOpen(browser, tree.small.link);
  notes.push(`open   20 frames  cold ${ms(cold.open)}`);
  const longest = Math.max(0, ...cold.frames);
  notes.push(`before easel:open: ${cold.frames.length} long frames, the longest ${ms(longest)}`);
  notes.push(
    `open   20 frames  4x CPU, 40 ms round trip ${ms(await throttledOpen(browser, tree.small.link))}`,
  );

  const scope = createScope();
  const kinds: Array<"inTime" | "overBudget" | "slowerThanBase"> = [];
  const lines: string[] = [];
  const alerts: string[] = [];
  for (const step of steps()) {
    let got = await measure(step);
    const over = (all: typeof got) =>
      step.rows.some((row) => verdictOf(scope, row, all).kind === "overBudget");
    // A step over its budget runs once again before it counts (SPEC-speed.md § The design 3).
    if (over(got)) {
      const names = step.rows.map((row) => `${row.step} at ${row.frames} frames`).join(", ");
      console.log(`speed: ${names} is over its budget; it runs once again`);
      got = await measure(step);
    }

    for (const row of step.rows) {
      const v = verdictOf(scope, row, got);
      kinds.push(v.kind);

      const name = `${row.step}${row.where ? ` ${row.where}` : ""}`.padEnd(11);
      const stat = row.step === "pan" ? `  max ${ms(v.value)}` : "";
      const was = baseRoot ? `  base ${ms(statOf(scope, row, got.base))}` : "";
      const budget = budgets.budgets[row.step];
      lines.push(
        `speed: ${name} ${String(row.frames).padStart(3)} frames  p50 ${ms(v.p50)}  p95 ${ms(v.p95)}${stat}${was}  budget ${ms(budget.ms)} (${budget.of})  ${v.kind}`,
      );
      if (v.kind === "slowerThanBase") {
        alerts.push(
          `${name.trim()} at ${row.frames} frames: ${ms(v.value).trim()}, base ${ms(v.base).trim()}`,
        );
      }
    }
  }

  console.log(`speed: ${viewport.width}x${viewport.height}, ${chromiumPath}`);
  for (const note of notes.filter((n) => n.includes("live"))) console.log(`speed: ${note}`);
  for (const line of lines) console.log(line);
  for (const note of notes.filter((n) => !n.includes("live"))) {
    console.log(`speed: ${note}  (report only)`);
  }

  // The hot path (SPEC-speed.md § The design 4): each request before `easel:open` is on the list.
  const seen = [...new Set(cold.requests.map((url) => scope.run(hotName, { input: url })))];
  const findings = scope.run(hotPathFindings, {
    input: { seen: seen.map((name) => ({ kind: "request", name })), list: budgets.hotPath },
  });
  for (const finding of findings) console.log(`speed: ${finding.text}`);
  console.log(`speed: before easel:open: ${seen.join(", ")}`);

  const verdict = scope.run(speedGate, { input: { steps: kinds, findings: findings.length } });
  if (verdict.kind === "alert") {
    console.log(
      `speed: alert, slower than the base by more than ${budgets.alert * 100}% and ${budgets.floor * 100}% of the budget: ${alerts.join("; ")}`,
    );
  }
  console.log(`speed: ${gate ? "gate" : "run"} ${verdict.kind}`);
  await scope.close();
  process.exitCode = verdict.kind === "red" ? 1 : 0;
} finally {
  await browser.close();
  for (const side of sides) await side.stop();
  rmSync(work, { recursive: true, force: true });
}

/** The value after a flag, as `--base <sha>`. */
function argOf(flag: string) {
  const at = process.argv.indexOf(flag);
  return at < 0 ? undefined : process.argv[at + 1];
}

/** The base's files: the commit from `git archive`, or the directory that was given. */
function baseTree() {
  if (baseDir) return resolve(baseDir);
  if (!baseSha || !/^[\w./~^-]+$/.test(baseSha)) throw new Error(`speed: not a commit: ${baseSha}`);

  const tar = join(work, "base.tar");
  const archived = Bun.spawnSync([
    "git",
    "-C",
    root,
    "archive",
    "--format=tar",
    "-o",
    tar,
    baseSha,
  ]);
  if (archived.exitCode !== 0) {
    throw new Error(`speed: git archive ${baseSha} failed (no .git here? use --base-dir)`);
  }

  const dir = join(work, "base");
  Bun.spawnSync(["mkdir", "-p", dir]);
  if (Bun.spawnSync(["tar", "-xf", tar, "-C", dir]).exitCode !== 0) {
    throw new Error("speed: tar failed");
  }

  return dir;
}

/** The binary of a tree: its packages (for a base), then its client and its server. */
function build(dir: string) {
  const steps = dir === root ? [] : [["bun", "install", "--frozen-lockfile"]];
  for (const command of [
    ...steps,
    ["bun", "run", "build:client"],
    ["bun", "run", "build:server"],
  ]) {
    const built = Bun.spawnSync(command, { cwd: dir, stdout: "ignore" });
    if (built.exitCode !== 0) throw new Error(`speed: ${command.join(" ")} failed in ${dir}`);
  }
}

/** One side: its server on a new database, signed in, with its two canvases, warm. */
async function start(browser: Browser, name: "base" | "tree", dir: string) {
  const own = join(work, name);
  Bun.spawnSync(["mkdir", "-p", own]);

  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  await probe.stop(true);

  const url = `http://127.0.0.1:${port}`;
  const log = join(own, "server.log");
  const binary = join(dir, "dist/server");
  const server = Bun.spawn([binary, "serve"], {
    env: {
      ...process.env,
      BUILD: "1",
      PORT: String(port),
      PUBLIC_ORIGIN: url,
      NODE_ENV: "production",
      EASEL_DB: join(own, "easel.db"),
      EASEL_CHROMIUM: chromiumPath,
      OTEL_SERVICE_NAME: `easel-speed-${name}`,
    },
    stdout: Bun.file(log),
    stderr: Bun.file(log),
  });
  const stop = async () => {
    server.kill();
    await server.exited;
  };

  await up(url, log);
  const mcp = tools(url, signIn({ url, log, binary, home: join(own, "home") }));
  const small = await seed(mcp, url, "Speed 20", 20);
  const big = await seed(mcp, url, "Speed 200", 200);

  const warm = await browser.newContext({ viewport });
  await warmUp(warm, small.link, 60_000);
  const many = await browser.newContext({ viewport });
  await warmUp(many, big.link, 300_000);

  return { name, url, mcp, small, big, warm, many, asked: 0, stop };
}

/** The runs of a step on each side, in turn, the order swapped each run. */
async function measure(step: Step) {
  const pairs: Array<{ side: Side; runner: Runner }> = [];
  for (const side of sides) pairs.push({ side, runner: await step.make(side) });

  const got: Record<"base" | "tree", Record<string, number[]>> = { base: {}, tree: {} };
  for (let i = 0; i < runs; i++) {
    for (const { side, runner } of i % 2 === 0 ? pairs : [...pairs].reverse()) {
      keep(got[side.name], await runner.once(i));
    }
  }

  for (const { runner } of pairs) await runner.done?.();
  return got;
}

/** The values of one run, after the values of the runs before it. */
function keep(kept: Record<string, number[]>, one: Record<string, number[]>) {
  for (const [key, values] of Object.entries(one)) kept[key] = [...(kept[key] ?? []), ...values];
}

/** A line's verdict: the tree's runs against the budget, and against the base's when it runs. */
function verdictOf(
  scope: Scope.Handle,
  row: Row,
  got: Record<"base" | "tree", Record<string, number[]>>,
) {
  const base = got.base[row.key];
  return scope.run(speedVerdict, {
    input: {
      runs: got.tree[row.key] ?? [],
      base: base && base.length > 0 ? base : undefined,
      budget: budgets.budgets[row.step],
      alert: budgets.alert,
      floor: budgets.floor,
    },
  });
}

/** The stat of a line's budget, of one side's runs. */
function statOf(scope: Scope.Handle, row: Row, got: Record<string, number[]>) {
  const values = got[row.key] ?? [];
  if (values.length === 0) return 0;

  return scope.run(speedVerdict, {
    input: {
      runs: values,
      budget: budgets.budgets[row.step],
      alert: budgets.alert,
      floor: budgets.floor,
    },
  }).value;
}

/** The steps, in order. A runner opens its own tabs, and closes them at its end. */
function steps(): Step[] {
  const one = (key: string, values: number[]) => ({ [key]: values });

  return [
    {
      rows: [{ key: "open20", step: "open", frames: 20 }],
      make: async (side) => ({
        once: async () => one("open20", await opens(side.warm, side.small.link, 1)),
      }),
    },
    {
      rows: [{ key: "change20", step: "change", frames: 20 }],
      make: async (side) => {
        const tab = await opened(side.warm, side.small.link);
        if (side.name === "tree") notes.push(await shownAt(tab, "20 frames at Fit"));
        const id = await centreFrame(tab);

        return {
          once: async () => one("change20", [await change(tab, side.mcp, side.small, id)]),
          done: () => tab.close(),
        };
      },
    },
    {
      rows: [{ key: "live20", step: "change", frames: 20, where: "live" }],
      make: async (side) => {
        const tab = await opened(side.warm, side.small.link);
        await zoomTo(tab, 40);
        if (side.name === "tree") notes.push(await shownAt(tab, "20 frames zoomed in"));
        const id = await centreFrame(tab);

        return {
          once: async () => one("live20", [await change(tab, side.mcp, side.small, id)]),
          done: () => tab.close(),
        };
      },
    },
    {
      rows: [{ key: "ask20", step: "ask", frames: 20 }],
      make: async (side) => {
        const asker = await asking(side);
        return { once: async () => one("ask20", [await asker.once()]), done: asker.done };
      },
    },
    {
      rows: [{ key: "open200", step: "open", frames: 200 }],
      make: async (side) => ({
        once: async () => one("open200", await opens(side.many, side.big.link, 1)),
      }),
    },
    {
      rows: [{ key: "change200", step: "change", frames: 200 }],
      make: async (side) => {
        const tab = await opened(side.many, side.big.link);
        if (side.name === "tree") notes.push(await shownAt(tab, "200 frames at Fit"));
        const id = await centreFrame(tab);

        return {
          once: async () => one("change200", [await change(tab, side.mcp, side.big, id)]),
          done: () => tab.close(),
        };
      },
    },
    {
      rows: [
        { key: "pan200", step: "pan", frames: 200 },
        { key: "handler200", step: "panHandler", frames: 200 },
      ],
      make: async (side) => {
        const tab = await opened(side.many, side.big.link);
        await zoomTo(tab, 40);
        if (side.name === "tree") notes.push(await shownAt(tab, "200 frames for the pan"));

        return {
          once: async (i) => {
            const panned = await pan(tab, i % 2 === 0 ? -10 : 10);
            return { pan200: panned.frames, handler200: panned.handlers };
          },
          done: () => tab.close(),
        };
      },
    },
  ];
}

/** A time in ms: one decimal below 10 ms (a move's handler), else whole. */
function ms(n: number) {
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ms`.padStart(7);
}

/** The server answers /api/health, in 30 s at most (a busy host has taken over 10 s). */
async function up(url: string, log: string) {
  for (let i = 0; i < 300; i++) {
    const ok = await fetch(`${url}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await Bun.sleep(100);
  }
  throw new Error(`speed: the server did not start (log: ${log})`);
}

/** The first owner signs in with the setup code of the log; its token is in its hosts file. */
function signIn(at: { url: string; log: string; binary: string; home: string }) {
  const code = /setup code: (\S+)/.exec(readFileSync(at.log, "utf8"))?.[1];
  if (!code) throw new Error("speed: no setup code in the server log");

  const login = Bun.spawnSync([at.binary, "login", at.url, "--name", "speed", "--setup", code], {
    env: { ...process.env, HOME: at.home, XDG_CONFIG_HOME: join(at.home, ".config") },
    stdout: "ignore",
  });
  if (login.exitCode !== 0) throw new Error("speed: easel login --setup failed");

  const hosts = readFileSync(join(at.home, ".config/easel/hosts.json"), "utf8");
  const token = /"token":\s*"([^"]+)"/.exec(hosts)?.[1];
  if (!token) throw new Error("speed: no token in the hosts file");

  return token;
}

/** One MCP tool call over HTTP: its answer, and the time that the answer came. */
function tools(url: string, token: string) {
  let n = 0;
  return async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++n,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const body = toolAnswer.parse(await response.json());
    const at = Date.now();
    if (!body.result || body.result.isError) {
      throw new Error(
        `speed: ${name} failed: ${JSON.stringify(body.error ?? body.result?.content)}`,
      );
    }
    return { answer: body.result.structuredContent, at };
  };
}

/** A frame's document: a small screen of an app, with its version in its text. */
function doc(id: string, version: number) {
  return `<main style="font:16px system-ui;padding:24px;display:grid;gap:12px"><h1 style="margin:0">Screen ${id}</h1><p>Version ${version}: a list of things to do, with a form to add one.</p><ul>${Array.from({ length: 6 }, (_, i) => `<li>Item ${i + 1}</li>`).join("")}</ul><form style="display:flex;gap:8px"><input placeholder="New item"><button>Add</button></form></main>`;
}

/** A canvas of `n` frames, put one by one as an agent does, and its share link. */
async function seed(mcp: Mcp, url: string, name: string, n: number) {
  const made = await mcp("create_canvas", { name });
  const canvas = z.object({ key: z.string() }).parse(made.answer).key;

  const versions = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const put = await mcp("put_frame", { canvas, html: doc(`s${i}`, 1), name: `Screen ${i + 1}` });
    const frame = z.object({ id: z.string(), version: z.number() }).parse(put.answer);
    versions.set(frame.id, frame.version);
  }

  const shared = await mcp("share_canvas", { canvas });
  const path = z.object({ path: z.string() }).parse(shared.answer).path;
  return { canvas, versions, link: `${url}${path}` };
}

/** The time of a mark as the epoch in ms, when it comes; it waits `timeout` ms at most. */
async function markOf(page: Page, name: string, timeout: number) {
  await page.waitForFunction((n) => performance.getEntriesByName(n, "mark").length > 0, name, {
    timeout,
    polling: 10,
  });
  return page.evaluate(
    (n) => performance.timeOrigin + (performance.getEntriesByName(n, "mark")[0]?.startTime ?? 0),
    name,
  );
}

/** A page of the link, once it marked `easel:open`. */
async function opened(context: BrowserContext, link: string, timeout = 30_000) {
  const page = await context.newPage();
  await page.goto(link);
  await markOf(page, "easel:open", timeout);
  return page;
}

/** A first open draws each picture on the server and fills the cache; it is not measured. */
async function warmUp(context: BrowserContext, link: string, timeout: number) {
  await (await opened(context, link, timeout)).close();
}

/** `n` opens of the link, each in a new page: from the start of its load to `easel:open`. */
async function opens(context: BrowserContext, link: string, n: number) {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const page = await opened(context, link);
    times.push(
      await page.evaluate(
        () => performance.getEntriesByName("easel:open", "mark")[0]?.startTime ?? 0,
      ),
    );
    await page.close();
  }
  return times;
}

/**
 * One open with an empty cache, in a new browser context: its time (for the report), each request
 * that started before `easel:open` (for the hot path list), and its long animation frames before
 * it (for the report: their count moves with the load of the machine, so they fail nothing).
 */
async function coldOpen(browser: Browser, link: string) {
  const context = await browser.newContext({ viewport });
  const page = await opened(context, link);

  const seen = await page.evaluate(async () => {
    const open = performance.getEntriesByName("easel:open", "mark")[0]?.startTime ?? 0;
    const requests = performance
      .getEntriesByType("resource")
      .filter((e) => e.startTime < open)
      .map((e) => e.name);
    const frames = await new Promise<number[]>((done) => {
      const got: number[] = [];
      const watch = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.startTime < open) got.push(e.duration);
      });
      watch.observe({ type: "long-animation-frame", buffered: true });
      setTimeout(() => {
        watch.disconnect();
        done(got);
      }, 200);
    });

    return { open, requests, frames };
  });

  await context.close();
  return seen;
}

/** One open with 4x CPU and a 40 ms round trip (Chrome DevTools' throttles), for the report. */
async function throttledOpen(browser: Browser, link: string) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  await page.goto(link);
  await markOf(page, "easel:open", 60_000);
  const time = await page.evaluate(
    () => performance.getEntriesByName("easel:open", "mark")[0]?.startTime ?? 0,
  );
  await context.close();

  return time;
}

/** What the page shows: how many frames are live, and the zoom. */
async function shownAt(page: Page, what: string) {
  const shown = await page.evaluate(() => ({
    live: document.querySelectorAll("iframe.e-doc").length,
    zoom: document.querySelector("output[aria-label=Zoom]")?.textContent ?? "",
  }));
  return `${what}: ${shown.live} live, zoom ${shown.zoom}`;
}

/** Zoom in until the zoom is `pct`% or more, then the camera rests and the live frames paint. */
async function zoomTo(page: Page, pct: number) {
  const zoom = page.getByRole("status", { name: "Zoom" });
  for (let i = 0; i < 60; i++) {
    if (Number.parseFloat((await zoom.textContent()) ?? "0") >= pct) break;
    await page.getByRole("button", { name: "Zoom in" }).click();
  }
  await page.waitForFunction(() => document.querySelector(".e-card[hidden]") !== null, null, {
    timeout: 10_000,
  });
  await page.waitForTimeout(500);
}

/** One put of frame `id`: from the answer of the put to `easel:change:<id>:<version>`. */
async function change(page: Page, mcp: Mcp, canvas: Seeded, id: string) {
  const version = canvas.versions.get(id) ?? 1;
  const put = await mcp("put_frame", {
    canvas: canvas.canvas,
    id,
    base: version,
    html: doc(id, version + 1),
  });

  const next = z.object({ version: z.number() }).parse(put.answer).version;
  canvas.versions.set(id, next);
  return (await markOf(page, `easel:change:${id}:${next}`, 10_000)) - put.at;
}

/**
 * A viewer that sends requests in one tab, each at a frame of its own, while another tab of the
 * canvas is open: from the click on Send (the event's time) to `easel:ask:<id>` in the other tab.
 * Its own browser context is a new pass, under the limit of 10 calls a minute; its first request
 * gives the name, and is not measured.
 */
async function asking(side: Side) {
  const own = await browser.newContext({ viewport });
  const [sender, watcher] = [
    await opened(own, side.small.link),
    await opened(side.warm, side.small.link),
  ];
  await sender.evaluate(() =>
    document.addEventListener(
      "click",
      (event) => {
        const button = event.target instanceof Element ? event.target.closest("button") : null;
        // The composer's Send is an icon with its label; the name's Send is its text.
        const name = button?.getAttribute("aria-label") ?? button?.textContent?.trim();
        if (name === "Send") {
          Reflect.set(window, "easelSentAt", performance.timeOrigin + event.timeStamp);
        }
      },
      true,
    ),
  );

  const send = async (named: boolean) => {
    side.asked += 1;
    const frame = `Screen ${((side.asked - 1) % 20) + 1}`;
    const before = await askMarks(watcher);
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
  };

  await send(false);
  return {
    once: () => send(true),
    done: async () => {
      await watcher.close();
      await own.close();
    },
  };
}

/** The count of the marks `easel:ask:*` in a page. */
async function askMarks(page: Page) {
  return page.evaluate(
    () =>
      performance.getEntriesByType("mark").filter((m) => m.name.startsWith("easel:ask:")).length,
  );
}

/**
 * One pan of 2 s across the row, one move each animation frame, as the browser tests pan: the time
 * of each frame (between two animation frames), and of each move's handler.
 */
async function pan(page: Page, dx: number) {
  const times = await page.evaluate(
    async ({ dx }) => {
      const region = document.querySelector('[aria-label="Frames"]');
      if (!region) return { frames: [], handlers: [] };

      const at = { x: innerWidth / 2, y: innerHeight / 2 };
      const send = (type: string) =>
        region.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            button: 0,
            clientX: at.x,
            clientY: at.y,
            bubbles: true,
          }),
        );
      send("pointerdown");

      const got: { frames: number[]; handlers: number[] } = { frames: [], handlers: [] };
      const start = performance.now();
      let last = start;
      while (performance.now() - start < 2_000) {
        await new Promise((done) => requestAnimationFrame(done));
        const now = performance.now();
        got.frames.push(now - last);
        last = now;

        at.x += dx;
        const t0 = performance.now();
        send("pointermove");
        got.handlers.push(performance.now() - t0);
      }
      send("pointerup");

      return got;
    },
    { dx },
  );

  await page.waitForTimeout(500);
  return times;
}

/** The id of the frame nearest the centre of the view: it is live when any frame is. */
async function centreFrame(page: Page) {
  return page.evaluate(() => {
    const [cx, cy] = [innerWidth / 2, innerHeight / 2];
    const near = [...document.querySelectorAll<HTMLElement>(".e-shell[data-id]")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
        return { id: el.dataset.id ?? "", d };
      })
      .sort((a, b) => a.d - b.d);
    return near[0]?.id ?? "";
  });
}
