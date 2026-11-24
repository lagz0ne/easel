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
import { userApi } from "@/access/contract";
import { frames } from "@/frames";
import { framesApi, frames as frameCells, type PutInput } from "@/frames/contract";
import { routeTree } from "@/routes";
import { Canvas } from "@/viewer/canvas";
import { notAnImage } from "@/viewer/drop";

type Plan = "created" | "badImage" | "tooBig" | "gone" | "changed" | "fail" | "hold";

const world = {
  puts: [] as PutInput[],
  plan: [] as Plan[],
  held: Promise.withResolvers<void>(),
};

const sessionGate = operation({
  label: "test.dropSessionGate",
  input: transport.hook.start,
  run: () => undefined,
});

const me = operation({
  label: "test.dropMe",
  input: userApi["users.me"].input,
  run: () => ({ kind: "me" as const, name: "ann", owner: true }),
});

const loginEnd = operation({
  label: "test.dropLoginEnd",
  input: userApi["login.end"].input,
  run: () => ({ kind: "ended" as const }),
});

const refusals = {
  badImage: { kind: "badImage", reason: "unreadable", maxSide: 16_000, maxPixels: 25_000_000 },
  tooBig: { kind: "tooBig", maxBytes: 10 * 1024 * 1024 },
  gone: { kind: "gone" },
  changed: { kind: "changed", rev: 2 },
} as const;

const askedFrame = z.object({
  canvas: z.string(),
  name: z.string().default("untitled"),
  page: z.string().default("page-1"),
  x: z.number().default(0),
  y: z.number().default(0),
});

const madeStub = operation({
  label: "test.dropMade",
  input: askedFrame,
  depends: { cells: frameCells.atScope.controller },
  run: ({ cells }, { input }) => {
    const id = `f${world.puts.length}`.padEnd(12, "0");
    cells.set({ ...input, id, w: 40, h: 30, version: 1, status: "exploring" });

    const layout = { page: input.page, rev: 1, findings: [], more: 0 };
    return { kind: "created" as const, id, version: 1, findings: [], more: 0, layout };
  },
});

const putStub = operation({
  label: "test.dropPut",
  input: framesApi["frame.put"].input,
  depends: { madeStub },
  run: async ({ madeStub }, { input }) => {
    world.puts.push(input);
    const plan = world.plan.shift() ?? "created";
    if (plan === "fail") throw new Error("the socket closed");
    if (plan === "hold") await world.held.promise;
    if (plan !== "created" && plan !== "hold") return refusals[plan];

    return madeStub.run({ input: askedFrame.parse(input) });
  },
});

const seedFrame = operation({
  label: "test.dropSeed",
  depends: { cells: frameCells.atScope.controller },
  run: ({ cells }) =>
    cells.set({
      canvas: "shop",
      id: "0123456789ab",
      name: "Checkout",
      page: "page-1",
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      version: 1,
      status: "exploring",
    }),
});

const notHere = (): never => {
  throw new Error("this call is not in the test");
};

const framesStub = {
  "canvas.create": operation({
    label: "test.no canvas.create",
    input: framesApi["canvas.create"].input,
    run: notHere,
  }),
  "canvas.list": operation({
    label: "test.no canvas.list",
    input: framesApi["canvas.list"].input,
    run: notHere,
  }),
  "canvas.delete": operation({
    label: "test.no canvas.delete",
    input: framesApi["canvas.delete"].input,
    run: notHere,
  }),
  "canvas.share": operation({
    label: "test.no canvas.share",
    input: framesApi["canvas.share"].input,
    run: notHere,
  }),
  "canvas.unshare": operation({
    label: "test.no canvas.unshare",
    input: framesApi["canvas.unshare"].input,
    run: notHere,
  }),
  "frame.put": putStub,
  "frame.list": operation({
    label: "test.no frame.list",
    input: framesApi["frame.list"].input,
    run: notHere,
  }),
  "frame.get": operation({
    label: "test.no frame.get",
    input: framesApi["frame.get"].input,
    run: notHere,
  }),
  "frame.delete": operation({
    label: "test.no frame.delete",
    input: framesApi["frame.delete"].input,
    run: notHere,
  }),
  "frame.ready": operation({
    label: "test.no frame.ready",
    input: framesApi["frame.ready"].input,
    run: notHere,
  }),
  "frame.explore": operation({
    label: "test.no frame.explore",
    input: framesApi["frame.explore"].input,
    run: notHere,
  }),
  "frame.shot": operation({
    label: "test.no frame.shot",
    input: framesApi["frame.shot"].input,
    run: notHere,
  }),
  "frame.move": operation({
    label: "test.no frame.move",
    input: framesApi["frame.move"].input,
    run: notHere,
  }),
  "section.set": operation({
    label: "test.no section.set",
    input: framesApi["section.set"].input,
    run: notHere,
  }),
  "page.layout": operation({
    label: "test.no page.layout",
    input: framesApi["page.layout"].input,
    run: notHere,
  }),
  "page.list": operation({
    label: "test.no page.list",
    input: framesApi["page.list"].input,
    run: notHere,
  }),
  "page.create": operation({
    label: "test.no page.create",
    input: framesApi["page.create"].input,
    run: notHere,
  }),
  "page.rename": operation({
    label: "test.no page.rename",
    input: framesApi["page.rename"].input,
    run: notHere,
  }),
  "page.order": operation({
    label: "test.no page.order",
    input: framesApi["page.order"].input,
    run: notHere,
  }),
  "page.delete": operation({
    label: "test.no page.delete",
    input: framesApi["page.delete"].input,
    run: notHere,
  }),
};

async function boot() {
  world.puts = [];
  world.plan = [];
  world.held = Promise.withResolvers<void>();

  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      access.user({ implement: { "users.me": me, "login.end": loginEnd }, onStart: [sessionGate] }),
      frames.board({ serve: true, onStart: [sessionGate] }),
      frames.api({ implement: framesStub, onStart: [sessionGate] }),
      memory.server({ services: [access.user, frames.board, frames.api] }),
    ],
  }).ready;
  onTestFinished(async () => {
    await server.close();
  });
  server.run(seedFrame);
  return server;
}

async function client(server: Scope.Handle) {
  const scope = await createScope({
    capsules: [
      exits({ store: localStorage }),
      memory.client({ peer: server }),
      access.user({ remote: memory.client }),
      frames.board({ read: memory.client }),
      frames.api({ remote: memory.client }),
    ],
  }).ready;
  onTestFinished(async () => {
    await scope.close();
  });
  return scope;
}

async function signedInTab(server: Scope.Handle) {
  await page.viewport(1440, 900);
  const scope = await client(server);
  const history = createMemoryHistory({ initialEntries: ["/c/shop"] });
  const router = createRouter({ routeTree, history, context: { scope } });

  const root = createRoot(document.body.appendChild(document.createElement("div")));
  onTestFinished(() => root.unmount());
  root.render(
    <ScopeProvider scope={scope}>
      <RouterProvider router={router} />
    </ScopeProvider>,
  );
  await expect.element(page.getByRole("group", { name: "Checkout" })).toBeVisible();
}

async function viewerTab(server: Scope.Handle) {
  await page.viewport(1440, 900);
  const scope = await client(server);

  const root = createRoot(document.body.appendChild(document.createElement("div")));
  onTestFinished(() => root.unmount());
  root.render(
    <ScopeProvider scope={scope}>
      <Canvas canvas="shop" opening={null} />
    </ScopeProvider>,
  );
  await expect.element(page.getByRole("group", { name: "Checkout" })).toBeVisible();
}

const png = (name = "screen shot.png") =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: "image/png" });

function viewport() {
  const element = document.querySelector(".e-viewport");
  if (!(element instanceof HTMLElement)) throw new Error("no viewport");
  return element;
}

function drag(kind: "dragover" | "dragleave" | "drop", file: File, at = { x: 900, y: 600 }) {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  const init = { dataTransfer, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true };
  viewport().dispatchEvent(new DragEvent(kind, init));
}

function paste(target: EventTarget, file: File) {
  const clipboardData = new DataTransfer();
  clipboardData.items.add(file);
  target.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
  );
}

function shellOf(name: string) {
  const shell = document.querySelector(`.e-shell[aria-label="${name}"]`);
  if (!(shell instanceof HTMLElement)) throw new Error(`no frame ${name}`);
  return shell.getBoundingClientRect();
}

test("a dropped PNG becomes an image frame on the page of the tab, with its top left corner where it was dropped, within 5 s (I3; TheFrameIsWhereItWent)", async () => {
  const server = await boot();
  await signedInTab(server);

  const dropped = Date.now();
  drag("dragover", png());
  drag("drop", png(), { x: 900, y: 600 });

  await expect.element(page.getByRole("group", { name: "screen shot" })).toBeVisible();
  expect(Date.now() - dropped).toBeLessThan(5_000);
  expect(world.puts).toHaveLength(1);
  expect(world.puts[0]).toMatchObject({ canvas: "shop", page: "page-1", name: "screen shot" });
  const box = shellOf("screen shot");
  expect(Math.abs(box.left - 900)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.top - 600)).toBeLessThanOrEqual(2);
});

test("a file over the canvas shows the hint, and the hint goes when the file goes off the canvas", async () => {
  const server = await boot();
  await signedInTab(server);

  drag("dragover", png());
  await expect.element(page.getByText("Drop the image to put it on this page")).toBeVisible();
  expect(getComputedStyle(viewport()).outlineStyle).toBe("dashed");

  drag("dragleave", png());
  await expect
    .element(page.getByText("Drop the image to put it on this page"))
    .not.toBeInTheDocument();
  expect(getComputedStyle(viewport()).outlineStyle).not.toBe("dashed");
  expect(world.puts).toHaveLength(0);
});

test("a dropped file that is not a PNG, JPEG or WebP, or that is over 10 MB, makes no frame, and the page says why (ARefusalMakesNoFrame)", async () => {
  const server = await boot();
  await signedInTab(server);

  drag("drop", new File(["<svg></svg>"], "a.svg", { type: "image/svg+xml" }));
  await expect.element(page.getByRole("alert")).toHaveTextContent(notAnImage);
  drag("drop", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }));
  await expect.element(page.getByRole("alert")).toHaveTextContent(notAnImage);
  expect(world.puts).toHaveLength(0);
});

test("a refusal of the server and a lost socket make no frame, and the page says why", async () => {
  const server = await boot();
  await signedInTab(server);

  world.plan = ["badImage", "tooBig", "gone", "changed", "fail"];
  drag("drop", png());
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("The image does not open. Save it again as a PNG, JPEG or WebP image.");
  drag("drop", png());
  await expect.element(page.getByRole("alert")).toHaveTextContent(notAnImage);
  drag("drop", png());
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("This page is gone. Open another page, and drop it again.");
  for (const sent of [4, 5]) {
    drag("drop", png());
    await expect.poll(() => world.puts.length).toBe(sent);
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("The image did not go. Drop it again.");
  }
  expect(document.querySelectorAll(".e-shell")).toHaveLength(1);
});

test("one image goes at a time: a drop while one goes says to wait, and does not replace it (OneAtATime)", async () => {
  const server = await boot();
  await signedInTab(server);

  world.plan = ["hold"];
  drag("drop", png("first.png"));
  await expect.element(page.getByText("The image goes on this page")).toBeVisible();
  drag("drop", png("second.png"));
  await expect.element(page.getByText("Wait for the image that goes now.")).toBeVisible();

  world.held.resolve();
  await expect.element(page.getByRole("group", { name: "first" })).toBeVisible();
  expect(world.puts.map((one) => ("name" in one ? one.name : null))).toEqual(["first"]);
});

test("a paste of an image on the canvas goes at the pointer; a paste into a text field makes no frame (ATextPasteMakesNoFrame)", async () => {
  const server = await boot();
  await signedInTab(server);

  const field = document.body.appendChild(document.createElement("textarea"));
  onTestFinished(() => field.remove());
  paste(field, png("in text.png"));
  await new Promise((done) => setTimeout(done, 100));
  expect(world.puts).toHaveLength(0);

  viewport().dispatchEvent(
    new PointerEvent("pointermove", { clientX: 700, clientY: 500, bubbles: true }),
  );
  paste(document.body, png("pasted.png"));
  await expect.element(page.getByRole("group", { name: "pasted" })).toBeVisible();
  const box = shellOf("pasted");
  expect(Math.abs(box.left - 700)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.top - 500)).toBeLessThanOrEqual(2);
});

test("a share link takes no drop: no hint, no frame (AViewerNeverWrites)", async () => {
  const server = await boot();
  await viewerTab(server);

  drag("dragover", png());
  drag("drop", png());
  await new Promise((done) => setTimeout(done, 100));
  expect(document.querySelector(".e-canvas[data-drop]")).toBeNull();
  expect(world.puts).toHaveLength(0);
});
