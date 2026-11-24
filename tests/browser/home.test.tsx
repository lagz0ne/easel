import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { exits } from "@tinkered/cli/test";
import { createScope, operation, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { page } from "vite-plus/test/browser/context";
import { z } from "zod";

import { access } from "@/access";
import { browserApi, ownerApi, userApi } from "@/access/contract";
import { frames } from "@/frames";
import { frames as frameCells } from "@/frames/contract";
import { home } from "@/home";
import { homeRows, waitingCodes } from "@/home/contract";
import { postForm, takeHash } from "@/home/signin";
import { routeTree } from "@/routes";

const now = Date.parse("2026-11-24T10:00:00Z");

const request = "a".repeat(32);

const link = "b".repeat(64);

type Wait = { kind: "approved" } | { kind: "denied" } | { kind: "expired" };

const world = {
  signedIn: false,
  owner: true,
  approvals: [] as Array<{ code: string; owner: boolean }>,
  denials: [] as string[],
  answer: Promise.withResolvers<Wait>(),
  start: { kind: "pending" } as { kind: "pending" } | { kind: "slow" },
};

const sessionGate = operation({
  label: "test.sessionGate",
  input: transport.hook.start,
  run: (_, { input }) => (world.signedIn ? undefined : input.refuse({ signIn: true })),
});

const me = operation({
  label: "test.me",
  input: userApi["users.me"].input,
  run: () => ({ kind: "me" as const, name: "ann", owner: world.owner }),
});

const loginEnd = operation({
  label: "test.loginEnd",
  input: userApi["login.end"].input,
  run: () => ({ kind: "ended" as const }),
});

const start = operation({
  label: "test.browserStart",
  input: browserApi["browser.start"].input,
  run: () =>
    world.start.kind === "slow"
      ? { kind: "slow" as const, retryIn: 3_000 }
      : { kind: "pending" as const, code: "BCDF-GHJK", request, expiresAt: now + 600_000 },
});

const wait = operation({
  label: "test.browserWait",
  input: browserApi["browser.wait"].input,
  run: () => world.answer.promise,
});

const approve = operation({
  label: "test.approve",
  input: ownerApi["users.approve"].input,
  depends: { codes: waitingCodes.atScope.controller },
  run: ({ codes }, { input }) => {
    world.approvals.push({ code: input.code, owner: input.owner === true });
    codes.delete({ code: input.code });
    return { kind: "approved" as const, user: { name: "bo", role: "member" as const, since: now } };
  },
});

const deny = operation({
  label: "test.deny",
  input: ownerApi["users.deny"].input,
  run: (_, { input }) => (world.denials.push(input.code), { kind: "denied" as const }),
});

const add = operation({
  label: "test.add",
  input: ownerApi["users.add"].input,
  run: () => ({ kind: "taken" as const }),
});

const list = operation({
  label: "test.list",
  input: ownerApi["users.list"].input,
  run: () => ({ users: [], requests: [], sessions: [] }),
});

const revoke = operation({
  label: "test.revoke",
  input: ownerApi["users.revoke"].input,
  run: () => ({ kind: "gone" as const }),
});

const end = operation({
  label: "test.end",
  input: ownerApi["users.end"].input,
  run: () => ({ kind: "gone" as const }),
});

const putRow = operation({
  label: "test.putRow",
  input: z.object({ canvas: z.string(), name: z.string(), inbox: z.number(), changed: z.number() }),
  depends: { rows: homeRows.atScope.controller },
  run: ({ rows }, { input }) => rows.set({ ...input, frames: 1, pages: 1 }),
});

const putCode = operation({
  label: "test.putCode",
  depends: { codes: waitingCodes.atScope.controller },
  run: ({ codes }) =>
    codes.set({
      code: "LMNP-QRST",
      name: "bo",
      since: now,
      expiresAt: now + 600_000,
      browser: true,
    }),
});

const putFrame = operation({
  label: "test.putFrame",
  input: z.string(),
  depends: { cells: frameCells.controller },
  run: ({ cells }, { input }) =>
    cells.set({
      canvas: input,
      id: "f1",
      name: "Checkout",
      page: "page-1",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      version: 1,
      status: "exploring",
    }),
});

async function boot() {
  world.signedIn = false;
  world.owner = true;
  world.approvals = [];
  world.denials = [];
  world.answer = Promise.withResolvers<Wait>();
  world.start = { kind: "pending" };
  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      access.user({
        implement: { "users.me": me, "login.end": loginEnd },
        onStart: [sessionGate],
      }),
      access.browser({ implement: { "browser.start": start, "browser.wait": wait } }),
      access.owner({
        implement: {
          "users.approve": approve,
          "users.deny": deny,
          "users.add": add,
          "users.list": list,
          "users.revoke": revoke,
          "users.end": end,
        },
        onStart: [sessionGate],
      }),
      home.board({ serve: true, onStart: [sessionGate] }),
      home.codes({ serve: true, onStart: [sessionGate] }),
      frames.board({ serve: true, onStart: [sessionGate] }),
      memory.server({
        services: [access.user, access.browser, access.owner, home.board, home.codes, frames.board],
      }),
    ],
  }).ready;
  onTestFinished(async () => {
    await server.close();
  });

  return server;
}

type Posted = Array<[string, Readonly<Record<string, string>>]>;

async function tab(server: Scope.Handle, path: string, size: { w: number; h: number }) {
  await page.viewport(size.w, size.h);
  const posted: Posted = [];
  const scope = await createScope({
    tags: [
      postForm((action, fields) => posted.push([action, fields])),
      takeHash(() => (path.startsWith("/open#") ? path.slice(6) : "")),
    ],
    capsules: [
      exits({ store: localStorage }),
      memory.client({ peer: server }),
      access.user({ remote: memory.client }),
      access.browser({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      home.board({ read: memory.client }),
      home.codes({ read: memory.client }),
      frames.board({ read: memory.client }),
    ],
  }).ready;
  const history = createMemoryHistory({ initialEntries: [path.split("#")[0] ?? path] });
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

  return { scope, posted, history };
}

const phone = { w: 390, h: 844 };

const desk = { w: 1440, h: 900 };

const fitsTheWidth = () =>
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

const heightOf = (element: Element) => element.getBoundingClientRect().height;

for (const size of [phone, desk]) {
  test(`criterion 1 (${size.w} x ${size.h}): with no session, / shows a code; within 5 s of the approve, the page posts its request to /auth/code, with no reload`, async () => {
    const server = await boot();
    const shown = await tab(server, "/", size);

    await expect.element(page.getByRole("heading", { name: "Sign in to easel" })).toBeVisible();
    await page.getByLabelText("Your name").fill("bo");
    await page.getByRole("button", { name: "Get a code" }).click();
    await expect.element(page.getByText("BCDF-GHJK", { exact: true })).toBeVisible();
    fitsTheWidth();

    const approved = Date.now();
    world.answer.resolve({ kind: "approved" });
    await expect.element(page.getByText("Approved. Signing in.")).toBeVisible();
    expect(shown.posted).toEqual([["/auth/code", { request }]]);
    expect(Date.now() - approved).toBeLessThan(5_000);
    expect(document.body.textContent).not.toContain(request);
  });
}

test("a denied code, a code that ran out, and too many tries each say so; Get a new code goes back to the name", async () => {
  const server = await boot();
  await tab(server, "/", phone);
  const getCode = async () => {
    await page.getByLabelText("Your name").fill("bo");
    await page.getByRole("button", { name: "Get a code" }).click();
  };

  await getCode();
  world.answer.resolve({ kind: "denied" });
  await expect.element(page.getByText("An owner denied the code.")).toBeVisible();
  await page.getByRole("button", { name: "Get a new code" }).click();

  world.answer = Promise.withResolvers<Wait>();
  await getCode();
  world.answer.resolve({ kind: "expired" });
  await expect.element(page.getByText("The code ran out.")).toBeVisible();
  await page.getByRole("button", { name: "Get a new code" }).click();

  world.start = { kind: "slow" };
  await getCode();
  await expect.element(page.getByText("Too many tries. Wait 3 s, then try again.")).toBeVisible();
});

for (const size of [phone, desk]) {
  test(`criterion 3 (${size.w} x ${size.h}): the list shows each canvas, a canvas with 2 requests that wait shows 2 and comes first, and the count moves to 1 with no reload`, async () => {
    const server = await boot();
    world.signedIn = true;
    server.run(putRow, { input: { canvas: "blog", name: "Blog", inbox: 0, changed: now } });
    server.run(putRow, { input: { canvas: "shop", name: "Shop", inbox: 2, changed: now - 1 } });
    await tab(server, "/", size);

    const list = page.getByRole("list", { name: "Canvases" });
    const rows = () =>
      list
        .getByRole("link")
        .elements()
        .map((row) => row.textContent ?? "");
    await expect.poll(rows).toHaveLength(2);
    expect(rows()[0]).toMatch(/^Shop.*2 wait for you$/);
    expect(rows()[1]).toMatch(/^Blog/);
    expect(document.querySelectorAll(".e-home-inbox")).toHaveLength(1);
    fitsTheWidth();
    for (const row of list.getByRole("link").elements()) {
      expect(heightOf(row)).toBeGreaterThanOrEqual(40);
    }

    server.run(putRow, { input: { canvas: "shop", name: "Shop", inbox: 1, changed: now - 1 } });
    await expect.poll(() => rows()[0]).toMatch(/^Shop.*1 wait for you$/);
  });
}

test("an owner sees the codes that wait, and approves or denies each one on the home page", async () => {
  const server = await boot();
  world.signedIn = true;
  server.run(putCode);
  await tab(server, "/", phone);

  await expect
    .element(page.getByRole("heading", { name: "Codes that wait for you" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Approve LMNP-QRST of bo" }).click();
  await expect
    .element(page.getByRole("heading", { name: "Codes that wait for you" }))
    .not.toBeInTheDocument();
  expect(world.approvals).toEqual([{ code: "LMNP-QRST", owner: false }]);

  server.run(putCode);
  await page.getByRole("button", { name: "Deny LMNP-QRST of bo" }).click();
  await expect.poll(() => world.denials).toEqual(["LMNP-QRST"]);
});

test("a member sees no codes that wait", async () => {
  const server = await boot();
  world.signedIn = true;
  world.owner = false;
  server.run(putCode);
  server.run(putRow, { input: { canvas: "shop", name: "Shop", inbox: 0, changed: now } });
  await tab(server, "/", phone);

  await expect.element(page.getByRole("link", { name: /^Shop/ })).toBeVisible();
  expect(page.getByRole("heading", { name: "Codes that wait for you" }).elements()).toHaveLength(0);
  await expect.element(page.getByText("ann", { exact: true })).toBeVisible();
});

for (const size of [phone, desk]) {
  test(`criterion 4 (${size.w} x ${size.h}): a row opens its canvas at /c/<canvas>; the back button before its name goes to the list`, async () => {
    const server = await boot();
    world.signedIn = true;
    server.run(putRow, { input: { canvas: "shop", name: "Shop", inbox: 0, changed: now } });
    server.run(putFrame, { input: "shop" });
    const shown = await tab(server, "/", size);

    await page.getByRole("link", { name: /^Shop/ }).click();
    await expect
      .element(page.getByRole("region", { name: "Frames" }).getByText("Checkout"))
      .toBeVisible();
    expect(shown.history.location.pathname).toBe("/c/shop");
    const bar = page.getByRole("navigation", { name: "Canvas" });
    await expect.element(bar.getByRole("heading", { name: "Shop" })).toBeVisible();
    const back = bar.getByRole("link", { name: "Back to the canvases" });
    expect(heightOf(back.element())).toBeGreaterThanOrEqual(36);
    fitsTheWidth();

    await back.click();
    await expect.element(page.getByRole("heading", { name: "Canvases" })).toBeVisible();
    expect(shown.history.location.pathname).toBe("/");
  });
}

test("criterion 5: when the session ends, the next look of the home page shows the sign-in page", async () => {
  const server = await boot();
  world.signedIn = true;
  server.run(putRow, { input: { canvas: "shop", name: "Shop", inbox: 0, changed: now } });
  await tab(server, "/", phone);
  await expect.element(page.getByRole("heading", { name: "Canvases" })).toBeVisible();

  world.signedIn = false;
  await server.run(home.board.invalidate, { input: { rows: {} } });
  await expect.element(page.getByRole("heading", { name: "Sign in to easel" })).toBeVisible();
});

test("/c/<canvas> with no session shows the sign-in page, not the canvas", async () => {
  const server = await boot();
  await tab(server, "/c/shop", phone);

  await expect.element(page.getByRole("heading", { name: "Sign in to easel" })).toBeVisible();
  expect(page.getByRole("navigation", { name: "Canvas" }).elements()).toHaveLength(0);
});

test("/open posts the link of its # to /auth/open, and a page with no good link says that the link does not work", async () => {
  const server = await boot();
  const good = await tab(server, `/open#${link}`, phone);
  await expect.element(page.getByText("Signing in.")).toBeVisible();
  expect(good.posted).toEqual([["/auth/open", { link }]]);
  document.body.replaceChildren();

  const bad = await tab(server, "/open#nope", phone);
  await expect
    .element(page.getByRole("heading", { name: "This sign-in link does not work" }))
    .toBeVisible();
  expect(bad.posted).toEqual([]);
});
