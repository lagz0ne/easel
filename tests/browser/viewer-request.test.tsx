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
import { docs, frames as frameCells, framesBoard } from "@/frames/contract";
import { passApi, passMeta, shareApi } from "@/frames/share";
import { queue } from "@/queue";
import { messages, requests, serverClock } from "@/queue/cells";
import type { Message, Request } from "@/queue/cells";
import { addInput } from "@/queue/contract";
import { routeTree } from "@/routes";
import { nameKey, tabMeta } from "@/viewer/gate";
import { restMs } from "@/viewer/stage";

const live = "a".repeat(32);
const serverNow = 1_800_000_000_000;
const home = "0123456789ab";
const pass = "1".repeat(32);

type Plan = "added" | "gone" | "full" | "slow" | "fail" | "drop";

type AddInput = z.infer<typeof addInput>;

const store = {
  names: new Map<string, string>(),
  named: [] as string[],
  opened: [] as Array<string | undefined>,
  requests: [] as Request[],
  messages: [] as Message[],
  keys: new Map<string, number>(),
  adds: [] as AddInput[],
  plan: [] as Plan[],
  refusal: null as null | { ended: true } | { locked: true },
  doc: null as string | null,
};

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
      kit: input.kit ?? 1,
      x: input.x,
      y: input.y,
      author: store.names.get(pass) ?? "",
      key: input.key,
      status: "open",
      claimedBy: null,
      claimedUntil: null,
      claimedAt: null,
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
      beforeKit: null,
      afterKit: null,
      created: 1,
    };
    store.requests.push(row);
    store.messages.push(ask);
    rows.set(row);
    thread.set(ask);

    return n;
  },
});

function stored(n: number, text: string, patch: Partial<Request> = {}) {
  const row: Request = {
    canvas: "home",
    id: `r${n}`,
    n,
    frameId: home,
    version: 1,
    kit: 1,
    x: 40 * n,
    y: 40,
    author: "Mai",
    key: `key-${n}`.padEnd(16, "-"),
    status: "open",
    claimedBy: null,
    claimedUntil: null,
    claimedAt: null,
    tries: 0,
    queuedAt: serverNow - 60_000 * n,
    acceptedBy: null,
    created: serverNow - 60_000 * n,
    updated: serverNow - 60_000 * n,
    ...patch,
  };
  store.keys.set(row.key, n);
  store.requests.push(row);
  store.messages.push({
    canvas: "home",
    id: `m${n}`,
    request: row.id,
    kind: "ask",
    from: row.author,
    text,
    html: null,
    options: null,
    option: null,
    before: null,
    after: null,
    beforeKit: null,
    afterKit: null,
    created: row.created,
  });
  return row;
}

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
      void current?.close();
      await tick(50);
    }
    return { kind: "added" as const, n };
  },
});

const passOnly = operation({
  label: "test.passOnly",
  input: transport.hook.start,
  run: (_, { input }) => {
    const held = passMeta.safeParse(input.meta).data?.pass;
    if (held !== pass) return input.refuse({ ended: true });
    return store.refusal ? input.refuse(store.refusal) : undefined;
  },
});

const named = operation({
  label: "test.named",
  input: transport.hook.start,
  run: (_, { input }) => (store.names.has(pass) ? undefined : input.refuse({ name: true })),
});

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

const seed = operation({
  label: "test.seed",
  depends: {
    cells: frameCells.controller,
    rows: requests.controller,
    thread: messages.controller,
    clocks: serverClock.controller,
    docCells: docs.controller,
  },
  run: ({ cells, rows, thread, clocks, docCells }) => {
    cells.set({ canvas: "home", id: home, name: "Home", x: 0, y: 0, w: 400, h: 300, version: 1 });
    clocks.set({ canvas: "home", now: serverNow });
    if (store.doc !== null) {
      docCells.set({ canvas: "home", id: home, version: 1, html: store.doc, css: null });
    }
    for (const row of store.requests) rows.set(row);
    for (const m of store.messages) thread.set(m);
  },
});

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

async function boot(fill?: () => void) {
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
  store.doc = null;
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

async function openOnHome() {
  await requestButton().click();
  await frameOf("Home").click({ position: { x: 50, y: 60 } });
  await expect.element(textbox()).toBeVisible();
}

async function type(text = "Add a short FAQ here.") {
  await textbox().fill(text);
}

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

  const shown = page.getByRole("region", { name: "Request #1" });
  await expect.element(shown.getByRole("img", { name: "Waiting for an agent" })).toBeVisible();
  expect(shown.getByText("Add a short FAQ here.").elements()).toHaveLength(1);
  expect(shown.getByText("#1 · On Home").elements()).toHaveLength(1);
  expect(requestButton().element()).toHaveAttribute("aria-pressed", "false");
  expect(textbox().elements()).toHaveLength(0);
  await tab(server);
  await expect.poll(() => pin(1).elements().length).toBe(2);
});

test("the dock at the bottom centre holds the canvas tools as icons, named: Request (Ask for a change), Requests, Find, Zoom out, the zoom, Zoom in and Fit; Request shows pressed while request mode is on (The page 2)", async () => {
  const server = await boot();
  await tab(server);

  const dock = page.getByRole("toolbar", { name: "Canvas" });
  const names = dock
    .getByRole("button")
    .elements()
    .map((b) => b.getAttribute("aria-label"));
  expect(names).toEqual(["Request", "Requests", "Find", "Zoom out", "Zoom in", "Fit"]);
  expect(dock.getByRole("status", { name: "Zoom" }).elements()).toHaveLength(1);
  expect(requestButton().element()).toHaveAttribute("title", "Ask for a change");
  expect(requestButton().element().querySelector("svg")).not.toBeNull();

  const box = dock.element().getBoundingClientRect();
  const view = frameList().element().getBoundingClientRect();
  expect(Math.abs(box.left + box.width / 2 - (view.left + view.width / 2))).toBeLessThan(2);
  expect(view.bottom - box.bottom).toBeGreaterThan(8);
  expect(view.bottom - box.bottom).toBeLessThan(24);

  expect(requestButton().element()).toHaveAttribute("aria-pressed", "false");
  await requestButton().click();
  expect(requestButton().element()).toHaveAttribute("aria-pressed", "true");
  await requestButton().click();
  expect(requestButton().element()).toHaveAttribute("aria-pressed", "false");
});

test("in request mode the pointer over the canvas is the request pointer, a speech bubble; out of it, the hand (Ask for a change 1)", async () => {
  const server = await boot();
  await tab(server);
  const pointer = () => getComputedStyle(frameList().element()).cursor;

  expect(pointer()).toBe("grab");
  await requestButton().click();
  expect(pointer()).toMatch(/^url\("data:image\/svg\+xml,.+"\) 2 22, crosshair$/);
  await requestButton().click();
  expect(pointer()).toBe("grab");
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

const passwordHeading = () =>
  page.getByRole("heading", { name: "The password of this link changed" });

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

test("the popover of a saved request names its state with the words of § Follow the requests 6: Waiting for an agent, the agent's name in work, Question for you, Result to check, Needs a person", async () => {
  const server = await boot(() => {
    stored(1, "Make the logo bigger.");
    stored(2, "Add a short FAQ here.", {
      claimedBy: "claude-1",
      claimedUntil: serverNow + 300_000,
      tries: 1,
    });
    stored(3, "Use our brand blue.", { status: "asking" });
    stored(4, "Make the Team plan stand out.", { status: "resolved" });
    stored(5, "Add the coupon field.", { status: "person" });
  });
  await tab(server);

  const words = [
    "Waiting for an agent",
    "claude-1",
    "Question for you",
    "Result to check",
    "Needs a person",
  ];
  for (const [i, word] of words.entries()) {
    await pin(i + 1).click();
    await expect
      .element(
        page.getByRole("region", { name: `Request #${i + 1}` }).getByRole("img", { name: word }),
      )
      .toBeVisible();
  }
});

function boxOf(selector: string) {
  const outline = document.querySelector<HTMLElement>(selector);
  if (!outline) return null;
  const { left, top, width, height } = outline.style;
  return { left, top, width, height };
}

const outlineBox = () => boxOf(".e-outline:not([data-hover])");

const hoverBox = () => boxOf(".e-outline[data-hover]");

test("in request mode, a click on a part of a live frame outlines that part: the frame's own script gives the box of the element there, and the frame stays sandboxed with scripts only (Ask for a change 2, judged rule 4)", async () => {
  const server = await boot(() => {
    store.doc =
      '<!doctype html><html><body style="margin:0"><div style="position:absolute;left:20px;top:40px;width:100px;height:50px;background:#ccc"></div></body></html>';
  });
  localStorage.setItem(nameKey, "Mai");
  const at = await tab(server);

  at.clock.advance(restMs);
  const card = () => frameOf("Home").element().querySelector<HTMLElement>(".e-card");
  await expect.poll(() => card()?.hidden, { timeout: 5_000 }).toBe(true);
  const frame = frameOf("Home").element().querySelector("iframe");
  expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");

  await openOnHome();
  await expect
    .poll(outlineBox)
    .toEqual({ left: "20px", top: "40px", width: "100px", height: "50px" });

  await frameOf("Home").click({ position: { x: 300, y: 200 } });
  await expect.poll(outlineBox).toBeNull();
  expect(textbox().elements()).toHaveLength(1);

  await frameOf("Home").click({ position: { x: 50, y: 60 } });
  await expect.poll(outlineBox).not.toBeNull();
  await userEvent.keyboard("{Escape}");
  await expect.poll(outlineBox).toBeNull();
});

test("in request mode, the part of a live frame under the pointer gets a 1 px outline before a click; it goes over the page's body, when the pointer leaves the frames, when a draft opens, and in view mode (Ask for a change 1, AnOutlineOnlyWhileHovering)", async () => {
  const server = await boot(() => {
    store.doc =
      '<!doctype html><html><body style="margin:0"><div style="position:absolute;left:20px;top:40px;width:100px;height:50px;background:#ccc"></div></body></html>';
  });
  localStorage.setItem(nameKey, "Mai");
  const at = await tab(server);
  at.clock.advance(restMs);
  const card = () => frameOf("Home").element().querySelector<HTMLElement>(".e-card");
  await expect.poll(() => card()?.hidden, { timeout: 5_000 }).toBe(true);
  const part = { left: "20px", top: "40px", width: "100px", height: "50px" };

  await frameOf("Home").hover({ position: { x: 50, y: 60 } });
  await tick(100);
  expect(hoverBox()).toBeNull();

  await requestButton().click();
  await frameOf("Home").hover({ position: { x: 50, y: 60 } });
  await expect.poll(hoverBox).toEqual(part);
  const line = document.querySelector(".e-outline[data-hover]");
  if (!line) throw new Error("no outline");
  expect(getComputedStyle(line).borderTopWidth).toBe("1px");

  await frameOf("Home").hover({ position: { x: 300, y: 200 } });
  await expect.poll(hoverBox).toBeNull();
  await frameOf("Home").hover({ position: { x: 60, y: 70 } });
  await expect.poll(hoverBox).toEqual(part);
  await page.getByRole("toolbar", { name: "Canvas" }).hover();
  await expect.poll(hoverBox).toBeNull();

  await frameOf("Home").click({ position: { x: 50, y: 60 } });
  await expect.element(textbox()).toBeVisible();
  await expect.poll(() => outlineBox()).toEqual(part);
  expect(hoverBox()).toBeNull();
});
