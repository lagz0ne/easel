import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { Profiler } from "react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { page } from "vite-plus/test/browser/context";
import { z } from "zod";

import { frames } from "@/frames";
import { frames as frameCells, framesBoard } from "@/frames/contract";
import { Canvas, picRetryMs } from "@/viewer/canvas";

// The canvas in a real Chromium (the viewer-canvas chart, SPEC-viewer.md § Pan and zoom, § Watch
// an agent work, § Numbers). The server is the board alone over `memory`: its `docs` load reads a
// map and keeps each part it was asked for. The tab's clock is a test clock, so the test says when
// the camera rests (120 ms) and when the paint wait (1.5 s) runs out; animation frames are real.
// The pointer and the wheel are events sent to the canvas, as a mouse or a trackpad sends them.

const canvas = "home";

// SPEC-viewer.md § Numbers, written out here: a test that read them from the stage would move
// with a wrong one.
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
  /** The picture key the board carries; none: pictures are off. */
  k?: string;
};

/** Each frame's document on the "server", by id. */
const htmls = new Map<string, { version: number; html: string }>();
/** Each part the board's `docs` load was asked for. */
const loads: Record<string, unknown>[] = [];

const loadDocs = operation({
  label: "test.loadDocs",
  input: z.object({ canvas: z.string() }).catchall(z.unknown()),
  run: (_, { input }) => {
    loads.push(input);
    const id = typeof input.id === "string" ? input.id : "";
    const doc = htmls.get(id);

    return doc ? [{ canvas: input.canvas, id, ...doc }] : [];
  },
});

/** An agent's put: a new frame at version 1, or the next version of one. */
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
  }),
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async ({ cells, invalidate }, { input }) => {
    const { html, ...box } = input;
    const version = (htmls.get(input.id)?.version ?? 0) + 1;
    htmls.set(input.id, { version, html });
    cells.set({ ...box, canvas, version });
    await invalidate.run({ input: { docs: { canvas, id: input.id } } });
  },
});

/** An agent's delete. */
const drop = operation({
  label: "test.drop",
  input: z.string(),
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async ({ cells, invalidate }, { input }) => {
    htmls.delete(input);
    cells.delete({ canvas, id: input });
    await invalidate.run({ input: { docs: { canvas, id: input } } });
  },
});

/** A frame that paints at once, and one whose document never posts (its paint script is in a comment). */
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

/** 200 frames, 20 across and 10 down, 400 by 320 apart. */
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

/** A tab with the canvas, in a Profiler that counts React's commits. */
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

/** Waits `n` animation frames. */
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
/** The shell's picture: the img in its card. */
const picOf = (id: string) => cardOf(id)?.querySelector<HTMLImageElement>("img");
/** The picture is on top while its card shows. */
const cardHidden = (id: string) => cardOf(id)?.hidden;
const docOf = (id: string) => docs().find((d) => d.dataset.id === id);
const versionOf = (id: string) => docOf(id)?.dataset.version;
const srcdocOf = (id: string) => docOf(id)?.srcdoc;
const zoomText = () => page.getByRole("status", { name: "Zoom" }).element().textContent;
const emptyText = () => page.getByText("This canvas has no frames yet.");

type Tab = Awaited<ReturnType<typeof tab>>;

/** The tab's read of the canvas's frames: pending, ready, or a fault. */
const statusOf = (at: Tab) =>
  at.scope.resolve(frames.board.status(frames.board.frames.where({ canvas }))).get()?.status;

/** The tab's board says the link dropped. */
const lostOf = (at: Tab) => at.scope.resolve(frames.board.faults).get().frames?.fault === "link";

/** The camera rests: 120 ms on the tab's clock, then time for one iframe per animation frame. */
async function rest(clock: ReturnType<typeof makeTestClock>) {
  clock.advance(restMs);
  await rafs(liveCap + 6);
  await tick();
}

/** The tab drew `n` frames, placed them with Fit, and rested. */
async function opened(at: Awaited<ReturnType<typeof tab>>, n: number) {
  await expect.poll(() => shells().length).toBe(n);
  await rafs(2);
  await rest(at.clock);
}

/** A drag on the canvas, one pointer move at a time. */
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

/** Each shell lies inside the canvas, and shows. */
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

/** Each shell that overlaps the canvas shows (InViewShows). */
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

/** From the canvas's centre to a shell's nearest point, on screen. */
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
  // More frames are in view than may be live: the cap is what holds them back.
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
  // Each live frame is as near the centre as any frame that is not live.
  const cut = Math.max(...liveIds().map((id) => nearest.find((n) => n.id === id)?.d ?? Infinity));
  expect(nearest.filter((n) => n.d < cut).every((n) => liveIds().includes(n.id))).toBe(true);
  // Each document was read by its frame (of), never by its canvas (where).
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
  // Wheel pans, and Ctrl+wheel zooms, with the same hold.
  wheel({ deltaX: 40, deltaY: 30 });
  wheel({ deltaY: -5, ctrlKey: true });
  await rafs(liveCap + 6);
  await tick();
  expect(liveIds().toSorted()).toEqual(before);
  // The zoom stayed in its 10% step, so nothing on the page changed for React.
  expect(at.commits.n - commits).toBe(0);

  const handler = times.filter((_, i) => i % 2 === 0).toSorted((a, b) => a - b);
  const frame = times.filter((_, i) => i % 2 === 1).toSorted((a, b) => a - b);
  const p = (list: number[], q: number) => list[Math.floor((list.length - 1) * q)] ?? 0;
  console.log(
    `speed: pan, 60 moves: per move ${p(handler, 0.5).toFixed(2)} ms median, ${p(handler, 0.95).toFixed(2)} ms p95; frame time ${p(frame, 0.5).toFixed(1)} ms median, ${p(frame, 0.95).toFixed(1)} ms p95, ${p(frame, 1).toFixed(1)} ms max`,
  );
  expect(p(handler, 0.95)).toBeLessThan(8);

  // At rest the set follows the camera: 1500 px of pan brought other frames to the centre.
  await rest(at.clock);
  expect(liveIds()).toHaveLength(liveCap);
  expect(liveIds().toSorted()).not.toEqual(before);
});

test("the camera's arrows, on one frame: pan, far, rest, zoom under 30%, and Fit from each", async () => {
  const server = await boot([frame("a", 0, 0, { w: 400, h: 300 })]);
  const at = await tab(server);
  await opened(at, 1);
  const hidden = () => shellOf("a")?.hidden;
  // s0: at rest, in view, live.
  expect(hidden()).toBe(false);
  expect(liveIds()).toEqual(["a"]);
  await tick(0);
  expect(zoomText()).toBe("100%");

  drag(100, 0); // s0 to s2: moving, the shell shows
  expect(hidden()).toBe(false);
  await rest(at.clock); // s2 to s0
  expect(liveIds()).toEqual(["a"]);

  drag(3_000, 0); // s0 to s1: far, hidden in the same write
  expect(hidden()).toBe(true);
  expect(liveIds()).toEqual(["a"]);
  drag(-3_000, 0); // s1 to s2
  expect(hidden()).toBe(false);
  drag(3_000, 0); // s2 to s1
  expect(hidden()).toBe(true);
  await rest(at.clock); // s1 to s3: hidden at rest, and no longer live (s9 to s6)
  expect(hidden()).toBe(true);
  expect(liveIds()).toEqual([]);
  expect(cardHidden("a")).toBe(false);
  drag(2_000, 0); // s3 to s1
  expect(hidden()).toBe(true);
  await rest(at.clock);
  press("Fit"); // s3 to s2
  expect(hidden()).toBe(false);
  expectEveryFrameInView();
  await rest(at.clock);
  drag(3_000, 0);
  expect(hidden()).toBe(true);
  press("Fit"); // s1 to s2
  expectEveryFrameInView();
  await rest(at.clock);
  drag(1_800, 0); // a view and a bit away: it shows while moving, and hides at rest
  expect(hidden()).toBe(false);
  await rest(at.clock);
  expect(hidden()).toBe(true);
  drag(-1_800, 0); // s3 to s2
  expect(hidden()).toBe(false);
  await rest(at.clock); // s2 to s0
  press("Fit"); // s0 to s2
  expectEveryFrameInView();

  pressTimes("Zoom out", 6);
  await tick(0);
  // 26.2%: the status rounds down to its step.
  expect(zoomText()).toBe("20%");
  await rest(at.clock); // s2 to s4: in view under 30%, and not live
  expect(hidden()).toBe(false);
  expect(liveIds()).toEqual([]);
  drag(10, 0); // s4 to s2
  expect(hidden()).toBe(false);
  await rest(at.clock);
  press("Fit"); // s4 to s2
  expectEveryFrameInView();
  pressTimes("Zoom out", 6);
  await rest(at.clock);
  drag(4_000, 0); // s4 to s1
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

  // Ctrl+wheel: the point under the cursor stays under it.
  const corner = { x: box().left, y: box().top };
  wheel({ deltaY: -100, ctrlKey: true, clientX: corner.x, clientY: corner.y });
  expect(box().left).toBeCloseTo(corner.x, 0);
  expect(box().top).toBeCloseTo(corner.y, 0);
  expect(box().width).toBeCloseTo(400, 0);
  // A plain wheel pans.
  wheel({ deltaY: 100 });
  expect(box().top).toBeCloseTo(corner.y - 100, 0);

  // A pinch: two pointers twice as far apart zoom by two.
  const before = box().width;
  const one = grab(500, 400, 1);
  const two = grab(700, 400, 2);
  two.by(200, 0);
  one.release();
  two.release();
  expect(box().width).toBeCloseTo(before * 2, 0);
});

test("an agent's put shows, goes live at rest under its picture, and a new version puts the picture back until it paints", async () => {
  const server = await boot([frame("a", 0, 0)]);
  const at = await tab(server);
  await opened(at, 1);
  // s8 to s9: the document painted, so its picture came off.
  await expect.poll(() => cardHidden("a")).toBe(true);

  // A put mid-move shows its shell at once, and goes live only at rest (s5 to s6, s6 to s8).
  const hand = grab();
  hand.by(5, 0);
  await server.run(put, { input: frame("b", 360, 0, { html: silent }) });
  await expect.poll(() => shellOf("b")?.hidden).toBe(false);
  await rafs(liveCap);
  expect(liveIds()).toEqual(["a"]);
  hand.release();
  await rest(at.clock);
  expect(liveIds().toSorted()).toEqual(["a", "b"]);
  // NoBlankBox: a document that has not posted stays under its picture until the 1.5 s pass.
  expect(cardHidden("b")).toBe(false);
  at.clock.advance(paintCapMs - restMs - 1);
  await tick();
  expect(cardHidden("b")).toBe(false);
  at.clock.advance(restMs + 1);
  await tick();
  expect(cardHidden("b")).toBe(true);

  // s9 to s8 (ShowsLatest): the agent writes "a" again; the new version loads under its picture.
  await server.run(put, { input: frame("a", 0, 0, { html: silent }) });
  await expect.poll(() => versionOf("a")).toBe("2");
  expect(cardHidden("a")).toBe(false);
  expect(srcdocOf("a")).toContain("still loading");
  at.clock.advance(paintCapMs);
  await tick();
  expect(cardHidden("a")).toBe(true);

  // s9 to s6: out of view at rest, "b" stops, and its picture is on top at once. "a" was written
  // once more and has not painted: s8 to s6, it stops while it loads.
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

  // Deleted while loading (s8 to s7): a frame live with no paint yet goes too.
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
  expect(shells()).toHaveLength(0);

  // s5 to s6: the put shows its shell, and the camera has not rested yet.
  await server.run(put, { input: frame("a", 0, 0, { html: silent }) });
  await expect.poll(() => shells()).toHaveLength(1);
  expect(emptyText().elements()).toHaveLength(0);
  await rafs(2);
  expectEveryFrameInView();
  expect(liveIds()).toEqual([]);

  // s6 to s7: deleted before the camera rests, so it never went live.
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
  // A sandbox without allow-same-origin gives the page no way into the document.
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

  // A new iframe, which has not posted and whose 1.5 s have not passed: no white box (NoBlankBox).
  drag(4_000, 0);
  await rest(at.clock);
  expect(liveIds()).toEqual(["a"]);
  expect(cardHidden("a")).toBe(false);
});

test("the margins: live within 0.1 of a view, stays live to 0.5; a shell shows within 0.5 and hides at rest past 0.75", async () => {
  const server = await boot([frame("a", 0, 0, { w: 400, h: 300 })]);
  const at = await tab(server);
  await opened(at, 1);
  // Fit put the frame at 400 to 800 of a 1200 px view. `out` is how far its left edge is past the
  // view's right edge, in views.
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
  // Between 0.5 and 0.75, a hidden shell stays hidden.
  await to(0.6);
  expect(hidden()).toBe(true);
  // Within 0.5 the shell is back, and not live yet; past 0.1 it is still not live.
  await to(0.4);
  expect(hidden()).toBe(false);
  expect(liveIds()).toEqual([]);
  await to(0.2);
  expect(liveIds()).toEqual([]);

  await to(0.05);
  expect(liveIds()).toEqual(["a"]);
  // A live frame stays live to 0.5.
  await to(0.4);
  expect(liveIds()).toEqual(["a"]);
  // Past 0.5 it stops; its shell, which showed, still shows under 0.75; past 0.75 at rest it hides.
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

  // A tall board: 12 more frames under the grid's first column.
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

  // Far enough that a settle now would pick other frames.
  const hand = grab();
  hand.by(-1_500, -700);
  await server.run(drop, { input: gone });
  await expect.poll(() => shellOf(gone)).toBeUndefined();
  await rafs(liveCap);
  await tick();
  expect(liveIds().toSorted()).toEqual(before.filter((id) => id !== gone).toSorted());

  // The agent puts it back, still mid-pan: a frame added mid-move waits for the rest, so the
  // deleted one left the live set and did not just leave the page.
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

  // "a" is now 0.75 of a view out: at rest it would stop.
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
  // Pictures off: no key, so the shell is a plain card with no picture to ask for.
  expect(picOf("off")).toBeNull();
  expect(cardOf("off")).toBeTruthy();

  // A new version brings its own key: the picture moves to it, on top until the document paints.
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
  // No server draws here: each try fails, as a 503 does, and each is one error.
  const errors = { n: 0 };
  const onError = (event: Event) => {
    if (event.target instanceof HTMLImageElement) errors.n++;
  };
  document.addEventListener("error", onError, true);
  onTestFinished(() => document.removeEventListener("error", onError, true));
  const server = await boot([frame("a", 0, 0, { k: "key-a1", html: silent })]);
  const at = await tab(server);
  // No rest: the tab's clock moves only by the waits below.
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

  // The fourth failed too: no more tries, the card stays, with the same img and address.
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

  // 32 MP at 0.5 is 8 MP, the limit; 80 MP at 0.25 is 5 MP; 128 MP at 0.25 is 8 MP, the limit;
  // 256 MP at 0.25 is 16 MP: a card.
  expect(picOf("small")?.getAttribute("src")).toBe(`/api/pictures/${canvas}/small/1?s=0.5&k=key-s`);
  expect(picOf("big")?.getAttribute("src")).toBe(`/api/pictures/${canvas}/big/1?s=0.25&k=key-b`);
  expect(picOf("edge")?.getAttribute("src")).toBe(`/api/pictures/${canvas}/edge/1?s=0.25&k=key-e`);
  expect(picOf("huge")).toBeNull();
  expect(cardOf("huge")).toBeTruthy();
});
