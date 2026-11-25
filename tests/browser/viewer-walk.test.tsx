import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { exits } from "@tinkered/cli/test";
import { capsule, createScope, operation, rpc, transport } from "@tinkered/core";
import { makeTestClock, memory, preset } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";
import { z } from "zod";

import { frames } from "@/frames";
import { docs, frames as frameCells, pages } from "@/frames/contract";
import { passApi, passMeta, shareApi } from "@/frames/share";
import type { MapJson } from "@/map/text";
import type { WalkData } from "@/map/walk";
import { queue } from "@/queue";
import { serverClock } from "@/queue/cells";
import { addInput } from "@/queue/contract";
import { routeTree } from "@/routes";
import { requestMode } from "@/viewer/draft";
import { nameKey, tabMeta } from "@/viewer/gate";
import { viewerDefaults } from "@/viewer/settings";
import { pickBackend } from "@/viewer/walk-backend";
import { walking } from "@/viewer/walking";

import { frameOnPage } from "./frame-page";

const live = "e".repeat(32);
const pass = "5".repeat(32);
const canvas = "home";
const serverNow = 1_800_000_000_000;
const startUrl = location.href;

const map: MapJson = {
  cell: "fixture.walkStep",
  start: "idle",
  view: "src/fixture.tsx",
  calls: [{ call: "fixture.go", answers: ["done", "refused", "link"] }],
  states: ["idle", "done", "refused"].map((state, at) => ({
    state,
    column: at === 0 ? 0 : 1,
    row: at === 0 ? 0 : at - 1,
    sample: { kind: state },
    actions: [],
    run: null,
  })),
  moves: [
    {
      from: "idle",
      to: "done",
      action: "fixture.press",
      answer: { call: "fixture.go", kind: "done", fault: false },
      effects: [],
    },
    {
      from: "idle",
      to: "refused",
      action: "fixture.press",
      answer: { call: "fixture.go", kind: "refused", fault: false },
      effects: [],
    },
  ],
  stays: [],
};

const walk: WalkData = { name: "fixture", map, replies: {} };

const walkDoc = `<!doctype html><html><head><script type="application/json" id="easel-walk">${JSON.stringify(walk)}</script></head><body style="margin:0"><p id="s"></p><script>
const to = parent;
let n = 0;
const show = (v) => {
  document.getElementById("s").textContent = v.kind;
  to.postMessage({ easel: "walk", kind: "state", state: v.kind, value: v }, "*");
  if (v.kind !== "idle") return;
  n += 1;
  to.postMessage({ easel: "walk", kind: "waits", calls: [{ id: n, call: "fixture.go" }] }, "*");
};
addEventListener("message", (e) => {
  const d = e.data;
  if (e.source !== to || !d || d.easel !== "walk") return;
  if (d.kind === "go") show(d.value);
  if (d.kind === "answer") {
    to.postMessage({ easel: "walk", kind: "waits", calls: [] }, "*");
    show({ kind: d.answer });
  }
});
show({ kind: "idle" });
</script></body></html>`;

const listDoc = `<main style="margin:0"><button type="button" data-easel-walk="fixture" style="position:absolute;left:0;top:0;width:600px;height:300px">Walk fixture</button></main>`;

const box = { version: 1, status: "exploring" as const };

const seeded = [
  { id: "a00000000001", name: "Maps", page: "live", x: 0, y: 0, w: 600, h: 300 },
  { id: "a00000000002", name: "fixture · walk", page: "map", x: 0, y: 0, w: 1024, h: 768 },
  { id: "a00000000003", name: "fixture · idle", page: "map", x: 1200, y: 0, w: 1024, h: 840 },
  { id: "a00000000004", name: "fixture · done", page: "map", x: 2400, y: 0, w: 1024, h: 840 },
];

const store = { adds: [] as Array<z.infer<typeof addInput>> };

const open = operation({
  label: "test.walkOpen",
  input: shareApi["share.open"].input,
  run: () => ({ kind: "open" as const, canvas, pass }),
});

const nameIt = operation({
  label: "test.walkName",
  input: passApi["share.name"].input,
  run: (_, { input }) => ({ kind: "named" as const, name: input.name }),
});

const passOnly = operation({
  label: "test.walkPass",
  input: transport.hook.start,
  run: (_, { input }) =>
    passMeta.safeParse(input.meta).data?.pass === pass ? undefined : input.refuse({ ended: true }),
});

const add = operation({
  label: "test.walkAdd",
  input: addInput,
  run: (_, { input }) => {
    store.adds.push(input);
    return { kind: "added" as const, n: store.adds.length };
  },
});

const addOnly = capsule({
  label: "test.walkQueue",
  exports: {
    viewer: rpc({
      "request.add": {
        input: addInput,
        output: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("added"), n: z.number() }),
          z.object({ kind: z.literal("gone") }),
        ]),
      },
    }),
  },
});

const seed = operation({
  label: "test.walkSeed",
  depends: {
    cells: frameCells.controller,
    list: pages.controller,
    docCells: docs.controller,
    clocks: serverClock.controller,
  },
  run: ({ cells, list, docCells, clocks }) => {
    for (const f of seeded) cells.set({ canvas, ...f, ...box });

    list.set({ canvas, key: "live", name: "Live", order: 0, frames: 1 });
    list.set({ canvas, key: "map", name: "Map · fixture", order: 1, frames: 3 });

    docCells.set({ canvas, id: "a00000000001", version: 1, html: listDoc, css: null });
    docCells.set({ canvas, id: "a00000000002", version: 1, html: walkDoc, css: null });
    clocks.set({ canvas, now: serverNow });
  },
});

async function serve() {
  store.adds.length = 0;
  localStorage.setItem(nameKey, "Mai");

  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      frames.board({ serve: true, onStart: [passOnly] }),
      frames.viewer({ implement: { "share.open": open } }),
      frames.pass({
        implement: { "share.name": nameIt, "share.frame": frameOnPage },
        onStart: [passOnly],
      }),
      addOnly.viewer({ implement: { "request.add": add }, onStart: [passOnly] }),
      memory.server({ services: [frames.board, frames.viewer, frames.pass, addOnly.viewer] }),
    ],
  }).ready;

  server.run(seed);
  onTestFinished(async () => {
    history.replaceState(history.state, "", startUrl);
    localStorage.removeItem(nameKey);
    await server.close();
  });
  return server;
}

async function tab(search = "", first = "Maps") {
  const server = await serve();
  const url = new URL(startUrl);
  url.search = search;
  history.replaceState(history.state, "", url);
  await page.viewport(1200, 800);

  const clock = makeTestClock();
  const scope = await createScope({
    clock,
    capsules: [
      exits({ store: localStorage }),
      memory.client({ peer: server, meta: tabMeta }),
      frames.board({ read: memory.client }),
      frames.viewer({ remote: memory.client }),
      frames.pass({ remote: memory.client }),
      queue.viewer({ remote: memory.client }),
    ],
  }).ready;

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/s/${live}`] }),
    context: { scope },
  });

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

  await expect.element(frameOf(first)).toBeVisible();
  return clock;
}

const frameOf = (name: string) =>
  page.getByRole("region", { name: "Frames" }).getByRole("group", { name });

const layer = () => page.getByRole("region", { name: "Walk fixture" });
const bar = () => layer().getByRole("toolbar", { name: "Walk" });
const shownState = () => bar().getByLabelText("State");
const steps = () => bar().getByLabelText("Steps");
const button = (name: string) => bar().getByRole("button", { name, exact: true });
const screen = () => layer().getByTitle(/^fixture · /);

test("one press on Walk in the list Maps starts the walk of that map at its first state", async () => {
  const clock = await tab();
  clock.advance(viewerDefaults.restMs);
  const card = () => frameOf("Maps").element().querySelector<HTMLElement>(".e-card");
  await expect.poll(() => card()?.hidden, { timeout: 5_000 }).toBe(true);

  await userEvent.click(frameOf("Maps"), { position: { x: 20, y: 40 } });

  await expect.element(bar().getByText("Walk fixture")).toBeVisible();
  await expect.element(shownState()).toHaveTextContent("idle");
  await expect.element(screen()).toHaveAttribute("title", "fixture · idle");
  await expect.element(button("Back")).toBeDisabled();
});

test("a pick of an answer shows its state; Back, Restart and Leave", async () => {
  await tab("?page=map", "fixture · walk");
  await page.getByRole("button", { name: "Walk fixture" }).click();
  const waits = bar().getByRole("group", { name: "fixture.go waits for its answer" });
  await expect.element(waits.getByRole("button", { name: "done → done" })).toBeVisible();

  await waits.getByRole("button", { name: "refused → refused" }).click();
  await expect.element(shownState()).toHaveTextContent("refused");
  await expect.element(steps()).toHaveTextContent("idle → refused");

  await button("Back").click();
  await expect.element(shownState()).toHaveTextContent("idle");
  await expect.poll(() => steps().element().textContent).toBe("idle");

  await bar().getByRole("button", { name: "done → done" }).click();
  await expect.element(steps()).toHaveTextContent("idle → done");
  await button("Restart").click();
  await expect.poll(() => steps().element().textContent).toBe("idle");

  await button("Leave").click();
  await expect.element(layer()).not.toBeInTheDocument();
  await expect.element(frameOf("fixture · walk")).toBeVisible();
});

test("a state that no move of the map reaches keeps the shown state, and Ask for it opens a request", async () => {
  await tab("?page=map", "fixture · walk");
  await page.getByRole("button", { name: "Walk fixture" }).click();

  await bar().getByRole("button", { name: "link", exact: true }).click();
  await expect
    .poll(() => bar().getByRole("status").element().textContent)
    .toContain("The map has no move from idle to link.");
  await expect.element(shownState()).toHaveTextContent("idle");
  await expect.poll(() => steps().element().textContent).toBe("idle");

  await button("Ask for it").click();
  await expect
    .element(layer().getByRole("textbox", { name: "Request" }))
    .toHaveValue(
      "The code goes from idle to link, and the map has no such move. Add the state link to the map, with its screen.",
    );
  await expect.element(button("Leave")).toBeDisabled();

  await userEvent.keyboard("{Escape}");
  await expect.element(layer().getByRole("textbox", { name: "Request" })).not.toBeInTheDocument();
  await expect.element(layer()).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(layer()).not.toBeInTheDocument();
});

test("a request made in the walk is on the frame of the shown state, at the place of the press", async () => {
  await tab("?page=map", "fixture · walk");
  await page.getByRole("button", { name: "Walk fixture" }).click();
  await bar().getByRole("button", { name: "done → done" }).click();
  await expect.element(shownState()).toHaveTextContent("done");

  await button("Comment").click();
  await expect.element(button("Back")).toBeDisabled();
  const ask = layer().getByLabelText("Press the screen to ask for a change here");
  await userEvent.click(ask, { position: { x: 100, y: 50 } });
  await userEvent.fill(layer().getByRole("textbox", { name: "Request" }), "Make the title larger.");
  await userEvent.keyboard("{Enter}");

  await expect.poll(() => store.adds.length).toBe(1);
  const [sent] = store.adds;
  expect(sent).toMatchObject({
    canvas,
    frameId: "a00000000004",
    version: 1,
    text: "Make the title larger.",
  });
  expect(sent?.x).toBeGreaterThanOrEqual(100);
  expect(sent?.x).toBeLessThan(115);
  expect(sent?.y).toBeGreaterThanOrEqual(50);
  expect(sent?.y).toBeLessThan(60);
  await expect.element(layer()).toBeVisible();
  await expect.element(shownState()).toHaveTextContent("done");
});

test("the walk draws its screen with the theme of the board", async () => {
  await tab("?page=map&theme=dark", "fixture · walk");
  await page.getByRole("button", { name: "Walk fixture" }).click();

  await expect.element(screen()).toHaveStyle({ colorScheme: "dark" });
});

const answers = () => bar().getByRole("group", { name: "Answers" });
const answer = (name: string) => answers().getByRole("button", { name, exact: true });

test("a pick of the live server starts the walk again; with no live server set up, the walk is held, and Use example answers starts it again", async () => {
  await tab("?page=map", "fixture · walk");
  await page.getByRole("button", { name: "Walk fixture" }).click();
  await expect.element(answer("examples")).toHaveAttribute("aria-pressed", "true");
  await bar().getByRole("button", { name: "done → done" }).click();
  await expect.element(steps()).toHaveTextContent("idle → done");

  await answer("examples").click();
  await expect.element(steps()).toHaveTextContent("idle → done");

  await answer("live server").click();
  await expect.element(answer("live server")).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => bar().getByRole("status").element().textContent)
    .toContain("No live server is set up for this easel.");
  await expect.element(screen()).not.toBeInTheDocument();
  await expect.element(shownState()).toHaveTextContent("held");
  await expect.poll(() => steps().element().textContent).toBe("");
  await expect.element(button("Back")).toBeDisabled();
  expect(new URLSearchParams(location.search).get("backend")).toBe("live");

  await button("Use example answers").click();
  await expect.element(answer("examples")).toHaveAttribute("aria-pressed", "true");
  await expect.element(screen()).toHaveAttribute("title", "fixture · idle");
  await expect.poll(() => steps().element().textContent).toBe("idle");
  await expect.element(bar().getByRole("button", { name: "done → done" })).toBeVisible();
});

test("a walk with the board value live and no live server starts held, and says why", async () => {
  await tab("?page=map&backend=live", "fixture · walk");
  await page.getByRole("button", { name: "Walk fixture" }).click();

  await expect
    .poll(() => bar().getByRole("status").element().textContent)
    .toContain("No live server is set up for this easel.");
  await expect.element(screen()).not.toBeInTheDocument();
  await expect.element(answer("live server")).toHaveAttribute("aria-pressed", "true");
});

test("the switch of the backend takes no pick while a request is in work, or with no walk", async () => {
  await tab("?page=map", "fixture · walk");
  await page.getByRole("button", { name: "Walk fixture" }).click();
  await button("Comment").click();
  await expect.element(answer("live server")).toBeDisabled();

  const shown = { kind: "none" } as const;
  const walk = { map: "fixture", path: [], told: shown, waits: [] };
  for (const presets of [[], [preset(walking, walk), preset(requestMode, true)]]) {
    const scope = await createScope({ capsules: [exits({ store: localStorage })], presets }).ready;
    expect(scope.run(pickBackend, { input: "live" })).toEqual({ kind: "stays" });
    await scope.close();
  }
});
