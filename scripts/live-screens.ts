import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createScope } from "@tinkered/core";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { z } from "zod";

import { liveName, livePlace, livePlan } from "@/live/plan";
import { livePage, screens, statusName, takes } from "@/live/screens";
import type { Screen, Take } from "@/live/screens";
import { liveStatusHtml, liveStatusRead } from "@/live/status";
import type { LiveStatus, TakeRecord } from "@/live/status";
import { liveFindings, liveLook, liveUsed, styleProps } from "@/live/values";
import type { ElementStyle, TakeValues } from "@/live/values";

const usage = `bun scripts/live-screens.ts [--binary <file>] [--build <n>] [--commit <sha>] [--dry <dir>]

Takes each screen of src/live/screens.ts on the build of <file> (dist/server when none), in 4 takes,
on a new database with the fixture canvas "Shop redesign", and puts each take on the page Live of
product (SPEC-live-screens.md). --dry <dir> writes the takes and the status there, and puts nothing.

The writes go to EASEL_SERVER with EASEL_TOKEN when both are set, else to the hosts file of
EASEL_CONFIG_HOME (~/.config/easel-agent when not set): the member vibea-claude.
Exit: 0 when each take is new, next or same; 1 when a take failed or differs. A value that the
design system does not have is a warning here: bun run design:proof fails on it (V6).`;

const root = join(import.meta.dir, "..");
const canvas = "product";
const fixtureName = "Shop redesign";
const viewer = "Mai";
const fixturePins = 3;

const fixtureAsks = [
  {
    n: 1,
    frame: "Pricing",
    text: "Make the Team plan stand out: it is the one we want people to pick.",
    spot: { x: 0.7, y: 0.35 },
  },
  {
    n: 2,
    frame: "Pricing",
    text: "Use our brand blue on the Starter button, not the default one.",
    spot: { x: 0.25, y: 0.55 },
  },
  {
    n: 3,
    frame: "Checkout, mobile",
    text: "Add the coupon field from the old checkout.",
    spot: { x: 0.5, y: 0.3 },
  },
  {
    n: 4,
    frame: "Sign-up",
    text: "Move the sign-up button above the fold.",
    spot: { x: 0.5, y: 0.4 },
  },
];

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

const argOf = (flag: string) => {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args[at + 1];
};

const binary = resolve(argOf("--binary") ?? join(root, "dist/server"));
const build = Number(argOf("--build") ?? process.env.BUILD ?? git(["rev-list", "--count", "HEAD"]));
const commit = argOf("--commit") ?? process.env.GIT_SHA ?? git(["rev-parse", "HEAD"]);
const dryDir = argOf("--dry");
if (!Number.isInteger(build) || build < 1) throw new Error(`live-screens: not a build: ${build}`);

const fixtureEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !["EASEL_TOKEN", "EASEL_SERVER", "EASEL_CONFIG_HOME", "XDG_CONFIG_HOME"].includes(k),
  ),
);

const chromiumPath = localChromium() || chromium.executablePath();
const work = mkdtempSync(join(tmpdir(), "easel-live-"));
const scope = createScope();
const browser = await chromium.launch({ executablePath: chromiumPath });
let server: ReturnType<typeof Bun.spawn> | undefined;

function localChromium() {
  const found = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      'import { localChromium } from "./tests/support/chromium"; console.log(localChromium() ?? "")',
    ],
    { cwd: root },
  );

  return found.stdout.toString().trim();
}

function git(command: Array<string>) {
  const out = Bun.spawnSync(["git", "-C", root, ...command]);
  return out.stdout.toString().trim();
}

type Fixture = Awaited<ReturnType<typeof startFixture>>;

type Shot = {
  screen: Screen;
  take: Take;
  png: Buffer | null;
  why?: string;
  values: TakeValues | null;
};

async function freePort() {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = probe.port;
  await probe.stop(true);

  return port;
}

async function healthy(url: string) {
  for (let i = 0; i < 300; i++) {
    const ok = await fetch(`${url}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;

    await Bun.sleep(100);
  }
}

function setupLogin(url: string, log: string) {
  const code = /setup code: (\S+)/.exec(readFileSync(log, "utf8"))?.[1];
  if (!code) throw new Error(`live-screens: no setup code (log: ${log})`);

  const home = join(work, "home");
  const login = Bun.spawnSync([binary, "login", url, "--name", "claude-1", "--setup", code], {
    env: { ...fixtureEnv, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
  });
  const hosts =
    login.exitCode === 0 ? readFileSync(join(home, ".config/easel/hosts.json"), "utf8") : "";
  const token = /"token":\s*"([^"]+)"/.exec(hosts)?.[1];
  if (!token) {
    throw new Error(`live-screens: easel login --setup failed: ${login.stderr.toString()}`);
  }

  return token;
}

async function startFixture() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const log = join(work, "server.log");
  const fixtureServer = Bun.spawn([binary, "serve"], {
    env: {
      ...fixtureEnv,
      BUILD: String(build),
      PORT: String(port),
      PUBLIC_ORIGIN: url,
      NODE_ENV: "production",
      EASEL_DB: join(work, "easel.db"),
      EASEL_CHROMIUM: chromiumPath,
      OTEL_SERVICE_NAME: "easel-live-screens",
    },
    stdout: Bun.file(log),
    stderr: Bun.file(log),
  });

  await healthy(url);

  const mcp = tools(url, setupLogin(url, log));
  const made = z
    .object({ key: z.string() })
    .parse(await mcp("create_canvas", { name: fixtureName }));
  for (const frame of fixtureFrames) {
    await mcp("put_frame", { canvas: made.key, ...frame });
  }
  const shared = z
    .object({ path: z.string() })
    .parse(await mcp("share_canvas", { canvas: made.key }));
  const link = `${url}${shared.path}`;

  const setup = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await opened(setup, link);
  await playFixture(page, mcp, made.key).catch(async (error: unknown) => {
    const kept = join(process.env.RUNNER_TEMP ?? tmpdir(), "easel-live-fixture.png");
    await page.screenshot({ path: kept });
    throw new Error(`live-screens: the fixture failed (a picture is in ${kept})`, { cause: error });
  });

  const state = await setup.storageState();
  await setup.close();
  return { server: fixtureServer, link, state };
}

const page = (title: string, body: string) =>
  `<main style="font-family:var(--font-sans);padding:32px;display:grid;gap:16px;background:var(--background);color:var(--foreground)"><h1 style="margin:0">${title}</h1>${body}</main>`;

const card = (name: string, price: string) =>
  `<section style="border:1px solid var(--border);border-radius:var(--radius);padding:16px;flex:1"><h2 style="margin:0 0 8px">${name}</h2><p style="margin:0 0 16px">${price}</p><button>Choose ${name}</button></section>`;

const fixtureFrames = [
  {
    name: "Pricing",
    size: { w: 800, h: 500 },
    html: page(
      "Plans for every team",
      `<div style="display:flex;gap:16px">${card("Starter", "$12")}${card("Team", "$48")}</div>`,
    ),
  },
  {
    name: "Checkout, mobile",
    size: { w: 390, h: 640 },
    html: page("Checkout", "<label>Card number <input></label><button>Pay $48</button>"),
  },
  {
    name: "Sign-up",
    size: { w: 640, h: 480 },
    html: page("Create your account", "<label>Email <input></label><button>Sign up</button>"),
  },
];

function tools(url: string, token: string) {
  let n = 0;
  const answer = z.object({
    result: z
      .object({ isError: z.boolean().optional(), structuredContent: z.unknown() })
      .optional(),
    error: z.unknown().optional(),
  });
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
    const body = answer.parse(await response.json());
    if (!body.result || body.result.isError) {
      throw new Error(`live-screens: ${name} failed: ${JSON.stringify(body)}`);
    }
    return body.result.structuredContent;
  };
}

async function answer(mcp: ReturnType<typeof tools>, key: string, n: number, text: string) {
  const got = z.object({ claim: z.string() }).parse(await mcp("next_request", { canvas: key, n }));
  await mcp("resolve_request", { claim: got.claim, text });
}

async function opened(context: BrowserContext, link: string) {
  const tab = await context.newPage();
  await tab.goto(link);
  await markedOpen(tab);
  return tab;
}

async function markedOpen(tab: Page) {
  await tab.waitForFunction(
    () => performance.getEntriesByName("easel:open", "mark").length > 0,
    undefined,
    { timeout: 60_000 },
  );
}

async function playFixture(page: Page, mcp: ReturnType<typeof tools>, key: string) {
  for (const one of fixtureAsks) await ask(page, one);

  await answer(mcp, key, 1, "Done. The Team card has a blue border and a Most popular label.");
  await answer(mcp, key, 2, "Done. The Starter button uses the brand blue now.");

  await accept(page, 1);
  await accept(page, 2);
  await openAgain(page, "The label is too loud. Make it grey, please.");
}

async function accept(tab: Page, n: number) {
  await openRequest(tab, n);
  await tab.getByRole("button", { name: "Accept", exact: true }).click();
  await tab
    .getByRole("region", { name: `Request #${n}` })
    .getByText("accepted the result")
    .waitFor({ timeout: 10_000 });
}

async function noteSent(tab: Page, note: string) {
  const card = tab.getByRole("region", { name: "Request #2" });
  const field = tab.getByRole("textbox", { name: "Note" });
  const shown = (one: ReturnType<Page["getByText"]>) => one.isVisible().catch(() => false);
  const reopened = await shown(card.getByText("opened it again"));
  const message = await shown(card.getByText(note, { exact: true }));

  return reopened && message && !(await field.isVisible().catch(() => false));
}

async function openAgain(tab: Page, note: string) {
  for (let i = 0; i < 5; i++) {
    if (await noteSent(tab, note)) return;

    await sendNote(tab, note).catch(() => undefined);
    await tab.waitForTimeout(2_000);
  }

  if (!(await noteSent(tab, note))) throw new Error("live-screens: the note of #2 was not sent");
}

async function sendNote(tab: Page, note: string) {
  const field = tab.getByRole("textbox", { name: "Note" });
  if (!(await field.isVisible().catch(() => false))) {
    await tab.getByRole("button", { name: "Open again", exact: true }).click({ timeout: 5_000 });
  }

  await field.fill(note, { timeout: 5_000 });
  await tab.getByRole("button", { name: "Send", exact: true }).click({ timeout: 5_000 });
}

type Ask = { n: number; frame: string; text: string; spot: { x: number; y: number } };

async function ask(tab: Page, { n, frame, text, spot }: Ask) {
  await tab.getByRole("button", { name: "Request", exact: true }).click();
  const shell = tab.getByRole("group", { name: frame, exact: true });
  const box = await shell.boundingBox();
  if (!box) throw new Error(`live-screens: the frame ${frame} does not show`);

  await shell.click({ position: { x: box.width * spot.x, y: box.height * spot.y } });
  await tab.getByRole("textbox", { name: "Request" }).fill(text);
  await tab.getByRole("button", { name: "Send", exact: true }).click();

  const named = tab.getByRole("textbox", { name: "Your name" });
  const pin = tab.locator(`button.e-pin[aria-label="Request #${n}"]`);
  await named.or(pin).first().waitFor({ timeout: 10_000 });
  if (await named.isVisible()) {
    await named.fill(viewer);
    await tab.getByRole("button", { name: "Send", exact: true }).click();
  }

  await pin.waitFor({ state: "attached", timeout: 10_000 });
  await tab.reload();
  await markedOpen(tab);
  await pin.waitFor({ state: "attached", timeout: 10_000 });
}

async function openList(tab: Page) {
  const list = tab.getByRole("heading", { name: "Requests", level: 2 });
  for (let i = 0; i < 5; i++) {
    if (await list.isVisible().catch(() => false)) return;

    await tab.getByRole("button", { name: /^Requests/ }).click();
    await list.waitFor({ timeout: 3_000 }).catch(() => undefined);
  }
  await list.waitFor({ timeout: 1_000 });
}

async function openLinked(tab: Page, n: number) {
  await tab.getByRole("region", { name: `Request #${n}` }).waitFor();
}

async function openRequest(tab: Page, n: number) {
  await openList(tab);
  await tab.getByRole("button", { name: new RegExp(`#${n} `) }).click();
  await tab.getByRole("region", { name: `Request #${n}` }).waitFor();
}

async function takeAll(on: Browser, fixture: Fixture) {
  const onlyScreen = argOf("--screen");
  const onlyTake = argOf("--take");
  const chosen = screens
    .filter((s) => !onlyScreen || s.key === onlyScreen)
    .flatMap((screen) =>
      takes.filter((t) => !onlyTake || t.key === onlyTake).map((take) => ({ screen, take })),
    );
  const started = Date.now();
  const shots = await Promise.all(
    chosen.map(({ screen, take }) =>
      takeOne(on, fixture, screen, take).catch((error: unknown) => ({
        screen,
        take,
        png: null,
        values: null,
        why: error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error),
      })),
    ),
  );
  console.log(`live-screens: took ${shots.length} takes in ${Date.now() - started} ms`);

  return shots;
}

async function justNow(tab: Page) {
  const old = await tab.evaluate(() =>
    [...document.querySelectorAll(".e-rr-when, .e-when, .e-pop, .e-req")]
      .map((el) => el.textContent ?? "")
      .filter((text) => /\d+\s?(min|h|days)\b|Yesterday/.test(text)),
  );
  if (old.length > 0) {
    throw new Error(`an age is not "just now" (${old[0]?.slice(0, 60)}): the take came too late`);
  }
}

async function takeOne(on: Browser, fixture: Fixture, screen: Screen, take: Take): Promise<Shot> {
  const context = await on.newContext({
    viewport: { width: take.width, height: take.height },
    deviceScaleFactor: 1,
    isMobile: take.phone,
    hasTouch: take.phone,
    colorScheme: take.theme,
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
    storageState: fixture.state,
  });
  try {
    const tab = await context.newPage();
    const hash = screen.open.kind === "request" ? `#request-${screen.open.n}` : "";
    await tab.goto(`${fixture.link}${hash}`);
    await markedOpen(tab);
    await eachRequest(tab);

    if (screen.open.kind === "list") await openList(tab);
    else await openLinked(tab, screen.open.n);

    await settle(tab);
    await justNow(tab);
    const values = scope.run(liveUsed, { input: await stylesOf(tab) });
    const raw = await tab.screenshot({ type: "png" });
    const png = await captioned(raw, `build ${build} · ${take.key}`);

    return { screen, take, png, values: { screen: screen.key, take: take.key, ...values } };
  } catch (error) {
    const kept = join(
      process.env.RUNNER_TEMP ?? tmpdir(),
      `easel-live-${screen.key}-${take.key.replace(" ", "-")}.png`,
    );
    for (const tab of context.pages()) await tab.screenshot({ path: kept }).catch(() => undefined);

    throw error;
  } finally {
    await context.close();
  }
}

async function eachRequest(tab: Page) {
  await tab.waitForFunction(
    ({ count }) => document.querySelectorAll("button.e-pin").length >= count,
    { count: fixturePins },
    { timeout: 20_000 },
  );
}

async function settle(tab: Page) {
  await tab.mouse.move(0, 0);
  await tab.addStyleTag({ content: "*{caret-color:transparent !important}" });
  await tab.evaluate(() => document.fonts.ready.then(() => undefined));

  await tab.waitForFunction(
    () =>
      [...document.images].every((i) => {
        const box = i.getBoundingClientRect();
        const shown =
          box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
        return !shown || (i.complete && i.naturalWidth > 0);
      }),
    undefined,
    { timeout: 30_000 },
  );

  await tab.waitForLoadState("networkidle");
  await tab.waitForTimeout(400);
}

async function stylesOf(tab: Page): Promise<Array<ElementStyle>> {
  return tab.evaluate((props) => {
    const shown = (el: Element) => {
      const box = el.getBoundingClientRect();
      const inside =
        box.bottom >= 0 && box.right >= 0 && box.top <= innerHeight && box.left <= innerWidth;

      return inside && box.width > 0 && box.height > 0;
    };
    const nameOf = (el: Element) => {
      const owner = el.closest("[aria-label]")?.getAttribute("aria-label");
      const classes = el.getAttribute("class");
      const svg = el instanceof SVGElement ? el.closest("svg")?.getAttribute("class") : null;

      return [
        el.tagName.toLowerCase(),
        classes ? `.${classes.trim().split(/\s+/).join(".")}` : "",
        svg ? ` in svg.${svg}` : "",
        owner ? ` in [${owner}]` : "",
      ].join("");
    };
    const hasText = (el: Element) =>
      [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
      );
    const styleOf = (el: Element) => {
      const s = getComputedStyle(el);

      return {
        visible: s.visibility === "visible",
        style: props.map((p) => [p, s.getPropertyValue(p)]),
      };
    };
    const rows = [...document.querySelectorAll("body *")].filter(shown).map((el) => ({
      el,
      ...styleOf(el),
    }));

    return rows
      .filter((row) => row.visible)
      .map(({ el, style }) => ({
        name: nameOf(el),
        text: hasText(el),
        svg: el instanceof SVGElement && !(el instanceof SVGSVGElement),
        style: Object.fromEntries(style),
      }));
  }, styleProps);
}

async function captioned(png: Buffer, text: string) {
  const tab = await browser.newPage();
  try {
    const data = await tab.evaluate(
      async ({ src, label }) => {
        const image = await createImageBitmap(await (await fetch(src)).blob());
        const strip = 40;
        const canvasEl = document.createElement("canvas");
        canvasEl.width = image.width;
        canvasEl.height = image.height + strip;
        const pen = canvasEl.getContext("2d");
        if (!pen) throw new Error("no 2d context");

        pen.fillStyle = "#ededeb";
        pen.fillRect(0, 0, canvasEl.width, canvasEl.height);
        pen.drawImage(image, 0, 0);
        pen.fillStyle = "#61615e";
        pen.font = "13px sans-serif";
        pen.textBaseline = "middle";
        pen.fillText(label, 12, image.height + strip / 2);

        return canvasEl.toDataURL("image/png");
      },
      { src: `data:image/png;base64,${png.toString("base64")}`, label: text },
    );
    return Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
  } finally {
    await tab.close();
  }
}

async function samePixels(a: Buffer, b: Buffer) {
  if (a.equals(b)) return true;

  const tab = await browser.newPage();
  try {
    return await tab.evaluate(
      async ({ one, two }) => {
        const read = async (src: string) => {
          const image = await createImageBitmap(await (await fetch(src)).blob());
          const canvasEl = new OffscreenCanvas(image.width, image.height);
          const pen = canvasEl.getContext("2d");
          if (!pen) throw new Error("no 2d context");

          pen.drawImage(image, 0, 0);

          return pen.getImageData(0, 0, image.width, image.height).data;
        };
        const [x, y] = [await read(one), await read(two)];
        return x.length === y.length && x.every((v, i) => v === y[i]);
      },
      {
        one: `data:image/png;base64,${a.toString("base64")}`,
        two: `data:image/png;base64,${b.toString("base64")}`,
      },
    );
  } finally {
    await tab.close();
  }
}

async function dry(shots: Array<Shot>) {
  if (!dryDir) return 1;
  mkdirSync(dryDir, { recursive: true });
  for (const shot of shots) {
    if (shot.png) {
      writeFileSync(
        join(dryDir, `${shot.screen.key}-${shot.take.key.replace(" ", "-")}.png`),
        shot.png,
      );
    }
  }

  const look = await lookOfDesignSystem().catch(() => null);
  const values = shots.flatMap((s) => (s.values ? [s.values] : []));
  const findings = look ? scope.run(liveFindings, { input: { look, values } }) : [];
  const status: LiveStatus = {
    build,
    commit,
    designs: {},
    takes: shots.map((s) => ({
      screen: s.screen.key,
      take: s.take.key,
      word: s.png ? "new" : "failed",
      after: s.png ? build : null,
      before: null,
      ...(s.why ? { why: s.why } : {}),
    })),
    values,
    findings,
  };
  writeFileSync(join(dryDir, "status.html"), scope.run(liveStatusHtml, { input: status }));
  report(status, look !== null);
  return verdict(status);
}

function report(status: LiveStatus, looked: boolean) {
  for (const t of status.takes) {
    console.log(`live-screens: ${t.screen} ${t.take}: ${t.word}${t.why ? `: ${t.why}` : ""}`);
  }
  if (!looked) {
    console.log("live-screens: the look of design-system was not read: no check of the values");
  }
  for (const f of status.findings) {
    console.log(
      `live-screens: V6 ${f.screen} ${f.take}: the ${f.kind} ${f.value} is not in the design system${f.where ? ` (${f.where})` : ""}`,
    );
  }
}

function verdict(status: LiveStatus) {
  const bad = status.takes.filter((t) => t.word === "failed" || t.word === "differs").length;
  const values = status.findings.length;
  if (values > 0 && process.env.GITHUB_ACTIONS) {
    console.log(
      `::warning::${values} values of the live screens are not in the design system (V6)`,
    );
  }

  console.log(
    `live-screens: build ${status.build}: ${status.takes.length - bad} of ${status.takes.length} takes good, ${values} values not in the design system: ${bad > 0 ? "red" : "OK"}`,
  );

  return bad > 0 ? 1 : 0;
}

function easel(command: Array<string>) {
  const env: Record<string, string | undefined> = { ...process.env };
  if (!(env.EASEL_TOKEN && env.EASEL_SERVER)) {
    env.EASEL_CONFIG_HOME =
      env.EASEL_CONFIG_HOME || join(process.env.HOME ?? "", ".config/easel-agent");
  }
  const out = Bun.spawnSync([binary, ...command, "--json"], { env });
  if (out.exitCode !== 0) {
    throw new Error(
      `live-screens: easel ${command.join(" ")}: ${out.stdout.toString()}${out.stderr.toString()}`,
    );
  }
  return JSON.parse(out.stdout.toString().trim().split("\n").at(-1) ?? "null");
}

const listed = z.object({
  frames: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      page: z.string().nullable(),
      version: z.number(),
    }),
  ),
});

const written = z.object({ id: z.string(), version: z.number() });

async function lookOfDesignSystem() {
  const frames = listed.parse(easel(["ls", "design-system"])).frames;
  let css = "";
  for (const f of frames) {
    const file = join(work, `ds-${f.id}.html`);
    easel(["get", "design-system", f.id, "-o", file]);
    for (const m of readFileSync(file, "utf8").matchAll(
      /<style data-doop-tokens>([\s\S]*?)<\/style>/g,
    )) {
      css += `${m[1] ?? ""}\n`;
    }
  }
  return scope.run(liveLook, { input: css });
}

function livePageKey() {
  const pages = z.object({ pages: z.array(z.object({ key: z.string(), name: z.string() })) });
  const found = pages.parse(easel(["pages", canvas])).pages.find((p) => p.name === livePage.name);
  if (found) return found.key;
  return z.object({ key: z.string() }).parse(easel(["page", "new", canvas, livePage.name])).key;
}

function put(
  file: string,
  at: { x: number; y: number },
  name: string,
  page: string,
  frame?: { id: string; version: number },
) {
  const command = frame
    ? ["put", canvas, file, "--id", frame.id, "--base", String(frame.version)]
    : ["put", canvas, file, "--name", name, "--page", page, "--at", `${at.x},${at.y}`];
  const sized = !frame && name === statusName ? ["--size", "1440x900"] : [];

  return written.parse(easel([...command, ...sized]));
}

type Frame = z.infer<typeof listed>["frames"][number];

type Live = {
  page: string;
  frames: Array<Frame>;
  byName: Map<string, Frame>;
  old: LiveStatus | null;
};

async function readLive(): Promise<Live & { statusFrame: Frame | undefined }> {
  const page = livePageKey();
  const frames = listed.parse(easel(["ls", canvas])).frames;
  const byName = new Map(frames.filter((f) => f.page === page).map((f) => [f.name, f]));
  const statusFrame = byName.get(statusName);
  const old = statusFrame ? await oldStatus(statusFrame.id) : null;

  return { page, frames, byName, old, statusFrame };
}

async function putDesign(live: Live, designs: Record<string, number>, row: number) {
  const screen = screens[row];
  const designed = live.frames.find((f) => f.id === screen?.design.id);
  if (!screen || !designed) return;

  const name = scope.run(liveName, { input: { role: "design", design: screen.design.name } });
  const current = live.byName.get(name);
  if (current && designs[screen.design.id] === designed.version) return;

  const shotFile = join(work, `design-${screen.key}.webp`);
  easel(["shot", canvas, screen.design.id, "-o", shotFile, "--scale", "1"]);
  const png = await captioned(readFileSync(shotFile), `design v${designed.version}`);
  const file = join(work, `design-${screen.key}.png`);
  writeFileSync(file, png);

  put(file, scope.run(livePlace, { input: { role: "design", row } }), name, live.page, current);
  designs[screen.design.id] = designed.version;
}

function getFrame(frame: Frame) {
  const file = join(work, `old-${frame.id}.png`);
  easel(["get", canvas, frame.id, "-o", file]);

  return file;
}

type ShotFrames = {
  row: number;
  afterName: string;
  beforeName: string;
  afterFrame: Frame | undefined;
  beforeFrame: Frame | undefined;
  base: Omit<TakeRecord, "word">;
};

function shotFrames(live: Live, shot: Shot): ShotFrames {
  const design = shot.screen.design.name;
  const take = shot.take.key;
  const was = live.old?.takes.find((t) => t.screen === shot.screen.key && t.take === take);
  const afterName = scope.run(liveName, { input: { role: "live", design, take } });
  const beforeName = scope.run(liveName, { input: { role: "before", design, take } });
  const afterFrame = live.byName.get(afterName);
  const after = afterFrame ? (was?.after ?? null) : null;

  return {
    row: screens.indexOf(shot.screen),
    afterName,
    beforeName,
    afterFrame,
    beforeFrame: live.byName.get(beforeName),
    base: { screen: shot.screen.key, take, after, before: was?.before ?? null },
  };
}

function keepBoth(take: { screen: string; take: string }, after: Buffer, png: Buffer) {
  const stem = join(
    process.env.RUNNER_TEMP ?? tmpdir(),
    `easel-live-${take.screen}-${take.take.replace(" ", "-")}`,
  );
  writeFileSync(`${stem}-after.png`, after);
  writeFileSync(`${stem}-take.png`, png);
}

async function planOf(f: ShotFrames, png: Buffer) {
  const plan = scope.run(livePlan, { input: { build, after: f.base.after } });
  if (plan.kind !== "compare" || !f.afterFrame) return plan;

  const after = readFileSync(getFrame(f.afterFrame));
  const same = await samePixels(after, png);
  if (!same) keepBoth(f.base, after, png);

  return scope.run(livePlan, { input: { build, after: f.base.after, same } });
}

function putNext(
  live: Live,
  f: ShotFrames,
  file: string,
  at: (role: "live" | "before") => { x: number; y: number },
) {
  if (f.afterFrame) {
    put(getFrame(f.afterFrame), at("before"), f.beforeName, live.page, f.beforeFrame);
  }

  put(file, at("live"), f.afterName, live.page, f.afterFrame);
}

async function putTake(live: Live, shot: Shot): Promise<TakeRecord> {
  const f = shotFrames(live, shot);
  if (!shot.png) return { ...f.base, word: "failed", why: shot.why ?? "no picture" };

  const file = join(work, `take-${shot.screen.key}-${shot.take.key.replace(" ", "-")}.png`);
  writeFileSync(file, shot.png);
  const plan = await planOf(f, shot.png);
  const at = (role: "live" | "before") =>
    scope.run(livePlace, { input: { role, row: f.row, take: shot.take.key } });

  switch (plan.kind) {
    case "new":
      put(file, at("live"), f.afterName, live.page, f.afterFrame);
      return { ...f.base, word: "new", after: build };
    case "next":
      putNext(live, f, file, at);
      return { ...f.base, word: "next", after: build, before: plan.before };
    case "same":
      return { ...f.base, word: "same" };
    case "differs":
      return { ...f.base, word: "differs", why: "a take of the same build has other pixels" };
    case "compare":
      return { ...f.base, word: "failed", why: "the After cannot be read" };
  }
}

async function putAll(shots: Array<Shot>) {
  const live = await readLive();
  const designs: Record<string, number> = { ...live.old?.designs };
  for (const row of screens.keys()) await putDesign(live, designs, row);

  const records: Array<TakeRecord> = [];
  for (const shot of shots) records.push(await putTake(live, shot));

  const look = await lookOfDesignSystem();
  const values = shots.flatMap((s) => (s.values ? [s.values] : []));
  const findings = scope.run(liveFindings, { input: { look, values } });
  const status: LiveStatus = { build, commit, designs, takes: records, values, findings };
  const statusFile = join(work, "status.html");
  writeFileSync(statusFile, scope.run(liveStatusHtml, { input: status }));

  const place = scope.run(livePlace, { input: { role: "status" } });
  put(statusFile, place, statusName, live.page, live.statusFrame);
  report(status, true);

  return verdict(status);
}

async function oldStatus(id: string) {
  const file = join(work, "old-status.html");
  easel(["get", canvas, id, "-o", file]);
  const read = scope.run(liveStatusRead, { input: readFileSync(file, "utf8") });
  return read.kind === "read" ? read.status : null;
}

try {
  const begun = Date.now();
  const fixture = await startFixture();
  console.log(`live-screens: the fixture took ${Date.now() - begun} ms`);
  server = fixture.server;

  const shots = await takeAll(browser, fixture);
  const exit = dryDir ? await dry(shots) : await putAll(shots);
  process.exitCode = exit;
} finally {
  await browser.close();
  server?.kill();
  await server?.exited;
  await scope.close();
  rmSync(work, { recursive: true, force: true });
}
