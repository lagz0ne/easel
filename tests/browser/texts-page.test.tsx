import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { exits } from "@tinkered/cli/test";
import { createScope, operation, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { page } from "vite-plus/test/browser/context";

import { access } from "@/access";
import { userApi } from "@/access/contract";
import { frames } from "@/frames";
import { frames as frameCells, pages as pageCells } from "@/frames/contract";
import { passApi, shareApi } from "@/frames/share";
import { home } from "@/home";
import { queue } from "@/queue";
import { serverClock } from "@/queue/cells";
import { routeTree } from "@/routes";
import { tabMeta } from "@/viewer/gate";
import { words } from "@/words";
import type { TextsUses } from "@/words/contract";
import { wordsApi } from "@/words/contract";

import { frameOnPage } from "./frame-page";

const checkout = "0123456789ab";
const cart = "ba9876543210";
const checkoutUse = { canvas: "shop", id: checkout, name: "Checkout", page: "page-2" };
const cartUse = { canvas: "shop", id: cart, name: "Cart", page: "page-1" };

const answer: TextsUses = {
  kind: "found",
  kit: 3,
  rev: 3,
  frames: 3,
  pictures: 1,
  texts: [
    { key: "plan.name", en: "Pro plan", uses: [checkoutUse] },
    { key: "trial.start", en: "Start", vi: "Bắt đầu", uses: [checkoutUse, cartUse] },
    { key: "ui.close", en: "Close", vi: "Đóng", uses: [] },
  ],
  unknown: [{ key: "cart.title", uses: [cartUse] }],
  own: [
    { text: "Your order", uses: [checkoutUse, cartUse] },
    { text: "Card number", uses: [checkoutUse] },
  ],
  missing: { vi: ["plan.name"] },
};

const world = { signedIn: true, asked: 0 };

const gate = operation({
  label: "test.textsGate",
  input: transport.hook.start,
  run: (_, { input }) => (world.signedIn ? undefined : input.refuse({ signIn: true })),
});

const me = operation({
  label: "test.textsMe",
  input: userApi["users.me"].input,
  run: () => ({ kind: "me" as const, name: "lagz0ne", owner: true }),
});

const loginEnd = operation({
  label: "test.textsLoginEnd",
  input: userApi["login.end"].input,
  run: () => ({ kind: "ended" as const }),
});

const open = operation({
  label: "test.textsShareOpen",
  input: shareApi["share.open"].input,
  run: () => ({ kind: "open" as const, canvas: "shop", pass: "3".repeat(32) }),
});

const nameIt = operation({
  label: "test.textsShareName",
  input: passApi["share.name"].input,
  run: () => ({ kind: "named" as const, name: "lagz0ne" }),
});

const uses = operation({
  label: "test.textsUses",
  input: wordsApi["texts.uses"].input,
  run: () => {
    world.asked++;
    return answer;
  },
});

const seed = operation({
  label: "test.textsSeed",
  depends: {
    cells: frameCells.controller,
    sheets: pageCells.controller,
    clocks: serverClock.controller,
  },
  run: ({ cells, sheets, clocks }) => {
    const shell = { canvas: "shop", version: 1, status: "exploring" as const };
    cells.set({ ...shell, id: cart, name: "Cart", page: "page-1", x: 0, y: 0, w: 400, h: 300 });
    cells.set({
      ...shell,
      id: checkout,
      name: "Checkout",
      page: "page-2",
      x: 4000,
      y: 3000,
      w: 400,
      h: 300,
    });

    sheets.set({ canvas: "shop", key: "page-1", name: "Cart", frames: 1, order: 0 });
    sheets.set({ canvas: "shop", key: "page-2", name: "Pay", frames: 1, order: 1 });
    clocks.set({ canvas: "shop", now: 1_800_000_000_000 });
  },
});

async function serve(signedIn = true) {
  world.signedIn = signedIn;
  world.asked = 0;

  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      access.user({ implement: { "users.me": me, "login.end": loginEnd }, onStart: [gate] }),
      frames.board({ serve: true, onStart: [gate] }),
      frames.viewer({ implement: { "share.open": open } }),
      frames.pass({
        implement: { "share.name": nameIt, "share.frame": frameOnPage },
        onStart: [gate],
      }),
      home.board({ serve: true, onStart: [gate] }),
      words.api({ implement: { "texts.uses": uses }, onStart: [gate] }),
      memory.server({
        services: [access.user, frames.board, frames.viewer, frames.pass, home.board, words.api],
      }),
    ],
  }).ready;
  await server.run(seed);
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
      home.board({ read: memory.client }),
      words.api({ remote: memory.client }),
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
  return { history };
}

const textOf = (at: ReturnType<typeof page.getByRole>) => at.query()?.textContent ?? "";

const rowOf = (key: string) => page.getByRole("row", { name: new RegExp(`^${key} `) });

const table = () => page.getByRole("table", { name: "Texts" });

const firstCells = () =>
  [...table().element().querySelectorAll("tbody th[scope=row]")].map((th) => th.textContent);

const groupNames = () =>
  [...table().element().querySelectorAll("tbody th[scope=rowgroup]")].map((th) => th.textContent);

test("L9, L11, L13, L14: /texts is one table: each text beside its translation with its uses, Not used, Not translated, the text keys that the team does not have, and the texts with no key", async () => {
  await tab(await serve(), "/texts");

  await expect.element(page.getByRole("heading", { name: "Texts", level: 1 })).toBeVisible();
  await expect.element(table()).toBeVisible();
  expect(firstCells()).toEqual([
    "plan.name",
    "trial.start",
    "ui.close",
    "cart.title",
    "No key",
    "No key",
  ]);
  await expect.poll(() => textOf(rowOf("trial.start"))).toContain("StartBắt đầu");
  await rowOf("trial.start").getByText("2 frames").click();
  await expect.element(rowOf("trial.start").getByRole("link", { name: "Cart" })).toBeVisible();
  await expect.element(rowOf("plan.name").getByRole("link", { name: "Checkout" })).toBeVisible();
  await expect.poll(() => textOf(rowOf("plan.name"))).toContain("Not translated");
  await expect.poll(() => textOf(rowOf("ui.close"))).toContain("ĐóngNot used");
  await expect.poll(() => textOf(rowOf("cart.title"))).toContain("Not in the team");
  await expect.poll(() => textOf(table())).toContain("No keyYour order");
  await expect.poll(() => textOf(table())).toContain("No keyCard number");
  await expect
    .element(page.getByText("Frames read: 3. Image frames: 1 (easel cannot read their words)."))
    .toBeVisible();
  expect(world.asked).toBe(1);
});

test("L13: Show gives the count of each kind of text, and shows only that kind", async () => {
  await tab(await serve(), "/texts");

  const show = page.getByRole("combobox", { name: "Show" });
  await expect.element(show).toBeVisible();
  expect([...show.element().querySelectorAll("option")].map((one) => one.textContent)).toEqual([
    "All texts (6)",
    "Vietnamese: not translated (1)",
    "Not used (1)",
    "No key (2)",
    "Not in the team (1)",
  ]);
  await show.selectOptions("Vietnamese: not translated (1)");
  await expect.poll(firstCells).toEqual(["plan.name"]);
  await show.selectOptions("No key (2)");
  await expect.poll(() => textOf(table())).toContain("Card number");
  expect(firstCells()).toEqual(["No key", "No key"]);
  expect(world.asked).toBe(1);
});

test("Group by Key prefix puts each text under the first word of its key, and the texts with no key last", async () => {
  await tab(await serve(), "/texts");

  await page.getByRole("combobox", { name: "Group by" }).selectOptions("Key prefix");
  await expect.poll(groupNames).toEqual(["cart 1", "plan 1", "trial 1", "ui 1", "No key 2"]);
});

test("Group by Canvas puts each text under each canvas that uses it, and the texts with no use last", async () => {
  await tab(await serve(), "/texts");

  await page.getByRole("combobox", { name: "Group by" }).selectOptions("Canvas");
  await expect.poll(groupNames).toEqual(["shop 5", "Not used 1"]);
});

test("Find shows only the texts whose key or words have the typed words", async () => {
  await tab(await serve(), "/texts");

  await page.getByRole("searchbox", { name: "Find a text" }).fill("ORDER");
  await expect.poll(() => textOf(table())).toContain("Your order");
  expect(firstCells()).toEqual(["No key"]);
  await page.getByRole("searchbox", { name: "Find a text" }).fill("bắt");
  await expect.poll(firstCells).toEqual(["trial.start"]);
  await page.getByRole("searchbox", { name: "Find a text" }).fill("nothing like this");
  await expect.element(page.getByText("No text matches.")).toBeVisible();
});

test("L10: a use on /texts opens its canvas on the page of the frame, with the frame in the middle of the view", async () => {
  const { history } = await tab(await serve(), "/texts");

  await page
    .getByRole("row", { name: /^plan\.name / })
    .getByRole("link", { name: "Checkout" })
    .click();
  await expect
    .poll(() => `${history.location.pathname}${history.location.hash}`)
    .toBe(`/c/shop#frame-${checkout}`);
  const shell = page
    .getByRole("region", { name: "Frames" })
    .getByRole("group", { name: "Checkout" });
  await expect.element(shell).toBeVisible();
  await expect
    .poll(() => {
      const box = shell.element().getBoundingClientRect();
      const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      return Math.abs(middle.x - 600) < 120 && Math.abs(middle.y - 400) < 160;
    })
    .toBe(true);
});

test("/texts with no session shows the sign-in page, and the home page links to /texts", async () => {
  await tab(await serve(false), "/texts");
  await expect.element(page.getByRole("heading", { name: "Sign in to easel" })).toBeVisible();
  expect(world.asked).toBe(0);
});

test("the home page of a signed-in person has a link to Texts", async () => {
  const { history } = await tab(await serve(), "/");
  await page.getByRole("link", { name: "Texts" }).click();
  await expect.poll(() => history.location.pathname).toBe("/texts");
  await expect.element(page.getByRole("heading", { name: "Texts", level: 1 })).toBeVisible();
});
