// The speed run (SPEC-speed.md § The design 2): the time of each step of the critical path, on
// the BUILT binary, in a real Chromium, against the budgets of speed.json.
//
// It builds the binary, starts it with a new database, and seeds a canvas of 20 frames through
// MCP over HTTP, as an agent does. Then it measures, 7 times each:
//   open    from the start of the share link's load to the page's mark `easel:open` (warm: the
//           browser has the files; one cold run, with an empty cache, is only reported).
//   change  from the answer of an agent's put to the mark `easel:change:<id>:<version>` in an
//           open tab.
// One line for each step: p50, p95, the budget and the verdict. The exit is 1 when a step is over
// its budget. Chromium has the flags of docs/canvas-speed.md "How to measure".
//
// Usage: bun scripts/speed.ts [--no-build]   (bun run speed; on vibea2: offload -- bun run speed)

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createScope } from "@tinkered/core";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { z } from "zod";

import { speedFile } from "@/speed/budget";
import { speedVerdict } from "@/speed/verdict";

const root = join(import.meta.dir, "..");
const runs = 7;
const frames = 20;

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

const budgets = speedFile.parse(JSON.parse(readFileSync(join(root, "speed.json"), "utf8")));

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

if (!process.argv.includes("--no-build")) {
  for (const script of ["build:client", "build:server"]) {
    const built = Bun.spawnSync(["bun", "run", script], { cwd: root, stdout: "ignore" });
    if (built.exitCode !== 0) throw new Error(`speed: bun run ${script} failed`);
  }
}

const dir = mkdtempSync(join(tmpdir(), "easel-speed-"));
const probe = Bun.serve({ port: 0, fetch: () => new Response() });
const port = probe.port;
await probe.stop(true);
const base = `http://127.0.0.1:${port}`;
const log = join(dir, "server.log");

const server = Bun.spawn([join(root, "dist/server"), "serve"], {
  env: {
    ...process.env,
    BUILD: "1",
    PORT: String(port),
    PUBLIC_ORIGIN: base,
    NODE_ENV: "production",
    EASEL_DB: join(dir, "easel.db"),
    EASEL_CHROMIUM: chromiumPath,
    OTEL_SERVICE_NAME: "easel-speed",
  },
  stdout: Bun.file(log),
  stderr: Bun.file(log),
});

const browser = await chromium.launch({ executablePath: chromiumPath, args: flags });

try {
  await up();
  const token = signIn();
  const mcp = tools(token);
  const seeded = await seed(mcp);
  const warm = await browser.newContext({ viewport });

  // A first open draws each picture and fills the cache; it is not measured.
  const first = await warm.newPage();
  await first.goto(seeded.link);
  await markOf(first, "easel:open", 60_000);
  await first.close();

  const open: number[] = [];
  for (let i = 0; i < runs; i++) open.push(await openTime(await warm.newPage(), seeded.link));
  const cold = await browser.newContext({ viewport });
  const coldOpen = await openTime(await cold.newPage(), seeded.link);
  await cold.close();

  const tab = await warm.newPage();
  await tab.goto(seeded.link);
  await markOf(tab, "easel:open", 30_000);
  const shown = await tab.evaluate(() => ({
    live: document.querySelectorAll("iframe.e-doc").length,
    zoom: document.querySelector("output[aria-label=Zoom]")?.textContent ?? "",
  }));
  const id = await centreFrame(tab);
  const change: number[] = [];
  let version = seeded.versions.get(id) ?? 1;
  for (let i = 0; i < runs; i++) {
    const put = await mcp("put_frame", {
      canvas: seeded.canvas,
      id,
      base: version,
      html: doc(id, i + 2),
    });
    version = z.object({ version: z.number() }).parse(put.answer).version;
    const at = await markOf(tab, `easel:change:${id}:${version}`, 10_000);
    change.push(at - put.at);
  }

  console.log(
    `speed: ${frames} frames, ${shown.live} live at Fit (zoom ${shown.zoom}), ${viewport.width}x${viewport.height}, ${chromiumPath}`,
  );
  const scope = createScope();
  const steps = [
    { step: "open", runs: open, budget: budgets.budgets.open },
    { step: "change", runs: change, budget: budgets.budgets.change },
  ];
  let over = false;
  for (const s of steps) {
    const v = scope.run(speedVerdict, { input: { ...s, alert: budgets.alert } });
    over ||= v.kind === "overBudget";
    console.log(
      `speed: ${s.step.padEnd(6)} ${frames} frames  p50 ${ms(v.p50)}  p95 ${ms(v.p95)}  budget ${ms(s.budget.ms)} (${s.budget.of})  ${v.kind}`,
    );
  }
  console.log(`speed: open   ${frames} frames  cold ${ms(coldOpen)}  (report only)`);
  await scope.close();
  process.exitCode = over ? 1 : 0;
} finally {
  await browser.close();
  server.kill();
  await server.exited;
  rmSync(dir, { recursive: true, force: true });
}

function ms(n: number) {
  return `${Math.round(n)} ms`.padStart(7);
}

/** The server answers /api/health, in 30 s at most (a busy host has taken over 10 s). */
async function up() {
  for (let i = 0; i < 300; i++) {
    const ok = await fetch(`${base}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await Bun.sleep(100);
  }
  throw new Error(`speed: the server did not start (log: ${log})`);
}

/** The first owner signs in with the setup code of the log; its token is in its hosts file. */
function signIn() {
  const code = /setup code: (\S+)/.exec(readFileSync(log, "utf8"))?.[1];
  if (!code) throw new Error("speed: no setup code in the server log");

  const home = join(dir, "home");
  const login = Bun.spawnSync(
    [join(root, "dist/server"), "login", base, "--name", "speed", "--setup", code],
    {
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      stdout: "ignore",
    },
  );
  if (login.exitCode !== 0) throw new Error("speed: easel login --setup failed");

  const hosts = readFileSync(join(home, ".config/easel/hosts.json"), "utf8");
  const token = /"token":\s*"([^"]+)"/.exec(hosts)?.[1];
  if (!token) throw new Error("speed: no token in the hosts file");

  return token;
}

/** One MCP tool call over HTTP: its answer, and the time that the answer came. */
function tools(token: string) {
  let n = 0;
  return async (name: string, args: Record<string, unknown>) => {
    const response = await fetch(`${base}/mcp`, {
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

/** A canvas of `frames` frames, and its share link. */
async function seed(mcp: ReturnType<typeof tools>) {
  const made = await mcp("create_canvas", { name: "Speed" });
  const canvas = z.object({ key: z.string() }).parse(made.answer).key;

  const versions = new Map<string, number>();
  for (let i = 0; i < frames; i++) {
    const put = await mcp("put_frame", { canvas, html: doc(`s${i}`, 1), name: `Screen ${i + 1}` });
    const frame = z.object({ id: z.string(), version: z.number() }).parse(put.answer);
    versions.set(frame.id, frame.version);
  }
  const shared = await mcp("share_canvas", { canvas });
  const path = z.object({ path: z.string() }).parse(shared.answer).path;
  return { canvas, versions, link: `${base}${path}` };
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

/** One open of the link in a new page: from the start of its load to `easel:open`. */
async function openTime(page: Page, link: string) {
  await page.goto(link);
  await markOf(page, "easel:open", 30_000);
  const time = await page.evaluate(
    () => performance.getEntriesByName("easel:open", "mark")[0]?.startTime ?? 0,
  );
  await page.close();
  return time;
}

/** The id of the frame nearest the centre of the view: it is live at Fit when any frame is. */
async function centreFrame(page: Page) {
  return page.evaluate(() => {
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    const shells = [...document.querySelectorAll<HTMLElement>(".e-shell[data-id]")];
    const near = shells
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.dataset.id ?? "",
          d: Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy),
        };
      })
      .sort((a, b) => a.d - b.d);
    return near[0]?.id ?? "";
  });
}
