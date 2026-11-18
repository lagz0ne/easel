import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { exits } from "@tinkered/cli/test";
import { createScope, operation, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser/context";
import { z } from "zod";

import { frames } from "@/frames";
import { frames as frameCells, framesBoard } from "@/frames/contract";
import { passMeta, shareApi } from "@/frames/share";
import { routeTree } from "@/routes";
import { gates, nameKey, openLink, tabMeta } from "@/viewer/gate";

// In a real Chromium: the share link's page over `memory`, with the app's own routes (the
// viewer-gate-open chart). The server here stands in for share.server.ts, which needs SQLite.
// Each link the stub knows plays one case; any other link is gone:
// - `live` opens to `home` with the pass the guard takes;
// - `stale` opens twice with a pass the guard turns away, as a link that ends after it opened,
//   then is gone: a page that opened it a third time would end on that, with 3 calls, not loop;
// - `evicted` opens first with a pass the guard turns away (the link's oldest, trimmed past
//   1000), then with a good one;
// - `flooded` answers `slow` twice (the flood limit), then opens;
// - `stuck` answers `slow`, then opens with a pass the guard turns away.

const live = "a".repeat(32);
const stale = "b".repeat(32);
const evicted = "c".repeat(32);
const flooded = "f".repeat(32);
const stuck = "9".repeat(32);
const pass = "1".repeat(32);
const badPass = "d".repeat(32);

/** `share.open` calls the stub answered, by link. */
const calls = new Map<string, number>();
const callsTo = (link: string) => calls.get(link) ?? 0;
const allCalls = () => [...calls.values()].reduce((a, b) => a + b, 0);

/** What `share.open` answers. */
type Answer =
  | { kind: "open"; canvas: string; pass: string }
  | { kind: "slow"; retryIn: number }
  | { kind: "gone" };

const opened = (p: string) => ({ kind: "open" as const, canvas: "home", pass: p });
const slow = { kind: "slow" as const, retryIn: 5_000 };
const gone = { kind: "gone" as const };

/** Each link the stub knows: its answer to the n-th call. */
const answers = new Map<string, (n: number) => Answer>([
  [live, () => opened(pass)],
  [stale, (n: number) => (n <= 2 ? opened(badPass) : gone)],
  [evicted, (n: number) => opened(n === 1 ? badPass : pass)],
  [flooded, (n: number) => (n <= 2 ? slow : opened(pass))],
  [stuck, (n: number) => (n === 1 ? slow : opened(badPass))],
]);

const open = operation({
  label: "test.shareOpen",
  input: shareApi["share.open"].input,
  run: (_, { input }) => {
    const n = callsTo(input.link) + 1;
    calls.set(input.link, n);

    return answers.get(input.link)?.(n) ?? gone;
  },
});

/** `mayRead`'s pass half: the pass for `home` reads `home`; any other read has ended. */
const passOnly = operation({
  label: "test.passOnly",
  input: transport.hook.start,
  run: (_, { input }) =>
    passMeta.safeParse(input.meta).data?.pass === pass && framesBoard.part(input)?.canvas === "home"
      ? undefined
      : input.refuse({ ended: true }),
});

const putFrame = operation({
  label: "test.putFrame",
  input: z.object({ id: z.string(), name: z.string() }),
  depends: { cells: frameCells.controller },
  run: ({ cells }, { input }) =>
    cells.set({ ...input, canvas: "home", x: 0, y: 0, w: 100, h: 100, version: 1 }),
});

async function boot() {
  calls.clear();
  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      frames.board({ serve: true, onStart: [passOnly] }),
      frames.viewer({ implement: { "share.open": open } }),
      memory.server({ services: [frames.board, frames.viewer] }),
    ],
  }).ready;
  server.run(putFrame, { input: { id: "f1", name: "Home" } });

  return server;
}

/** A tab: its own scope and clock, and the app's routes drawn at `path`. */
async function tab(server: Scope.Handle, path: string) {
  const clock = makeTestClock();
  const scope = await createScope({
    clock,
    capsules: [
      exits({ store: localStorage }),
      memory.client({ peer: server, meta: tabMeta }),
      frames.board({ read: memory.client }),
      frames.viewer({ remote: memory.client }),
    ],
  }).ready;

  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history, context: { scope } });
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  // A test that fails leaves no page behind for the next one.
  onTestFinished(() => root.unmount());
  root.render(
    <ScopeProvider scope={scope}>
      <RouterProvider router={router} />
    </ScopeProvider>,
  );

  return { scope, root, clock, history };
}

/** The tab's gate cell for a link, as the page reads it. */
const gateOf = operation({
  label: "test.gateOf",
  input: z.string(),
  depends: { pages: gates.controller },
  run: ({ pages }, { input }) => pages.of({ link: input }).get(),
});

const tick = (ms = 50) => new Promise((done) => setTimeout(done, ms));

/** Every role a viewer could press, type in, pick or follow. */
const interactive = [
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "slider",
  "spinbutton",
  "menuitem",
  "tab",
] as const;

/** The page shows no control at all: the ended page's. */
function expectNoControl() {
  for (const role of interactive) {
    expect(page.getByRole(role).elements(), role).toHaveLength(0);
  }
}

/** The canvas's CanvasControls: Zoom in, Zoom out and Fit, and no other control. */
function expectCanvasControlsOnly() {
  for (const role of interactive.filter((r) => r !== "button")) {
    expect(page.getByRole(role).elements(), role).toHaveLength(0);
  }
  const buttons = page
    .getByRole("button")
    .elements()
    .map((b) => b.textContent);
  expect(buttons.toSorted()).toEqual(["Fit", "Zoom in", "Zoom out"]);
}

const frameList = () => page.getByRole("region", { name: "Frames" });
const reconnecting = () => page.getByRole("status").filter({ hasText: "Reconnecting" });
const endedHeading = () => page.getByRole("heading", { name: "This link has ended" });

test("the name is asked once per browser, before any call; then the canvas shows its frames live, names as text, with only the camera's controls", async () => {
  localStorage.removeItem(nameKey);
  const server = await boot();
  const first = await tab(server, `/s/${live}`);

  await expect.element(page.getByLabelText("Your name")).toBeVisible();
  expect(allCalls()).toBe(0);
  await page.getByLabelText("Your name").fill("  Bo  ");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.element(frameList().getByText("Home")).toBeVisible();
  expect(localStorage.getItem(nameKey)).toBe("Bo");
  expect(callsTo(live)).toBe(1);

  // A frame name is text: markup in it is shown, never drawn.
  server.run(putFrame, { input: { id: "f2", name: "<b>Checkout</b>" } });
  await expect.element(frameList().getByText("<b>Checkout</b>")).toBeVisible();
  expect(document.querySelector('section[aria-label="Frames"] b')).toBeNull();
  expectCanvasControlsOnly();
  first.root.unmount();
  await first.scope.close();

  // Another tab of the same browser, with a session of its own: no gate, straight to the canvas.
  sessionStorage.clear();
  const second = await tab(server, `/s/${live}`);
  await expect.element(frameList().getByText("<b>Checkout</b>")).toBeVisible();
  expect(page.getByLabelText("Your name").elements()).toHaveLength(0);
  expectCanvasControlsOnly();

  await second.scope.close();
  await server.close();
});

test("an unknown link, a path that is no link, and a pass turned away twice each show only the ended page", async () => {
  localStorage.setItem(nameKey, "Bo");
  const server = await boot();

  for (const path of [`/s/${"e".repeat(32)}`, "/s/not-a-link", `/s/${stale}`]) {
    const shown = await tab(server, path);

    await expect.element(endedHeading()).toBeVisible();
    expectNoControl();
    expect(frameList().elements()).toHaveLength(0);

    shown.root.unmount();
    await shown.scope.close();
  }
  // The link with a pass turned away was opened once more before the page said it ended.
  expect(callsTo(stale)).toBe(2);
  expect(calls.has("not-a-link")).toBe(false);

  await server.close();
});

test("the name gate on an unknown link leads to the ended page (s2 to s3)", async () => {
  localStorage.removeItem(nameKey);
  const server = await boot();
  const shown = await tab(server, `/s/${"e".repeat(32)}`);

  await page.getByLabelText("Your name").fill("Bo");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.element(endedHeading()).toBeVisible();
  expectNoControl();

  await shown.scope.close();
  await server.close();
});

test("a pass the server ended while the link is live opens the link once more, and the canvas shows", async () => {
  localStorage.setItem(nameKey, "Bo");
  const server = await boot();
  const shown = await tab(server, `/s/${evicted}`);

  await expect.element(frameList().getByText("Home")).toBeVisible();
  expect(callsTo(evicted)).toBe(2);
  expect(endedHeading().elements()).toHaveLength(0);
  // Its read is back: a pass trimmed once more, later, opens the link once more too.
  await expect
    .poll(() => shown.scope.run(gateOf, { input: evicted }))
    .toMatchObject({ page: "canvas", again: false });

  await shown.scope.close();
  await server.close();
});

test("a dropped link says Reconnecting, and the frames read so far stay", async () => {
  localStorage.setItem(nameKey, "Bo");
  const server = await boot();
  const shown = await tab(server, `/s/${live}`);
  await expect.element(frameList().getByText("Home")).toBeVisible();
  expect(reconnecting().elements()).toHaveLength(0);

  await server.close();
  // The board knows the link dropped; then the page must say so, by then and not later.
  await expect
    .poll(() => shown.scope.resolve(frames.board.faults).get().frames?.fault)
    .toBe("link");
  await tick();
  expect(reconnecting().elements()).toHaveLength(1);
  expect(frameList().getByText("Home").elements()).toHaveLength(1);

  await shown.scope.close();
});

test("past the flood limit the page stays on Opening, with no wait page, and calls again after retryIn each time", async () => {
  localStorage.removeItem(nameKey);
  // The jitter, pinned: half of its 1 s.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  onTestFinished(() => void vi.restoreAllMocks());
  const server = await boot();
  const shown = await tab(server, `/s/${flooded}`);

  await page.getByLabelText("Your name").fill("Bo");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("Opening.");
  expect(callsTo(flooded)).toBe(1);
  expectNoControl();
  expect(page.getByRole("heading").elements()).toHaveLength(0);
  expect(page.getByRole("alert").elements()).toHaveLength(0);

  // retryIn is 5 s, and the page adds up to 1 s (here 0.5 s) so tabs slowed together spread out.
  shown.clock.advance(5_499);
  await tick();
  expect(callsTo(flooded)).toBe(1);
  shown.clock.advance(1);
  await expect.poll(() => callsTo(flooded)).toBe(2);
  await expect.element(page.getByRole("status")).toHaveTextContent("Opening.");
  shown.clock.advance(6_000);
  await expect.element(frameList().getByText("Home")).toBeVisible();
  expect(callsTo(flooded)).toBe(3);
  shown.root.unmount();
  await shown.scope.close();

  // With the name kept, the slow comes while the route loads: the page says Opening there too.
  calls.clear();
  const again = await tab(server, `/s/${flooded}`);
  await expect.element(page.getByRole("status")).toHaveTextContent("Opening.");
  expect(page.getByRole("heading").elements()).toHaveLength(0);
  again.clock.advance(6_000);
  await expect.poll(() => callsTo(flooded)).toBe(2);
  again.clock.advance(6_000);
  await expect.element(frameList().getByText("Home")).toBeVisible();

  await again.scope.close();
  await server.close();
});

test("leaving a link mid-retry stops its loop, and a late answer for another link never takes the shown link's pass", async () => {
  localStorage.setItem(nameKey, "Bo");
  const server = await boot();
  const shown = await tab(server, `/s/${stuck}`);
  await expect.element(page.getByRole("status")).toHaveTextContent("Opening.");
  expect(callsTo(stuck)).toBe(1);

  // The tab goes to another link while `stuck` waits out its retryIn: that loader is aborted.
  shown.history.push(`/s/${live}`);
  await expect.element(frameList().getByText("Home")).toBeVisible();
  shown.clock.advance(10_000);
  await tick(100);
  expect(callsTo(stuck)).toBe(1);

  // A run of `stuck` that nothing aborts (no signal) answers late, after the tab opened `live`
  // again, with a pass turned away: it is kept for `stuck`, and the tab still sends `live`'s.
  calls.delete(stuck);
  const late = shown.scope.run(openLink, { input: { link: stuck } });
  await expect.poll(() => callsTo(stuck)).toBe(1);
  await shown.scope.run(openLink, { input: { link: live } });
  shown.clock.advance(10_000);
  await late;
  expect(callsTo(stuck)).toBe(2);
  expect(await shown.scope.run(tabMeta)).toMatchObject({ pass });
  await expect.element(frameList().getByText("Home")).toBeVisible();
  expect(endedHeading().elements()).toHaveLength(0);

  await shown.scope.close();
  await server.close();
});
