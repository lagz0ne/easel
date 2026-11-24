import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { exits } from "@tinkered/cli/test";
import { createScope, operation, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";
import { z } from "zod";

import { frames } from "@/frames";
import { frames as frameCells, pages } from "@/frames/contract";
import { passApi, passMeta, shareApi } from "@/frames/share";
import { queue } from "@/queue";
import { messages, requests, serverClock } from "@/queue/cells";
import type { Request } from "@/queue/cells";
import { routeTree } from "@/routes";
import { openedKey, visitKey } from "@/viewer/follow";
import { nameKey, tabMeta } from "@/viewer/gate";
import { showFrameOf } from "@/viewer/pages";
import { pickBoard, pickFrame, picksNow } from "@/viewer/switches";

import { frameOnPage } from "./frame-page";

const live = "d".repeat(32);
const pass = "4".repeat(32);
const canvas = "home";
const serverNow = 1_800_000_000_000;
const startUrl = location.href;

const box = { w: 400, h: 300, version: 1, status: "exploring" as const };

const seeded = [
  { id: "a1", name: "Alpha", page: "page-1", x: 0, y: 0 },
  { id: "b1", name: "Beta", page: "page-1", x: 500, y: 0 },
  { id: "c2", name: "Gamma", page: "two", x: 2000, y: 1500 },
];

const pageNames = { "page-1": "Page 1", two: "Two" } as const;

const open = operation({
  label: "test.pagesOpen",
  input: shareApi["share.open"].input,
  run: () => ({ kind: "open" as const, canvas, pass }),
});

const nameIt = operation({
  label: "test.pagesName",
  input: passApi["share.name"].input,
  run: (_, { input }) => ({ kind: "named" as const, name: input.name }),
});

const passOnly = operation({
  label: "test.pagesPass",
  input: transport.hook.start,
  run: (_, { input }) =>
    passMeta.safeParse(input.meta).data?.pass === pass ? undefined : input.refuse({ ended: true }),
});

const row = (n: number, patch: Partial<Request>): Request => ({
  canvas,
  id: `r${n}`,
  n,
  page: null,
  frameId: null,
  version: null,
  kit: 1,
  x: 40,
  y: 50,
  author: "Mai",
  key: `key-${n}`.padEnd(16, "-"),
  status: "open",
  claimedBy: null,
  claimedUntil: null,
  claimedAt: null,
  tries: 0,
  queuedAt: serverNow - n,
  acceptedBy: null,
  created: serverNow - n,
  updated: serverNow - n,
  ...patch,
});

const countPages = operation({
  label: "test.pagesCount",
  depends: { cells: frameCells.controller, list: pages.controller },
  run: ({ cells, list }) => {
    for (const [order, key] of (["page-1", "two"] as const).entries()) {
      const count = cells.where({ canvas, page: key }).get().length;
      list.set({ canvas, key, name: pageNames[key], order, frames: count });
    }
  },
});

const seed = operation({
  label: "test.pagesSeed",
  depends: {
    cells: frameCells.controller,
    rows: requests.controller,
    thread: messages.controller,
    clocks: serverClock.controller,
    countPages,
  },
  run: ({ cells, rows, thread, clocks, countPages }) => {
    for (const f of seeded) cells.set({ canvas, ...f, ...box });
    countPages.run();
    clocks.set({ canvas, now: serverNow });
    const asks = [
      row(1, { frameId: "c2", version: 1, x: 30, y: 40 }),
      row(2, { page: "two", x: 2100, y: 1400 }),
    ];
    for (const r of asks) {
      rows.set(r);
      thread.set({
        canvas,
        id: `m${r.n}`,
        request: r.id,
        kind: "ask",
        from: "Mai",
        text: `Ask ${r.n}`,
        html: null,
        options: null,
        option: null,
        before: null,
        after: null,
        beforeKit: null,
        afterKit: null,
        created: r.created,
      });
    }
  },
});

const moveFrame = operation({
  label: "test.pagesMove",
  input: z.object({ id: z.string(), page: z.string(), x: z.number(), y: z.number() }),
  depends: { cells: frameCells.controller, countPages },
  run: ({ cells, countPages }, { input: { id, page, x, y } }) => {
    const [was] = cells.where({ canvas, id }).get();
    if (!was) throw new Error(`no frame ${id}`);

    if (was.page !== page) cells.delete({ canvas, page: was.page, id });
    cells.set({ ...was, page, x, y });
    countPages.run();
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

function address(pageKey: string | null) {
  const url = new URL(startUrl);
  if (pageKey !== null) url.searchParams.set("page", pageKey);
  history.replaceState(history.state, "", url);
}

async function tab(server: Scope.Handle) {
  await page.viewport(1200, 800);
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
  const close = async () => {
    root.unmount();
    host.remove();
    await scope.close();
  };
  onTestFinished(close);
  root.render(
    <ScopeProvider scope={scope}>
      <RouterProvider router={router} />
    </ScopeProvider>,
  );
  await expect.poll(() => shells(host).length).toBeGreaterThan(0);

  return { scope, host, close };
}

const shells = (host: Element) => [
  ...host.querySelectorAll<HTMLElement>('[aria-label="Frames"] [role="group"]'),
];

const idsOf = (host: Element) =>
  shells(host)
    .map((s) => s.dataset.id ?? "")
    .toSorted((a, b) => a.localeCompare(b));

const shellOf = (host: Element, id: string) => shells(host).find((s) => s.dataset.id === id);

const marked = (host: Element) =>
  shells(host)
    .filter((s) => s.dataset.found !== undefined)
    .map((s) => s.dataset.id);

const addressPage = () => new URLSearchParams(location.search).get("page");

const pagesButton = () => page.getByRole("button", { name: "Pages" });

const pagesMenu = () => page.getByRole("menu", { name: "Pages" });

const inView = (host: Element, id: string) => {
  const shell = shellOf(host, id)?.getBoundingClientRect();
  const view = host.querySelector('[aria-label="Frames"]')?.getBoundingClientRect();
  if (!shell || !view) return false;

  return (
    shell.left >= view.left &&
    shell.right <= view.right &&
    shell.top >= view.top &&
    shell.bottom <= view.bottom
  );
};

test("the canvas shows the frames of one page; the list of pages in the dock names each page with its count of frames; a pick shows that page at Fit and names it in the address (rules 8, 9)", async () => {
  address(null);
  const t = await tab(await serve());

  expect(idsOf(t.host)).toEqual(["a1", "b1"]);
  await expect.poll(addressPage).toBe("page-1");
  await expect.element(pagesButton()).toHaveTextContent("Page 1");

  await pagesButton().click();
  const items = pagesMenu().getByRole("menuitemradio");
  expect(items.elements().map((b) => b.getAttribute("aria-label"))).toEqual([
    "Page 1, 2 frames",
    "Two, 1 frame",
  ]);
  expect(items.first().element()).toHaveAttribute("aria-checked", "true");
  await pagesMenu()
    .getByRole("menuitemradio", { name: /^Page 1/ })
    .click();
  expect(pagesMenu().elements()).toHaveLength(0);
  expect(idsOf(t.host)).toEqual(["a1", "b1"]);
  expect(inView(t.host, "b1")).toBe(true);

  await pagesButton().click();
  await pagesMenu().getByRole("menuitemradio", { name: /^Two/ }).click();
  await expect.poll(() => idsOf(t.host)).toEqual(["c2"]);
  await expect.poll(() => inView(t.host, "c2")).toBe(true);
  expect(addressPage()).toBe("two");
  expect(pagesMenu().elements()).toHaveLength(0);
  await expect.element(pagesButton()).toHaveTextContent("Two");
});

test("a link with ?page=two opens that page, and a reload keeps it; a page that the canvas does not have opens the first page (rule 9, criterion 4)", async () => {
  const server = await serve();
  address("two");
  const first = await tab(server);
  expect(idsOf(first.host)).toEqual(["c2"]);
  await first.close();

  const reloaded = await tab(server);
  expect(idsOf(reloaded.host)).toEqual(["c2"]);
  expect(addressPage()).toBe("two");
  await reloaded.close();

  address("nope");
  const wrong = await tab(server);
  await expect.poll(() => idsOf(wrong.host)).toEqual(["a1", "b1"]);
  await expect.poll(addressPage).toBe("page-1");
});

test("Find finds a frame on each page, with the name of its page; a pick shows its page, then the frame, marked (rule 10)", async () => {
  address(null);
  const t = await tab(await serve());

  await page.getByRole("button", { name: "Find" }).click();
  await userEvent.keyboard("gam");
  const option = page.getByRole("option");
  await expect.poll(() => option.elements().map((o) => o.textContent)).toEqual(["GammaTwo"]);
  await option.first().click();

  await expect.poll(() => idsOf(t.host)).toEqual(["c2"]);
  await expect.poll(() => marked(t.host)).toEqual(["c2"]);
  expect(inView(t.host, "c2")).toBe(true);
  expect(addressPage()).toBe("two");
});

test("the Requests panel names the page of each request; a pick of a request on a frame of page 2, on page 1, shows page 2 and the frame, marked (rule 11, criterion 3)", async () => {
  address(null);
  const t = await tab(await serve());

  await page.getByRole("button", { name: /^Requests/ }).click();
  const panel = page.getByRole("complementary", { name: "Requests" });
  await expect.element(panel.getByText("On Gamma, page Two")).toBeVisible();
  await expect.element(panel.getByText("On page Two")).toBeVisible();

  await panel.getByRole("button", { name: /#1(?!\d)/ }).click();
  await expect.poll(() => idsOf(t.host)).toEqual(["c2"]);
  await expect.poll(() => marked(t.host)).toEqual(["c2"]);
  expect(addressPage()).toBe("two");
  await expect.element(page.getByRole("region", { name: "Request #1" })).toBeVisible();
});

test("a pin of a request with no frame shows on its page only; a pick of it in the Requests panel shows its page (rule 4)", async () => {
  address(null);
  const t = await tab(await serve());
  const pin = (n: number) => page.getByRole("button", { name: `Request #${n}`, exact: true });

  expect(pin(1).elements()).toHaveLength(0);
  expect(pin(2).elements()).toHaveLength(0);

  await page.getByRole("button", { name: /^Requests/ }).click();
  const panel = page.getByRole("complementary", { name: "Requests" });
  await panel.getByRole("button", { name: /#2(?!\d)/ }).click();
  await expect.poll(() => idsOf(t.host)).toEqual(["c2"]);
  await expect.poll(() => pin(2).elements()).toHaveLength(1);
  expect(addressPage()).toBe("two");
});

test("a pick of a found frame that is not on the canvas any more changes nothing", async () => {
  address(null);
  const t = await tab(await serve());

  const answer = await t.scope.run(showFrameOf, { input: { canvas, id: "zz", spot: null } });
  expect(answer).toEqual({ kind: "gone" });
  expect(idsOf(t.host)).toEqual(["a1", "b1"]);
  expect(addressPage()).toBe("page-1");
});

test("a move shows in each open tab within 1 s: a new place on the page, and a frame that goes to another page leaves it (criterion 2)", async () => {
  address(null);
  const server = await serve();
  const one = await tab(server);
  const two = await tab(server);

  server.run(moveFrame, { input: { id: "a1", page: "page-1", x: 900, y: 600 } });
  for (const t of [one, two]) {
    await expect.poll(() => shellOf(t.host, "a1")?.style.left, { timeout: 1_000 }).toBe("900px");
    expect(shellOf(t.host, "a1")?.style.top).toBe("600px");
  }

  server.run(moveFrame, { input: { id: "b1", page: "two", x: 0, y: 0 } });
  for (const t of [one, two]) {
    await expect.poll(() => idsOf(t.host), { timeout: 1_000 }).toEqual(["a1"]);
  }
});

test("an agent moves a marked frame to another page: the tab stays on its page, and the mark ends (rule 12)", async () => {
  address(null);
  const server = await serve();
  const t = await tab(server);

  await page.getByRole("button", { name: "Find" }).click();
  await userEvent.keyboard("bet");
  await page.getByRole("option").first().click();
  await expect.poll(() => marked(t.host)).toEqual(["b1"]);

  server.run(moveFrame, { input: { id: "b1", page: "two", x: 0, y: 0 } });
  await expect.poll(() => idsOf(t.host)).toEqual(["a1"]);
  expect(marked(t.host)).toEqual([]);
  expect(addressPage()).toBe("page-1");

  server.run(moveFrame, { input: { id: "b1", page: "page-1", x: 500, y: 0 } });
  await expect.poll(() => idsOf(t.host)).toEqual(["a1", "b1"]);
  expect(marked(t.host)).toEqual([]);
});

test("a switch of the board is for the canvas: the locale and a config pick stay when the person goes to another page (rule 13)", async () => {
  address(null);
  const t = await tab(await serve());
  t.scope.run(pickBoard, { input: { name: "locale", value: "vi" } });
  t.scope.run(pickFrame, { input: { id: "a1", name: "theme", value: "dark" } });

  await pagesButton().click();
  await pagesMenu().getByRole("menuitemradio", { name: /^Two/ }).click();
  await expect.poll(() => idsOf(t.host)).toEqual(["c2"]);

  const picks = t.scope.resolve(picksNow({})).get();
  expect([picks.board.locale, picks.frames]).toEqual(["vi", { a1: { theme: "dark" } }]);
});
