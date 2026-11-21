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
import { frames as frameCells, kept, removed } from "@/frames/contract";
import { passApi, passMeta, shareApi } from "@/frames/share";
import { queue } from "@/queue";
import { messageKind, messages, request, requests, serverClock } from "@/queue/cells";
import type { Message, Request } from "@/queue/cells";
import { requestContracts } from "@/queue/contract";
import type { State } from "@/queue/contract";
import { routeTree } from "@/routes";
import { openedKey, visitKey } from "@/viewer/follow";
import { nameKey, tabMeta } from "@/viewer/gate";

// A viewer answers and decides, in a real Chromium, over `memory` (SPEC-viewer.md § Follow the
// requests 10 to 16; SPEC-queue.md § A viewer answers and decides). The oracle is the
// viewer-queue chart: each test names the arrows it walks. The server stands in for
// share.server.ts and the queue: the board holds the frames, the requests, their messages and
// the server's clock. Each viewer call (`request.edit`, `answer`, `accept`, `reopen`, `close`)
// answers as the test plans: by default it writes the request as the queue's store does and
// answers its kind; a plan answers `wrongState` after another viewer's write, `gone`, `full`,
// `slow`, or a server fault, and writes nothing of its own.

const live = "c".repeat(32);
const pass = "4".repeat(32);
const home = "0123456789ab";
const serverNow = 1_800_000_000_000;
const minute = 60_000;

/** A call of a viewer, by its name in the contract. */
type Call =
  | "request.edit"
  | "request.answer"
  | "request.accept"
  | "request.reopen"
  | "request.close";

/** What a write does: a patch of the request, and a message. */
type Change = {
  n: number;
  patch: Partial<Request>;
  message?: { kind: Message["kind"]; from: string; text: string | null; option?: number | null };
};

/** What the next viewer call answers, if not its own kind. */
type Plan =
  | { kind: "gone" | "full" | "slow" | "fail" }
  | { kind: "wrongState"; state: State; first: Change };

/** The stub server's state; it outlives a server, as a database does. */
const store = {
  /** The name each pass holds. */
  names: new Map<string, string>(),
  requests: [] as Request[],
  messages: [] as Message[],
  /** Each viewer call that reached the server, with its input, in order. */
  calls: [] as Array<{ call: Call; input: unknown }>,
  plan: [] as Plan[],
  /** Frame Home's version, and the key of its picture; null: Home was removed. */
  home: { version: 1, k: "kh1" } as { version: number; k: string } | null,
  /** The kept versions of Home, each with the key of its picture. */
  kept: [] as Array<{ version: number; k?: string }>,
  /** Frame Side is on the board, far from Home. */
  side: false,
};

/** Frame Home's box. */
const homeBox = { name: "Home", x: 0, y: 0, w: 400, h: 300 };

let current: Scope.Handle | null = null;

const tick = (ms = 30) => new Promise((done) => setTimeout(done, ms));

const open = operation({
  label: "test.actOpen",
  input: shareApi["share.open"].input,
  run: (_, { input }) => {
    if (input.name !== undefined && !store.names.has(pass)) store.names.set(pass, input.name);
    return { kind: "open" as const, canvas: "home", pass };
  },
});

const nameIt = operation({
  label: "test.actName",
  input: passApi["share.name"].input,
  run: (_, { input }) => {
    if (!store.names.has(pass)) store.names.set(pass, input.name);
    return { kind: "named" as const, name: store.names.get(pass) ?? input.name };
  },
});

const passOnly = operation({
  label: "test.actPass",
  input: transport.hook.start,
  run: (_, { input }) =>
    passMeta.safeParse(input.meta).data?.pass === pass ? undefined : input.refuse({ ended: true }),
});

/** `mayAct`'s name half: a live pass with no name is refused `{ name: true }`. */
const named = operation({
  label: "test.actNamed",
  input: transport.hook.start,
  run: (_, { input }) => (store.names.has(pass) ? undefined : input.refuse({ name: true })),
});

/** A request on the store, with its ask: `n`, its text, and a patch. Newer for a lower `n`. */
function stored(n: number, text: string, patch: Partial<Request> = {}) {
  const at = serverNow - minute * 10 * n;
  const row: Request = {
    canvas: "home",
    id: `r${n}`,
    n,
    frameId: home,
    version: 1,
    x: 60 * n,
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
  said(row, { kind: "ask", from: row.author, text }, at);
  return row;
}

/** A message of a request on the store. */
function said(r: Request, m: Partial<Message> & Pick<Message, "kind" | "from">, at: number) {
  const message: Message = {
    canvas: "home",
    id: `m${String(store.messages.length + 1).padStart(3, "0")}`,
    request: r.id,
    text: null,
    html: null,
    options: null,
    option: null,
    before: null,
    after: null,
    created: at,
    ...m,
  };
  store.messages.push(message);
  return message;
}

/** Changes request `n` on the store, with a new `updated`, and adds the message. */
function changeStored(change: Change) {
  const i = store.requests.findIndex((r) => r.n === change.n);
  const before = store.requests[i];
  if (!before) throw new Error(`no request #${change.n}`);

  // The server's time now, and later than each write before it.
  const row: Request = { ...before, ...change.patch, updated: serverNow + store.messages.length };
  store.requests[i] = row;
  const m = change.message ? said(row, change.message, row.updated) : null;
  return { row, m };
}

const seed = operation({
  label: "test.actSeed",
  depends: {
    cells: frameCells.controller,
    versions: kept.controller,
    gone: removed.controller,
    rows: requests.controller,
    thread: messages.controller,
    clocks: serverClock.controller,
  },
  run: ({ cells, versions, gone, rows, thread, clocks }) => {
    if (store.home) cells.set({ canvas: "home", id: home, ...homeBox, ...store.home });
    else gone.set({ canvas: "home", id: home, ...homeBox, removed: serverNow - minute });

    if (store.side) {
      const box = { name: "Side", x: 3000, y: 0, w: 400, h: 300, version: 1 };
      cells.set({ canvas: "home", id: "5ide5ide5ide", ...box });
    }
    for (const v of store.kept) versions.set({ canvas: "home", id: home, ...v });
    clocks.set({ canvas: "home", now: serverNow });
    for (const row of store.requests) rows.set(row);
    for (const m of store.messages) thread.set(m);
  },
});

/** A change's message, as the test writes it. */
const changeMessage = z.object({
  kind: messageKind,
  from: z.string(),
  text: z.string().nullable(),
  option: z.number().nullable().optional(),
});

/** A change, as an agent's or another viewer's call writes it: the board pushes it. */
const write = operation({
  label: "test.actWrite",
  input: z.object({ n: z.number(), patch: request.partial(), message: changeMessage.optional() }),
  depends: { rows: requests.controller, thread: messages.controller },
  run: ({ rows, thread }, { input }) => {
    const { row, m } = changeStored(input);
    rows.set(row);
    if (m) thread.set(m);
  },
});

/** A viewer call's input, as the stub reads it. */
const callInput = z.object({
  n: z.number(),
  text: z.string().optional(),
  option: z.number().optional(),
});

type CallInput = z.infer<typeof callInput>;

/** What each call writes when it saves, as the queue's store writes it. */
const saves: Record<Call, (from: string, input: CallInput) => Change> = {
  "request.edit": (from, { n, text }) => ({
    n,
    patch: { status: "open", tries: 0, claimedBy: null, claimedUntil: null },
    message: { kind: "edit", from, text: text ?? null },
  }),
  "request.answer": (from, { n, text, option }) => ({
    n,
    patch: { status: "open", tries: 0 },
    message: { kind: "answer", from, text: text ?? null, option: option ?? null },
  }),
  "request.accept": (from, { n }) => ({
    n,
    patch: { acceptedBy: from },
    message: { kind: "accept", from, text: null },
  }),
  "request.reopen": (from, { n, text }) => ({
    n,
    patch: { status: "open", tries: 0, acceptedBy: null },
    message: { kind: "reopen", from, text: text ?? null },
  }),
  "request.close": (from, { n, text }) => ({
    n,
    patch: { status: "closed", claimedBy: null, claimedUntil: null },
    message: { kind: "close", from, text: text ?? null },
  }),
};

/** What a planned refusal answers. A fault throws. */
function refusedBy(plan: Plan) {
  switch (plan.kind) {
    case "fail":
      throw new Error("the stub server fails");
    case "slow":
      return { kind: "slow" as const, retryIn: minute };
    case "gone":
      return { kind: "gone" as const };
    case "full":
      return { kind: "full" as const };
    case "wrongState":
      return { kind: "wrongState" as const, state: plan.state };
  }
}

/**
 * One viewer call of the stub: it keeps the call, then answers as the test planned (a
 * `wrongState` after another viewer's write), or saves and answers `saved`. Each call's own stub
 * gives `saved` its kind.
 */
const called = operation({
  label: "test.actCalled",
  input: z.object({
    call: z.enum([
      "request.edit",
      "request.answer",
      "request.accept",
      "request.reopen",
      "request.close",
    ]),
    input: z.record(z.string(), z.unknown()),
  }),
  depends: { rows: requests.controller, thread: messages.controller },
  run: ({ rows, thread }, { input: { call, input } }) => {
    store.calls.push({ call, input });
    const plan = store.plan.shift();
    const first = plan?.kind === "wrongState" ? plan.first : null;
    const change = plan ? first : saves[call](store.names.get(pass) ?? "", callInput.parse(input));
    const answer = plan ? refusedBy(plan) : { kind: "saved" as const };

    if (change) {
      const { row, m } = changeStored(change);
      rows.set(row);
      if (m) thread.set(m);
    }
    return answer;
  },
});

const editStub = operation({
  label: "test.actEdit",
  input: requestContracts["request.edit"].input,
  depends: { called },
  run: ({ called }, { input }) => {
    const a = called.run({ input: { call: "request.edit", input } });
    if (a.kind === "full") throw new Error("an edit is not full");
    return a.kind === "saved" ? { kind: "edited" as const } : a;
  },
});

const answerStub = operation({
  label: "test.actAnswer",
  input: requestContracts["request.answer"].input,
  depends: { called },
  run: ({ called }, { input }) => {
    const a = called.run({ input: { call: "request.answer", input } });
    if (a.kind === "full") throw new Error("an answer is not full");
    return a.kind === "saved" ? { kind: "answered" as const } : a;
  },
});

const acceptStub = operation({
  label: "test.actAccept",
  input: requestContracts["request.accept"].input,
  depends: { called },
  run: ({ called }, { input }) => {
    const a = called.run({ input: { call: "request.accept", input } });
    if (a.kind === "full") throw new Error("an accept is not full");
    return a.kind === "saved" ? { kind: "accepted" as const } : a;
  },
});

const reopenStub = operation({
  label: "test.actReopen",
  input: requestContracts["request.reopen"].input,
  depends: { called },
  run: ({ called }, { input }) => {
    const a = called.run({ input: { call: "request.reopen", input } });
    return a.kind === "saved" ? { kind: "reopened" as const } : a;
  },
});

const closeStub = operation({
  label: "test.actClose",
  input: requestContracts["request.close"].input,
  depends: { called },
  run: ({ called }, { input }) => {
    const a = called.run({ input: { call: "request.close", input } });
    if (a.kind === "full") throw new Error("a close is not full");
    return a.kind === "saved" ? { kind: "closed" as const } : a;
  },
});

const addStub = operation({
  label: "test.actAdd",
  input: requestContracts["request.add"].input,
  run: () => ({ kind: "gone" as const }),
});

async function serve() {
  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      frames.board({ serve: true, onStart: [passOnly] }),
      frames.viewer({ implement: { "share.open": open } }),
      frames.pass({ implement: { "share.name": nameIt }, onStart: [passOnly] }),
      queue.viewer({
        implement: {
          "request.add": addStub,
          "request.edit": editStub,
          "request.answer": answerStub,
          "request.accept": acceptStub,
          "request.reopen": reopenStub,
          "request.close": closeStub,
        },
        onStart: [passOnly, named],
      }),
      memory.server({ services: [frames.board, frames.viewer, frames.pass, queue.viewer] }),
    ],
  }).ready;
  server.run(seed);
  current = server;
  onTestFinished(async () => {
    await server.close();
  });

  return server;
}

/** A fresh store and browser that kept the name `name` (or none); `fill` puts requests on it. */
async function boot(fill: () => void, name: string | null = "Mai") {
  localStorage.removeItem(visitKey + "home");
  localStorage.removeItem(openedKey + "home");
  if (name === null) localStorage.removeItem(nameKey);
  else localStorage.setItem(nameKey, name);
  store.names.clear();
  store.requests.length = 0;
  store.messages.length = 0;
  store.calls.length = 0;
  store.plan.length = 0;
  store.home = { version: 1, k: "kh1" };
  store.kept.length = 0;
  store.side = false;
  fill();

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
  const scope = await createScope({
    clock: makeTestClock(),
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

  return { scope, host };
}

const pin = (n: number) => page.getByRole("button", { name: `Request #${n}`, exact: true });
const dialog = (n: number) => page.getByRole("dialog", { name: `Request #${n}` });
const alertIn = (n: number) => dialog(n).getByRole("alert");
const mark = (n: number) => dialog(n).element().querySelector(".e-sb")?.getAttribute("aria-label");

/** The lines of the thread: each message and each step, oldest first. */
const lines = (n: number) =>
  [...dialog(n).element().querySelectorAll(".e-thread > li")].map((li) => {
    const walk = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    const words: string[] = [];
    while (walk.nextNode()) words.push(walk.currentNode.textContent ?? "");
    return words.join(" ").replace(/\s+/g, " ").trim();
  });

/** Opens request `n` by its pin. */
async function openIt(n: number) {
  await pin(n).click();
  await expect.element(dialog(n)).toBeVisible();
}

/** The calls that reached the server, as `call` and input. */
const calls = () => store.calls.map(({ call, input }) => ({ call, input }));

test("the thread shows each message oldest first, and each step as one line with the name; an agent has a square avatar; an HTML part shows in a sandboxed iframe (Follow the requests 10, 12, 13)", async () => {
  const server = await boot(() => {
    const r = stored(1, "Use our brand blue.", {
      status: "asking",
      claimedBy: "claude-1",
      tries: 1,
    });
    const at = r.created;
    said(r, { kind: "release", from: "claude-2", text: "out of time" }, at + minute);
    said(
      r,
      { kind: "edit", from: "Mai", text: "Use our brand blue on the Starter button." },
      at + 2 * minute,
    );
    said(
      r,
      {
        kind: "question",
        from: "claude-1",
        text: "Which blue do you mean?",
        html: "<!doctype html><p>Brand blue</p>",
        options: ["Brand blue", "Link blue"],
      },
      at + 3 * minute,
    );

    const p = stored(2, "Add the coupon field.", {
      status: "person",
      claimedBy: "claude-1",
      author: "Lan",
    });
    said(p, { kind: "decline", from: "claude-1", text: "not allowed" }, p.created + minute);
  });
  await tab(server);

  await openIt(1);
  expect(lines(1)).toEqual([
    "M Mai 10 min Use our brand blue on the Starter button.",
    "claude-2 stopped with no outcome: out of time · 9 min",
    "Mai corrected it · 8 min",
    "C claude-1 7 min Which blue do you mean? Brand blue Link blue",
  ]);
  // The agent's avatar is square; a person's is round.
  const avatars = [...dialog(1).element().querySelectorAll(".e-thread .e-avatar")];
  expect(avatars.map((a) => a.getAttribute("data-agent"))).toEqual(["false", "true"]);
  // The HTML part: a sandboxed iframe with scripts and no origin of its own.
  const part = dialog(1).element().querySelector("iframe");
  expect(part?.getAttribute("sandbox")).toBe("allow-scripts");
  expect(part?.getAttribute("title")).toBe("HTML part from claude-1");
  expect(part?.getAttribute("srcdoc")).toContain("Brand blue");

  await userEvent.keyboard("{Escape}");
  await expect.poll(() => dialog(1).elements().length).toBe(0);
  await openIt(2);
  expect(lines(2)).toEqual([
    "L Lan 20 min Add the coupon field.",
    "claude-1 gave it back: not allowed · 19 min",
  ]);
  expect(store.calls).toHaveLength(0);
});

test("a question: an option button answers it, or the textbox Answer and Send; the request waits again, and the thread says so (s22 to s3, A viewer answers and decides 1)", async () => {
  const server = await boot(() => {
    for (const n of [1, 2]) {
      const r = stored(n, "Use our brand blue.", { status: "asking", claimedBy: "claude-1" });
      said(
        r,
        {
          kind: "question",
          from: "claude-1",
          text: "Which blue?",
          options: ["Brand blue", "Link blue"],
        },
        r.created + minute,
      );
    }
  });
  await tab(server);

  await openIt(1);
  expect(mark(1)).toBe("Question for you");
  await dialog(1).getByRole("button", { name: "Brand blue" }).click();
  await expect.poll(() => mark(1)).toBe("Waiting for an agent");
  expect(calls()).toEqual([
    { call: "request.answer", input: { canvas: "home", n: 1, text: "Brand blue", option: 0 } },
  ]);
  expect(lines(1).slice(-2)).toEqual([
    "M Mai just now Brand blue",
    "Back in the queue, in its first place",
  ]);
  // The picked option shows picked; no option button answers again.
  expect(dialog(1).getByRole("button", { name: "Brand blue" }).elements()).toHaveLength(0);

  await userEvent.keyboard("{Escape}");
  await openIt(2);
  await dialog(2).getByRole("textbox", { name: "Answer" }).fill("The blue of the logo.");
  await dialog(2).getByRole("button", { name: "Send" }).click();
  await expect.poll(() => mark(2)).toBe("Waiting for an agent");
  expect(calls()[1]).toEqual({
    call: "request.answer",
    input: { canvas: "home", n: 2, text: "The blue of the logo." },
  });
  expect(dialog(2).getByRole("textbox", { name: "Answer" }).elements()).toHaveLength(0);
});

test("a result: Accept makes it done; Open again asks a note, Cancel keeps it, Send makes it wait again; a done request opens again the same way (s36 to s44, s43 to s3, s36 to s3)", async () => {
  const server = await boot(() => {
    for (const n of [1, 2]) {
      const r = stored(n, "Make the Team plan stand out.", {
        status: "resolved",
        claimedBy: "claude-1",
      });
      said(
        r,
        { kind: "result", from: "claude-1", text: "Done. The Team card has a blue border." },
        r.created + minute,
      );
    }
  });
  await tab(server);

  await openIt(1);
  expect(mark(1)).toBe("Result to check");
  await dialog(1).getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => mark(1)).toBe("Done");
  expect(lines(1).at(-1)).toBe("Mai accepted the result · just now");
  expect(dialog(1).getByRole("button", { name: "Accept" }).elements()).toHaveLength(0);

  // A done request: Open again, with a note.
  await dialog(1).getByRole("button", { name: "Open again" }).click();
  await dialog(1).getByRole("textbox", { name: "Note" }).fill("The label is too loud.");
  await dialog(1).getByRole("button", { name: "Send" }).click();
  await expect.poll(() => mark(1)).toBe("Waiting for an agent");
  expect(lines(1).slice(-2)).toEqual([
    "Mai opened it again · just now",
    "M Mai just now The label is too loud.",
  ]);

  await userEvent.keyboard("{Escape}");
  await openIt(2);
  await dialog(2).getByRole("button", { name: "Open again" }).click();
  await dialog(2).getByRole("textbox", { name: "Note" }).fill("Not this.");
  await dialog(2).getByRole("button", { name: "Cancel" }).click();
  expect(dialog(2).getByRole("textbox", { name: "Note" }).elements()).toHaveLength(0);
  expect(mark(2)).toBe("Result to check");
  await dialog(2).getByRole("button", { name: "Open again" }).click();
  await dialog(2).getByRole("textbox", { name: "Note" }).fill("Make it grey.");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => mark(2)).toBe("Waiting for an agent");

  expect(calls()).toEqual([
    { call: "request.accept", input: { canvas: "home", n: 1 } },
    { call: "request.reopen", input: { canvas: "home", n: 1, text: "The label is too loud." } },
    { call: "request.reopen", input: { canvas: "home", n: 2, text: "Make it grey." } },
  ]);
});

/** The switch of a picture in the popover of request `n`, its sides, and the picture on show. */
const compare = (n: number) => {
  const group = dialog(n).getByRole("radiogroup", { name: "Picture" });
  const side = (name: string) => group.getByRole("radio", { name, exact: true });
  const pictures = () =>
    [...dialog(n).element().querySelectorAll<HTMLImageElement>(".e-cmpr img")].map((img) => ({
      alt: img.alt,
      src: img.getAttribute("src"),
    }));

  return { group, side, pictures };
};

/** The address of a picture of Home at a version, with its key. */
const homePicture = (version: number, k: string) =>
  `/api/pictures/home/${home}/${version}?s=0.5&k=${k}`;

test("a result: one picture, the switch Before | After on its top edge, open on After; folded after a decision and while a note is written (Follow the requests 13, E4.2 M11, M12, M17)", async () => {
  const server = await boot(() => {
    store.home = { version: 3, k: "kh3" };
    store.kept.push({ version: 2, k: "kh2" });
    const r = stored(1, "Make the Team plan stand out.", {
      status: "resolved",
      claimedBy: "claude-1",
      version: 2,
    });
    said(
      r,
      { kind: "result", from: "claude-1", text: "Done.", before: 2, after: 3 },
      r.created + minute,
    );
  });
  await tab(server);
  await openIt(1);
  const { group, side, pictures } = compare(1);

  await expect.element(group).toBeVisible();
  expect(side("After").element()).toHaveAttribute("aria-checked", "true");
  expect(side("Before").element()).toHaveAttribute("aria-checked", "false");
  expect(pictures()).toEqual([{ alt: "After: Home", src: homePicture(3, "kh3") }]);
  // The switch sits on the top edge of the picture.
  const edge = dialog(1).element().querySelector(".e-cmpr-pic")?.getBoundingClientRect();
  const top = group.element().getBoundingClientRect();
  expect(top.top).toBeLessThan(edge?.top ?? 0);
  expect(top.bottom).toBeGreaterThan(edge?.top ?? 0);

  await side("Before").click();
  expect(pictures()).toEqual([{ alt: "Before: Home", src: homePicture(2, "kh2") }]);
  expect(side("Before").element()).toHaveAttribute("aria-checked", "true");

  // While the note is written, only the switch shows; a click on a side opens it.
  await dialog(1).getByRole("button", { name: "Open again" }).click();
  expect(pictures()).toEqual([]);
  expect(side("After").element()).toHaveAttribute("aria-checked", "false");
  expect(side("Before").element()).toHaveAttribute("aria-checked", "false");
  await side("After").click();
  expect(pictures()).toEqual([{ alt: "After: Home", src: homePicture(3, "kh3") }]);
  // Cancel: the picture is as it was before the note.
  await dialog(1).getByRole("button", { name: "Cancel" }).click();
  expect(pictures()).toEqual([{ alt: "Before: Home", src: homePicture(2, "kh2") }]);

  // After a decision, only the switch shows.
  await dialog(1).getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => mark(1)).toBe("Done");
  expect(pictures()).toEqual([]);
  await side("Before").click();
  expect(pictures()).toEqual([{ alt: "Before: Home", src: homePicture(2, "kh2") }]);
});

test("a picture with no key is the plain card; a result on the whole canvas has no switch (Follow the requests 13)", async () => {
  const server = await boot(() => {
    store.home = { version: 3, k: "kh3" };
    store.kept.push({ version: 2 });
    const r = stored(1, "Make it stand out.", { status: "resolved", claimedBy: "claude-1" });
    said(r, { kind: "result", from: "claude-1", text: "Done.", before: 2, after: 3 }, r.created);

    const c = stored(2, "Add a frame.", {
      status: "resolved",
      claimedBy: "claude-1",
      frameId: null,
      version: null,
    });
    said(
      c,
      { kind: "result", from: "claude-1", text: "Added.", before: null, after: null },
      c.created,
    );
  });
  await tab(server);
  await openIt(1);
  const { side, pictures } = compare(1);
  await side("Before").click();
  expect(pictures()).toEqual([]);
  expect(dialog(1).element().querySelectorAll(".e-cmpr-pic")).toHaveLength(1);
  await side("After").click();
  expect(pictures()).toEqual([{ alt: "After: Home", src: homePicture(3, "kh3") }]);

  await userEvent.keyboard("{Escape}");
  await pin(2).click();
  await expect.element(dialog(2)).toBeVisible();
  expect(dialog(2).getByRole("radiogroup").elements()).toHaveLength(0);
});

test("a result done with no answer: the step says it, only Open again shows, and its note opens the request again (Follow the requests 12, 15, E4.2 M15)", async () => {
  const server = await boot(() => {
    const r = stored(1, "Make the Team plan stand out.", {
      status: "resolved",
      claimedBy: "claude-1",
      updated: serverNow - 4 * 24 * 60 * minute,
    });
    said(r, { kind: "result", from: "claude-1", text: "Done." }, r.updated);
  });
  await tab(server);
  // A done request has no pin: the list Done opens it.
  await page.getByRole("button", { name: /^Requests/ }).click();
  const panel = page.getByRole("complementary", { name: "Requests" });
  await panel.getByRole("button", { name: "Open" }).click();
  await panel.getByRole("menuitemradio", { name: /Done/ }).click();
  await panel.getByRole("button", { name: /#1(?!\d)/ }).click();
  await expect.element(dialog(1)).toBeVisible();

  expect(mark(1)).toBe("Done, no answer");
  expect(lines(1).at(-1)).toBe("No viewer answered in 3 days, so it is done · Yesterday");
  expect(dialog(1).getByRole("button", { name: "Accept" }).elements()).toHaveLength(0);
  await dialog(1).getByRole("button", { name: "Open again" }).click();
  await dialog(1).getByRole("textbox", { name: "Note" }).fill("Make it grey.");
  await dialog(1).getByRole("button", { name: "Send" }).click();
  await expect.poll(() => mark(1)).toBe("Waiting for an agent");
  expect(calls()).toEqual([
    { call: "request.reopen", input: { canvas: "home", n: 1, text: "Make it grey." } },
  ]);
});

test("a waiting request that may be outdated: the dotted mark, the switch When asked | Now open on When asked, the step with the count of changes, and Close request (Follow the requests 6, 14, 15, E4.1 N8)", async () => {
  const server = await boot(() => {
    store.home = { version: 3, k: "kh3" };
    store.kept.push({ version: 1, k: "kh1" });
    stored(1, "Make the logo bigger.");
  });
  await tab(server);
  await openIt(1);

  const outdated = dialog(1).element().querySelector('.e-sb[data-state="outdated"]');
  expect(outdated?.getAttribute("aria-label")).toBe("May be outdated: the frame changed");
  const { side, pictures } = compare(1);
  expect(side("When asked").element()).toHaveAttribute("aria-checked", "true");
  expect(pictures()).toEqual([{ alt: "When asked: Home", src: homePicture(1, "kh1") }]);
  await side("Now").click();
  expect(pictures()).toEqual([{ alt: "Now: Home", src: homePicture(3, "kh3") }]);
  expect(lines(1).at(-1)).toBe("The Home frame changed 2 times since Mai asked");

  await dialog(1).getByRole("button", { name: "Close request" }).click();
  await expect.poll(() => mark(1)).toBe("Taken back");
  expect(calls()).toEqual([{ call: "request.close", input: { canvas: "home", n: 1 } }]);
});

test("a waiting request of a removed frame: Now says Frame removed, and the step says when the frame was removed (Follow the requests 9, 14)", async () => {
  const server = await boot(() => {
    store.home = null;
    store.side = true;
    store.kept.push({ version: 1, k: "kh1" });
    stored(1, "Make the logo bigger.");
  });
  await tab(server);
  await page.getByRole("button", { name: /^Requests/ }).click();
  const panel = page.getByRole("complementary", { name: "Requests" });
  await panel.getByRole("button", { name: /#1(?!\d)/ }).click();
  await expect.element(dialog(1)).toBeVisible();

  const outdated = dialog(1).element().querySelector('.e-sb[data-state="outdated"]');
  expect(outdated?.getAttribute("aria-label")).toBe("May be outdated: the frame was removed");
  const { side, pictures } = compare(1);
  expect(pictures()).toEqual([{ alt: "When asked: Home", src: homePicture(1, "kh1") }]);
  await side("Now").click();
  expect(pictures()).toEqual([]);
  expect(dialog(1).element().querySelector(".e-cmpr-pic")?.textContent).toBe("Frame removed");
  expect(lines(1).at(-1)).toBe("The Home frame was removed · 1 min");
  expect(dialog(1).getByRole("button", { name: "Close request" }).elements()).toHaveLength(1);
});

test("the step claude-1 took it shows at the time of the claim; a last lease that ran out shows took it, then ran out of time with no outcome; the board has no message for either (Follow the requests 12)", async () => {
  const server = await boot(() => {
    stored(1, "Add a short FAQ here.", {
      claimedBy: "claude-1",
      claimedAt: serverNow - 3 * minute,
      claimedUntil: serverNow + 2 * minute,
      tries: 1,
    });
    stored(2, "Make the logo bigger.", {
      claimedBy: "claude-2",
      claimedAt: serverNow - 8 * minute,
      claimedUntil: serverNow - 3 * minute,
      tries: 1,
    });
  });
  await tab(server);

  await openIt(1);
  expect(mark(1)).toBe("claude-1");
  expect(lines(1).slice(1)).toEqual(["claude-1 took it · 3 min"]);
  await userEvent.keyboard("{Escape}");
  await openIt(2);
  expect(mark(2)).toBe("Waiting for an agent");
  expect(lines(2).slice(1)).toEqual([
    "claude-2 took it · 8 min",
    "claude-2 ran out of time with no outcome · 3 min",
  ]);
  expect(store.messages).toHaveLength(2);
});

test("needs a person: the reason shows; the textbox sends it back made clear, or Close request closes it (s29 to s3, s29 to s9, A request no agent finishes 3)", async () => {
  const server = await boot(() => {
    for (const n of [1, 2]) {
      const r = stored(n, "Add the coupon field.", {
        status: "person",
        claimedBy: "claude-1",
        author: "Lan",
      });
      said(r, { kind: "decline", from: "claude-1", text: "not allowed" }, r.created + minute);
    }
    stored(3, "Add a chat button.", {
      claimedBy: "claude-1",
      claimedUntil: serverNow - minute,
      tries: 3,
    });
  });
  await tab(server);

  await openIt(1);
  expect(mark(1)).toBe("Needs a person");
  const clear = dialog(1).getByRole("textbox", { name: "Make it clear, then send it back" });
  await clear.fill("Draw a coupon field: a code box and an Apply button.");
  await dialog(1).getByRole("button", { name: "Send" }).click();
  await expect.poll(() => mark(1)).toBe("Waiting for an agent");
  expect(lines(1).slice(-2)).toEqual([
    "M Mai just now Draw a coupon field: a code box and an Apply button.",
    "Mai sent it back · just now",
  ]);

  await userEvent.keyboard("{Escape}");
  await openIt(2);
  await dialog(2).getByRole("button", { name: "Close request" }).click();
  await expect.poll(() => mark(2)).toBe("Closed");
  expect(lines(2).at(-1)).toBe("Mai closed it · just now");

  // 3 tries with no outcome: the thread says why it needs a person.
  await userEvent.keyboard("{Escape}");
  await openIt(3);
  expect(lines(3).at(-1)).toBe("3 tries with no outcome: it needs a person · 1 min");

  expect(calls()).toEqual([
    {
      call: "request.edit",
      input: { canvas: "home", n: 1, text: "Draw a coupon field: a code box and an Apply button." },
    },
    { call: "request.close", input: { canvas: "home", n: 2 } },
  ]);
});

test("More: Correct the request (Cancel, Save) while it waits, off with the hint Agent works while an agent works; Copy link; Take back for the author, Close request for another viewer (s1 to s3, s15 to s9, Follow the requests 11)", async () => {
  const server = await boot(() => {
    stored(1, "Add a short FAQ here.");
    stored(2, "Add a pricing FAQ.", {
      claimedBy: "claude-1",
      claimedUntil: serverNow + 5 * minute,
      tries: 1,
    });
    stored(3, "Shorter banner.", { author: "Tom" });
  });
  await tab(server);
  const copied = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

  await openIt(1);
  const more = dialog(1).getByRole("button", { name: "More" });
  expect(more.element()).toHaveAttribute("aria-haspopup", "menu");
  await more.click();
  const items = () =>
    dialog(1)
      .getByRole("menuitem")
      .elements()
      .map((i) => i.textContent);
  expect(items()).toEqual(["Correct the request", "Copy link", "Take back"]);

  await dialog(1).getByRole("menuitem", { name: "Copy link" }).click();
  expect(copied).toHaveBeenCalledWith(`${location.href.split("#")[0]}#request-1`);

  await more.click();
  await dialog(1).getByRole("menuitem", { name: "Correct the request" }).click();
  const box = dialog(1).getByRole("textbox", { name: "Request" });
  await expect.element(box).toHaveValue("Add a short FAQ here.");
  await box.fill("Add a short FAQ here, with a short answer each.");
  await dialog(1).getByRole("button", { name: "Cancel" }).click();
  expect(box.elements()).toHaveLength(0);
  await more.click();
  await dialog(1).getByRole("menuitem", { name: "Correct the request" }).click();
  await box.fill("Add a short FAQ here, with a short answer each.");
  await dialog(1).getByRole("button", { name: "Save" }).click();
  await expect.poll(() => lines(1).at(-1)).toBe("Mai corrected it · just now");
  expect(lines(1)[0]).toBe("M Mai 10 min Add a short FAQ here, with a short answer each.");

  // In work: Correct is off, with its hint; Take back ends the work.
  await userEvent.keyboard("{Escape}");
  await openIt(2);
  expect(mark(2)).toBe("claude-1");
  expect(lines(2).at(-1)).toBe("claude-1 took it · 20 min");
  await dialog(2).getByRole("button", { name: "More" }).click();
  const correct = dialog(2).getByRole("menuitem", { name: /Correct the request/ });
  expect(correct.element()).toHaveAttribute("aria-disabled", "true");
  expect(correct.element().textContent).toContain("Agent works");
  await dialog(2).getByRole("menuitem", { name: "Take back" }).click();
  await expect.poll(() => mark(2)).toBe("Taken back");
  expect(lines(2).at(-1)).toBe("Mai took it back · just now");

  // Another viewer's request: Close request in the place of Take back.
  await userEvent.keyboard("{Escape}");
  await openIt(3);
  await dialog(3).getByRole("button", { name: "More" }).click();
  expect(
    dialog(3)
      .getByRole("menuitem")
      .elements()
      .map((i) => i.textContent),
  ).toEqual(["Correct the request", "Copy link", "Close request"]);
  await dialog(3).getByRole("menuitem", { name: "Close request" }).click();
  await expect.poll(() => mark(3)).toBe("Closed");

  expect(calls()).toEqual([
    {
      call: "request.edit",
      input: { canvas: "home", n: 1, text: "Add a short FAQ here, with a short answer each." },
    },
    { call: "request.close", input: { canvas: "home", n: 2 } },
    { call: "request.close", input: { canvas: "home", n: 3 } },
  ]);
});

test("another viewer acted first (wrongState): nothing is saved, the popover shows the new state, keeps the text, and says who; after an accept, Send opens it again (Follow the requests 16, E4.2 M20)", async () => {
  const server = await boot(() => {
    const r = stored(1, "Make the Team plan stand out.", {
      status: "resolved",
      claimedBy: "claude-1",
    });
    said(r, { kind: "result", from: "claude-1", text: "Done." }, r.created + minute);
    for (const n of [2, 3]) {
      const q = stored(n, "Use our brand blue.", { status: "asking", claimedBy: "claude-1" });
      said(q, { kind: "question", from: "claude-1", text: "Which blue?" }, q.created + minute);
    }
  });
  await tab(server);

  // Tom accepts while Mai writes her note; the server answered wrongState to her reopen.
  await openIt(1);
  await dialog(1).getByRole("button", { name: "Open again" }).click();
  await dialog(1).getByRole("textbox", { name: "Note" }).fill("Make it grey.");
  store.plan.push({
    kind: "wrongState",
    state: "accepted",
    first: {
      n: 1,
      patch: { acceptedBy: "Tom" },
      message: { kind: "accept", from: "Tom", text: null },
    },
  });
  await dialog(1).getByRole("button", { name: "Send" }).click();
  await expect
    .element(alertIn(1))
    .toHaveTextContent(
      "Not sent: Tom accepted this first. Your text is kept. Send it to open the request again.",
    );
  expect(mark(1)).toBe("Done");
  await expect
    .element(dialog(1).getByRole("textbox", { name: "Note" }))
    .toHaveValue("Make it grey.");
  await dialog(1).getByRole("button", { name: "Send" }).click();
  await expect.poll(() => mark(1)).toBe("Waiting for an agent");

  // The page saw the change while Mai typed: it sends nothing, and says who acted.
  await userEvent.keyboard("{Escape}");
  await openIt(2);
  await dialog(2).getByRole("textbox", { name: "Answer" }).fill("The logo's blue.");
  server.run(write, {
    input: {
      n: 2,
      patch: { status: "open", tries: 0 },
      message: { kind: "answer", from: "Lan", text: "Brand blue", option: null },
    },
  });
  await expect.poll(() => mark(2)).toBe("Waiting for an agent");
  await dialog(2).getByRole("button", { name: "Send" }).click();
  await expect
    .element(alertIn(2))
    .toHaveTextContent("Not sent: Lan answered first. Your text is kept.");
  await expect
    .element(dialog(2).getByRole("textbox", { name: "Answer" }))
    .toHaveValue("The logo's blue.");

  // An agent started work while Mai corrected: Not saved, Copy text and Take back.
  await userEvent.keyboard("{Escape}");
  const copied = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  await openIt(2);
  await dialog(2).getByRole("button", { name: "More" }).click();
  await dialog(2).getByRole("menuitem", { name: "Correct the request" }).click();
  await dialog(2).getByRole("textbox", { name: "Request" }).fill("Use the blue of the logo.");
  store.plan.push({
    kind: "wrongState",
    state: "inWork",
    first: {
      n: 2,
      patch: { claimedBy: "claude-1", claimedUntil: serverNow + 5 * minute, tries: 1 },
    },
  });
  await dialog(2).getByRole("button", { name: "Save" }).click();
  await expect
    .element(alertIn(2))
    .toHaveTextContent("Not saved: claude-1 started work on it first. Your text is kept.");
  await dialog(2).getByRole("button", { name: "Copy text" }).click();
  expect(copied).toHaveBeenCalledWith("Use the blue of the logo.");
  await dialog(2).getByRole("button", { name: "Take back" }).click();
  await expect.poll(() => mark(2)).toBe("Taken back");

  expect(calls().map((c) => c.call)).toEqual([
    "request.reopen",
    "request.reopen",
    "request.edit",
    "request.close",
  ]);
});

test("gone, full, slow and a fault save nothing: the text is kept, and the popover says why (Follow the requests 16)", async () => {
  const server = await boot(() => {
    const r = stored(1, "Make the Team plan stand out.", {
      status: "resolved",
      claimedBy: "claude-1",
    });
    said(r, { kind: "result", from: "claude-1", text: "Done." }, r.created + minute);
    const q = stored(2, "Use our brand blue.", { status: "asking", claimedBy: "claude-1" });
    said(q, { kind: "question", from: "claude-1", text: "Which blue?" }, q.created + minute);
  });
  await tab(server);

  await openIt(1);
  await dialog(1).getByRole("button", { name: "Open again" }).click();
  await dialog(1).getByRole("textbox", { name: "Note" }).fill("Make it grey.");
  const why = {
    full: "Not sent: this canvas has too many open requests. Your text is kept. Send again when some are done.",
    slow: "Not sent: you sent many changes in a short time. Your text is kept. Send again in a minute.",
    fail: "Not sent: easel had a problem. Your text is kept. Send again.",
  } as const;
  for (const kind of ["full", "slow", "fail"] as const) {
    store.plan.push({ kind });
    await dialog(1).getByRole("button", { name: "Send" }).click();
    await expect.element(alertIn(1)).toHaveTextContent(why[kind]);
    await expect
      .element(dialog(1).getByRole("textbox", { name: "Note" }))
      .toHaveValue("Make it grey.");
  }
  expect(mark(1)).toBe("Result to check");

  await userEvent.keyboard("{Escape}");
  await openIt(2);
  await dialog(2).getByRole("textbox", { name: "Answer" }).fill("The logo's blue.");
  store.plan.push({ kind: "gone" });
  await dialog(2).getByRole("button", { name: "Send" }).click();
  await expect
    .element(alertIn(2))
    .toHaveTextContent("Not sent: this request is not on the canvas any more. Your text is kept.");

  expect(calls().map((c) => c.call)).toEqual([
    "request.reopen",
    "request.reopen",
    "request.reopen",
    "request.answer",
  ]);
});

test("a viewer whose browser kept no name: the first act asks the name, then acts with it (E4.2 M16)", async () => {
  const server = await boot(() => {
    const r = stored(1, "Make the Team plan stand out.", {
      status: "resolved",
      claimedBy: "claude-1",
    });
    said(r, { kind: "result", from: "claude-1", text: "Done." }, r.created + minute);
  }, null);
  await tab(server);

  await openIt(1);
  await dialog(1).getByRole("button", { name: "Accept" }).click();
  const name = dialog(1).getByRole("textbox", { name: "Your name" });
  await expect.element(name).toBeVisible();
  expect(store.calls).toHaveLength(0);
  await name.fill("Tom");
  await dialog(1).getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => mark(1)).toBe("Done");
  expect(lines(1).at(-1)).toBe("Tom accepted the result · just now");
  expect(localStorage.getItem(nameKey)).toBe("Tom");
  await tick();
});

test("the link that Copy link gives opens the panel and the request when the canvas opens (Follow the requests 11)", async () => {
  const server = await boot(() => {
    stored(1, "Add a short FAQ here.");
    stored(2, "Shorter banner.", { author: "Tom" });
  });
  location.hash = "#request-2";
  onTestFinished(() => {
    history.replaceState(null, "", location.href.split("#")[0]);
  });
  await tab(server);

  await expect.element(dialog(2)).toBeVisible();
  await expect.element(page.getByRole("complementary", { name: "Requests" })).toBeVisible();
  expect(dialog(1).elements()).toHaveLength(0);
});
