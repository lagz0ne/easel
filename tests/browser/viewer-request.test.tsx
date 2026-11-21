import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { exits } from "@tinkered/cli/test";
import { capsule, createScope, operation, rpc, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";
import { z } from "zod";

import { frames } from "@/frames";
import { frames as frameCells, framesBoard } from "@/frames/contract";
import { passApi, passMeta, shareApi } from "@/frames/share";
import { queue } from "@/queue";
import { messages, requests } from "@/queue/cells";
import type { Message, Request } from "@/queue/cells";
import { addInput } from "@/queue/contract";
import { routeTree } from "@/routes";
import { nameKey, tabMeta } from "@/viewer/gate";

// A viewer asks for a change, in a real Chromium, over `memory` (SPEC-viewer.md § Ask for a
// change, § When the link ends, § When a password is set). The oracle is the viewer-pin-post
// chart (the socket drops; full, slow and a server fault) and the viewer-pin-link chart (the
// link ends, the password changes, the frame changes): each test names its arrows and rules.
// The server stands in for share.server.ts and the queue: `share.open` gives the one pass;
// `share.name` names it once; `request.add` answers as the test plans, saves a key once, and
// writes the board's `requests` and `messages`. The tab reaches the server through `peer`, which
// a test points at a new server after the old one closed: the socket drops and comes back.

const live = "a".repeat(32);
/** The frame Home's id. */
const home = "0123456789ab";
const pass = "1".repeat(32);

/** What `request.add` answers next: `drop` saves it, then the server closes before it answers. */
type Plan = "added" | "gone" | "full" | "slow" | "fail" | "drop";

type AddInput = z.infer<typeof addInput>;

/** The stub server's state; it outlives a server, as a database does. */
const store = {
  /** The name each pass holds. */
  names: new Map<string, string>(),
  /** Each `share.name` input's name, and each `share.open` input's name, in order. */
  named: [] as string[],
  opened: [] as Array<string | undefined>,
  requests: [] as Request[],
  messages: [] as Message[],
  keys: new Map<string, number>(),
  /** Each `request.add` input that reached the server, in order. */
  adds: [] as AddInput[],
  plan: [] as Plan[],
  /** What every guard refuses now: a link that ended, or a password set or changed. */
  refusal: null as null | { ended: true } | { locked: true },
};

/** The server the tab's `peer` points at now. */
let current: Scope.Handle | null = null;

const open = operation({
  label: "test.shareOpen",
  input: shareApi["share.open"].input,
  run: (_, { input }) => {
    store.opened.push(input.name);
    if (input.name !== undefined && !store.names.has(pass)) store.names.set(pass, input.name);
    return { kind: "open" as const, canvas: "home", pass };
  },
});

const nameIt = operation({
  label: "test.shareName",
  input: passApi["share.name"].input,
  run: (_, { input }) => {
    store.named.push(input.name);
    if (!store.names.has(pass)) store.names.set(pass, input.name);
    return { kind: "named" as const, name: store.names.get(pass) ?? input.name };
  },
});

const tick = (ms = 30) => new Promise((done) => setTimeout(done, ms));

/** The answer the test planned that saves nothing: `gone`, `full`, `slow`, or a server fault. */
const refusedPlan = operation({
  label: "test.refusedPlan",
  input: z.enum(["added", "gone", "full", "slow", "fail", "drop"]),
  run: (_, { input: plan }) => {
    switch (plan) {
      case "gone":
      case "full":
        return { kind: plan };
      case "slow":
        return { kind: plan, retryIn: 60_000 };
      case "fail":
        throw new Error("the stub server fails");
      case "added":
      case "drop":
        return null;
    }
  },
});

/** The request and its first message, as the queue's store writes them. */
const save = operation({
  label: "test.save",
  input: addInput,
  depends: { rows: requests.controller, thread: messages.controller },
  run: ({ rows, thread }, { input }) => {
    const n = store.keys.size + 1;
    store.keys.set(input.key, n);
    const row: Request = {
      canvas: input.canvas,
      id: `r${n}`,
      n,
      frameId: input.frameId,
      version: input.version,
      x: input.x,
      y: input.y,
      author: store.names.get(pass) ?? "",
      key: input.key,
      status: "open",
      claimedBy: null,
      claimedUntil: null,
      tries: 0,
      queuedAt: 1,
      acceptedBy: null,
      created: 1,
      updated: 1,
    };
    const ask: Message = {
      canvas: input.canvas,
      id: `m${n}`,
      request: row.id,
      kind: "ask",
      from: row.author,
      text: input.text,
      html: null,
      options: null,
      option: null,
      before: null,
      after: null,
      created: 1,
    };
    store.requests.push(row);
    store.messages.push(ask);
    rows.set(row);
    thread.set(ask);

    return n;
  },
});

/** `request.add`: a key seen answers `added` first; then the planned answer; then the save. */
const add = operation({
  label: "test.requestAdd",
  input: addInput,
  depends: { refusedPlan, save },
  run: async ({ refusedPlan, save }, { input }) => {
    store.adds.push(input);
    const seen = store.keys.get(input.key);
    if (seen !== undefined) return { kind: "added" as const, n: seen };

    const plan = store.plan.shift() ?? "added";
    const refused = refusedPlan.run({ input: plan });
    if (refused) return refused;

    const n = save.run({ input });
    if (plan === "drop") {
      // The server goes before it answers: the tab cannot know whether it saved.
      void current?.close();
      await tick(50);
    }
    return { kind: "added" as const, n };
  },
});

/** Every guard: the refusal the test set, else the pass reads `home`. */
const passOnly = operation({
  label: "test.passOnly",
  input: transport.hook.start,
  run: (_, { input }) => {
    const held = passMeta.safeParse(input.meta).data?.pass;
    if (held !== pass) return input.refuse({ ended: true });
    return store.refusal ? input.refuse(store.refusal) : undefined;
  },
});

/** `mayAct`'s name half: a live pass with no name is refused `{ name: true }`. */
const named = operation({
  label: "test.named",
  input: transport.hook.start,
  run: (_, { input }) => (store.names.has(pass) ? undefined : input.refuse({ name: true })),
});

/** An agent's write to frame Home (a new version), or its delete. */
const agent = operation({
  label: "test.agent",
  input: z.enum(["write", "delete"]),
  depends: { cells: frameCells.controller },
  run: ({ cells }, { input }) => {
    const frame = cells.of({ canvas: "home", id: home }).get();
    if (input === "delete") return cells.delete({ canvas: "home", id: home });
    if (frame) cells.set({ ...frame, version: frame.version + 1 });
  },
});

/** The board as the store holds it: the frame, and each request and its messages. */
const seed = operation({
  label: "test.seed",
  depends: {
    cells: frameCells.controller,
    rows: requests.controller,
    thread: messages.controller,
  },
  run: ({ cells, rows, thread }) => {
    cells.set({ canvas: "home", id: home, name: "Home", x: 0, y: 0, w: 400, h: 300, version: 1 });
    for (const row of store.requests) rows.set(row);
    for (const m of store.messages) thread.set(m);
  },
});

/** A refusal for every pass, pushed to each open tab, as share.server.ts's `endPasses` does. */
const refuseAll = operation({
  label: "test.refuseAll",
  input: z.enum(["ended", "locked"]),
  depends: { invalidate: framesBoard.invalidate },
  run: async ({ invalidate }, { input }) => {
    store.refusal = input === "ended" ? { ended: true } : { locked: true };
    const canvas = { canvas: "home" };
    await invalidate.run({ input: { frames: canvas, docs: canvas, requests: canvas } });
  },
});

/**
 * The server's side of `request.add` alone: the queue's other viewer calls are not this test's,
 * and the wire knows a call by its address.
 */
const addOnly = capsule({
  label: "test.queue",
  exports: {
    viewer: rpc({
      "request.add": {
        input: addInput,
        output: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("added"), n: z.number() }),
          z.object({ kind: z.literal("gone") }),
          z.object({ kind: z.literal("full") }),
          z.object({ kind: z.literal("slow"), retryIn: z.number() }),
        ]),
      },
    }),
  },
});

/** A server with the stubs, on the store; the tab's `peer` points at it. */
async function serve() {
  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      frames.board({ serve: true, onStart: [passOnly] }),
      frames.viewer({ implement: { "share.open": open } }),
      frames.pass({ implement: { "share.name": nameIt }, onStart: [passOnly] }),
      addOnly.viewer({ implement: { "request.add": add }, onStart: [passOnly, named] }),
      memory.server({ services: [frames.board, frames.viewer, frames.pass, addOnly.viewer] }),
    ],
  }).ready;
  server.run(seed);
  current = server;
  onTestFinished(async () => {
    await server.close();
  });

  return server;
}

async function boot() {
  localStorage.removeItem(nameKey);
  store.names.clear();
  store.named.length = 0;
  store.opened.length = 0;
  store.requests.length = 0;
  store.messages.length = 0;
  store.keys.clear();
  store.adds.length = 0;
  store.plan.length = 0;
  store.refusal = null;

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
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  onTestFinished(async () => {
    root.unmount();
    await scope.close();
  });
  root.render(
    <ScopeProvider scope={scope}>
      <RouterProvider router={router} />
    </ScopeProvider>,
  );
  await expect.element(frameOf("Home")).toBeVisible();

  return { scope, clock, root };
}

const frameList = () => page.getByRole("region", { name: "Frames" });
const frameOf = (name: string) => frameList().getByRole("group", { name });
const requestButton = () => page.getByRole("button", { name: "Request", exact: true });
const textbox = () => page.getByRole("textbox", { name: "Request" });
const sendButton = () => page.getByRole("button", { name: "Send" });
const nameBox = () => page.getByRole("textbox", { name: "Your name" });
const pin = (n: number) => page.getByRole("button", { name: `Request #${n}` });
const alertText = () => page.getByRole("alert").element().textContent;
const reconnecting = () => page.getByRole("status").filter({ hasText: "Reconnecting" });

/** You press Request and click the Home frame at (50, 60) on it. */
async function openOnHome() {
  await requestButton().click();
  await frameOf("Home").click({ position: { x: 50, y: 60 } });
  await expect.element(textbox()).toBeVisible();
}

/** You type `text` in the textbox. */
async function type(text = "Add a short FAQ here.") {
  await textbox().fill(text);
}

/** The server closes and, after `ms` on the tab's clock, a new one takes its place. */
async function backAfterDrop(at: { clock: ReturnType<typeof makeTestClock> }) {
  await expect.element(reconnecting()).toBeVisible();
  await serve();
  for (let i = 0; i < 100 && reconnecting().elements().length; i++) {
    at.clock.advance(1_000);
    await tick(20);
  }
  expect(reconnecting().elements()).toHaveLength(0);
}

test("the first Send asks the name; share.name names the pass, the browser keeps it, request.add has the key and version, and pin #1 shows in each tab (s0 to s1, s1 to s2, s2 to s4, s4 to s8, PinMeansSaved)", async () => {
  const server = await boot();
  await tab(server);

  await openOnHome();
  expect(requestButton().element()).toHaveAttribute("aria-pressed", "true");
  expect(page.getByText("On Home").elements()).toHaveLength(1);
  await type();
  await sendButton().click();

  // The first Send asks the name, in the same popover; nothing is sent yet.
  await expect.element(nameBox()).toBeVisible();
  expect(
    page
      .getByText("People on this canvas see it on your requests. This browser keeps it.")
      .elements(),
  ).toHaveLength(1);
  expect(store.adds).toHaveLength(0);
  await nameBox().fill("  Mai ");
  await sendButton().click();

  await expect.element(pin(1)).toBeVisible();
  expect(store.named).toEqual(["Mai"]);
  expect(localStorage.getItem(nameKey)).toBe("Mai");
  expect(store.adds).toHaveLength(1);
  const sent = store.adds[0];
  expect(sent).toMatchObject({
    canvas: "home",
    frameId: home,
    version: 1,
    text: "Add a short FAQ here.",
  });
  expect(Math.round(sent?.x ?? 0)).toBe(50);
  expect(Math.round(sent?.y ?? 0)).toBe(60);
  expect(sent?.key.length).toBeGreaterThanOrEqual(16);
  expect(store.requests.map((r) => r.author)).toEqual(["Mai"]);

  // The popover shows the new request, waiting, and Request is off.
  const shown = page.getByRole("region", { name: "Request #1" });
  await expect.element(shown.getByText("Waiting for an agent")).toBeVisible();
  expect(shown.getByText("Add a short FAQ here.").elements()).toHaveLength(1);
  expect(shown.getByText("#1 · On Home").elements()).toHaveLength(1);
  expect(requestButton().element()).toHaveAttribute("aria-pressed", "false");
  expect(textbox().elements()).toHaveLength(0);
  // Another tab on the canvas shows the pin too: two pins, one in each tab.
  await tab(server);
  await expect.poll(() => pin(1).elements().length).toBe(2);
});

test("a browser that kept a name sends it at open, so its first Send asks nothing; Enter sends (E3 V4)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Bo");
  await tab(server);
  expect(store.opened).toEqual(["Bo"]);

  await openOnHome();
  await type("Make the price bigger.");
  await userEvent.keyboard("{Enter}");

  await expect.element(pin(1)).toBeVisible();
  expect(nameBox().elements()).toHaveLength(0);
  expect(store.named).toEqual([]);
  expect(store.requests.map((r) => r.author)).toEqual(["Bo"]);
});

test("a name kept after the link opened: request.add is refused name, the page gives the kept name to the pass and sends again with the same key", async () => {
  const server = await boot();
  await tab(server);
  localStorage.setItem(nameKey, "Bo");

  await openOnHome();
  await type();
  await sendButton().click();

  await expect.element(pin(1)).toBeVisible();
  expect(store.named).toEqual(["Bo"]);
  // The refused try never reached the op; the second one did, once.
  expect(store.adds).toHaveLength(1);
  expect(store.requests.map((r) => r.author)).toEqual(["Bo"]);
});

test("a click out of all frames asks about the whole canvas: frameId and version are null (E4.1 N2)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Tom");
  await tab(server);

  await requestButton().click();
  await frameList().click({ position: { x: 20, y: 400 } });
  await expect.element(page.getByText("On the whole canvas")).toBeVisible();
  await type("Add a frame for the order confirmation page.");
  await sendButton().click();

  await expect.element(pin(1)).toBeVisible();
  expect(store.adds[0]).toMatchObject({ frameId: null, version: null });
  await expect
    .element(page.getByRole("region", { name: "Request #1" }).getByText("#1 · On the whole canvas"))
    .toBeVisible();
});

test("Escape, or a press on Request, closes the textbox and sends nothing; Request turns off (s2 to s0, s1 to s0, CancelSendsNothing)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Mai");
  await tab(server);

  await openOnHome();
  await type();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => textbox().elements().length).toBe(0);
  expect(requestButton().element()).toHaveAttribute("aria-pressed", "false");

  await openOnHome();
  await type();
  await requestButton().click();
  await expect.poll(() => textbox().elements().length).toBe(0);
  expect(requestButton().element()).toHaveAttribute("aria-pressed", "false");
  expect(store.adds).toHaveLength(0);
});

test("full and slow save nothing: the text stays, with a danger edge, and says why; Send again sends with the same key (s4 to s6, s6 to s4, TextboxSaysWhetherSaved)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Mai");
  await tab(server);
  store.plan.push("full", "slow");

  await openOnHome();
  await type();
  await sendButton().click();
  await expect
    .poll(alertText)
    .toBe(
      "Not sent: this canvas has too many open requests. Your text is kept. Send again when some are done.",
    );
  expect(textbox().element()).toHaveValue("Add a short FAQ here.");
  expect(textbox().element()).toHaveAttribute("aria-invalid", "true");

  await sendButton().click();
  await expect
    .poll(alertText)
    .toBe(
      "Not sent: you sent many requests in a short time. Your text is kept. Send again in a minute.",
    );
  expect(textbox().element()).toHaveValue("Add a short FAQ here.");

  await sendButton().click();
  await expect.element(pin(1)).toBeVisible();
  const keys = new Set(store.adds.map((a) => a.key));
  expect(store.adds).toHaveLength(3);
  expect(keys.size).toBe(1);
  expect(store.requests).toHaveLength(1);
});

test("an agent's write to the frame leaves the textbox as it is; its removal answers gone at Send: nothing saved, the text stays, the frame shows as a dashed area, and a click puts the pin again (NoTextLost, GoneSendsNothing, s5 to s10, s10 to s5)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Mai");
  await tab(server);

  await openOnHome();
  await type();
  server.run(agent, { input: "write" });
  await tick(100);
  expect(textbox().element()).toHaveValue("Add a short FAQ here.");

  server.run(agent, { input: "delete" });
  await expect.poll(() => frameOf("Home").elements().length).toBe(0);
  expect(textbox().element()).toHaveValue("Add a short FAQ here.");
  store.plan.push("gone");
  await sendButton().click();
  await expect
    .poll(alertText)
    .toBe(
      "Not sent: an agent removed the Home frame. Your text is kept. Click the canvas to put the pin again.",
    );
  expect(document.querySelectorAll(".e-gone")).toHaveLength(1);
  expect(store.requests).toHaveLength(0);

  await frameList().click({ position: { x: 20, y: 400 } });
  await expect.element(page.getByText("On the whole canvas")).toBeVisible();
  expect(textbox().element()).toHaveValue("Add a short FAQ here.");
  expect(page.getByRole("alert").elements()).toHaveLength(0);
  await sendButton().click();
  await expect.element(pin(1)).toBeVisible();
  expect(store.adds.at(-1)).toMatchObject({ frameId: null, version: null });
});

test("with the socket down, Send sends nothing and says so; when it is back, Send sends it (s2 to s3, s3 to s2)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Mai");
  const at = await tab(server);

  await openOnHome();
  await type();
  await server.close();
  await expect.element(reconnecting()).toBeVisible();
  await sendButton().click();
  await expect
    .poll(alertText)
    .toBe("Not sent: no link to easel. Your text is kept. Send again when Reconnecting goes.");
  expect(store.adds).toHaveLength(0);

  await backAfterDrop(at);
  expect(page.getByRole("alert").elements()).toHaveLength(0);
  expect(textbox().element()).toHaveValue("Add a short FAQ here.");
  await sendButton().click();
  await expect.element(pin(1)).toBeVisible();
  expect(store.requests).toHaveLength(1);
});

test("the server saves it and the socket drops before the answer: not known yet if it saved, and Escape does nothing; when the socket is back the tab sends it again with the same key, and it is saved once (s4 to s5, s5 to s7, s7 to s8, OneSendOneRequest)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Mai");
  const at = await tab(server);
  store.plan.push("drop");

  await openOnHome();
  await type();
  await sendButton().click();
  await expect
    .poll(alertText)
    .toBe(
      "Not known yet if easel saved it. Your text is kept. It goes again when Reconnecting goes.",
    );
  await userEvent.keyboard("{Escape}");
  await tick();
  expect(textbox().element()).toHaveValue("Add a short FAQ here.");
  expect(store.requests).toHaveLength(1);

  await backAfterDrop(at);
  await expect.element(pin(1)).toBeVisible();
  expect(store.adds).toHaveLength(2);
  expect(store.adds[0]?.key).toBe(store.adds[1]?.key);
  expect(store.requests).toHaveLength(1);
  expect(pin(1).elements()).toHaveLength(1);
});

test("a server fault: not known yet if it saved, no Escape; Send sends it again with the same key (s4 to s7, s7 to s8)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Mai");
  await tab(server);
  store.plan.push("fail");

  await openOnHome();
  await type();
  await sendButton().click();
  await expect
    .poll(alertText)
    .toBe("Not known yet if easel saved it. Your text is kept. Send again.");
  await userEvent.keyboard("{Escape}");
  await tick();
  expect(textbox().element()).toHaveValue("Add a short FAQ here.");

  await sendButton().click();
  await expect.element(pin(1)).toBeVisible();
  expect(store.adds).toHaveLength(2);
  expect(store.adds[0]?.key).toBe(store.adds[1]?.key);
});

const kept = () => page.getByRole("region", { name: "Your request" });
const endedHeading = () => page.getByRole("heading", { name: "This link does not work" });
const passwordHeading = () => page.getByRole("heading", { name: "This link needs a password" });

test("the link ends while the text is typed: the ended page keeps it to copy, and says it was not sent (s3 to s6, NoTextLost, EndedPageOnly)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Mai");
  await tab(server);

  await openOnHome();
  await type();
  await server.run(refuseAll, { input: "ended" });

  await expect.element(endedHeading()).toBeVisible();
  await expect
    .element(kept().getByRole("heading", { name: "Your request was not sent" }))
    .toBeVisible();
  expect(kept().getByText("Add a short FAQ here.").elements()).toHaveLength(1);
  expect(kept().getByRole("button", { name: "Copy text" }).elements()).toHaveLength(1);
  expect(textbox().elements()).toHaveLength(0);
  expect(page.getByRole("button", { name: /^Request #/ }).elements()).toHaveLength(0);

  // Copy text puts the text on the clipboard.
  const copied = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  onTestFinished(() => void vi.restoreAllMocks());
  await kept().getByRole("button", { name: "Copy text" }).click();
  await expect.poll(() => copied.mock.calls).toEqual([["Add a short FAQ here."]]);
});

test("a new password while the text is typed: the password page keeps it, not sent; a send refused locked says it is not known whether it saved (s3 to s7, s5 to s11, EndedPageKeepsText)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Mai");
  await tab(server);

  await openOnHome();
  await type();
  await server.run(refuseAll, { input: "locked" });
  await expect.element(passwordHeading()).toBeVisible();
  await expect
    .element(kept().getByRole("heading", { name: "Your request was not sent" }))
    .toBeVisible();
  expect(kept().getByText("Add a short FAQ here.").elements()).toHaveLength(1);
});

test("Send, and the call is refused ended: the ended page keeps the text, and says it is not known whether it saved (s5 to s9, EndedPageKeepsText)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Mai");
  await tab(server);

  await openOnHome();
  await type();
  // The link ends; the push has not come yet when Send goes.
  store.refusal = { ended: true };
  await sendButton().click();
  await server.run(refuseAll, { input: "ended" });

  await expect.element(endedHeading()).toBeVisible();
  await expect
    .element(kept().getByRole("heading", { name: "Not known if your request was saved" }))
    .toBeVisible();
  expect(store.adds).toHaveLength(0);
});

test("Send, and the call is refused locked: the password page keeps the text, and says it is not known whether it saved (s5 to s11)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Mai");
  await tab(server);

  await openOnHome();
  await type();
  store.refusal = { locked: true };
  await sendButton().click();
  await server.run(refuseAll, { input: "locked" });

  await expect.element(passwordHeading()).toBeVisible();
  await expect
    .element(kept().getByRole("heading", { name: "Not known if your request was saved" }))
    .toBeVisible();
});

test("a press on a pin opens its request; a pin goes with its removed frame; a request on the canvas keeps its pin (PinMeansSaved)", async () => {
  const server = await boot();
  localStorage.setItem(nameKey, "Mai");
  await tab(server);

  await openOnHome();
  await type();
  await sendButton().click();
  await expect.element(pin(1)).toBeVisible();
  await requestButton().click();
  await frameList().click({ position: { x: 20, y: 400 } });
  await type("A frame for the order page.");
  await sendButton().click();
  await expect.element(pin(2)).toBeVisible();

  // Escape closes the popover of #2; a press on the pin of #1 opens its own.
  await userEvent.keyboard("{Escape}");
  await expect
    .poll(() => page.getByRole("region", { name: "Request #2" }).elements().length)
    .toBe(0);
  await pin(1).click();
  const first = page.getByRole("region", { name: "Request #1" });
  await expect.element(first.getByText("Add a short FAQ here.")).toBeVisible();
  expect(pin(1).element()).toHaveAttribute("aria-pressed", "true");

  server.run(agent, { input: "delete" });
  await expect.poll(() => pin(1).elements().length).toBe(0);
  expect(pin(2).elements()).toHaveLength(1);
});
