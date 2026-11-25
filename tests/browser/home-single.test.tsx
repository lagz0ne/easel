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
import { home } from "@/home";
import { homeRows, waitingCodes } from "@/home/contract";
import { postForm, readSite } from "@/home/signin";
import type { Site } from "@/home/signin";
import { routeTree } from "@/routes";

const now = Date.parse("2026-11-24T10:00:00Z");

const request = "c".repeat(32);

type Wait = { kind: "approved" } | { kind: "denied" } | { kind: "expired" };

const world = {
  signedIn: false,
  starts: [] as Array<{ name?: string }>,
  approvals: [] as Array<{ code: string; owner?: boolean }>,
  answer: Promise.withResolvers<Wait>(),
};

const sessionGate = operation({
  label: "test.singleSessionGate",
  input: transport.hook.start,
  run: (_, { input }) => (world.signedIn ? undefined : input.refuse({ signIn: true })),
});

const me = operation({
  label: "test.singleMe",
  input: userApi["users.me"].input,
  run: () => ({ kind: "me" as const, name: "lagz0ne", owner: true }),
});

const loginEnd = operation({
  label: "test.singleLoginEnd",
  input: userApi["login.end"].input,
  run: () => ({ kind: "ended" as const }),
});

const start = operation({
  label: "test.singleStart",
  input: browserApi["browser.start"].input,
  run: (_, { input }) => {
    world.starts.push(input);
    return { kind: "pending" as const, code: "DFGH-JKLM", request, expiresAt: now + 600_000 };
  },
});

const wait = operation({
  label: "test.singleWait",
  input: browserApi["browser.wait"].input,
  run: () => world.answer.promise,
});

const peek = operation({
  label: "test.singlePeek",
  input: browserApi["browser.peek"].input,
  run: () => ({ kind: "gone" as const }),
});

const approve = operation({
  label: "test.singleApprove",
  input: ownerApi["users.approve"].input,
  run: (_, { input }) => {
    world.approvals.push(input);
    if (input.code !== "PQRS-TVWX") return { kind: "gone" as const };
    return {
      kind: "approved" as const,
      user: { name: "lagz0ne", role: "owner" as const, since: now },
    };
  },
});

const ownerFakes = {
  "users.approve": approve,
  "users.deny": operation({
    label: "test.singleDeny",
    input: ownerApi["users.deny"].input,
    run: () => ({ kind: "denied" as const }),
  }),
  "users.add": operation({
    label: "test.singleAdd",
    input: ownerApi["users.add"].input,
    run: () => ({ kind: "single" as const }),
  }),
  "users.list": operation({
    label: "test.singleList",
    input: ownerApi["users.list"].input,
    run: () => ({ users: [], requests: [], sessions: [] }),
  }),
  "users.revoke": operation({
    label: "test.singleRevoke",
    input: ownerApi["users.revoke"].input,
    run: () => ({ kind: "last" as const }),
  }),
  "users.end": operation({
    label: "test.singleEnd",
    input: ownerApi["users.end"].input,
    run: () => ({ kind: "gone" as const }),
  }),
};

const putRow = operation({
  label: "test.singlePutRow",
  input: z.object({ canvas: z.string(), name: z.string(), inbox: z.number() }),
  depends: { rows: homeRows.atScope.controller },
  run: ({ rows }, { input }) => rows.set({ ...input, frames: 2, pages: 1, changed: now }),
});

const putCode = operation({
  label: "test.singlePutCode",
  depends: { codes: waitingCodes.atScope.controller },
  run: ({ codes }) =>
    codes.set({
      code: "PQRS-TVWX",
      name: "",
      since: now,
      expiresAt: now + 600_000,
      browser: true,
      user: false,
    }),
});

async function boot() {
  world.signedIn = false;
  world.starts = [];
  world.approvals = [];
  world.answer = Promise.withResolvers<Wait>();
  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      access.user({
        implement: { "users.me": me, "login.end": loginEnd },
        onStart: [sessionGate],
      }),
      access.browser({
        implement: { "browser.start": start, "browser.wait": wait, "browser.peek": peek },
      }),
      access.owner({ implement: ownerFakes, onStart: [sessionGate] }),
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

const single: Site = { mode: "single", project: "easel" };

async function tab(server: Scope.Handle, site: Site) {
  await page.viewport(390, 844);
  const posted: Array<[string, Readonly<Record<string, string>>]> = [];
  const scope = await createScope({
    tags: [postForm((action, fields) => posted.push([action, fields])), readSite(() => site)],
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
  const history = createMemoryHistory({ initialEntries: ["/"] });
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

  return { posted };
}

test("criterion 1, single: / with no session shows a code at once, with no name field; the approve posts the request to /auth/code", async () => {
  const server = await boot();
  const shown = await tab(server, single);

  await expect.element(page.getByText("DFGH-JKLM", { exact: true })).toBeVisible();
  expect(page.getByLabelText("Your name").elements()).toHaveLength(0);
  expect(world.starts).toEqual([{}]);
  await expect.element(page.getByText("easel users approve DFGH-JKLM")).toBeVisible();
  await expect
    .element(
      page.getByText(
        "Type it on the home page of a browser where you are signed in, or approve it with this command.",
      ),
    )
    .toBeVisible();

  world.answer.resolve({ kind: "approved" });
  await expect.element(page.getByText("Approved. Signing in.")).toBeVisible();
  expect(shown.posted).toEqual([["/auth/code", { request }]]);
});

test("single: a code that ran out gets a new code with no name on one click", async () => {
  const server = await boot();
  await tab(server, single);
  await expect.element(page.getByText("DFGH-JKLM", { exact: true })).toBeVisible();

  world.answer.resolve({ kind: "expired" });
  await expect.element(page.getByText("The code ran out.")).toBeVisible();
  world.answer = Promise.withResolvers<Wait>();
  await page.getByRole("button", { name: "Get a new code" }).click();

  await expect.element(page.getByText("DFGH-JKLM", { exact: true })).toBeVisible();
  expect(world.starts).toEqual([{}, {}]);
  expect(page.getByLabelText("Your name").elements()).toHaveLength(0);
  world.answer.resolve({ kind: "denied" });
  await expect.element(page.getByText("An owner denied the code.")).toBeVisible();
});

test("criterion 2, single: the title of / is the project name, and the page lists its canvases with their inbox", async () => {
  const server = await boot();
  world.signedIn = true;
  server.run(putRow, { input: { canvas: "design-system", name: "design-system", inbox: 2 } });
  server.run(putRow, { input: { canvas: "product", name: "product", inbox: 0 } });
  await tab(server, single);

  await expect.element(page.getByRole("heading", { level: 1, name: "easel" })).toBeVisible();
  const list = page.getByRole("list", { name: "Canvases" });
  await expect.poll(() => list.getByRole("link").elements().length).toBe(2);
  await expect.element(list.getByText("2 wait for you")).toBeVisible();
});

test("single: the person sees a code with no name one time, as a browser, with Deny and no Approve button of its own", async () => {
  const server = await boot();
  world.signedIn = true;
  server.run(putCode);
  await tab(server, single);

  const codes = page.getByRole("list", { name: "Codes that wait for you" });
  await expect
    .element(codes.getByRole("button", { name: "Deny PQRS-TVWX of a browser" }))
    .toBeVisible();
  expect(codes.getByRole("button", { name: /^Approve/ }).elements()).toHaveLength(0);
  const row = codes.getByRole("listitem").element().textContent ?? "";
  expect(row.match(/PQRS-TVWX/g)).toHaveLength(1);
  expect(row.match(/a browser/g)).toHaveLength(1);
});

test("single: the person types the code that its own device shows, and Approve approves that code", async () => {
  const server = await boot();
  world.signedIn = true;
  server.run(putCode);
  await tab(server, single);

  await page.getByRole("textbox", { name: "Code on your device" }).fill("pqrs tvwx");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(() => world.approvals).toEqual([{ code: "PQRS-TVWX", owner: false }]);
});

test("single: a typed code that does not wait gets an answer that says so", async () => {
  const server = await boot();
  world.signedIn = true;
  server.run(putCode);
  await tab(server, single);

  await page.getByRole("textbox", { name: "Code on your device" }).fill("BCDF-GHJK");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("No code like this waits. Read the code on your device again.");
});

test("approve: with no project, the title stays Canvases", async () => {
  const server = await boot();
  world.signedIn = true;
  await tab(server, { mode: "approve", project: null });

  await expect.element(page.getByRole("heading", { level: 1, name: "Canvases" })).toBeVisible();
});
