import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { exits } from "@tinkered/cli/test";
import { capsule, createScope, operation, rpc, tag, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";

import { access } from "@/access";
import { userApi } from "@/access/contract";
import { frames } from "@/frames";
import { frames as frameCells } from "@/frames/contract";
import { passApi, passMeta, shareApi } from "@/frames/share";
import { home as homeApp } from "@/home";
import { queue } from "@/queue";
import { messages, requests, serverClock } from "@/queue/cells";
import type { Request } from "@/queue/cells";
import { addInput, requestContracts } from "@/queue/contract";
import { routeTree } from "@/routes";
import { nameKey, tabMeta } from "@/viewer/gate";

import { frameOnPage } from "./frame-page";

const live = "c".repeat(32);
const pass = "3".repeat(32);
const serverNow = 1_800_000_000_000;
const home = "0123456789ab";
const person = "lagz0ne";

const store = {
  viewerName: null as string | null,
  named: [] as string[],
  adds: [] as Array<{ author: string; text: string }>,
  notes: [] as Array<{ from: string; text: string }>,
};

const actor = tag<string>({ label: "test.signedInActor" });

const sessionOrPass = operation({
  label: "test.sessionOrPass",
  input: transport.hook.start,
  run: (_, { input }) => {
    const held = passMeta.safeParse(input.meta).data?.pass;
    if (held === undefined) return { tags: [actor(person)] };
    if (held !== pass) return input.refuse({ ended: true });
    return { tags: [actor(store.viewerName ?? "")] };
  },
});

const named = operation({
  label: "test.signedInNamed",
  input: transport.hook.start,
  depends: { who: actor.required },
  run: ({ who }, { input }) => (who === "" ? input.refuse({ name: true }) : undefined),
});

const me = operation({
  label: "test.signedInMe",
  input: userApi["users.me"].input,
  run: () => ({ kind: "me" as const, name: person, owner: true }),
});

const loginEnd = operation({
  label: "test.signedInLoginEnd",
  input: userApi["login.end"].input,
  run: () => ({ kind: "ended" as const }),
});

const open = operation({
  label: "test.signedInShareOpen",
  input: shareApi["share.open"].input,
  run: () => ({ kind: "open" as const, canvas: "home", pass }),
});

const nameIt = operation({
  label: "test.signedInShareName",
  input: passApi["share.name"].input,
  depends: { who: actor.required },
  run: ({ who }, { input }) => {
    store.named.push(input.name);
    if (who === person) return { kind: "named" as const, name: person };
    store.viewerName ??= input.name;
    return { kind: "named" as const, name: store.viewerName };
  },
});

function rowOf(n: number, author: string, at: { x: number; y: number }, key: string): Request {
  return {
    canvas: "home",
    id: `r${n}`,
    n,
    page: null,
    frameId: home,
    version: 1,
    kit: 1,
    x: at.x,
    y: at.y,
    author,
    key,
    status: "open",
    claimedBy: null,
    claimedUntil: null,
    claimedAt: null,
    tries: 0,
    queuedAt: serverNow,
    acceptedBy: null,
    created: serverNow,
    updated: serverNow,
  };
}

const add = operation({
  label: "test.signedInAdd",
  input: addInput,
  depends: { who: actor.required, rows: requests.controller, thread: messages.controller },
  run: ({ who, rows, thread }, { input }) => {
    store.adds.push({ author: who, text: input.text });
    const n = rows.get().length + 1;
    const row = rowOf(n, who, input, input.key);

    rows.set(row);
    thread.set({
      canvas: "home",
      id: `m${n}`,
      request: row.id,
      kind: "ask",
      from: who,
      text: input.text,
      html: null,
      options: null,
      option: null,
      before: null,
      after: null,
      beforeKit: null,
      afterKit: null,
      created: serverNow,
    });
    return { kind: "added" as const, n };
  },
});

const note = operation({
  label: "test.signedInNote",
  input: requestContracts["request.note"].input,
  depends: { who: actor.required, thread: messages.controller },
  run: ({ who, thread }, { input }) => {
    store.notes.push({ from: who, text: input.text });
    thread.set({
      canvas: "home",
      id: `note-${store.notes.length}`,
      request: `r${input.n}`,
      kind: "note",
      from: who,
      text: input.text,
      html: null,
      options: null,
      option: null,
      before: null,
      after: null,
      beforeKit: null,
      afterKit: null,
      created: serverNow,
    });
    return { kind: "noted" as const };
  },
});

const addAndNote = capsule({
  label: "test.signedInQueue",
  exports: {
    viewer: rpc({
      "request.add": requestContracts["request.add"],
      "request.note": requestContracts["request.note"],
    }),
  },
});

const seed = operation({
  label: "test.signedInSeed",
  depends: { cells: frameCells.controller, clocks: serverClock.controller },
  run: ({ cells, clocks }) => {
    cells.set({
      canvas: "home",
      id: home,
      page: "page-1",
      name: "Home",
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      version: 1,
      status: "exploring",
    });
    clocks.set({ canvas: "home", now: serverNow });
  },
});

async function serve() {
  store.viewerName = null;
  store.named.length = 0;
  store.adds.length = 0;
  store.notes.length = 0;
  localStorage.removeItem(nameKey);
  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      access.user({ implement: { "users.me": me, "login.end": loginEnd } }),
      frames.board({ serve: true, onStart: [sessionOrPass] }),
      frames.viewer({ implement: { "share.open": open } }),
      frames.pass({
        implement: { "share.name": nameIt, "share.frame": frameOnPage },
        onStart: [sessionOrPass],
      }),
      addAndNote.viewer({
        implement: { "request.add": add, "request.note": note },
        onStart: [sessionOrPass, named],
      }),
      homeApp.board({ serve: true }),
      memory.server({
        services: [
          access.user,
          frames.board,
          frames.viewer,
          frames.pass,
          addAndNote.viewer,
          homeApp.board,
        ],
      }),
    ],
  }).ready;
  server.run(seed);
  onTestFinished(async () => {
    await server.close();
  });

  return server;
}

async function tab(server: Scope.Handle, path: string) {
  await page.viewport(1200, 800);
  const scope = await createScope({
    clock: makeTestClock(),
    capsules: [
      exits({ store: localStorage }),
      memory.client({ peer: server, meta: tabMeta }),
      access.user({ remote: memory.client }),
      frames.board({ read: memory.client }),
      frames.viewer({ remote: memory.client }),
      frames.pass({ remote: memory.client }),
      queue.viewer({ remote: memory.client }),
      homeApp.board({ read: memory.client }),
    ],
  }).ready;
  const history = createMemoryHistory({ initialEntries: [path] });
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

  return { root };
}

const frameOf = (name: string) =>
  page.getByRole("region", { name: "Frames" }).getByRole("group", { name });

const requestButton = () => page.getByRole("button", { name: "Request", exact: true });

const textbox = () => page.getByRole("textbox", { name: "Request" });

const sendButton = () =>
  page.getByRole("form", { name: "New request" }).getByRole("button", { name: "Send" });

const nameBox = () => page.getByRole("textbox", { name: "Your name" });

const pin = (n: number) => page.getByRole("button", { name: `Request #${n}` });

const card = (n: number) => page.getByRole("region", { name: `Request #${n}` });

async function askOnHome(text: string) {
  await requestButton().click();
  await frameOf("Home").click({ position: { x: 50, y: 60 } });
  await textbox().fill(text);
  await sendButton().click();
}

test("on /c/<canvas>, the first Send of a signed-in user asks no name: request.add goes with no pass, as the user, share.name is not called, and pin #1 shows (H-4)", async () => {
  await tab(await serve(), "/c/home");

  await askOnHome("Add a short FAQ here.");

  await expect.element(pin(1)).toBeVisible();
  expect(nameBox().elements()).toHaveLength(0);
  expect(store.adds).toEqual([{ author: person, text: "Add a short FAQ here." }]);
  expect(store.named).toEqual([]);
  expect(localStorage.getItem(nameKey)).toBeNull();
  expect(card(1).getByText("Add a short FAQ here.").elements()).toHaveLength(1);
});

test("on /c/<canvas>, a note of a signed-in user goes with no name step, as the user; More offers Take back, as the user is the author (H-4)", async () => {
  await tab(await serve(), "/c/home");
  await askOnHome("Add a pricing FAQ.");
  await expect.element(pin(1)).toBeVisible();

  const box = card(1).getByRole("textbox", { name: "Add a note" });
  await box.fill("Three questions at most.");
  await userEvent.keyboard("{Enter}");

  await expect
    .poll(() => store.notes)
    .toEqual([{ from: person, text: "Three questions at most." }]);
  expect(nameBox().elements()).toHaveLength(0);
  expect(store.named).toEqual([]);
  await card(1).getByRole("button", { name: "More" }).click();
  await expect.element(page.getByRole("menuitem", { name: "Take back" })).toBeVisible();
});

test("the share link still asks for a name at the first Send, also in a browser where a signed-in tab sent a request, and request.add goes as that name (H-4)", async () => {
  const server = await serve();
  const signedIn = await tab(server, "/c/home");
  await askOnHome("Add a short FAQ here.");
  await expect.element(pin(1)).toBeVisible();
  signedIn.root.unmount();

  await tab(server, `/s/${live}`);
  await requestButton().click();
  await frameOf("Home").click({ position: { x: 120, y: 90 } });
  await textbox().fill("Make the title bigger.");
  await sendButton().click();

  await expect.element(nameBox()).toBeVisible();
  expect(store.adds).toHaveLength(1);
  await nameBox().fill("Mai");
  await sendButton().click();

  await expect.element(pin(2)).toBeVisible();
  expect(store.named).toEqual(["Mai"]);
  expect(store.adds.at(-1)).toEqual({ author: "Mai", text: "Make the title bigger." });
  expect(localStorage.getItem(nameKey)).toBe("Mai");
});
