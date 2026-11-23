// The speed run (SPEC-speed.md § The design 2): the time of each step of the critical path, on
// the BUILT binary, in a real Chromium, against the budgets of speed.json.
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
// One line for each step: p50, p95, the budget and the verdict. The exit is 1 when a step is over
// its budget. Chromium has the flags of docs/canvas-speed.md "How to measure".
//
// Usage: bun scripts/speed.ts [--no-build]   (bun run speed; on vibea2: offload -- bun run speed)

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createScope } from "@tinkered/core";
import { chromium } from "playwright";
import type { BrowserContext, Page } from "playwright";
import { z } from "zod";

import { speedFile } from "@/speed/budget";
import { speedVerdict } from "@/speed/verdict";

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
  const mcp = tools(signIn());
  const scope = createScope();
  const rows: Row[] = [];
  const notes: string[] = [];

  // 20 frames: open (warm, cold, throttled), change at Fit and on a live document, ask.
  const small = await seed(mcp, "Speed 20", 20);
  const warm = await browser.newContext({ viewport });
  await warmUp(warm, small.link, 60_000);
  rows.push({ step: "open", frames: 20, runs: await opens(warm, small.link, runs) });
  const cold = await browser.newContext({ viewport });
  notes.push(`open   20 frames  cold ${ms((await opens(cold, small.link, 1))[0] ?? 0)}`);
  await cold.close();
  const slow = await browser.newContext({ viewport });
  notes.push(
    `open   20 frames  4x CPU, 40 ms round trip ${ms(await throttledOpen(slow, small.link))}`,
  );
  await slow.close();

  const tab = await opened(warm, small.link);
  notes.push(await shownAt(tab, "20 frames at Fit"));
  rows.push({ step: "change", frames: 20, runs: await changes(tab, mcp, small) });
  await zoomTo(tab, 40);
  notes.push(await shownAt(tab, "20 frames zoomed in"));
  rows.push({ step: "change", frames: 20, where: "live", runs: await changes(tab, mcp, small) });
  await tab.close();
  rows.push({ step: "ask", frames: 20, runs: await asks(warm, small.link) });
  await warm.close();

  // 200 frames: open, change at Fit, and the pan.
  const big = await seed(mcp, "Speed 200", 200);
  const many = await browser.newContext({ viewport });
  await warmUp(many, big.link, 300_000);
  rows.push({ step: "open", frames: 200, runs: await opens(many, big.link, runs) });
  const wide = await opened(many, big.link);
  notes.push(await shownAt(wide, "200 frames at Fit"));
  rows.push({ step: "change", frames: 200, runs: await changes(wide, mcp, big) });
  await zoomTo(wide, 40);
  notes.push(await shownAt(wide, "200 frames for the pan"));
  const panned = await pans(wide);
  rows.push({ step: "pan", frames: 200, runs: panned.frames });
  rows.push({ step: "panHandler", frames: 200, runs: panned.handlers });
  await many.close();

  console.log(`speed: ${viewport.width}x${viewport.height}, ${chromiumPath}`);
  for (const note of notes.filter((n) => n.includes("live"))) console.log(`speed: ${note}`);
  let over = false;
  for (const row of rows) {
    const budget = budgets.budgets[row.step];
    const v = scope.run(speedVerdict, { input: { runs: row.runs, budget, alert: budgets.alert } });
    over ||= v.kind === "overBudget";

    const name = `${row.step}${row.where ? ` ${row.where}` : ""}`.padEnd(11);
    const stat = budget.of === "max" ? `  max ${ms(v.value)}` : "";
    console.log(
      `speed: ${name} ${String(row.frames).padStart(3)} frames  p50 ${ms(v.p50)}  p95 ${ms(v.p95)}${stat}  budget ${ms(budget.ms)} (${budget.of})  ${v.kind}`,
    );
  }
  for (const note of notes.filter((n) => !n.includes("live"))) {
    console.log(`speed: ${note}  (report only)`);
  }
  await scope.close();
  process.exitCode = over ? 1 : 0;
} finally {
  await browser.close();
  server.kill();
  await server.exited;
  rmSync(dir, { recursive: true, force: true });
}

/** A time in ms: one decimal below 10 ms (a move's handler), else whole. */
function ms(n: number) {
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ms`.padStart(7);
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

type Row = {
  step: "open" | "change" | "ask" | "pan" | "panHandler";
  frames: number;
  where?: string;
  runs: number[];
};

type Seeded = Awaited<ReturnType<typeof seed>>;

/** A canvas of `n` frames, put one by one as an agent does, and its share link. */
async function seed(mcp: ReturnType<typeof tools>, name: string, n: number) {
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

/** One open with 4x CPU and a 40 ms round trip (Chrome DevTools' throttles), for the report. */
async function throttledOpen(context: BrowserContext, link: string) {
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
  await page.close();
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

/**
 * `runs` puts of the frame nearest the centre of the view, each when the last one showed: from
 * the answer of the put to `easel:change:<id>:<version>` in the page.
 */
async function changes(page: Page, mcp: ReturnType<typeof tools>, canvas: Seeded) {
  const id = await centreFrame(page);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const version = canvas.versions.get(id) ?? 1;
    const put = await mcp("put_frame", {
      canvas: canvas.canvas,
      id,
      base: version,
      html: doc(id, version + 1),
    });
    const next = z.object({ version: z.number() }).parse(put.answer).version;
    canvas.versions.set(id, next);
    times.push((await markOf(page, `easel:change:${id}:${next}`, 10_000)) - put.at);
  }
  return times;
}

/**
 * `runs` requests that a viewer sends in one tab, each at a frame of its own, while another tab
 * of the canvas is open: from the click on Send (the event's time) to `easel:ask:<id>` in the
 * other tab. A first request gives the name, and is not measured.
 */
async function asks(context: BrowserContext, link: string) {
  const [sender, watcher] = [await opened(context, link), await opened(context, link)];
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

  const times: number[] = [];
  for (let i = 0; i <= runs; i++) {
    const before = await askMarks(watcher);
    await sender.getByRole("button", { name: "Request", exact: true }).click();
    await sender.getByRole("group", { name: `Screen ${i + 1}`, exact: true }).click();
    await sender.getByRole("textbox", { name: "Request" }).fill(`Make screen ${i + 1} blue.`);
    await sender.getByRole("button", { name: "Send" }).click();
    if (i === 0) {
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
    if (i > 0) times.push(shown - sent);
    await sender.keyboard.press("Escape");
  }

  await sender.close();
  await watcher.close();
  return times;
}

/** The count of the marks `easel:ask:*` in a page. */
async function askMarks(page: Page) {
  return page.evaluate(
    () =>
      performance.getEntriesByType("mark").filter((m) => m.name.startsWith("easel:ask:")).length,
  );
}

/**
 * `runs` pans of 2 s across the row, one move each animation frame, as the browser tests pan:
 * the time of each frame (between two animation frames), and of each move's handler.
 */
async function pans(page: Page) {
  const frames: number[] = [];
  const handlers: number[] = [];
  for (let i = 0; i < runs; i++) {
    const one = await page.evaluate(
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

        const times: { frames: number[]; handlers: number[] } = { frames: [], handlers: [] };
        const start = performance.now();
        let last = start;
        while (performance.now() - start < 2_000) {
          await new Promise((done) => requestAnimationFrame(done));
          const now = performance.now();
          times.frames.push(now - last);
          last = now;

          at.x += dx;
          const t0 = performance.now();
          send("pointermove");
          times.handlers.push(performance.now() - t0);
        }
        send("pointerup");

        return times;
      },
      { dx: i % 2 === 0 ? -10 : 10 },
    );
    frames.push(...one.frames);
    handlers.push(...one.handlers);
    await page.waitForTimeout(500);
  }
  return { frames, handlers };
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
