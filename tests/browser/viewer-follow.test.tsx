import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { exits } from "@tinkered/cli/test";
import { createScope, operation, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";
import { z } from "zod";

import { frames } from "@/frames";
import { frames as frameCells, removed } from "@/frames/contract";
import { passMeta, shareApi } from "@/frames/share";
import { queue } from "@/queue";
import { messageKind, messages, request, requests, serverClock } from "@/queue/cells";
import type { Message, Request } from "@/queue/cells";
import { routeTree } from "@/routes";
import { openedKey, visitKey } from "@/viewer/follow";
import { nameKey, tabMeta } from "@/viewer/gate";

// A viewer follows the requests, in a real Chromium, over `memory` (SPEC-viewer.md § Follow the
// requests). The oracle is the viewer-queue chart: each test names the arrows and the rules it
// walks. The server stands in for share.server.ts and the queue: the board holds the frames, the
// requests, their messages and the server's clock; `write` changes a request as an agent's or
// another viewer's call does, and the board pushes it. The tab reaches the server through `peer`,
// which a test points at a new server after the old one closed: the socket drops and comes back.

const live = "e".repeat(32);
const pass = "3".repeat(32);
/** The frames Home and Far. */
const home = "0123456789ab";
const far = "ba9876543210";
/** The time of the stub server: the board's `serverClock` says it. */
const serverNow = 1_800_000_000_000;
const minute = 60_000;

/** The stub server's state; it outlives a server, as a database does. */
const store = {
  requests: [] as Request[],
  messages: [] as Message[],
  /** Frame Far is on the board. */
  far: false,
  /** Frame Far was removed: the board has it in `removed`. */
  farGone: false,
  /** Frame Home's version. */
  homeVersion: 1,
};

/** The server the tab's `peer` points at now. */
let current: Scope.Handle | null = null;

const tick = (ms = 30) => new Promise((done) => setTimeout(done, ms));

const open = operation({
  label: "test.followOpen",
  input: shareApi["share.open"].input,
  run: () => ({ kind: "open" as const, canvas: "home", pass }),
});

/** Every guard: the pass reads `home`. */
const passOnly = operation({
  label: "test.followPass",
  input: transport.hook.start,
  run: (_, { input }) =>
    passMeta.safeParse(input.meta).data?.pass === pass ? undefined : input.refuse({ ended: true }),
});

/** A request on the store, with its ask: `n`, its text, and a patch. Newer for a lower `n`. */
function stored(n: number, text: string, patch: Partial<Request> = {}) {
  const at = serverNow - minute * n;
  const row: Request = {
    canvas: "home",
    id: `r${n}`,
    n,
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

/** A message of a request. */
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

/** The board as the store holds it. */
const seed = operation({
  label: "test.followSeed",
  depends: {
    cells: frameCells.controller,
    gone: removed.controller,
    rows: requests.controller,
    thread: messages.controller,
    clocks: serverClock.controller,
  },
  run: ({ cells, gone, rows, thread, clocks }) => {
    const version = store.homeVersion;
    cells.set({ canvas: "home", id: home, name: "Home", x: 0, y: 0, w: 400, h: 300, version });

    if (store.farGone) {
      const box = { name: "Far", x: 3000, y: 2000, w: 400, h: 300 };
      gone.set({ canvas: "home", id: far, ...box, removed: serverNow - 5 * minute });
    }
    if (store.far) {
      cells.set({
        canvas: "home",
        id: far,
        name: "Far",
        x: 3000,
        y: 2000,
        w: 400,
        h: 300,
        version: 1,
      });
    }
    clocks.set({ canvas: "home", now: serverNow });
    for (const row of store.requests) rows.set(row);
    for (const m of store.messages) thread.set(m);
  },
});

/** What a change writes: a patch of the request, and a message. */
const change = z.object({
  n: z.number(),
  patch: request.partial(),
  message: z
    .object({ kind: messageKind, from: z.string(), text: z.string().nullable() })
    .optional(),
});

/** Changes request `n` on the store, with a new `updated`, and adds the message. */
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

/** A change of a request, as an agent's or a viewer's call writes it: the board pushes it. */
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

/** A new request `n`, as a viewer's send in another tab writes it: the board pushes it. */
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

/** A server with the stubs, on the store; the tab's `peer` points at it. */
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

/** A fresh store and browser; `fill` puts requests on the store before the server seeds. */
async function boot(fill?: () => void) {
  localStorage.removeItem(nameKey);
  localStorage.removeItem(visitKey + "home");
  localStorage.removeItem(openedKey + "home");
  store.requests.length = 0;
  store.messages.length = 0;
  store.far = false;
  store.farGone = false;
  store.homeVersion = 1;
  fill?.();

  return serve();
}

/** A tab with the app's routes at the link, on the server `current` points at. */
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

// One tab: its controls by role and name. Two tabs overlap on the page, so the test of two tabs
// reads each tab's own elements in its host.
const requestsButton = () => page.getByRole("button", { name: /^Requests/ });
const panel = () => page.getByRole("complementary", { name: "Requests" });
const group = (name: string) => panel().getByRole("region", { name });

/** The row of request `n`: its button names `#n`. */
const row = (n: number) => panel().getByRole("button", { name: new RegExp(`#${n}(?!\\d)`) });

/** The numbers of the rows in a part of the page, in order. */
const rowsIn = (part: Element | null | undefined) =>
  [...(part?.querySelectorAll(".e-rr-ref") ?? [])].map((ref) => Number(ref.textContent?.slice(1)));

/** The word of the state mark of request `n`'s row, in a host. */
const markIn = (host: Element, n: number) =>
  [...host.querySelectorAll(".e-rr")]
    .find((r) => r.querySelector(".e-rr-ref")?.textContent === `#${n}`)
    ?.querySelector(".e-sb")
    ?.getAttribute("aria-label");

const markOf = (n: number) => markIn(document.body, n);
const pin = (n: number) => page.getByRole("button", { name: `Request #${n}`, exact: true });

const changedMark = (n: number) =>
  row(n).getByRole("img", { name: "Changed since your last visit" });

/** A tab's own Requests button, panel and group, in its host. */
const own = ({ host }: Tab) => {
  const button = () =>
    host.querySelector<HTMLButtonElement>('button[title="Requests on this canvas"]');
  const group = (name: string) => host.querySelector(`aside section[aria-label="${name}"]`);

  return { button, group, mark: (n: number) => markIn(host, n) };
};

/** The tab's clock moves `ms`, and the page draws. */
async function advance(t: Tab, ms: number) {
  t.clock.advance(ms);
  await tick();
}

/** A request in each state, as § Follow the requests 6 lists them. */
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

  // The count: a question, a result, a declined request, and one with 3 tries and no lease.
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
  // In work, the agent's name shows as text after its mark.
  expect(row(2).getByText("claude-1", { exact: true }).elements()).toHaveLength(1);
  // A row: the author, the age, the text, the place.
  expect(row(5).element().textContent).toContain("Lan");
  expect(row(5).element().textContent).toContain("5\u00a0min");
  expect(row(5).element().textContent).toContain("Add the coupon field.");
  expect(row(5).element().textContent).toContain("On Home");
  expect(row(10).element().textContent).toContain("On the whole canvas");

  // Pins: the list Open only, accent while a viewer is waited for, danger for a person.
  const looks = [1, 2, 3, 4, 5, 6, 10].map((n) => pin(n).element().getAttribute("data-look"));
  expect(looks).toEqual(["quiet", "quiet", "waits", "waits", "person", "person", "quiet"]);
  for (const n of [7, 8, 9]) expect(pin(n).elements()).toHaveLength(0);

  // The menu names the list on show, and gives the two lists with their counts.
  const menuButton = panel().getByRole("button", { name: "Open" });
  expect(menuButton.element()).toHaveAttribute("aria-haspopup", "menu");
  await menuButton.click();
  const items = panel().getByRole("menuitemradio");
  expect(items.elements().map((i) => i.textContent)).toEqual(["Open7", "Done3"]);
  await panel().getByRole("menuitemradio", { name: /Done/ }).click();
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

test("the panel opens at the right edge, 340 px wide over the full height; the canvas and the dock use the rest of the width (The page 3)", async () => {
  const server = await boot(everyState);
  await tab(server);
  await requestsButton().click();
  await expect.element(panel()).toBeVisible();

  const box = panel().element().getBoundingClientRect();
  expect(box.right).toBe(1200);
  expect(box.width).toBe(340);
  expect(box.top).toBe(0);
  expect(box.height).toBe(800);
  const frames = page.getByRole("region", { name: "Frames" }).element().getBoundingClientRect();
  expect(frames.right).toBe(860);
  const dock = page.getByRole("toolbar", { name: "Canvas" }).element().getBoundingClientRect();
  expect(Math.abs(dock.left + dock.width / 2 - 430)).toBeLessThan(2);
});

test("each change of a request shows in every tab within 1 s, with no reload: the row moves group, the mark and the count change (PanelShowsLatest, s1 to s16, s15 to s23, s22 to s3)", async () => {
  const server = await boot(() => stored(1, "Make the logo bigger."));
  const tabs = [await tab(server), await tab(server)].map(own);
  for (const t of tabs) {
    t.button()?.click();
    await expect.poll(() => t.mark(1)).toBe("Waiting for an agent");
  }

  // An agent claims it.
  server.run(write, {
    input: {
      n: 1,
      patch: { claimedBy: "claude-1", claimedUntil: serverNow + 5 * minute, tries: 1 },
    },
  });
  for (const t of tabs) await expect.poll(() => t.mark(1), { timeout: 1_000 }).toBe("claude-1");

  // It asks a question: the request waits for a viewer.
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

  // A viewer answers: back to Other requests, waiting.
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

  // Nothing was written: the board is as it was.
  expect(JSON.stringify(board.get())).toBe(before);
});

test("a request changed since the last visit shows the mark Changed since your last visit until the viewer opens it; the browser keeps the visit and each opened request in localStorage (Follow the requests 17, AChangeShowsUntilOpened, s3 to s2)", async () => {
  const server = await boot(() => {
    stored(1, "Make the logo bigger.");
    stored(2, "Add a short FAQ here.");
    stored(3, "Use our brand blue.");
    stored(9, "Older than the visit.");
  });
  // The last visit was 5 min ago; #3 was opened at its last change.
  localStorage.setItem(visitKey + "home", String(serverNow - 5 * minute));
  localStorage.setItem(openedKey + "home", JSON.stringify({ r3: serverNow - 3 * minute }));
  await tab(server);
  await requestsButton().click();

  await expect.element(changedMark(1)).toBeVisible();
  expect(changedMark(2).elements()).toHaveLength(1);
  expect(changedMark(3).elements()).toHaveLength(0);
  expect(changedMark(9).elements()).toHaveLength(0);
  // The page wrote the time of this visit: the server's time now.
  await expect.poll(() => Number(localStorage.getItem(visitKey + "home"))).toBe(serverNow);
  // Requests shows no count of changed requests.
  await expect.element(requestsButton()).toHaveAccessibleName("Requests");

  await row(1).click();
  await expect.element(page.getByRole("dialog", { name: "Request #1" })).toBeVisible();
  await expect.poll(() => changedMark(1).elements().length).toBe(0);
  expect(JSON.parse(localStorage.getItem(openedKey + "home") ?? "{}")).toMatchObject({
    r1: serverNow - minute,
  });

  // A change while it is open is seen at once; a change of #3 shows its mark.
  server.run(write, { input: { n: 1, patch: { tries: 0 } } });
  server.run(write, {
    input: { n: 3, patch: {}, message: { kind: "edit", from: "Tom", text: "Our blue." } },
  });
  await expect.element(changedMark(3)).toBeVisible();
  expect(changedMark(1).elements()).toHaveLength(0);
  await userEvent.keyboard("{Escape}");
  expect(changedMark(1).elements()).toHaveLength(0);
  // The row shows the corrected text.
  expect(row(3).element().textContent).toContain("Our blue.");
});

test("a press on a row moves the canvas to the place of the request and opens it, and the list stays open; a press on a pin opens its request (Follow the requests 9, 10)", async () => {
  const server = await boot(() => {
    store.far = true;
    stored(1, "Make the logo bigger.", { frameId: far, x: 20, y: 30 });
    stored(2, "Add a short FAQ here.");
  });
  await tab(server);
  await requestsButton().click();

  await row(1).click();
  const dialog = page.getByRole("dialog", { name: "Request #1" });
  await expect.element(dialog).toBeVisible();
  expect(row(1).element()).toHaveAttribute("aria-current", "true");
  expect(panel().elements()).toHaveLength(1);
  // The place is at 40% of the canvas's width and height.
  const view = page.getByRole("region", { name: "Frames" }).element().getBoundingClientRect();
  const at = pin(1).element().getBoundingClientRect();
  expect(Math.abs(at.left - (view.left + view.width * 0.4))).toBeLessThan(3);
  expect(Math.abs(at.bottom - (view.top + view.height * 0.4))).toBeLessThan(3);

  await userEvent.keyboard("{Escape}");
  await expect.poll(() => dialog.elements().length).toBe(0);
  await row(2).click();
  await expect.element(page.getByRole("dialog", { name: "Request #2" })).toBeVisible();
  await pin(1).click();
  await expect.element(dialog).toBeVisible();
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
  await panel().getByRole("menuitemradio", { name: /Done/ }).click();
  expect(rowsIn(panel().query())).toEqual([1]);
  expect(markOf(1)).toBe("Done, no answer");
  // Nothing was written: the board is as it was.
  expect(JSON.stringify(board.get())).toBe(before);
});

/** The outdated mark of request `n`'s row: its word, or null. */
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
  // The pins of a removed frame go with it.
  expect(pin(2).elements()).toHaveLength(0);

  // More than 7 days: a long wait.
  await advance(t, minute);
  expect(outdatedOf(3)).toBeNull();
  await advance(t, minute);
  await expect.poll(() => outdatedOf(3)).toBe("May be outdated: a long wait");
  // It is a mark, not a state: the count and the groups do not change.
  await expect.element(requestsButton()).toHaveAccessibleName("Requests");
  expect(rowsIn(group("Other requests").query())).toEqual([1, 2, 4, 5, 3]);
  expect(JSON.stringify(board.get())).toBe(before);
});

test("a press on the row of a request of a removed frame moves the canvas to where the frame was: a dashed area that says it was removed, with the pin in it, and the popover (Follow the requests 9)", async () => {
  const server = await boot(() => {
    store.farGone = true;
    stored(1, "Shorter banner.", { frameId: far, x: 20, y: 30 });
  });
  await tab(server);
  await requestsButton().click();

  await row(1).click();
  await expect.element(page.getByRole("dialog", { name: "Request #1" })).toBeVisible();
  const area = page.getByRole("group", { name: "Far was removed" });
  await expect.element(area).toBeVisible();
  expect(area.element().textContent).toContain("Far was removed");
  // The place is at 40% of the canvas's width and height, in the area.
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

/** Request `n` with a long thread: its popover is as tall as it may be. */
function longThread(n: number, x: number, y: number) {
  const r = stored(n, "Make the logo bigger.", { x, y });
  for (let i = 1; i <= 12; i++) {
    store.messages.push(said(r, "edit", "Mai", `Make the logo bigger, take ${i}.`, r.created + i));
  }
}

test("the popover opens below its pin; with no room below it flips above, and with no room above or below it goes beside; it stays in the view, over the dock, and never covers its pin (Follow the requests 10)", async () => {
  // Fit shows Home at 100%, its top left at (400, 250) of the 1200 x 800 view.
  const server = await boot(() => {
    longThread(1, 40, 10);
    longThread(2, 40, 290);
    longThread(3, 200, 150);
  });
  await tab(server);
  const view = page.getByRole("region", { name: "Frames" }).element().getBoundingClientRect();
  const dock = page.getByRole("toolbar", { name: "Canvas" }).element().getBoundingClientRect();

  const sides: string[] = [];
  for (const n of [1, 2, 3]) {
    await pin(n).click();
    const dialog = page.getByRole("dialog", { name: `Request #${n}` });
    await expect.element(dialog).toBeVisible();
    await tick(50);
    const pop = dialog.element().getBoundingClientRect();
    const at = pin(n).element().getBoundingClientRect();
    sides.push(dialog.element().getAttribute("data-side") ?? "");

    expect(pop.left).toBeGreaterThanOrEqual(view.left);
    expect(pop.right).toBeLessThanOrEqual(view.right);
    expect(pop.top).toBeGreaterThanOrEqual(view.top);
    expect(pop.bottom).toBeLessThanOrEqual(dock.top);
    const overPin =
      pop.left < at.right && pop.right > at.left && pop.top < at.bottom && pop.bottom > at.top;
    expect(overPin).toBe(false);
    await userEvent.keyboard("{Escape}");
  }
  expect(sides).toEqual(["below", "above", "right"]);
});

test("a wheel over the thread of a popover scrolls the thread, not the canvas: the canvas does not move (Follow the requests 10)", async () => {
  const server = await boot(() => longThread(1, 40, 10));
  await tab(server);
  await pin(1).click();
  const dialog = page.getByRole("dialog", { name: "Request #1" });
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

test("the popover has the look of the design system: a 40 px head with a line under it, filled while a question waits; 13/20 text; a name of weight 600; a round 24 px avatar, square for an agent; icons for More and Close (Popover, ThreadHead, Message)", async () => {
  const server = await boot(() => {
    const r = stored(1, "Make the logo bigger.", { status: "asking", claimedBy: "claude-1" });
    store.messages.push(said(r, "question", "claude-1", "Which logo?", r.created + 1));
  });
  await tab(server);
  await pin(1).click();
  const dialog = page.getByRole("dialog", { name: "Request #1" });
  await expect.element(dialog.getByText("Which logo?")).toBeVisible();
  const pop = dialog.element();
  const all = (selector: string) =>
    [...pop.querySelectorAll(selector)].map((el) => getComputedStyle(el));
  const one = (selector: string) => {
    const [first] = all(selector);
    if (!first) throw new Error(`no ${selector}`);
    return first;
  };

  const box = getComputedStyle(pop);
  expect([box.width, box.borderTopWidth, box.borderTopLeftRadius]).toEqual([
    "340px",
    "1px",
    "12px",
  ]);
  const head = one("header");
  expect([head.height, head.borderBottomWidth]).toEqual(["40px", "1px"]);
  expect(head.backgroundColor).toBe("rgb(238, 244, 252)");
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
  for (const label of ["More", "Close"]) {
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
  // While it is down, an agent asks a question: the tab cannot know yet.
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
  // The pin draws again when its request changes: its mark comes once.
  server.run(write, {
    input: {
      n: 1,
      patch: { claimedBy: "claude-1", claimedUntil: serverNow + 5 * minute, tries: 1 },
    },
  });
  await expect.poll(() => markOf(1)).toBe("claude-1");
  expect(asks()).toEqual([{ name: "easel:ask:r1", pin: true }]);
});
