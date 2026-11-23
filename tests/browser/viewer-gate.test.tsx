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
import { gates, keepName, nameKey, openLink, tabMeta } from "@/viewer/gate";

// In a real Chromium: the share link's page over `memory`, with the app's own routes (the
// viewer-gate-password chart). The page asks no name at the link; a name this browser kept rides
// `share.open`. The server here stands in for share.server.ts, which needs SQLite.
// Each link the stub knows plays one case; any other link is gone:
// - `live` opens to `home` with the pass the guard takes;
// - `stale` opens twice with a pass the guard turns away, as a link that ends after it opened,
//   then is gone: a page that opened it a third time would end on that, with 3 calls, not loop;
// - `evicted` opens first with a pass the guard turns away (the link's oldest, trimmed past
//   1000), then with a good one;
// - `flooded` answers `slow` twice (the flood limit), then opens;
// - `stuck` answers `slow`, then opens with a pass the guard turns away;
// - `guarded` asks a password: none answers `locked`, `rightPw` opens with a new pass each time,
//   `waitPw` starts a lock of a minute on the stub's clock (as the 5th wrong try does) and answers
//   `slow`; in the lock every try answers `slow` with the time left, even `rightPw`; any other
//   password is `wrong`. The test
//   locks its passes (a password set or changed) or ends it (unshare) and pushes the refusal, as
//   share.server.ts does.

const live = "a".repeat(32);
const stale = "b".repeat(32);
const evicted = "c".repeat(32);
const flooded = "f".repeat(32);
const stuck = "9".repeat(32);
const guarded = "7".repeat(32);
const pass = "1".repeat(32);
const badPass = "d".repeat(32);
const rightPw = "correct horse";
const waitPw = "after five wrong";

/**
 * The `guarded` link's server side: its passes, which of them a password change locked, whether
 * it ended, and the end of its lock (none: no lock), on `stubClock`.
 */
const guard: { passes: Set<string>; locked: Set<string>; ended: boolean; lockEnds: number | null } =
  { passes: new Set(), locked: new Set(), ended: false, lockEnds: null };

/** The stub server's clock: a test moves it with the tab's. */
let stubClock = makeTestClock();

/** `share.open` calls the stub answered, by link. */
const calls = new Map<string, number>();
/** The name each `share.open` call sent, in order: undefined for none. */
const sentNames: Array<string | undefined> = [];
const callsTo = (link: string) => calls.get(link) ?? 0;

/** What `share.open` answers. */
type Answer =
  | { kind: "open"; canvas: string; pass: string }
  | { kind: "slow"; retryIn: number }
  | { kind: "locked" }
  | { kind: "wrong" }
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

/** `guarded`'s answer to the n-th call, with `password` or none. */
const guardedAnswer = (n: number, password?: string): Answer => {
  if (guard.ended) return gone;
  if (password === undefined) return { kind: "locked" };
  const now = stubClock.currentTimeMillis();
  if (password === waitPw) guard.lockEnds = now + 60_000;
  if (guard.lockEnds !== null && now < guard.lockEnds) {
    return { kind: "slow", retryIn: guard.lockEnds - now };
  }
  if (password !== rightPw) return { kind: "wrong" };

  const given = n.toString(16).padStart(32, "2");
  guard.passes.add(given);
  return opened(given);
};

const open = operation({
  label: "test.shareOpen",
  input: shareApi["share.open"].input,
  run: (_, { input }) => {
    const n = callsTo(input.link) + 1;
    calls.set(input.link, n);
    sentNames.push(input.name);

    return input.link === guarded
      ? guardedAnswer(n, input.password)
      : (answers.get(input.link)?.(n) ?? gone);
  },
});

/** What the guard refuses a read of `home` with `held`; none when it may read. */
const refusalOf = (held: string) => {
  if (held === pass) return undefined;
  if (!guard.passes.has(held) || guard.ended) return { ended: true };

  return guard.locked.has(held) ? { locked: true } : undefined;
};

/**
 * `mayRead`'s pass half: the pass for `home` reads `home`, as does a live pass of `guarded`; a
 * pass a password change locked is refused `locked`; any other read has ended.
 */
const passOnly = operation({
  label: "test.passOnly",
  input: transport.hook.start,
  run: (_, { input }) => {
    const held = passMeta.safeParse(input.meta).data?.pass ?? "";
    const refusal = framesBoard.part(input)?.canvas === "home" ? refusalOf(held) : { ended: true };

    return refusal ? input.refuse(refusal) : undefined;
  },
});

/** A password set or changed on `guarded` (every pass locked), or an unshare; then the push. */
const changeGuarded = operation({
  label: "test.changeGuarded",
  input: z.enum(["password", "unshare"]),
  depends: { invalidate: framesBoard.invalidate },
  run: async ({ invalidate }, { input }) => {
    if (input === "password") for (const given of guard.passes) guard.locked.add(given);
    else guard.ended = true;
    await invalidate.run({ input: { frames: { canvas: "home" }, docs: { canvas: "home" } } });
  },
});

const putFrame = operation({
  label: "test.putFrame",
  input: z.object({ id: z.string(), name: z.string() }),
  depends: { cells: frameCells.controller },
  run: ({ cells }, { input }) =>
    cells.set({ ...input, canvas: "home", x: 0, y: 0, w: 100, h: 100, version: 1 }),
});

async function boot() {
  localStorage.removeItem(nameKey);
  calls.clear();
  sentNames.length = 0;
  guard.passes.clear();
  guard.locked.clear();
  guard.ended = false;
  guard.lockEnds = null;
  stubClock = makeTestClock();
  const server = await createScope({
    clock: stubClock,
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

/** The canvas's controls: Request, Requests, Zoom in, Zoom out and Fit, and no other control. */
function expectCanvasControlsOnly() {
  for (const role of interactive.filter((r) => r !== "button")) {
    expect(page.getByRole(role).elements(), role).toHaveLength(0);
  }
  const buttons = page
    .getByRole("button")
    .elements()
    .map((b) => b.getAttribute("aria-label") ?? b.textContent);
  expect(buttons.toSorted()).toEqual(["Fit", "Request", "Requests", "Zoom in", "Zoom out"]);
}

const frameList = () => page.getByRole("region", { name: "Frames" });
const reconnecting = () => page.getByRole("status").filter({ hasText: "Reconnecting" });
const endedHeading = () => page.getByRole("heading", { name: "This link does not work" });

test("the link opens with no name asked and none kept, then the canvas shows its frames live, names as text, with only Request, Requests and the camera's controls (s0 to s1, NameNotAtTheGate)", async () => {
  const server = await boot();
  const first = await tab(server, `/s/${live}`);

  await expect.element(frameList().getByText("Home")).toBeVisible();
  expect(page.getByLabelText("Your name").elements()).toHaveLength(0);
  expect(callsTo(live)).toBe(1);
  expect(sentNames).toEqual([undefined]);
  expect(localStorage.getItem(nameKey)).toBeNull();

  // A frame name is text: markup in it is shown, never drawn.
  server.run(putFrame, { input: { id: "f2", name: "<b>Checkout</b>" } });
  await expect.element(frameList().getByText("<b>Checkout</b>")).toBeVisible();
  expect(document.querySelector('section[aria-label="Frames"] b')).toBeNull();
  expectCanvasControlsOnly();
  first.root.unmount();
  await first.scope.close();

  await server.close();
});

test("a name this browser kept, trimmed, rides share.open in each tab; a kept name out of bounds is not sent", async () => {
  const server = await boot();
  const first = await tab(server, `/s/${live}`);
  await expect.element(frameList().getByText("Home")).toBeVisible();
  first.scope.run(keepName, { input: "  Bo  " });
  expect(localStorage.getItem(nameKey)).toBe("Bo");
  first.root.unmount();
  await first.scope.close();

  // Another tab of the same browser, with a session of its own: it sends the kept name.
  sessionStorage.clear();
  const second = await tab(server, `/s/${live}`);
  await expect.element(frameList().getByText("Home")).toBeVisible();
  expect(sentNames).toEqual([undefined, "Bo"]);
  second.root.unmount();
  await second.scope.close();

  localStorage.setItem(nameKey, "x".repeat(41));
  const third = await tab(server, `/s/${live}`);
  await expect.element(frameList().getByText("Home")).toBeVisible();
  expect(sentNames).toEqual([undefined, "Bo", undefined]);

  await third.scope.close();
  await server.close();
});

test("an unknown link, a path that is no link, and a pass turned away twice each show only the ended page, with no name asked first (s0 to s3)", async () => {
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

test("a pass the server ended while the link is live opens the link once more, and the canvas shows", async () => {
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
  // The jitter, pinned: half of its 1 s.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  onTestFinished(() => void vi.restoreAllMocks());
  const server = await boot();
  const shown = await tab(server, `/s/${flooded}`);

  // The slow comes while the route loads: the page says Opening there, to a screen reader only.
  // The eye sees the empty canvas, as in Figma and Miro (user, 2026-11-23).
  await expect.element(page.getByRole("status")).toHaveTextContent("Opening the link");
  expect(getComputedStyle(page.getByRole("status").element()).clipPath).toBe("inset(50%)");
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
  await expect.element(page.getByRole("status")).toHaveTextContent("Opening the link");
  shown.clock.advance(6_000);
  await expect.element(frameList().getByText("Home")).toBeVisible();
  expect(callsTo(flooded)).toBe(3);

  await shown.scope.close();
  await server.close();
});

test("leaving a link mid-retry stops its loop, and a late answer for another link never takes the shown link's pass", async () => {
  const server = await boot();
  const shown = await tab(server, `/s/${stuck}`);
  await expect.element(page.getByRole("status")).toHaveTextContent("Opening the link");
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

const passwordBox = () => page.getByLabelText("Password");
const openButton = () => page.getByRole("button", { name: "Open" });
const passwordHeading = () => page.getByRole("heading", { name: "This link needs a password" });

const changedHeading = () =>
  page.getByRole("heading", { name: "The password of this link changed" });

/** Types `password` on the password page and presses Open. */
async function enter(password: string) {
  await passwordBox().fill(password);
  await openButton().click();
}

test("a password link asks the password at once, with no name, and never says to wait first; a wrong one says so; the right one shows the canvas (s0 to s2, s2 to s1, OpenWithoutPasswordIsNeverSlow)", async () => {
  const server = await boot();
  const shown = await tab(server, `/s/${guarded}`);

  await expect.element(passwordHeading()).toBeVisible();
  expect(page.getByLabelText("Your name").elements()).toHaveLength(0);
  expect(passwordBox().element()).toHaveAttribute("type", "password");
  expect(page.getByRole("alert").elements()).toHaveLength(0);
  expect(frameList().elements()).toHaveLength(0);

  await enter("not the password");
  await expect.element(page.getByRole("alert")).toHaveTextContent("That password is wrong.");
  expect(frameList().elements()).toHaveLength(0);
  await enter(rightPw);
  await expect.element(frameList().getByText("Home")).toBeVisible();
  expectCanvasControlsOnly();
  // Its calls: the open, the wrong try and the right one, none with a name.
  expect(callsTo(guarded)).toBe(3);
  expect(sentNames).toEqual([undefined, undefined, undefined]);

  await shown.scope.close();
  await server.close();
});

test("with the name kept, the open and the password try send it (s0 to s2); the password is never kept in the browser", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Bo");
  const shown = await tab(server, `/s/${guarded}`);

  await expect.element(passwordHeading()).toBeVisible();
  await enter(rightPw);
  await expect.element(frameList().getByText("Home")).toBeVisible();
  expect(sentNames).toEqual(["Bo", "Bo"]);
  const kept = JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]);
  expect(kept).not.toContain(rightPw);

  await shown.scope.close();
  await server.close();
});

test("past 5 wrong tries the page says to wait; the right password 20 s later does not open, and says to wait the 40 s left of the minute from the 5th; then the alert is gone and it opens (s2 to s5, s5 to s2, WaitMeansWait, TheLockLastsAMinute)", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  onTestFinished(() => void vi.restoreAllMocks());
  const server = await boot();
  const shown = await tab(server, `/s/${guarded}`);
  await expect.element(passwordHeading()).toBeVisible();
  const advance = (ms: number) => {
    stubClock.advance(ms);
    shown.clock.advance(ms);
  };
  const waitText =
    "Too many wrong passwords. Wait 1 minute, then try again. Until then, no password opens the link.";

  await enter(waitPw);
  await expect.element(page.getByRole("alert")).toHaveTextContent(waitText);
  expect(frameList().elements()).toHaveLength(0);
  await expect
    .poll(() => shown.scope.run(gateOf, { input: guarded }))
    .toEqual({ link: guarded, page: "password", alert: "wait", changed: false });

  // 20 s into the lock, the right password: the server answers slow with the 40 s left.
  advance(20_000);
  const before = callsTo(guarded);
  await enter(rightPw);
  await expect.poll(() => callsTo(guarded)).toBe(before + 1);
  await tick();
  await expect.element(page.getByRole("alert")).toHaveTextContent(waitText);
  expect(frameList().elements()).toHaveLength(0);

  // The page waits the 40 s and up to 1 s more (here 0.5 s).
  advance(40_499);
  await tick();
  expect(page.getByRole("alert").elements()).toHaveLength(1);
  advance(1);
  await expect.poll(() => page.getByRole("alert").elements().length).toBe(0);
  await expect.element(passwordHeading()).toBeVisible();
  await enter(rightPw);
  await expect.element(frameList().getByText("Home")).toBeVisible();

  await shown.scope.close();
  await server.close();
});

test("a password set or changed while the canvas shows takes the tab back to the password page at once, which says the password changed (E3 S4); a wrong one keeps that; the new password shows the canvas again (s1 to s2, LockPushedAtOnce)", async () => {
  const server = await boot();
  const shown = await tab(server, `/s/${guarded}`);
  await expect.element(passwordHeading()).toBeVisible();
  expect(changedHeading().elements()).toHaveLength(0);
  await enter(rightPw);
  await expect.element(frameList().getByText("Home")).toBeVisible();
  const before = callsTo(guarded);

  await server.run(changeGuarded, { input: "password" });
  await expect.element(changedHeading()).toBeVisible();
  expect(
    page
      .getByText("Enter the new password to see the canvas again. Ask the person who shared it.")
      .elements(),
  ).toHaveLength(1);
  expect(passwordHeading().elements()).toHaveLength(0);
  expect(frameList().elements()).toHaveLength(0);
  // It asks; it does not open the link again on its own.
  expect(callsTo(guarded)).toBe(before);
  expect(await shown.scope.run(tabMeta)).not.toHaveProperty("pass");
  await enter("not the password");
  await expect.element(page.getByRole("alert")).toHaveTextContent("That password is wrong.");
  expect(changedHeading().elements()).toHaveLength(1);

  await enter(rightPw);
  await expect.element(frameList().getByText("Home")).toBeVisible();
  expect(endedHeading().elements()).toHaveLength(0);

  await shown.scope.close();
  await server.close();
});

test("an unshare while the canvas shows takes the tab to the ended page at once, and it stays there (s1 to s3, EndPushedAtOnce, EndedStaysEnded)", async () => {
  const server = await boot();
  const shown = await tab(server, `/s/${guarded}`);
  await enter(rightPw);
  await expect.element(frameList().getByText("Home")).toBeVisible();

  await server.run(changeGuarded, { input: "unshare" });
  await expect.element(endedHeading()).toBeVisible();
  expectNoControl();
  expect(frameList().elements()).toHaveLength(0);
  await tick(200);
  await expect.element(endedHeading()).toBeVisible();

  await shown.scope.close();
  await server.close();
});

test("Open on the password page of a link that has ended shows the ended page, from the wait too (s2 to s3, s5 to s3)", async () => {
  const server = await boot();

  for (const first of [null, waitPw]) {
    guard.ended = false;
    const shown = await tab(server, `/s/${guarded}`);
    await expect.element(passwordHeading()).toBeVisible();

    if (first) {
      await enter(first);
      await expect.element(page.getByRole("alert")).toBeVisible();
    }
    guard.ended = true;
    await enter(rightPw);
    await expect.element(endedHeading()).toBeVisible();
    expectNoControl();

    shown.root.unmount();
    await shown.scope.close();
  }

  await server.close();
});
