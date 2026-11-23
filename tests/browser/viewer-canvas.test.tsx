import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { Profiler } from "react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import type {} from "vite-plus/test/browser-playwright";
import { cdp, page, userEvent } from "vite-plus/test/browser/context";
import { z } from "zod";

import { frames } from "@/frames";
import {
  type FrameStatus,
  frames as frameCells,
  frameStatus,
  framesBoard,
} from "@/frames/contract";
import { Canvas } from "@/viewer/canvas";
import { picRetryMs } from "@/viewer/picture";

const canvas = "home";

const liveCap = 12;
const restMs = 120;
const paintCapMs = 1_500;

type Put = {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  html: string;
  k?: string;
  status?: FrameStatus;
};

const htmls = new Map<string, { version: number; html: string }>();
const loads: Record<string, unknown>[] = [];

const loadDocs = operation({
  label: "test.loadDocs",
  input: z.object({ canvas: z.string() }).catchall(z.unknown()),
  run: (_, { input }) => {
    loads.push(input);
    const id = typeof input.id === "string" ? input.id : "";
    const doc = htmls.get(id);

    return doc ? [{ canvas: input.canvas, id, ...doc, css: null }] : [];
  },
});

const put = operation({
  label: "test.put",
  input: z.object({
    id: z.string(),
    name: z.string(),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    html: z.string(),
    k: z.string().optional(),
    status: frameStatus.optional(),
  }),
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async ({ cells, invalidate }, { input: { html, status = "exploring", ...box } }) => {
    const version = (htmls.get(box.id)?.version ?? 0) + 1;
    htmls.set(box.id, { version, html });
    cells.set({ ...box, canvas, page: "page-1", version, status });
    await invalidate.run({ input: { docs: { canvas, id: box.id } } });
  },
});

const mark = operation({
  label: "test.mark",
  input: z.object({ id: z.string(), status: frameStatus }),
  depends: { cells: frameCells.controller },
  run: ({ cells }, { input: { id, status } }) => {
    const now = cells.of({ canvas, page: "page-1", id }).get();
    if (now) cells.set({ ...now, status });
  },
});

const drop = operation({
  label: "test.drop",
  input: z.string(),
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async ({ cells, invalidate }, { input }) => {
    htmls.delete(input);
    cells.delete({ canvas, page: "page-1", id: input });
    await invalidate.run({ input: { docs: { canvas, id: input } } });
  },
});

const frame = (id: string, x: number, y: number, more: Partial<Put> = {}): Put => ({
  id,
  name: `Frame ${id}`,
  x,
  y,
  w: 320,
  h: 240,
  html: `<p>${id}</p>`,
  ...more,
});

const silent = "<p>still loading</p><!--";

const grid = Array.from({ length: 200 }, (_, i) =>
  frame(`f${String(i).padStart(3, "0")}`, (i % 20) * 400, Math.floor(i / 20) * 320),
);

async function boot(list: readonly Put[]) {
  htmls.clear();
  loads.length = 0;
  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      frames.board({ serve: true, load: { docs: loadDocs } }),
      memory.server({ services: [frames.board] }),
    ],
  }).ready;
  onTestFinished(async () => {
    await server.close();
  });
  for (const f of list) await server.run(put, { input: f });

  return server;
}

async function tab(server: Scope.Handle) {
  await page.viewport(1200, 800);
  const clock = makeTestClock();
  const scope = await createScope({
    clock,
    capsules: [
      exits({ store: localStorage }),
      memory.client({ peer: server }),
      frames.board({ read: memory.client }),
    ],
  }).ready;
  const commits = { n: 0 };
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  onTestFinished(async () => {
    root.unmount();
    await scope.close();
  });
  const start = performance.now();
  root.render(
    <ScopeProvider scope={scope}>
      <Profiler id="canvas" onRender={() => void commits.n++}>
        <Canvas canvas={canvas} opening={<p>Opening</p>} />
      </Profiler>
    </ScopeProvider>,
  );

  return { clock, commits, start, scope };
}

const tick = (ms = 30) => new Promise((done) => setTimeout(done, ms));

const rafs = (n: number) =>
  new Promise<void>((done) => {
    const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : done());
    step(n);
  });

const region = () => page.getByRole("region", { name: "Frames" }).element();
const shells = () => [...region().querySelectorAll<HTMLElement>('[role="group"]')];
const shellOf = (id: string) => shells().find((s) => s.dataset.id === id);
const shown = () => shells().filter((s) => !s.hidden);
const docs = () => [...region().querySelectorAll<HTMLIFrameElement>("iframe")];
const liveIds = () => docs().map((d) => d.dataset.id ?? "");
const cardOf = (id: string) => shellOf(id)?.querySelector<HTMLElement>(".e-card");
const picOf = (id: string) => cardOf(id)?.querySelector<HTMLImageElement>("img");
const cardHidden = (id: string) => cardOf(id)?.hidden;
const docOf = (id: string) => docs().find((d) => d.dataset.id === id);
const versionOf = (id: string) => docOf(id)?.dataset.version;
const srcdocOf = (id: string) => docOf(id)?.srcdoc;
const zoomText = () => page.getByRole("status", { name: "Zoom" }).element().textContent;
const emptyText = () => page.getByText("This canvas has no frames yet.");

type Tab = Awaited<ReturnType<typeof tab>>;

const statusOf = (at: Tab) =>
  at.scope.resolve(frames.board.status(frames.board.frames.where({ canvas, page: "page-1" }))).get()
    ?.status;

const lostOf = (at: Tab) => at.scope.resolve(frames.board.faults).get().frames?.fault === "link";

async function rest(clock: ReturnType<typeof makeTestClock>) {
  clock.advance(restMs);
  await rafs(liveCap + 6);
  await tick();
}

async function opened(at: Awaited<ReturnType<typeof tab>>, n: number) {
  await expect.poll(() => shells().length).toBe(n);
  await rafs(2);
  await rest(at.clock);
}

function grab(x = 600, y = 400, pointerId = 1) {
  let at = { x, y };
  const send = (type: string, to: { x: number; y: number }) =>
    region().dispatchEvent(
      new PointerEvent(type, { pointerId, button: 0, clientX: to.x, clientY: to.y, bubbles: true }),
    );
  send("pointerdown", at);

  return {
    by: (dx: number, dy: number) => {
      at = { x: at.x + dx, y: at.y + dy };
      send("pointermove", at);
    },
    release: () => send("pointerup", at),
  };
}

function drag(dx: number, dy: number) {
  const hand = grab();
  hand.by(dx, dy);
  hand.release();
}

function wheel(init: WheelEventInit) {
  region().dispatchEvent(
    new WheelEvent("wheel", {
      clientX: 600,
      clientY: 400,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );
}

function press(name: string) {
  const button = page.getByRole("button", { name }).element();
  if (button instanceof HTMLElement) button.click();
}

function pressTimes(name: string, times: number) {
  for (let i = 0; i < times; i++) press(name);
}

function expectEveryFrameInView() {
  const view = region().getBoundingClientRect();
  for (const shell of shells()) {
    const box = shell.getBoundingClientRect();

    expect(shell.hidden, shell.dataset.id).toBe(false);
    expect(box.left, shell.dataset.id).toBeGreaterThanOrEqual(view.left);
    expect(box.top, shell.dataset.id).toBeGreaterThanOrEqual(view.top);
    expect(box.right, shell.dataset.id).toBeLessThanOrEqual(view.right);
    expect(box.bottom, shell.dataset.id).toBeLessThanOrEqual(view.bottom);
  }
}

function expectInViewShows() {
  const view = region().getBoundingClientRect();
  for (const shell of shells().filter((s) => s.hidden)) {
    const box = shell.getBoundingClientRect();
    const overlaps =
      box.right > view.left &&
      box.left < view.right &&
      box.bottom > view.top &&
      box.top < view.bottom;
    expect(overlaps, shell.dataset.id).toBe(false);
  }
}

function fromCentre(shell: HTMLElement) {
  const view = region().getBoundingClientRect();
  const box = shell.getBoundingClientRect();
  const cx = view.left + view.width / 2;
  const cy = view.top + view.height / 2;

  return Math.hypot(
    Math.max(box.left - cx, 0, cx - box.right),
    Math.max(box.top - cy, 0, cy - box.bottom),
  );
}

test("200 frames: shells first, Fit shows every one, and under 30% nothing goes live (Fit s0 to s2, s2 to s4)", async () => {
  const server = await boot(grid);
  const at = await tab(server);

  await expect.poll(() => shells().length).toBe(200);
  const firstShells = performance.now() - at.start;
  console.log(`speed: 200 shells drawn ${firstShells.toFixed(0)} ms after the first render`);
  await rafs(2);
  expectEveryFrameInView();
  expect(Number.parseFloat(zoomText() ?? "")).toBeLessThan(30);

  await rest(at.clock);
  expect(liveIds()).toEqual([]);
  expectEveryFrameInView();
  expect(firstShells).toBeLessThan(2_000);
});

test("at most 12 live at rest, the nearest the centre, one per animation frame and none before the camera rests", async () => {
  const server = await boot(grid);
  const at = await tab(server);
  await opened(at, 200);
  pressTimes("Zoom in", 6);
  await rafs(liveCap + 6);
  expect(liveIds()).toEqual([]);

  at.clock.advance(restMs);
  await rafs(3);
  expect(liveIds().length).toBeGreaterThan(0);
  expect(liveIds().length).toBeLessThanOrEqual(3);
  await rafs(liveCap + 6);
  await tick();

  const nearest = shown()
    .toSorted((a, b) => fromCentre(a) - fromCentre(b))
    .slice(0, 20)
    .map((s) => ({ id: s.dataset.id ?? "", d: fromCentre(s) }));
  const view = region().getBoundingClientRect();
  const inView = shown().filter((s) => {
    const box = s.getBoundingClientRect();
    return (
      box.right > view.left &&
      box.left < view.right &&
      box.bottom > view.top &&
      box.top < view.bottom
    );
  });
  expect(inView.length).toBeGreaterThan(liveCap);
  expect(liveIds()).toHaveLength(liveCap);
  const cut = Math.max(...liveIds().map((id) => nearest.find((n) => n.id === id)?.d ?? Infinity));
  expect(nearest.filter((n) => n.d < cut).every((n) => liveIds().includes(n.id))).toBe(true);
  expect(loads.length).toBeGreaterThanOrEqual(liveCap);
  for (const part of loads) expect(part).toEqual({ canvas, id: expect.any(String) });
});

test("a pan or a zoom changes no live frame and renders no React, until the camera rests", async () => {
  const server = await boot(grid);
  const at = await tab(server);
  await opened(at, 200);
  pressTimes("Zoom in", 6);
  await rest(at.clock);
  const before = liveIds().toSorted();
  expect(before).toHaveLength(liveCap);
  const commits = at.commits.n;

  const hand = grab();
  const times: number[] = [];
  let last = performance.now();
  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    hand.by(-25, -12);
    times.push(performance.now() - t0);

    await rafs(1);
    const now = performance.now();
    times.push(now - last);
    last = now;

    expect(liveIds().toSorted(), `move ${i}`).toEqual(before);
    expectInViewShows();
  }
  hand.release();
  wheel({ deltaX: 40, deltaY: 30 });
  wheel({ deltaY: -5, ctrlKey: true });
  await rafs(liveCap + 6);
  await tick();
  expect(liveIds().toSorted()).toEqual(before);
  expect(at.commits.n - commits).toBe(0);

  const handler = times.filter((_, i) => i % 2 === 0).toSorted((a, b) => a - b);
  const frame = times.filter((_, i) => i % 2 === 1).toSorted((a, b) => a - b);
  const p = (list: number[], q: number) => list[Math.floor((list.length - 1) * q)] ?? 0;
  console.log(
    `speed: pan, 60 moves: per move ${p(handler, 0.5).toFixed(2)} ms median, ${p(handler, 0.95).toFixed(2)} ms p95; frame time ${p(frame, 0.5).toFixed(1)} ms median, ${p(frame, 0.95).toFixed(1)} ms p95, ${p(frame, 1).toFixed(1)} ms max`,
  );

  await rest(at.clock);
  expect(liveIds()).toHaveLength(liveCap);
  expect(liveIds().toSorted()).not.toEqual(before);
});

test("the camera's arrows, on one frame: pan, far, rest, zoom under 30%, and Fit from each", async () => {
  const server = await boot([frame("a", 0, 0, { w: 400, h: 300 })]);
  const at = await tab(server);
  await opened(at, 1);
  const hidden = () => shellOf("a")?.hidden;
  expect(hidden()).toBe(false);
  expect(liveIds()).toEqual(["a"]);
  await tick(0);
  expect(zoomText()).toBe("100%");

  drag(100, 0);
  expect(hidden()).toBe(false);
  await rest(at.clock);
  expect(liveIds()).toEqual(["a"]);

  drag(3_000, 0);
  expect(hidden()).toBe(true);
  expect(liveIds()).toEqual(["a"]);
  drag(-3_000, 0);
  expect(hidden()).toBe(false);
  drag(3_000, 0);
  expect(hidden()).toBe(true);
  await rest(at.clock);
  expect(hidden()).toBe(true);
  expect(liveIds()).toEqual([]);
  expect(cardHidden("a")).toBe(false);
  drag(2_000, 0);
  expect(hidden()).toBe(true);
  await rest(at.clock);
  press("Fit");
  expect(hidden()).toBe(false);
  expectEveryFrameInView();
  await rest(at.clock);
  drag(3_000, 0);
  expect(hidden()).toBe(true);
  press("Fit");
  expectEveryFrameInView();
  await rest(at.clock);
  drag(1_800, 0);
  expect(hidden()).toBe(false);
  await rest(at.clock);
  expect(hidden()).toBe(true);
  drag(-1_800, 0);
  expect(hidden()).toBe(false);
  await rest(at.clock);
  press("Fit");
  expectEveryFrameInView();

  pressTimes("Zoom out", 6);
  await tick(0);
  expect(zoomText()).toBe("20%");
  await rest(at.clock);
  expect(hidden()).toBe(false);
  expect(liveIds()).toEqual([]);
  drag(10, 0);
  expect(hidden()).toBe(false);
  await rest(at.clock);
  press("Fit");
  expectEveryFrameInView();
  pressTimes("Zoom out", 6);
  await rest(at.clock);
  drag(4_000, 0);
  expect(hidden()).toBe(true);
});

test("Zoom in and Zoom out zoom around the centre by 1.25; Ctrl+wheel around the cursor; a pinch zooms", async () => {
  const server = await boot([frame("a", 0, 0, { w: 400, h: 300 })]);
  const at = await tab(server);
  await opened(at, 1);
  const box = () => shellOf("a")?.getBoundingClientRect() ?? new DOMRect();
  const centre = () => ({ x: box().left + box().width / 2, y: box().top + box().height / 2 });
  const view = region().getBoundingClientRect();
  expect(centre().x).toBeCloseTo(view.left + view.width / 2, 0);
  expect(box().width).toBeCloseTo(400, 0);

  press("Zoom in");
  expect(box().width).toBeCloseTo(500, 0);
  expect(centre().x).toBeCloseTo(view.left + view.width / 2, 0);
  await tick(0);
  expect(zoomText()).toBe("120%");
  press("Zoom out");
  press("Zoom out");
  expect(box().width).toBeCloseTo(320, 0);
  await tick(0);
  expect(zoomText()).toBe("80%");

  const corner = { x: box().left, y: box().top };
  wheel({ deltaY: -100, ctrlKey: true, clientX: corner.x, clientY: corner.y });
  expect(box().left).toBeCloseTo(corner.x, 0);
  expect(box().top).toBeCloseTo(corner.y, 0);
  expect(box().width).toBeCloseTo(400, 0);
  wheel({ deltaY: 100 });
  expect(box().top).toBeCloseTo(corner.y - 100, 0);

  const before = box().width;
  const one = grab(500, 400, 1);
  const two = grab(700, 400, 2);
  two.by(200, 0);
  one.release();
  two.release();
  expect(box().width).toBeCloseTo(before * 2, 0);
});

test("in a dark system theme the canvas stays light gray, as in Doop, and its labels stay dark; the dock follows the theme (SPEC-design journey 1)", async () => {
  const scheme = (value: string) =>
    cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value }],
    });
  await scheme("dark");
  onTestFinished(() => scheme("").then(() => undefined));
  const server = await boot([frame("a", 0, 0, { w: 400, h: 300 })]);
  const at = await tab(server);
  await opened(at, 1);
  const label = shellOf("a")?.querySelector(".e-label");
  const dock = page.getByRole("toolbar", { name: "Canvas" }).element();

  expect(getComputedStyle(region()).backgroundColor).toBe("rgb(243, 243, 242)");
  expect(label && getComputedStyle(label).color).toBe("rgb(97, 97, 94)");
  expect(getComputedStyle(dock).backgroundColor).toBe("rgb(31, 31, 31)");
});

test("SPEC-copy rule 14: the label row of a ready frame says Ready in the ok color, in both themes; an exploring frame has no mark; the mark follows each change of the status live", async () => {
  const scheme = (value: string) =>
    cdp().send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value }],
    });
  onTestFinished(() => scheme("").then(() => undefined));
  const server = await boot([frame("a", 0, 0, { status: "ready" }), frame("b", 400, 0)]);
  const at = await tab(server);
  await opened(at, 2);
  const markOf = (id: string) =>
    shellOf(id)?.querySelector<HTMLElement>(".e-label .e-ready") ?? null;
  const okColor = "rgb(29, 107, 64)";

  await expect
    .element(page.getByRole("group", { name: "Frame a" }).getByText("Ready", { exact: true }))
    .toBeVisible();
  expect(markOf("b")).toBeNull();
  expect(getComputedStyle(markOf("a") ?? region()).color).toBe(okColor);

  await scheme("dark");
  expect(getComputedStyle(markOf("a") ?? region()).color).toBe(okColor);

  server.run(mark, { input: { id: "a", status: "exploring" } });
  server.run(mark, { input: { id: "b", status: "ready" } });
  await expect.poll(() => markOf("a")).toBeNull();
  await expect.poll(() => markOf("b")?.textContent).toBe("Ready");

  await server.run(put, { input: frame("a", 0, 0, { status: "ready" }) });
  await expect.poll(() => markOf("a")?.textContent).toBe("Ready");
  await server.run(put, { input: frame("b", 400, 0) });
  await expect.poll(() => markOf("b")).toBeNull();
});

test("a trackpad pinch (small Ctrl+wheel steps) zooms 1% for each pixel, as tldraw and Excalidraw; a wheel notch stays ×1.25", async () => {
  const server = await boot([frame("a", 0, 0, { w: 400, h: 300 })]);
  const at = await tab(server);
  await opened(at, 1);
  const width = () => shellOf("a")?.getBoundingClientRect().width ?? 0;
  expect(width()).toBeCloseTo(400, 0);

  for (let step = 0; step < 10; step++) wheel({ deltaY: -2, ctrlKey: true });
  expect(width()).toBeCloseTo(400 * Math.exp(0.2), 0);

  const before = width();
  wheel({ deltaY: -100, ctrlKey: true });
  expect(width()).toBeCloseTo(before * 1.25, 0);
  wheel({ deltaY: 50, ctrlKey: true });
  expect(width()).toBeCloseTo(before, 0);
});

test("an agent's put shows, goes live at rest under its picture, and a new version puts the picture back until it paints", async () => {
  const server = await boot([frame("a", 0, 0)]);
  const at = await tab(server);
  await opened(at, 1);
  await expect.poll(() => cardHidden("a")).toBe(true);

  const hand = grab();
  hand.by(5, 0);
  await server.run(put, { input: frame("b", 360, 0, { html: silent }) });
  await expect.poll(() => shellOf("b")?.hidden).toBe(false);
  await rafs(liveCap);
  expect(liveIds()).toEqual(["a"]);
  hand.release();
  await rest(at.clock);
  expect(liveIds().toSorted()).toEqual(["a", "b"]);
  expect(cardHidden("b")).toBe(false);
  at.clock.advance(paintCapMs - restMs - 1);
  await tick();
  expect(cardHidden("b")).toBe(false);
  at.clock.advance(restMs + 1);
  await tick();
  expect(cardHidden("b")).toBe(true);

  await server.run(put, { input: frame("a", 0, 0, { html: silent }) });
  await expect.poll(() => versionOf("a")).toBe("2");
  expect(cardHidden("a")).toBe(false);
  expect(srcdocOf("a")).toContain("still loading");
  at.clock.advance(paintCapMs);
  await tick();
  expect(cardHidden("a")).toBe(true);

  await server.run(put, { input: frame("a", 0, 0, { html: silent }) });
  await expect.poll(() => versionOf("a")).toBe("3");
  expect(cardHidden("a")).toBe(false);

  drag(-4_000, 0);
  await rest(at.clock);
  expect(liveIds()).toEqual([]);
  expect(cardHidden("a")).toBe(false);
  expect(cardHidden("b")).toBe(false);
});

test("an agent's delete takes a live frame out at once, even mid-pan, and nothing else changes (s8 to s7, s9 to s7)", async () => {
  const server = await boot(grid);
  const at = await tab(server);
  await opened(at, 200);
  pressTimes("Zoom in", 6);
  await rest(at.clock);
  const before = liveIds();
  const [gone = "", other = ""] = before;

  const hand = grab();
  hand.by(-10, 0);
  await server.run(drop, { input: gone });
  await expect.poll(() => shellOf(gone)).toBeUndefined();
  hand.by(-10, 0);
  await rafs(liveCap);
  expect(liveIds().toSorted()).toEqual(before.filter((id) => id !== gone).toSorted());
  hand.release();

  await server.run(put, { input: frame(other, 0, 0, { html: silent }) });
  await expect.poll(() => versionOf(other)).toBe("2");
  await server.run(drop, { input: other });
  await expect.poll(() => shellOf(other)).toBeUndefined();
  expect(liveIds()).not.toContain(other);
});

test("an empty canvas says so; the first put takes it away, and a delete before rest brings it back (s5 to s6, s6 to s7)", async () => {
  const server = await boot([]);
  const at = await tab(server);
  await expect.poll(() => statusOf(at)).toBe("ready");
  await tick(0);
  expect(emptyText().elements()).toHaveLength(1);
  expect(region().contains(emptyText().element())).toBe(true);
  expect(shells()).toHaveLength(0);

  await server.run(put, { input: frame("a", 0, 0, { html: silent }) });
  await expect.poll(() => shells()).toHaveLength(1);
  expect(emptyText().elements()).toHaveLength(0);
  await rafs(2);
  expectEveryFrameInView();
  expect(liveIds()).toEqual([]);

  await server.run(drop, { input: "a" });
  await expect.poll(() => shells()).toHaveLength(0);
  await tick(0);
  expect(emptyText().elements()).toHaveLength(1);
  await rest(at.clock);
  expect(liveIds()).toEqual([]);
});

test("an empty canvas still says so while Reconnecting, once a read has arrived", async () => {
  const server = await boot([]);
  const at = await tab(server);
  await expect.poll(() => statusOf(at)).toBe("ready");

  await server.close();
  await expect.poll(() => lostOf(at)).toBe(true);
  await tick(0);
  expect(page.getByText("Reconnecting").elements()).toHaveLength(1);
  expect(emptyText().elements()).toHaveLength(1);
});

test("a link that drops before any read says Reconnecting, and never that the canvas is empty", async () => {
  const server = await boot([]);
  await server.close();
  const at = await tab(server);

  await expect.poll(() => lostOf(at)).toBe(true);
  await tick(0);
  expect(statusOf(at)).not.toBe("ready");
  expect(page.getByText("Reconnecting").elements()).toHaveLength(1);
  expect(emptyText().elements()).toHaveLength(0);
});

test("a live document runs sandboxed: scripts, and no same origin", async () => {
  const server = await boot([frame("a", 0, 0)]);
  const at = await tab(server);
  await opened(at, 1);
  const [doc] = docs();

  expect(doc?.getAttribute("sandbox")).toBe("allow-scripts");
  expect(doc?.contentDocument).toBeNull();
});

test("a frame that was live, went out of reach and comes back keeps its picture on top until the new document paints", async () => {
  const server = await boot([frame("a", 0, 0, { html: silent })]);
  const at = await tab(server);
  await opened(at, 1);
  expect(liveIds()).toEqual(["a"]);
  at.clock.advance(paintCapMs);
  await tick();
  expect(cardHidden("a")).toBe(true);

  drag(-4_000, 0);
  await rest(at.clock);
  expect(liveIds()).toEqual([]);
  expect(cardHidden("a")).toBe(false);

  drag(4_000, 0);
  await rest(at.clock);
  expect(liveIds()).toEqual(["a"]);
  expect(cardHidden("a")).toBe(false);
});

test("the margins: live within 0.1 of a view, stays live to 0.5; a shell shows within 0.5 and hides at rest past 0.75", async () => {
  const server = await boot([frame("a", 0, 0, { w: 400, h: 300 })]);
  const at = await tab(server);
  await opened(at, 1);
  let net = 0;
  const to = async (out: number) => {
    const want = 1_200 + out * 1_200 - 400;
    drag(want - net, 0);
    net = want;
    await rest(at.clock);
  };
  const hidden = () => shellOf("a")?.hidden;

  await to(2);
  expect(liveIds()).toEqual([]);
  expect(hidden()).toBe(true);
  await to(0.6);
  expect(hidden()).toBe(true);
  await to(0.4);
  expect(hidden()).toBe(false);
  expect(liveIds()).toEqual([]);
  await to(0.2);
  expect(liveIds()).toEqual([]);

  await to(0.05);
  expect(liveIds()).toEqual(["a"]);
  await to(0.4);
  expect(liveIds()).toEqual(["a"]);
  await to(0.6);
  expect(liveIds()).toEqual([]);
  expect(hidden()).toBe(false);
  await to(0.8);
  expect(hidden()).toBe(true);
});

test("the camera rests 120 ms after the last move, not a millisecond before", async () => {
  const server = await boot([frame("a", 0, 0, { w: 400, h: 300 })]);
  const at = await tab(server);
  await opened(at, 1);
  drag(-4_000, 0);
  await rest(at.clock);
  expect(liveIds()).toEqual([]);

  drag(4_000, 0);
  at.clock.advance(restMs - 1);
  await rafs(liveCap);
  expect(liveIds()).toEqual([]);
  at.clock.advance(1);
  await rafs(liveCap);
  expect(liveIds()).toEqual(["a"]);
});

test("the paint wait is 1.5 s to the millisecond", async () => {
  const server = await boot([frame("a", 0, 0, { html: silent })]);
  const at = await tab(server);
  await opened(at, 1);
  expect(liveIds()).toEqual(["a"]);

  at.clock.advance(paintCapMs - 1);
  await tick();
  expect(cardHidden("a")).toBe(false);
  at.clock.advance(1);
  await tick();
  expect(cardHidden("a")).toBe(true);
});

test("a paint post counts only from the frame's own document and for its version; the page and another frame cannot send it", async () => {
  const spoof = `<script>for(let v=0;v<9;v++)parent.postMessage({easel:"painted",v},"*");for(const w of [parent.frames[0],parent.frames[1]])try{w.postMessage({easel:"painted",v:1},"*")}catch{}</script><!--`;
  const wrong = `<script>parent.postMessage({easel:"painted",v:999},"*")</script><!--`;
  const server = await boot([
    frame("a", 0, 0, { html: silent }),
    frame("b", 360, 0, { html: spoof }),
    frame("c", 0, 280, { html: wrong }),
  ]);
  const at = await tab(server);
  await opened(at, 3);
  expect(liveIds().toSorted()).toEqual(["a", "b", "c"]);

  window.postMessage({ easel: "painted", v: 1 }, "*");
  await tick(200);
  expect(cardHidden("a"), "a: the page's post and b's are not a's").toBe(false);
  expect(cardHidden("c"), "c: a post for version 999 is not version 1's").toBe(false);
});

test("Fit leaves a 40 px edge: across on a wide board, and down on a tall one", async () => {
  const edges = () => {
    const view = region().getBoundingClientRect();
    const boxes = shells().map((s) => s.getBoundingClientRect());

    return {
      left: Math.min(...boxes.map((b) => b.left)) - view.left,
      right: view.right - Math.max(...boxes.map((b) => b.right)),
      top: Math.min(...boxes.map((b) => b.top)) - view.top,
      bottom: view.bottom - Math.max(...boxes.map((b) => b.bottom)),
    };
  };
  const server = await boot(grid);
  const at = await tab(server);
  await opened(at, 200);
  expect(edges().left).toBeCloseTo(40, 0);
  expect(edges().right).toBeCloseTo(40, 0);
  expect(edges().top).toBeCloseTo(edges().bottom, 0);

  for (let i = 0; i < 12; i++) {
    await server.run(put, { input: frame(`t${i}`, 0, 3_200 + i * 2_000) });
  }
  await expect.poll(() => shells().length).toBe(212);
  await rest(at.clock);
  press("Fit");
  await rest(at.clock);
  expect(edges().top).toBeCloseTo(40, 0);
  expect(edges().bottom).toBeCloseTo(40, 0);
  expectEveryFrameInView();
});

test("a delete mid-pan takes out only the deleted frame, and at rest its place is filled", async () => {
  const server = await boot(grid);
  const at = await tab(server);
  await opened(at, 200);
  pressTimes("Zoom in", 6);
  await rest(at.clock);
  const before = liveIds();
  const [gone = ""] = before;

  const hand = grab();
  hand.by(-1_500, -700);
  await server.run(drop, { input: gone });
  await expect.poll(() => shellOf(gone)).toBeUndefined();
  await rafs(liveCap);
  await tick();
  expect(liveIds().toSorted()).toEqual(before.filter((id) => id !== gone).toSorted());

  const back = grid.find((f) => f.id === gone) ?? frame(gone, 0, 0);
  await server.run(put, { input: back });
  await expect.poll(() => shellOf(gone)).toBeDefined();
  await rafs(liveCap);
  expect(liveIds()).not.toContain(gone);

  hand.by(1_500, 700);
  hand.release();
  await rest(at.clock);
  expect(liveIds()).toHaveLength(liveCap);
});

test("a put mid-move changes no live frame, even one the pan carried out of reach", async () => {
  const server = await boot([frame("a", 0, 0, { w: 400, h: 300 })]);
  const at = await tab(server);
  await opened(at, 1);
  expect(liveIds()).toEqual(["a"]);

  const hand = grab();
  hand.by(1_700, 0);
  await server.run(put, { input: frame("b", -1_500, 0, { html: silent }) });
  await expect.poll(() => shellOf("b")).toBeDefined();
  await rafs(liveCap);
  expect(liveIds()).toEqual(["a"]);

  hand.release();
  await rest(at.clock);
  expect(liveIds()).toEqual(["b"]);
});

test("a move stops documents going live part way, and none goes live until the camera rests again", async () => {
  const server = await boot(grid);
  const at = await tab(server);
  await opened(at, 200);
  pressTimes("Zoom in", 6);
  at.clock.advance(restMs);
  await rafs(3);
  const some = liveIds().length;
  expect(some).toBeGreaterThan(0);
  expect(some).toBeLessThan(liveCap);

  const hand = grab();
  hand.by(-3, 0);
  const held = liveIds().length;
  await rafs(liveCap + 6);
  expect(liveIds()).toHaveLength(held);
  expect(held).toBeLessThan(liveCap);
  hand.release();
});

test("zoom stops at 400% and at 0.1%", async () => {
  const server = await boot([frame("a", 0, 0, { w: 400, h: 300 })]);
  const at = await tab(server);
  await opened(at, 1);

  pressTimes("Zoom in", 12);
  await tick(0);
  expect(zoomText()).toBe("400%");
  pressTimes("Zoom out", 60);
  await tick(0);
  expect(zoomText()).toBe("0.1%");
});

test("a label keeps its screen size at rest, and a live document takes no pointer", async () => {
  const server = await boot([frame("a", 0, 0, { w: 400, h: 300 })]);
  const at = await tab(server);
  await opened(at, 1);
  const label = () =>
    shellOf("a")?.querySelector<HTMLElement>("[data-label]")?.getBoundingClientRect().height ?? 0;
  const atFit = label();
  expect(atFit).toBeGreaterThan(0);

  pressTimes("Zoom in", 4);
  await rest(at.clock);
  expect(label()).toBeCloseTo(atFit, 0);
  const [doc] = docs();
  expect(doc && getComputedStyle(doc).pointerEvents).toBe("none");
});

test("a shell's picture is its frame's address on the board: version, key and scale; with pictures off, a plain card", async () => {
  const server = await boot([
    frame("a", 0, 0, { k: "key-a1", html: silent }),
    frame("off", 400, 0),
  ]);
  const at = await tab(server);
  await opened(at, 2);

  expect(picOf("a")?.getAttribute("src")).toBe(`/api/pictures/${canvas}/a/1?s=0.5&k=key-a1`);
  expect(picOf("a")?.alt).toBe("Frame a");
  expect(picOf("off")).toBeNull();
  expect(cardOf("off")).toBeTruthy();

  expect(liveIds()).toContain("a");
  at.clock.advance(paintCapMs);
  await tick();
  expect(cardHidden("a")).toBe(true);
  await server.run(put, { input: frame("a", 0, 0, { k: "key-a2", html: silent }) });
  await expect.poll(() => versionOf("a")).toBe("2");
  expect(cardHidden("a")).toBe(false);
  expect(picOf("a")?.getAttribute("src")).toBe(`/api/pictures/${canvas}/a/2?s=0.5&k=key-a2`);
  at.clock.advance(paintCapMs - 1);
  await tick();
  expect(cardHidden("a")).toBe(false);
  at.clock.advance(1);
  await tick();
  expect(cardHidden("a")).toBe(true);
});

test("a picture that fails (a busy server's 503) is asked again after 1, 2 and 4 s, then left a card", async () => {
  const errors = { n: 0 };
  const onError = (event: Event) => {
    if (event.target instanceof HTMLImageElement) errors.n++;
  };
  document.addEventListener("error", onError, true);
  onTestFinished(() => document.removeEventListener("error", onError, true));
  const server = await boot([frame("a", 0, 0, { k: "key-a1", html: silent })]);
  const at = await tab(server);
  await expect.poll(() => errors.n).toBe(1);
  const img = picOf("a");
  const src = img?.getAttribute("src");

  for (const [i, wait] of picRetryMs.entries()) {
    await tick();
    at.clock.advance(wait - 1);
    await tick(100);
    expect(errors.n).toBe(i + 1);

    at.clock.advance(1);
    await expect.poll(() => errors.n).toBe(i + 2);
  }

  await tick();
  at.clock.advance(60_000);
  await tick(200);
  expect(errors.n).toBe(4);
  expect(picOf("a")).toBe(img);
  expect(img?.getAttribute("src")).toBe(src);
});

test("a shell asks for its picture at 0.5, at 0.25 when 0.5 is over 8 megapixels (8 MP itself is allowed), and not at all past that", async () => {
  const server = await boot([
    frame("small", 0, 0, { w: 8_000, h: 4_000, k: "key-s" }),
    frame("big", 8_400, 0, { w: 10_000, h: 8_000, k: "key-b" }),
    frame("huge", 0, 8_400, { w: 16_000, h: 16_000, k: "key-h" }),
    frame("edge", 18_800, 0, { w: 16_000, h: 8_000, k: "key-e" }),
  ]);
  const at = await tab(server);
  await opened(at, 4);

  expect(picOf("small")?.getAttribute("src")).toBe(`/api/pictures/${canvas}/small/1?s=0.5&k=key-s`);
  expect(picOf("big")?.getAttribute("src")).toBe(`/api/pictures/${canvas}/big/1?s=0.25&k=key-b`);
  expect(picOf("edge")?.getAttribute("src")).toBe(`/api/pictures/${canvas}/edge/1?s=0.25&k=key-e`);
  expect(picOf("huge")).toBeNull();
  expect(cardOf("huge")).toBeTruthy();
});

const findBox = () => page.getByRole("combobox", { name: "Find a frame" });
const findButton = () => page.getByRole("button", { name: "Find", exact: true });

const names = () =>
  page
    .getByRole("listbox", { name: "Frames" })
    .getByRole("option")
    .elements()
    .map((o) => o.textContent);

const hint = () => document.querySelector(".e-find-hint")?.textContent;

test("Find in the dock, or the key /, opens the list over the dock with all names; a typed text shows the names that have it, those that start with it first; the hint counts them, or says that no name has the text (Find a frame 1 to 2, E3 S15, Open, Type)", async () => {
  const server = await boot([
    frame("a1", 0, 0, { name: "Checkout · pay" }),
    frame("a2", 400, 0, { name: "Payments" }),
    frame("a3", 800, 0, { name: "Account · payments" }),
    frame("a4", 0, 320, { name: "Home" }),
  ]);
  const at = await tab(server);
  await opened(at, 4);

  expect(findButton().element()).toHaveAttribute("title", "Find a frame (/)");
  expect(findButton().element()).toHaveAttribute("aria-pressed", "false");
  await userEvent.keyboard("/");
  await expect.element(findBox()).toHaveFocus();
  expect(findButton().element()).toHaveAttribute("aria-pressed", "true");
  expect(findBox().element()).toHaveValue("");
  expect(names()).toEqual(["Checkout · pay", "Payments", "Account · payments", "Home"]);
  expect(hint()).toBe("4 frames");
  const list = document.querySelector(".e-find")?.getBoundingClientRect();
  const dock = page.getByRole("toolbar", { name: "Canvas" }).element().getBoundingClientRect();
  expect(list?.width).toBe(320);
  expect(list?.bottom).toBeLessThan(dock.top);
  expect(Math.abs((list?.left ?? 0) + 160 - (dock.left + dock.width / 2))).toBeLessThan(2);

  await userEvent.keyboard("PAY");
  await expect.poll(names).toEqual(["Payments", "Checkout · pay", "Account · payments"]);
  expect(hint()).toBe("3 of 4 frames");
  expect(page.getByRole("option", { selected: true }).element().textContent).toBe("Payments");

  await userEvent.keyboard("x");
  await expect.poll(names).toEqual([]);
  expect(hint()).toBe("No frame name has this text.");
});

test("Enter takes the selected name: the list closes, the canvas shows the frame at its centre, never past 100%, and marks it with an accent ring; a pan ends the mark (Find a frame 3 to 4, E3 S15, Take, Pan, AMarkIsInView)", async () => {
  const server = await boot(grid);
  const at = await tab(server);
  await expect.poll(() => shells().length).toBe(200);
  await rafs(2);
  expect(Number.parseFloat(zoomText() ?? "")).toBeLessThan(30);

  const started = performance.now();
  await findButton().click();
  await userEvent.keyboard("f137");
  await expect.poll(names).toEqual(["Frame f137"]);
  await userEvent.keyboard("{Enter}");
  const took = performance.now() - started;

  await expect.poll(() => findBox().elements().length).toBe(0);
  const found = shellOf("f137");
  if (!found) throw new Error("no f137");
  expect(found).toHaveAttribute("data-found", "");
  expect(fromCentre(found)).toBe(0);
  expect(zoomText()).toBe("100%");
  const ring = getComputedStyle(found);
  expect([ring.outlineStyle, ring.outlineWidth, ring.outlineColor]).toEqual([
    "solid",
    "2px",
    "rgb(26, 102, 201)",
  ]);
  expect(took).toBeLessThan(10_000);

  drag(30, 0);
  await rest(at.clock);
  expect(found.hasAttribute("data-found")).toBe(false);
});

test("Arrow Down moves the selection, and a click takes a name; Escape or Find closes the list and the canvas stays (Find a frame 3, 5; Close, OnlyATakeOrAPanMovesTheCanvas)", async () => {
  const server = await boot([
    frame("a1", 0, 0, { name: "Pricing" }),
    frame("a2", 3000, 2000, { name: "Pricing, mobile" }),
  ]);
  const at = await tab(server);
  await opened(at, 2);
  const before = shellOf("a2")?.getBoundingClientRect();

  await findButton().click();
  await userEvent.keyboard("pric");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => findBox().elements().length).toBe(0);
  expect(shellOf("a2")?.getBoundingClientRect()).toEqual(before);

  await findButton().click();
  await expect.element(findBox()).toBeVisible();
  await findButton().click();
  await expect.poll(() => findBox().elements().length).toBe(0);
  expect(shellOf("a2")?.getBoundingClientRect()).toEqual(before);

  await userEvent.keyboard("/");
  await userEvent.keyboard("pric{ArrowDown}");
  expect(page.getByRole("option", { selected: true }).element().textContent).toBe(
    "Pricing, mobile",
  );
  await userEvent.keyboard("{ArrowUp}");
  expect(page.getByRole("option", { selected: true }).element().textContent).toBe("Pricing");
  await page.getByRole("option", { name: "Pricing, mobile" }).click();
  await expect.poll(() => findBox().elements().length).toBe(0);
  const found = shellOf("a2");
  if (!found) throw new Error("no a2");
  expect(fromCentre(found)).toBe(0);
  expect(found).toHaveAttribute("data-found", "");
});
