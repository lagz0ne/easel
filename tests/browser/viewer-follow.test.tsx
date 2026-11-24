import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { exits } from "@tinkered/cli/test";
import { createScope, operation, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory, preset } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";
import { z } from "zod";

import { frames } from "@/frames";
import { frames as frameCells, pageClient, removed } from "@/frames/contract";
import { passMeta, shareApi } from "@/frames/share";
import { queue } from "@/queue";
import { messageKind, messages, request, requests, serverClock } from "@/queue/cells";
import type { Message, Request } from "@/queue/cells";
import { routeTree } from "@/routes";
import { openedKey, visitKey } from "@/viewer/follow";
import { nameKey, tabMeta } from "@/viewer/gate";
import { pageReloader } from "@/viewer/release";

const live = "e".repeat(32);
const pass = "3".repeat(32);
const home = "0123456789ab";
const far = "ba9876543210";
const serverNow = 1_800_000_000_000;
const minute = 60_000;

const store = {
  requests: [] as Request[],
  messages: [] as Message[],
  far: false,
  farGone: false,
  homeVersion: 1,
  client: null as string | null,
  reloads: 0,
};

let current: Scope.Handle | null = null;

const tick = (ms = 30) => new Promise((done) => setTimeout(done, ms));

const open = operation({
  label: "test.followOpen",
  input: shareApi["share.open"].input,
  run: () => ({ kind: "open" as const, canvas: "home", pass }),
});

const passOnly = operation({
  label: "test.followPass",
  input: transport.hook.start,
  run: (_, { input }) =>
    passMeta.safeParse(input.meta).data?.pass === pass ? undefined : input.refuse({ ended: true }),
});

function stored(n: number, text: string, patch: Partial<Request> = {}) {
  const at = serverNow - minute * n;
  const row: Request = {
    canvas: "home",
    id: `r${n}`,
    n,
    page: null,
    frameId: home,
    version: 1,
    kit: 1,
    x: 30 * n,
    y: 40,
    author: "Mai",
    key: `key-${n}`.padEnd(16, "-"),
    status: "open",
    claimedBy: null,
    claimedUntil: null,
    claimedAt: null,
    tries: 0,
    queuedAt: at,
    acceptedBy: null,
    created: at,
    updated: at,
    ...patch,
  };
  store.requests.push(row);
  store.messages.push(said(row, "ask", row.author, text, at));
  return row;
}

function said(r: Request, kind: Message["kind"], from: string, text: string | null, at: number) {
  const m: Message = {
    canvas: "home",
    id: `m${store.messages.length + 1}`,
    request: r.id,
    kind,
    from,
    text,
    html: null,
    options: null,
    option: null,
    before: null,
    after: null,
    beforeKit: null,
    afterKit: null,
    created: at,
  };
  return m;
}

const seed = operation({
  label: "test.followSeed",
  depends: {
    cells: frameCells.controller,
    gone: removed.controller,
    rows: requests.controller,
    thread: messages.controller,
    clocks: serverClock.controller,
    client: pageClient.controller,
  },
  run: ({ cells, gone, rows, thread, clocks, client }) => {
    const version = store.homeVersion;
    cells.set({
      canvas: "home",
      id: home,
      page: "page-1",
      name: "Home",
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      version,
      status: "exploring",
    });

    if (store.farGone) {
      const box = { name: "Far", x: 3000, y: 2000, w: 400, h: 300 };
      gone.set({
        canvas: "home",
        id: far,
        page: "page-1",
        ...box,
        removed: serverNow - 5 * minute,
      });
    }
    if (store.far) {
      cells.set({
        canvas: "home",
        id: far,
        page: "page-1",
        name: "Far",
        x: 3000,
        y: 2000,
        w: 400,
        h: 300,
        version: 1,
        status: "exploring",
      });
    }
    clocks.set({ canvas: "home", now: serverNow });
    client.set({ canvas: "home", client: store.client });
    for (const row of store.requests) rows.set(row);
    for (const m of store.messages) thread.set(m);
  },
});

const change = z.object({
  n: z.number(),
  patch: request.partial(),
  message: z
    .object({ kind: messageKind, from: z.string(), text: z.string().nullable() })
    .optional(),
});

function changeStored(input: z.infer<typeof change>) {
  const i = store.requests.findIndex((r) => r.n === input.n);
  const before = store.requests[i];
  if (!before) throw new Error(`no request #${input.n}`);

  const row: Request = { ...before, ...input.patch, updated: before.updated + 1 };
  store.requests[i] = row;

  const m = input.message
    ? said(row, input.message.kind, input.message.from, input.message.text, row.updated)
    : null;
  if (m) store.messages.push(m);
  return { row, m };
}

const write = operation({
  label: "test.followWrite",
  input: change,
  depends: { rows: requests.controller, thread: messages.controller },
  run: ({ rows, thread }, { input }) => {
    const { row, m } = changeStored(input);
    rows.set(row);
    if (m) thread.set(m);
  },
});

const ask = operation({
  label: "test.followAsk",
  input: z.number(),
  depends: { rows: requests.controller, thread: messages.controller },
  run: ({ rows, thread }, { input }) => {
    const row = stored(input, "Make it blue.");
    rows.set(row);
    const m = store.messages.at(-1);
    if (m) thread.set(m);
  },
});

async function serve() {
  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      frames.board({ serve: true, onStart: [passOnly] }),
      frames.viewer({ implement: { "share.open": open } }),
      memory.server({ services: [frames.board, frames.viewer] }),
    ],
  }).ready;
  server.run(seed);
  current = server;
  onTestFinished(async () => {
    await server.close();
  });

  return server;
}

async function boot(fill?: () => void) {
  localStorage.removeItem(nameKey);
  localStorage.removeItem(visitKey + "home");
  localStorage.removeItem(openedKey + "home");
  store.requests.length = 0;
  store.messages.length = 0;
  store.far = false;
  store.farGone = false;
  store.homeVersion = 1;
  store.client = null;
  store.reloads = 0;
  fill?.();

  return serve();
}

async function tab(first: Scope.Handle) {
  await page.viewport(1200, 800);
  const peer = new Proxy(first, {
    get: (_, key) => {
      const now = current ?? first;
      const value: unknown = Reflect.get(now, key);
      return typeof value === "function" ? value.bind(now) : value;
    },
  });
  const clock = makeTestClock();
  const scope = await createScope({
    clock,
    presets: [preset(pageReloader, () => ({ reload: () => void store.reloads++ }))],
    capsules: [
      exits({ store: localStorage }),
      memory.client({ peer, meta: tabMeta }),
      frames.board({ read: memory.client }),
      frames.viewer({ remote: memory.client }),
      frames.pass({ remote: memory.client }),
      queue.viewer({ remote: memory.client }),
    ],
  }).ready;

  const history = createMemoryHistory({ initialEntries: [`/s/${live}`] });
  const router = createRouter({ routeTree, history, context: { scope } });
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
    .poll(() => host.querySelector('[aria-label="Frames"] [role="group"]'))
    .not.toBeNull();

  return { scope, clock, host };
}

type Tab = Awaited<ReturnType<typeof tab>>;

const requestsButton = () => page.getByRole("button", { name: /^Requests/ });
const panel = () => page.getByRole("complementary", { name: "Requests" });
const listsMenu = () => page.getByRole("menu", { name: "Lists" });
const group = (name: string) => panel().getByRole("region", { name });

const row = (n: number) => panel().getByRole("button", { name: new RegExp(`#${n}(?!\\d)`) });

const rowsIn = (part: Element | null | undefined) =>
  [...(part?.querySelectorAll(".e-rr-ref") ?? [])].map((ref) => Number(ref.textContent?.slice(1)));

const markIn = (host: Element, n: number) =>
  [...host.querySelectorAll(".e-rr")]
    .find((r) => r.querySelector(".e-rr-ref")?.textContent === `#${n}`)
    ?.querySelector(".e-sb")
    ?.getAttribute("aria-label");

const markOf = (n: number) => markIn(document.body, n);
const pin = (n: number) => page.getByRole("button", { name: `Request #${n}`, exact: true });

const changedMark = (n: number) =>
  row(n).getByRole("img", { name: "Changed since your last visit" });

const own = ({ host }: Tab) => {
  const button = () =>
    host.querySelector<HTMLButtonElement>('button[title="Requests on this canvas"]');
  const group = (name: string) => host.querySelector(`aside section[aria-label="${name}"]`);

  return { button, group, mark: (n: number) => markIn(host, n) };
};

async function advance(t: Tab, ms: number) {
  t.clock.advance(ms);
  await tick();
}

function everyState() {
  stored(1, "Make the logo bigger.");
  stored(2, "Add a short FAQ here.", {
    claimedBy: "claude-1",
    claimedUntil: serverNow + 5 * minute,
    tries: 1,
  });
  stored(3, "Use our brand blue.", { status: "asking", claimedBy: "claude-1" });
  stored(4, "Make the Team plan stand out.", { status: "resolved", claimedBy: "claude-1" });
  stored(5, "Add the coupon field.", { status: "person", claimedBy: "claude-1", author: "Lan" });
  stored(6, "Move the sign-up button up.", {
    claimedBy: "claude-2",
    claimedUntil: serverNow - minute,
    tries: 3,
    author: "Tom",
  });
  stored(7, "Make the price bigger.", { status: "resolved", acceptedBy: "Tom" });

  const closed = stored(8, "Shorter banner.", { status: "closed" });
  store.messages.push(said(closed, "close", "Tom", null, closed.updated));
  const back = stored(9, "Wrong frame, sorry.", { status: "closed" });
  store.messages.push(said(back, "close", "Mai", null, back.updated));

  stored(10, "Add a frame for the order page.", { frameId: null, version: null, x: -200, y: 400 });
}

test("each state has its row in its list and group, newest first, with its own mark named by its word; Requests counts the requests that wait for a viewer; pins show for the list Open, with their look (Follow the requests 1 to 7, TheCountIsRight)", async () => {
  const server = await boot(everyState);
  await tab(server);

  await expect.element(requestsButton()).toHaveAccessibleName("Requests, 4 wait for you");
  expect(requestsButton().element()).toHaveAttribute("aria-pressed", "false");
  expect(requestsButton().element()).toHaveAttribute("title", "Requests on this canvas");
  expect(panel().elements()).toHaveLength(0);

  await requestsButton().click();
  await expect.element(panel()).toBeVisible();
  expect(requestsButton().element()).toHaveAttribute("aria-pressed", "true");
  expect(panel().getByRole("heading", { name: "Requests" }).elements()).toHaveLength(1);
  expect(rowsIn(group("Waits for you").query())).toEqual([3, 4, 5, 6]);
  expect(rowsIn(group("Other requests").query())).toEqual([1, 2, 10]);
  const words: Record<number, string> = {
    1: "Waiting for an agent",
    2: "claude-1",
    3: "Question for you",
    4: "Result to check",
    5: "Needs a person",
    6: "Needs a person",
    10: "Waiting for an agent",
  };
  for (const [n, word] of Object.entries(words)) expect(markOf(Number(n))).toBe(word);
  expect(row(2).getByText("claude-1", { exact: true }).elements()).toHaveLength(1);
  expect(row(5).element().textContent).toContain("Lan");
  expect(row(5).element().textContent).toContain("5\u00a0min");
  expect(row(5).element().textContent).toContain("Add the coupon field.");
  expect(row(5).element().textContent).toContain("On Home");
  expect(row(10).element().textContent).toContain("On the whole canvas");

  const looks = [1, 2, 3, 4, 5, 6, 10].map((n) => pin(n).element().getAttribute("data-look"));
  expect(looks).toEqual(["quiet", "quiet", "waits", "waits", "person", "person", "quiet"]);
  for (const n of [7, 8, 9]) expect(pin(n).elements()).toHaveLength(0);

  const menuButton = panel().getByRole("button", { name: "Open" });
  expect(menuButton.element()).toHaveAttribute("aria-haspopup", "menu");
  await menuButton.click();
  const items = listsMenu().getByRole("menuitemradio");
  expect(items.elements().map((i) => i.textContent)).toEqual(["Open7", "Done3"]);
  await listsMenu().getByRole("menuitemradio", { name: /Done/ }).click();
  await expect.element(panel().getByRole("button", { name: "Done" })).toBeVisible();
  expect(rowsIn(panel().query())).toEqual([7, 8, 9]);
  expect([7, 8, 9].map((n) => markOf(n))).toEqual(["Done", "Closed", "Taken back"]);

  await requestsButton().click();
  await expect.poll(() => panel().elements().length).toBe(0);
});

test("a canvas with no requests says so in the list Open, and how to ask for one; Requests has no count", async () => {
  const server = await boot();
  await tab(server);

  await expect.element(requestsButton()).toHaveAccessibleName("Requests");
  expect(requestsButton().element().querySelector(".e-count")).toBeNull();
  await requestsButton().click();
  await expect.element(panel().getByText("No requests yet")).toBeVisible();
  expect(
    panel()
      .getByText(
        "Click the speech bubble in the dock (Ask for a change), then a part of a frame. To ask about the whole canvas, click a place out of all frames.",
      )
      .elements(),
  ).toHaveLength(1);
});

test("the card Requests floats over the canvas at its right edge, 12 px from the edges, 340 px wide; the canvas and the dock keep the full width, and no frame moves when it opens (The page 3, OnlyARowOrAPanMovesTheCanvas)", async () => {
  const server = await boot(everyState);
  await tab(server);
  const before = pin(1).element().getBoundingClientRect();

  await requestsButton().click();
  await expect.element(panel()).toBeVisible();

  const box = panel().element().getBoundingClientRect();
  expect(box.right).toBe(1200 - 12);
  expect(box.top).toBe(12);
  expect(box.bottom).toBe(800 - 12);
  expect(box.width).toBe(340);
  const look = getComputedStyle(panel().element());
  expect(look.borderTopWidth).toBe("1px");
  expect(look.borderTopLeftRadius).toBe("12px");
  expect(look.boxShadow).not.toBe("none");
  const frames = page.getByRole("region", { name: "Frames" }).element().getBoundingClientRect();
  expect(frames.right).toBe(1200);
  const dock = page.getByRole("toolbar", { name: "Canvas" }).element().getBoundingClientRect();
  expect(Math.abs(dock.left + dock.width / 2 - 600)).toBeLessThan(2);
  expect(pin(1).element().getBoundingClientRect()).toEqual(before);
});

test("each change of a request shows in every tab within 1 s, with no reload: the row moves group, the mark and the count change (PanelShowsLatest, s1 to s16, s15 to s23, s22 to s3)", async () => {
  const server = await boot(() => stored(1, "Make the logo bigger."));
  const tabs = [await tab(server), await tab(server)].map(own);
  for (const t of tabs) {
    t.button()?.click();
    await expect.poll(() => t.mark(1)).toBe("Waiting for an agent");
  }

  server.run(write, {
    input: {
      n: 1,
      patch: { claimedBy: "claude-1", claimedUntil: serverNow + 5 * minute, tries: 1 },
    },
  });
  for (const t of tabs) await expect.poll(() => t.mark(1), { timeout: 1_000 }).toBe("claude-1");

  server.run(write, {
    input: {
      n: 1,
      patch: { status: "asking", claimedUntil: null },
      message: { kind: "question", from: "claude-1", text: "Which logo?" },
    },
  });
  for (const t of tabs) {
    await expect.poll(() => rowsIn(t.group("Waits for you")), { timeout: 1_000 }).toEqual([1]);
    expect(t.button()?.getAttribute("aria-label")).toBe("Requests, 1 wait for you");
  }

  server.run(write, {
    input: {
      n: 1,
      patch: { status: "open", tries: 0 },
      message: { kind: "answer", from: "Tom", text: "The top one." },
    },
  });
  for (const t of tabs) {
    await expect.poll(() => t.mark(1), { timeout: 1_000 }).toBe("Waiting for an agent");
    expect(t.group("Waits for you")).toBeNull();
    expect(t.button()?.getAttribute("aria-label")).toBe("Requests");
  }
});

test("a lease that runs out shows with no write: in work, then waiting at its end; at 3 tries it needs a person and Requests counts it (LeaseOutShowsWithNoWrite, s16 to s3, s16 to s51, fact rule 9)", async () => {
  const server = await boot(() => {
    stored(1, "Make the logo bigger.", {
      claimedBy: "claude-1",
      claimedUntil: serverNow + 90_000,
      tries: 1,
    });
    stored(2, "Add a short FAQ here.", {
      claimedBy: "claude-2",
      claimedUntil: serverNow + 150_000,
      tries: 3,
    });
  });
  const board = server.resolve(requests.where({ canvas: "home" }));
  const stop = board.watch(() => undefined);
  onTestFinished(() => stop());
  const before = JSON.stringify(board.get());
  const t = await tab(server);
  await requestsButton().click();
  await expect.poll(() => markOf(1)).toBe("claude-1");
  expect(markOf(2)).toBe("claude-2");
  await expect.element(requestsButton()).toHaveAccessibleName("Requests");

  await advance(t, 89_000);
  expect(markOf(1)).toBe("claude-1");
  await advance(t, 1_001);
  await expect.poll(() => markOf(1)).toBe("Waiting for an agent");
  expect(markOf(2)).toBe("claude-2");

  await advance(t, minute);
  await expect.poll(() => markOf(2)).toBe("Needs a person");
  expect(rowsIn(group("Waits for you").query())).toEqual([2]);
  await expect.element(requestsButton()).toHaveAccessibleName("Requests, 1 wait for you");
  expect(pin(2).element().getAttribute("data-look")).toBe("person");

  expect(JSON.stringify(board.get())).toBe(before);
});

test("a request changed since the last visit shows the mark Changed since your last visit until the viewer opens it; the browser keeps the visit and each opened request in localStorage (Follow the requests 17, AChangeShowsUntilOpened, s3 to s2)", async () => {
  const server = await boot(() => {
    stored(1, "Make the logo bigger.");
    stored(2, "Add a short FAQ here.");
    stored(3, "Use our brand blue.");
    stored(9, "Older than the visit.");
  });
  localStorage.setItem(visitKey + "home", String(serverNow - 5 * minute));
  localStorage.setItem(openedKey + "home", JSON.stringify({ r3: serverNow - 3 * minute }));
  await tab(server);
  await requestsButton().click();

  await expect.element(changedMark(1)).toBeVisible();
  expect(changedMark(2).elements()).toHaveLength(1);
  expect(changedMark(3).elements()).toHaveLength(0);
  expect(changedMark(9).elements()).toHaveLength(0);
  await expect.poll(() => Number(localStorage.getItem(visitKey + "home"))).toBe(serverNow);
  await expect.element(requestsButton()).toHaveAccessibleName("Requests");

  await row(1).click();
  await expect.element(page.getByRole("region", { name: "Request #1" })).toBeVisible();
  await expect.poll(() => changedMark(1).elements().length).toBe(0);
  expect(JSON.parse(localStorage.getItem(openedKey + "home") ?? "{}")).toMatchObject({
    r1: serverNow - minute,
  });

  server.run(write, { input: { n: 1, patch: { tries: 0 } } });
  server.run(write, {
    input: { n: 3, patch: {}, message: { kind: "edit", from: "Tom", text: "Our blue." } },
  });
  await expect.element(page.getByRole("region", { name: "Request #1" })).toBeVisible();
  await tick(100);
  await userEvent.keyboard("{Escape}");
  await expect.element(changedMark(3)).toBeVisible();
  expect(changedMark(1).elements()).toHaveLength(0);
  expect(row(3).element().textContent).toContain("Our blue.");
});

const opened = (n: number) => panel().getByRole("region", { name: `Request #${n}` });
const allRequests = () => panel().getByRole("button", { name: "All requests" });

test("a press on a row opens the request in the card and moves the canvas to its place; All requests goes back to the list; a press on a pin opens its request in the card, and the canvas stays (Follow the requests 9, 10; PressRow, Back, PressPin)", async () => {
  const server = await boot(() => {
    store.far = true;
    stored(1, "Make the logo bigger.", { frameId: far, x: 20, y: 30 });
    stored(2, "Add a short FAQ here.");
  });
  await tab(server);
  await requestsButton().click();

  await row(1).click();
  await expect.element(opened(1)).toBeVisible();
  expect(row(1).elements()).toHaveLength(0);
  expect(pin(1).element()).toHaveAttribute("aria-pressed", "true");
  const view = page.getByRole("region", { name: "Frames" }).element().getBoundingClientRect();
  const at = pin(1).element().getBoundingClientRect();
  expect(Math.abs(at.left - (view.left + view.width * 0.4))).toBeLessThan(3);
  expect(Math.abs(at.bottom - (view.top + view.height * 0.4))).toBeLessThan(3);

  await allRequests().click();
  await expect.element(row(2)).toBeVisible();
  expect(opened(1).elements()).toHaveLength(0);
  expect(pin(1).element()).toHaveAttribute("aria-pressed", "false");

  const still = pin(1).element().getBoundingClientRect();
  await pin(1).click();
  await expect.element(opened(1)).toBeVisible();
  expect(pin(1).element().getBoundingClientRect()).toEqual(still);
});

test("Escape goes back from a request to the list, then closes the card; a press on another pin opens that request in its place; Close closes the card from a request; Requests closes an open card (Escape, PressPin, Close, Toggle)", async () => {
  const server = await boot(() => {
    stored(1, "Make the logo bigger.");
    stored(2, "Add a short FAQ here.");
  });
  await tab(server);

  await pin(1).click();
  await expect.element(opened(1)).toBeVisible();
  expect(requestsButton().element()).toHaveAttribute("aria-pressed", "true");
  await userEvent.keyboard("{Escape}");
  await expect.element(row(1)).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => panel().elements().length).toBe(0);
  expect(requestsButton().element()).toHaveAttribute("aria-pressed", "false");

  await pin(1).click();
  await expect.element(opened(1)).toBeVisible();
  await pin(2).click();
  await expect.element(opened(2)).toBeVisible();
  expect(opened(1).elements()).toHaveLength(0);
  expect(pin(1).element()).toHaveAttribute("aria-pressed", "false");
  await opened(2).getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => panel().elements().length).toBe(0);

  await pin(1).click();
  await expect.element(opened(1)).toBeVisible();
  await requestsButton().click();
  await expect.poll(() => panel().elements().length).toBe(0);
  await requestsButton().click();
  await expect.element(row(1)).toBeVisible();
});

const day = 24 * 60 * minute;

test("a result that no viewer answers for 3 days moves to Done as Done, no answer, with no write, and Requests stops counting it (Follow the requests 4, E4.2 M15)", async () => {
  const server = await boot(() => {
    stored(1, "Make the Team plan stand out.", {
      status: "resolved",
      claimedBy: "claude-1",
      updated: serverNow - 3 * day + 2 * minute,
    });
    stored(2, "Make the price bigger.", { status: "resolved", claimedBy: "claude-1" });
  });
  const board = server.resolve(requests.where({ canvas: "home" }));
  const stop = board.watch(() => undefined);
  onTestFinished(() => stop());
  const before = JSON.stringify(board.get());
  const t = await tab(server);
  await requestsButton().click();
  await expect.poll(() => markOf(1)).toBe("Result to check");
  await expect.element(requestsButton()).toHaveAccessibleName("Requests, 2 wait for you");
  expect(rowsIn(group("Waits for you").query())).toEqual([1, 2]);

  await advance(t, minute);
  expect(markOf(1)).toBe("Result to check");
  await advance(t, minute);
  await expect.element(requestsButton()).toHaveAccessibleName("Requests, 1 wait for you");
  expect(rowsIn(group("Waits for you").query())).toEqual([2]);
  expect(pin(1).elements()).toHaveLength(0);

  await panel().getByRole("button", { name: "Open" }).click();
  await listsMenu().getByRole("menuitemradio", { name: /Done/ }).click();
  await expect.poll(() => rowsIn(panel().query())).toEqual([1]);
  expect(markOf(1)).toBe("Done, no answer");
  expect(JSON.stringify(board.get())).toBe(before);
});

const outdatedOf = (n: number) =>
  [...document.querySelectorAll(".e-rr")]
    .find((r) => r.querySelector(".e-rr-ref")?.textContent === `#${n}`)
    ?.querySelector('.e-sb[data-state="outdated"]')
    ?.getAttribute("aria-label") ?? null;

test("a waiting request may be outdated: its frame has a newer version, the frame was removed, or it was made more than 7 days ago; a dotted mark names the cause, with no write (Follow the requests 6, A request becomes outdated)", async () => {
  const server = await boot(() => {
    store.homeVersion = 4;
    store.farGone = true;
    stored(1, "Make the logo bigger.");
    stored(2, "Shorter banner.", { frameId: far });

    stored(3, "Add a frame for the order page.", {
      frameId: null,
      version: null,
      created: serverNow - 7 * day + minute,
    });
    stored(4, "Add a short FAQ here.", {
      claimedBy: "claude-1",
      claimedUntil: serverNow + 5 * minute,
    });
    stored(5, "Use our brand blue.", { version: 4 });
  });
  const board = server.resolve(requests.where({ canvas: "home" }));
  const stop = board.watch(() => undefined);
  onTestFinished(() => stop());
  const before = JSON.stringify(board.get());
  const t = await tab(server);
  await requestsButton().click();
  await expect.poll(() => outdatedOf(1)).toBe("May be outdated: the frame changed");

  expect(markOf(1)).toBe("Waiting for an agent");
  expect(outdatedOf(2)).toBe("May be outdated: the frame was removed");
  expect(row(2).element().textContent).toContain("On Far");
  expect(outdatedOf(3)).toBeNull();
  expect(outdatedOf(4)).toBeNull();
  expect(outdatedOf(5)).toBeNull();
  expect(pin(2).elements()).toHaveLength(0);

  await advance(t, minute);
  expect(outdatedOf(3)).toBeNull();
  await advance(t, minute);
  await expect.poll(() => outdatedOf(3)).toBe("May be outdated: a long wait");
  await expect.element(requestsButton()).toHaveAccessibleName("Requests");
  expect(rowsIn(group("Other requests").query())).toEqual([1, 2, 4, 5, 3]);
  expect(JSON.stringify(board.get())).toBe(before);
});

test("a press on the row of a request of a removed frame moves the canvas to where the frame was: a dashed area that says it was removed, with the pin in it, and the request in the card (Follow the requests 9)", async () => {
  const server = await boot(() => {
    store.farGone = true;
    stored(1, "Shorter banner.", { frameId: far, x: 20, y: 30 });
  });
  await tab(server);
  await requestsButton().click();

  await row(1).click();
  await expect.element(page.getByRole("region", { name: "Request #1" })).toBeVisible();
  const area = page.getByRole("group", { name: "Far was removed" });
  await expect.element(area).toBeVisible();
  expect(area.element().textContent).toContain("Far was removed");
  const view = page.getByRole("region", { name: "Frames" }).element().getBoundingClientRect();
  const at = pin(1).element().getBoundingClientRect();
  expect(Math.abs(at.left - (view.left + view.width * 0.4))).toBeLessThan(3);
  expect(Math.abs(at.bottom - (view.top + view.height * 0.4))).toBeLessThan(3);
  const box = area.element().getBoundingClientRect();
  expect(at.left).toBeGreaterThan(box.left);
  expect(at.bottom).toBeLessThan(box.bottom);

  await userEvent.keyboard("{Escape}");
  await expect.poll(() => area.elements().length).toBe(0);
  expect(pin(1).elements()).toHaveLength(0);
});

function longThread(n: number, x: number, y: number) {
  const r = stored(n, "Make the logo bigger.", { x, y });
  for (let i = 1; i <= 12; i++) {
    store.messages.push(said(r, "edit", "Mai", `Make the logo bigger, take ${i}.`, r.created + i));
  }
}

test("the textbox of a new request opens below its pin, or above it with no room below; it stays out of the card and over the dock (Follow the requests 10)", async () => {
  const server = await boot();
  await tab(server);
  await requestsButton().click();
  await expect.element(panel()).toBeVisible();
  const card = panel().element().getBoundingClientRect();
  const dock = page.getByRole("toolbar", { name: "Canvas" }).element().getBoundingClientRect();
  const textbox = page.getByRole("textbox", { name: "Request" });

  const sides: string[] = [];
  for (const spot of [
    { x: 820, y: 40 },
    { x: 100, y: 700 },
  ]) {
    await page.getByRole("button", { name: "Request", exact: true }).click();
    await page.getByRole("region", { name: "Frames" }).click({ position: spot });
    await expect.element(textbox).toBeVisible();
    await tick(50);
    const pop = textbox.element().closest(".e-pop");
    if (!pop) throw new Error("no popover");
    const at = pop.getBoundingClientRect();
    sides.push(pop.getAttribute("data-side") ?? "");

    expect(at.right).toBeLessThanOrEqual(card.left);
    expect(at.top).toBeGreaterThanOrEqual(0);
    expect(at.bottom).toBeLessThanOrEqual(dock.top);
    await userEvent.keyboard("{Escape}");
  }
  expect(sides).toEqual(["below", "above"]);
  await expect.element(panel()).toBeVisible();
});

test("a wheel over the thread of a request in the card scrolls the thread, not the canvas: the canvas does not move (Follow the requests 10)", async () => {
  const server = await boot(() => longThread(1, 40, 10));
  await tab(server);
  await pin(1).click();
  const dialog = page.getByRole("region", { name: "Request #1" });
  await expect.element(dialog).toBeVisible();
  const thread = dialog.element().querySelector(".e-thread");
  if (!thread) throw new Error("no thread");
  const before = pin(1).element().getBoundingClientRect();
  const box = thread.getBoundingClientRect();

  const wheel = new WheelEvent("wheel", {
    deltaY: 100,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
    bubbles: true,
    cancelable: true,
  });
  const free = thread.dispatchEvent(wheel);

  expect(free).toBe(true);
  expect(pin(1).element().getBoundingClientRect().top).toBe(before.top);
  expect(getComputedStyle(thread).overscrollBehaviorY).toBe("contain");
});

function expectFirstInHeadAtTopOfCard(button: Element) {
  const head = button.parentElement;
  if (!head) throw new Error("the button has no parent");

  expect(head.tagName).toBe("HEADER");
  expect(button.previousElementSibling).toBeNull();

  const cardTop = panel().element().getBoundingClientRect().top;
  expect(head.getBoundingClientRect().top - cardTop).toBe(1);
}

test("a request in the card has the look of the design system: a 40 px head with a line under it, filled while a question waits; 13/20 text; a name of weight 600; a round 24 px avatar, square for an agent; icons for More and Close; All requests is a chevron in the head at the top of the card, not a line of its own (Sidebar card, Popover card, ThreadHead, Message; request product#5)", async () => {
  const server = await boot(() => {
    const r = stored(1, "Make the logo bigger.", { status: "asking", claimedBy: "claude-1" });
    store.messages.push(said(r, "question", "claude-1", "Which logo?", r.created + 1));
  });
  await tab(server);
  await pin(1).click();
  const dialog = page.getByRole("region", { name: "Request #1" });
  await expect.element(dialog.getByText("Which logo?")).toBeVisible();
  const pop = dialog.element();
  const all = (selector: string) =>
    [...pop.querySelectorAll(selector)].map((el) => getComputedStyle(el));
  const one = (selector: string) => {
    const [first] = all(selector);
    if (!first) throw new Error(`no ${selector}`);
    return first;
  };

  const box = getComputedStyle(panel().element());
  expect([box.width, box.borderTopWidth, box.borderTopLeftRadius]).toEqual([
    "340px",
    "1px",
    "12px",
  ]);
  const back = dialog.getByRole("button", { name: "All requests" }).element();
  expect(back.querySelector("svg")).not.toBeNull();
  expectFirstInHeadAtTopOfCard(back);
  const head = one("header");
  expect([head.height, head.borderBottomWidth, head.borderTopWidth]).toEqual([
    "40px",
    "1px",
    "0px",
  ]);
  expect(head.backgroundColor).toBe("rgb(238, 244, 252)");
  const ref = one(".e-head-ref");
  expect([ref.whiteSpace, ref.textOverflow, ref.overflow]).toEqual([
    "nowrap",
    "ellipsis",
    "hidden",
  ]);
  const text = one(".e-text");
  expect([text.fontSize, text.lineHeight]).toEqual(["13px", "20px"]);
  const name = one(".e-who strong");
  expect([name.fontSize, name.fontWeight]).toEqual(["13px", "600"]);
  const [person, agent] = all(".e-avatar");
  expect([person?.width, person?.height, person?.borderTopLeftRadius]).toEqual([
    "24px",
    "24px",
    "999px",
  ]);
  expect(agent?.borderTopLeftRadius).toBe("6px");
  const count = document.querySelector(".e-dock-btn .e-count");
  if (!count) throw new Error("no count");
  const drawn = count.getBoundingClientRect();
  expect([drawn.width, drawn.height, getComputedStyle(count).fontSize]).toEqual([16, 16, "11px"]);
  for (const label of ["All requests", "More", "Close"]) {
    const button = dialog.getByRole("button", { name: label, exact: true }).element();
    expect(button.querySelector("svg")).not.toBeNull();
    expect([getComputedStyle(button).width, getComputedStyle(button).height]).toEqual([
      "28px",
      "28px",
    ]);
  }
});

test("while the socket is down the list may be behind and says Reconnecting; when it is back, the board read brings each change (s16 to s19, s19 to s16, PanelShowsLatest)", async () => {
  const server = await boot(() => stored(1, "Make the logo bigger."));
  const t = await tab(server);
  await requestsButton().click();
  await expect.poll(() => markOf(1)).toBe("Waiting for an agent");

  await server.close();
  const reconnecting = page.getByRole("status").filter({ hasText: "Reconnecting" });
  await expect.element(reconnecting).toBeVisible();
  changeStored({
    n: 1,
    patch: { status: "asking", claimedBy: "claude-1" },
    message: { kind: "question", from: "claude-1", text: "Which logo?" },
  });
  await tick(100);
  expect(markOf(1)).toBe("Waiting for an agent");

  await serve();
  for (let i = 0; i < 100 && reconnecting.elements().length; i++) {
    t.clock.advance(1_000);
    await tick(20);
  }
  await expect.poll(() => markOf(1)).toBe("Question for you");
  await expect.element(requestsButton()).toHaveAccessibleName("Requests, 1 wait for you");
});

test("SPEC-speed marks: easel:ask:<request id> comes when the pin of a new request shows, and not before", async () => {
  performance.clearMarks();
  const server = await boot();
  await tab(server);
  const real = performance.mark.bind(performance);
  const calls: Array<{ name: string; pin: boolean }> = [];
  vi.spyOn(performance, "mark").mockImplementation((name, options) => {
    calls.push({ name, pin: document.querySelector('[aria-label="Request #1"]') !== null });
    return real(name, options);
  });
  const asks = () => calls.filter((c) => c.name.startsWith("easel:ask:"));
  expect(asks()).toEqual([]);

  await requestsButton().click();
  server.run(ask, { input: 1 });
  await expect.poll(asks, { timeout: 1_000 }).toEqual([{ name: "easel:ask:r1", pin: true }]);
  server.run(write, {
    input: {
      n: 1,
      patch: { claimedBy: "claude-1", claimedUntil: serverNow + 5 * minute, tries: 1 },
    },
  });
  await expect.poll(() => markOf(1)).toBe("claude-1");
  expect(asks()).toEqual([{ name: "easel:ask:r1", pin: true }]);
});

test("after a deploy that changes the page, the socket connects again and a bar says a new version is ready, with Reload; while a text is typed it asks to send the text first; the tab never reloads by itself (The page 4, TheBarMeansNewer, NoTextLost, OnlyTheViewerReloads)", async () => {
  const server = await boot(() => {
    store.client = "/assets/index-old.js";
    stored(1, "Make the logo bigger.");
  });
  const t = await tab(server);
  await expect.element(pin(1)).toBeVisible();
  const bar = () =>
    page.getByRole("status").filter({ hasText: "A new version of easel is ready." });
  await tick(100);
  expect(bar().elements()).toHaveLength(0);

  await server.close();
  store.client = "/assets/index-new.js";
  await serve();
  for (let i = 0; i < 100 && !bar().elements().length; i++) {
    t.clock.advance(1_000);
    await tick(20);
  }
  await expect.element(bar()).toBeVisible();
  const reload = bar().getByRole("button", { name: "Reload" });
  expect(reload.elements()).toHaveLength(1);

  await page.getByRole("button", { name: "Request", exact: true }).click();
  await page.getByRole("region", { name: "Frames" }).click({ position: { x: 600, y: 600 } });
  await page.getByRole("textbox", { name: "Request" }).fill("A new FAQ.");
  await expect.element(bar().getByText("Send your text first, then reload.")).toBeVisible();
  expect(reload.elements()).toHaveLength(0);

  await userEvent.keyboard("{Escape}");
  await expect.element(reload).toBeVisible();
  expect(store.reloads).toBe(0);
  await reload.click();
  expect(store.reloads).toBe(1);
});

test("a server that names no page client, as in dev, never shows the bar (TheBarMeansNewer)", async () => {
  const server = await boot(() => stored(1, "Make the logo bigger."));
  const t = await tab(server);
  await expect.element(pin(1)).toBeVisible();

  await server.close();
  await serve();
  for (let i = 0; i < 20; i++) {
    t.clock.advance(1_000);
    await tick(20);
  }
  expect(page.getByText("A new version of easel is ready.").elements()).toHaveLength(0);
});
