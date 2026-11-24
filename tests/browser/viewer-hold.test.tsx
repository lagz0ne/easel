import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { exits } from "@tinkered/cli/test";
import { capsule, createScope, operation, rpc, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { page } from "vite-plus/test/browser/context";

import { frames } from "@/frames";
import { frames as frameCells } from "@/frames/contract";
import { passApi, passMeta, shareApi } from "@/frames/share";
import { home as homeApp } from "@/home";
import { queue } from "@/queue";
import { messages, requests, serverClock } from "@/queue/cells";
import type { Request } from "@/queue/cells";
import { holds } from "@/queue/holds";
import type { Hold } from "@/queue/holds";
import { startsContracts } from "@/queue/starts";
import { routeTree } from "@/routes";
import { Canvas } from "@/viewer/canvas";
import { nameKey, tabMeta } from "@/viewer/gate";

import { frameOnPage } from "./frame-page";

const live = "b".repeat(32);
const serverNow = 1_800_000_000_000;
const home = "0123456789ab";
const pass = "2".repeat(32);

const store = {
  agreed: [] as Array<{ canvas: string; n: number }>,
  hold: null as Hold | null,
  owner: false,
  member: false,
};

const open = operation({
  label: "test.holdShareOpen",
  input: shareApi["share.open"].input,
  run: () => ({ kind: "open" as const, canvas: "home", pass }),
});

const nameIt = operation({
  label: "test.holdShareName",
  input: passApi["share.name"].input,
  run: (_, { input }) => ({ kind: "named" as const, name: input.name }),
});

const passOnly = operation({
  label: "test.holdPassOnly",
  input: transport.hook.start,
  run: (_, { input }) =>
    store.owner || passMeta.safeParse(input.meta).data?.pass === pass
      ? undefined
      : input.refuse({ ended: true }),
});

const root = createRootRoute({ component: Outlet });

const signedIn = createRoute({
  getParentRoute: () => root,
  path: "/c/$canvas",
  component: () => (
    <Canvas
      canvas={signedIn.useParams().canvas}
      opening={null}
      me={{ name: store.member ? "vibea-claude" : "lagz0ne", owner: !store.member }}
    />
  ),
});

const signedInTree = root.addChildren([signedIn]);

const agree = operation({
  label: "test.holdAgree",
  input: startsContracts["request.agree"].input,
  run: (_, { input }) => {
    store.agreed.push(input);
    return { kind: "agreed" as const };
  },
});

const agreeOnly = capsule({
  label: "test.starts",
  exports: { starts: rpc({ "request.agree": startsContracts["request.agree"] }) },
});

const row: Request = {
  canvas: "home",
  id: "r1",
  n: 1,
  page: null,
  frameId: home,
  version: 1,
  kit: 1,
  x: 40,
  y: 40,
  author: "Lan",
  key: "key-1".padEnd(16, "-"),
  status: "open",
  claimedBy: null,
  claimedUntil: null,
  claimedAt: null,
  tries: 0,
  queuedAt: serverNow - 60_000,
  acceptedBy: null,
  created: serverNow - 60_000,
  updated: serverNow - 60_000,
};

const seed = operation({
  label: "test.holdSeed",
  depends: {
    cells: frameCells.controller,
    rows: requests.controller,
    thread: messages.controller,
    clocks: serverClock.controller,
    holdCells: holds.controller,
  },
  run: ({ cells, rows, thread, clocks, holdCells }) => {
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
    rows.set(row);
    thread.set({
      canvas: "home",
      id: "m1",
      request: "r1",
      kind: "ask",
      from: "Lan",
      text: "Add the coupon field from the old checkout.",
      html: null,
      options: null,
      option: null,
      before: null,
      after: null,
      beforeKit: null,
      afterKit: null,
      created: row.created,
    });
    if (store.hold) holdCells.set({ canvas: "home", id: "r1", hold: store.hold });
  },
});

const dropHold = operation({
  label: "test.holdDrop",
  depends: { holdCells: holds.controller },
  run: ({ holdCells }) => holdCells.delete({ canvas: "home", id: "r1" }),
});

async function serve(hold: Hold) {
  store.agreed.length = 0;
  store.hold = hold;
  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      frames.board({ serve: true, onStart: [passOnly] }),
      frames.viewer({ implement: { "share.open": open } }),
      frames.pass({
        implement: { "share.name": nameIt, "share.frame": frameOnPage },
        onStart: [passOnly],
      }),
      agreeOnly.starts({ implement: { "request.agree": agree } }),
      homeApp.board({ serve: true }),
      memory.server({
        services: [frames.board, frames.viewer, frames.pass, agreeOnly.starts, homeApp.board],
      }),
    ],
  }).ready;
  server.run(seed);
  onTestFinished(async () => {
    await server.close();
  });

  return server;
}

async function tab(server: Scope.Handle, person: boolean, member = false) {
  store.owner = person;
  store.member = member;
  localStorage.setItem(nameKey, "Lan");
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
      queue.starts({ remote: memory.client }),
      homeApp.board({ read: memory.client }),
    ],
  }).ready;

  const history = createMemoryHistory({
    initialEntries: [person ? "/c/home" : `/s/${live}`],
  });
  const router = person
    ? createRouter({ routeTree: signedInTree, history })
    : createRouter({ routeTree, history, context: { scope } });
  const shown = createRoot(document.body.appendChild(document.createElement("div")));
  onTestFinished(async () => {
    shown.unmount();
    await scope.close();
  });
  shown.render(
    <ScopeProvider scope={scope}>
      <RouterProvider router={router} />
    </ScopeProvider>,
  );
  const pin = page.getByRole("button", { name: "Request #1" });
  await expect.element(pin).toBeVisible();
  await pin.click();

  return page.getByRole("region", { name: "Request #1" });
}

test("a request that waits for agreement tells a viewer of the share link that it waits for the owner, with no Agree button (D11, ARequestThatWaitsForThePersonSaysSo)", async () => {
  const card = await tab(await serve({ kind: "agreement" }), false);

  await expect.element(card.getByText("Waits for the owner to agree")).toBeVisible();
  expect(
    card.getByText("Then an agent starts on it. You can still correct it.").elements(),
  ).toHaveLength(1);
  expect(card.getByRole("button", { name: "Agree" }).elements()).toHaveLength(0);
});

test("the person sees Waits for you to agree and an Agree button; Agree calls request.agree, and the notice goes with the hold (D11)", async () => {
  const server = await serve({ kind: "agreement" });
  const card = await tab(server, true);

  await expect.element(card.getByText("Waits for you to agree").first()).toBeVisible();
  await card.getByRole("button", { name: "Agree" }).click();
  await expect.poll(() => store.agreed).toEqual([{ canvas: "home", n: 1 }]);

  server.run(dropHold);
  await expect.poll(() => card.getByRole("button", { name: "Agree" }).elements().length).toBe(0);
  expect(card.getByRole("status").filter({ hasText: "agree" }).elements()).toHaveLength(0);
});

test("a member on /c/<canvas> is not the person: the request waits for the owner, with no Agree button (H-4)", async () => {
  const card = await tab(await serve({ kind: "agreement" }), true, true);

  await expect.element(card.getByText("Waits for the owner to agree")).toBeVisible();
  expect(card.getByRole("button", { name: "Agree" }).elements()).toHaveLength(0);
});

const otherHolds: Array<[string, Hold, string | RegExp]> = [
  [
    "the running limit",
    { kind: "limit", which: "running", count: 2, limit: 2 },
    "Waits for the limit: 2 of 2 agents run",
  ],
  [
    "the day limit",
    { kind: "limit", which: "day", count: 20, limit: 20 },
    "Waits for the limit: 20 of 20 starts today",
  ],
  ["a failed start", { kind: "failed", retryAt: serverNow }, "The agent did not start"],
  ["a refusal", { kind: "refused" }, "The channel refused the request"],
  [
    "a silent starter",
    { kind: "silent", since: serverNow },
    /^The agent starter does not answer since \d\d:\d\d$/,
  ],
];

test.each(otherHolds)(
  "the card says why no agent started: %s, with no Agree button (D12, D13, AShownLimitIsTrue)",
  async (_, hold, title) => {
    const card = await tab(await serve(hold), true);

    await expect.element(card.getByText(title)).toBeVisible();
    expect(card.getByRole("button", { name: "Agree" }).elements()).toHaveLength(0);
  },
);
