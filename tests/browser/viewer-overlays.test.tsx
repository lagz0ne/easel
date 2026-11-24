import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { exits } from "@tinkered/cli/test";
import { createScope, operation, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";

import { frames } from "@/frames";
import { frames as frameCells, pages } from "@/frames/contract";
import { passApi, passMeta, shareApi } from "@/frames/share";
import { queue } from "@/queue";
import { messages, requests, serverClock } from "@/queue/cells";
import type { Message, Request } from "@/queue/cells";
import { routeTree } from "@/routes";
import { openedKey, visitKey } from "@/viewer/follow";
import { nameKey, tabMeta } from "@/viewer/gate";

import { frameOnPage } from "./frame-page";

const live = "e".repeat(32);
const pass = "5".repeat(32);
const canvas = "home";
const serverNow = 1_800_000_000_000;
const startUrl = location.href;

const box = { w: 300, h: 200, version: 1, status: "exploring" as const };

const open = operation({
  label: "test.overlaysOpen",
  input: shareApi["share.open"].input,
  run: () => ({ kind: "open" as const, canvas, pass }),
});

const nameIt = operation({
  label: "test.overlaysName",
  input: passApi["share.name"].input,
  run: (_, { input }) => ({ kind: "named" as const, name: input.name }),
});

const passOnly = operation({
  label: "test.overlaysPass",
  input: transport.hook.start,
  run: (_, { input }) =>
    passMeta.safeParse(input.meta).data?.pass === pass ? undefined : input.refuse({ ended: true }),
});

const asked: Request = {
  canvas,
  id: "r1",
  n: 1,
  page: "page-1",
  frameId: null,
  version: null,
  kit: 1,
  x: 40,
  y: 50,
  author: "Mai",
  key: "key-1".padEnd(16, "-"),
  status: "open",
  claimedBy: null,
  claimedUntil: null,
  claimedAt: null,
  tries: 0,
  queuedAt: serverNow - 1,
  acceptedBy: null,
  created: serverNow - 1,
  updated: serverNow - 1,
};

const ask: Message = {
  canvas,
  id: "m1",
  request: "r1",
  kind: "ask",
  from: "Mai",
  text: "Make the logo bigger.",
  html: null,
  options: null,
  option: null,
  before: null,
  after: null,
  beforeKit: null,
  afterKit: null,
  created: serverNow - 1,
};

const seed = operation({
  label: "test.overlaysSeed",
  depends: {
    cells: frameCells.controller,
    list: pages.controller,
    rows: requests.controller,
    thread: messages.controller,
    clocks: serverClock.controller,
  },
  run: ({ cells, list, rows, thread, clocks }) => {
    cells.set({ canvas, id: "a1", name: "Alpha", page: "page-1", x: 0, y: 0, ...box });
    cells.set({ canvas, id: "c2", name: "Gamma", page: "two", x: 0, y: 0, ...box });

    list.set({ canvas, key: "page-1", name: "Page 1", order: 0, frames: 1 });
    list.set({ canvas, key: "two", name: "Two", order: 1, frames: 1 });

    clocks.set({ canvas, now: serverNow });
    rows.set(asked);
    thread.set(ask);
  },
});

async function serve() {
  localStorage.removeItem(nameKey);
  localStorage.removeItem(visitKey + canvas);
  localStorage.removeItem(openedKey + canvas);
  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      frames.board({ serve: true, onStart: [passOnly] }),
      frames.viewer({ implement: { "share.open": open } }),
      frames.pass({
        implement: { "share.name": nameIt, "share.frame": frameOnPage },
        onStart: [passOnly],
      }),
      memory.server({ services: [frames.board, frames.viewer, frames.pass] }),
    ],
  }).ready;
  server.run(seed);
  onTestFinished(async () => {
    history.replaceState(history.state, "", startUrl);
    await server.close();
  });

  return server;
}

const phone = { width: 390, height: 844 } as const;

const wide = { width: 1200, height: 800 } as const;

async function tab(server: Scope.Handle, size: { width: number; height: number }) {
  await page.viewport(size.width, size.height);
  const scope = await createScope({
    clock: makeTestClock(),
    capsules: [
      exits({ store: localStorage }),
      memory.client({ peer: server, meta: tabMeta }),
      frames.board({ read: memory.client }),
      frames.viewer({ remote: memory.client }),
      frames.pass({ remote: memory.client }),
      queue.viewer({ remote: memory.client }),
    ],
  }).ready;
  const memoryHistory = createMemoryHistory({ initialEntries: [`/s/${live}`] });
  const router = createRouter({ routeTree, history: memoryHistory, context: { scope } });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  onTestFinished(async () => {
    root.unmount();
    host.remove();
    await scope.close();
  });
  root.render(
    <ScopeProvider scope={scope}>
      <RouterProvider router={router} />
    </ScopeProvider>,
  );
  await expect
    .poll(() => host.querySelectorAll('[aria-label="Frames"] [role="group"]').length)
    .toBe(1);

  return { scope, host };
}

const dock = () => page.getByRole("toolbar", { name: "Canvas" });
const pagesButton = () => page.getByRole("button", { name: "Pages" });
const pagesMenu = () => page.getByRole("menu", { name: "Pages" });
const listsMenu = () => page.getByRole("menu", { name: "Lists" });
const moreMenu = () => page.getByRole("menu", { name: "More" });
const requestsButton = () => page.getByRole("button", { name: /^Requests/ });
const findButton = () => page.getByRole("button", { name: "Find" });
const findBox = () => page.getByRole("combobox", { name: "Find a frame" });
const card = () => page.getByRole("complementary", { name: "Requests" });
const closeRequests = () => page.getByRole("button", { name: "Close requests" });
const framesView = () => page.getByRole("region", { name: "Frames" });

const rectOf = (el: Element) => el.getBoundingClientRect();

const pressable = (el: Element) => {
  const r = rectOf(el);
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return hit !== null && (hit === el || el.contains(hit));
};

const pressOutside = () => framesView().click({ position: { x: 30, y: 140 } });

test("on a phone, a press out of the menu Pages closes it (AnOutsidePressClosesAMenu)", async () => {
  await tab(await serve(), phone);

  await pagesButton().click();
  await expect.element(pagesMenu()).toBeVisible();
  expect(pagesButton().element()).toHaveAttribute("aria-expanded", "true");

  await pressOutside();
  await expect.poll(() => pagesMenu().elements()).toHaveLength(0);
  expect(pagesButton().element()).toHaveAttribute("aria-expanded", "false");
});

test("on a phone, Escape closes the menu Pages, gives the focus back to Pages, and leaves the card open (EscapeClosesTheTop)", async () => {
  await tab(await serve(), phone);

  await pagesButton().click();
  await expect.element(pagesMenu()).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => pagesMenu().elements()).toHaveLength(0);
  await expect.poll(() => document.activeElement).toBe(pagesButton().element());

  await requestsButton().click();
  await expect.element(card()).toBeVisible();
  await pagesButton().click();
  await expect.element(pagesMenu()).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => pagesMenu().elements()).toHaveLength(0);
  expect(card().elements()).toHaveLength(1);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => card().elements()).toHaveLength(0);
});

test("on a phone, the card has the full width and stops above the dock: Requests can be pressed, and Close requests closes the card (TheDockIsFree, OnePressClosesTheTop)", async () => {
  await tab(await serve(), phone);

  await requestsButton().click();
  await expect.element(card()).toBeVisible();
  const sheet = rectOf(card().element());
  expect([sheet.left, sheet.width]).toEqual([0, phone.width]);
  expect(sheet.bottom).toBeLessThanOrEqual(rectOf(dock().element()).top);
  for (const button of dock().getByRole("button").elements()) {
    expect(pressable(button), button.getAttribute("aria-label") ?? "").toBe(true);
  }

  await requestsButton().click();
  await expect.poll(() => card().elements()).toHaveLength(0);

  await requestsButton().click();
  await expect.element(closeRequests()).toBeVisible();
  await closeRequests().click();
  await expect.poll(() => card().elements()).toHaveLength(0);
});

test("on a phone, Pages then Requests leaves only the card open; one menu at most is open, and a press out of it closes it (OneMenuAtMost)", async () => {
  await tab(await serve(), phone);

  await pagesButton().click();
  await expect.element(pagesMenu()).toBeVisible();
  await requestsButton().click();
  await expect.element(card()).toBeVisible();
  await expect.poll(() => pagesMenu().elements()).toHaveLength(0);

  await card().getByRole("button", { name: "Open" }).click();
  await expect.element(listsMenu()).toBeVisible();
  await pagesButton().click();
  await expect.element(pagesMenu()).toBeVisible();
  expect(listsMenu().elements()).toHaveLength(0);
  await card().getByRole("heading", { name: "Requests" }).click();
  await expect.poll(() => pagesMenu().elements()).toHaveLength(0);
  expect(card().elements()).toHaveLength(1);
});

test("on a phone, Find closes the card, and Requests closes Find, so the two never show together (FindAndTheCardDoNotStackOnAPhone)", async () => {
  await tab(await serve(), phone);

  await requestsButton().click();
  await expect.element(card()).toBeVisible();
  await findButton().click();
  await expect.element(findBox()).toBeVisible();
  expect(card().elements()).toHaveLength(0);

  await requestsButton().click();
  await expect.element(card()).toBeVisible();
  expect(findBox().elements()).toHaveLength(0);
});

test("on a phone, the menu More of a request closes by a press out of it, and a pick closes it (APickClosesItsMenu)", async () => {
  await tab(await serve(), phone);

  await requestsButton().click();
  await card()
    .getByRole("button", { name: /#1(?!\d)/ })
    .click();
  const more = page.getByRole("button", { name: "More" });
  await more.click();
  await expect.element(moreMenu()).toBeVisible();
  const menu = rectOf(moreMenu().element());
  expect(menu.left).toBeGreaterThanOrEqual(0);
  expect(menu.right).toBeLessThanOrEqual(phone.width);

  const head = page
    .getByRole("region", { name: "Request #1" })
    .element()
    .querySelector(".e-head-ref");
  if (!head) throw new Error("no head");
  await userEvent.click(head);
  await expect.poll(() => moreMenu().elements()).toHaveLength(0);

  await more.click();
  await moreMenu().getByRole("menuitem", { name: "Correct the request" }).click();
  await expect.poll(() => moreMenu().elements()).toHaveLength(0);
  await expect.element(page.getByRole("textbox", { name: "Request" })).toBeVisible();
});

test("on a phone the dock has no Zoom out and Zoom in, and each of its buttons is 40 x 40 px at least", async () => {
  await tab(await serve(), phone);

  const shown = dock()
    .getByRole("button")
    .elements()
    .filter((b) => rectOf(b).width > 0);
  expect(shown.map((b) => b.getAttribute("aria-label"))).toEqual([
    "Request",
    "Requests",
    "Find",
    "Pages",
    "Fit",
  ]);
  for (const button of shown) {
    const r = rectOf(button);
    expect([r.width >= 40, r.height >= 40], button.getAttribute("aria-label") ?? "").toEqual([
      true,
      true,
    ]);
  }
  expect(rectOf(dock().element()).width).toBeLessThan(phone.width - 48);
});

test("on a wide screen the dock and the card stay as they were: the card at the right, 340 px wide, the zoom buttons in the dock; Close requests and Escape close the card", async () => {
  await tab(await serve(), wide);

  const shown = dock()
    .getByRole("button")
    .elements()
    .filter((b) => rectOf(b).width > 0)
    .map((b) => b.getAttribute("aria-label"));
  expect(shown).toEqual(["Request", "Requests", "Find", "Pages", "Zoom out", "Zoom in", "Fit"]);
  expect(rectOf(dock().element()).height).toBe(42);
  for (const button of dock()
    .getByRole("button", { name: /^Zoom|^Fit|^Find/ })
    .elements()) {
    expect([rectOf(button).width, rectOf(button).height]).toEqual([32, 32]);
  }

  await requestsButton().click();
  const sheet = rectOf(card().element());
  expect(sheet.width).toBe(340);
  expect(sheet.right).toBe(wide.width - 12);
  expect(pressable(requestsButton().element())).toBe(true);
  await closeRequests().click();
  await expect.poll(() => card().elements()).toHaveLength(0);

  await requestsButton().click();
  await expect.element(card()).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => card().elements()).toHaveLength(0);

  await pagesButton().click();
  await expect.element(pagesMenu()).toBeVisible();
  expect(rectOf(pagesMenu().element()).bottom).toBeLessThanOrEqual(
    rectOf(pagesButton().element()).top,
  );
  await pagesMenu().getByRole("menuitemradio", { name: /^Two/ }).click();
  await expect.poll(() => pagesMenu().elements()).toHaveLength(0);
  await expect.element(pagesButton()).toHaveTextContent("Two");
});
