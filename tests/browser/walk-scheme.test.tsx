import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { exits } from "@tinkered/cli/test";
import { capsule, createScope, operation, rpc, transport } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { cdp, page } from "vite-plus/test/browser/context";
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
import { nameKey, tabMeta } from "@/viewer/gate";

import { frameOnPage } from "./frame-page";

const live = "e".repeat(32);
const pass = "5".repeat(32);
const canvas = "home";
const startUrl = location.href;

const light = "rgb(250, 250, 250)";
const dark = "rgb(18, 18, 18)";

const map: MapJson = {
  cell: "fixture.walkStep",
  start: "idle",
  view: "src/fixture.tsx",
  calls: [],
  states: [{ state: "idle", column: 0, row: 0, sample: { kind: "idle" }, actions: [], run: null }],
  moves: [],
  stays: [],
};

const walk: WalkData = { name: "fixture", map, replies: {} };

const look = ":root { color-scheme: light dark; --background: light-dark(#fafafa, #121212); }";

const walkDoc = `<!doctype html><html><head><style id="easel-look">${look}</style><style>body { margin: 0; background: var(--background); }</style><script type="application/json" id="easel-walk">${JSON.stringify(walk)}</script></head><body><p id="s">idle</p><script>
const to = parent;
to.postMessage({ easel: "walk", kind: "state", state: "idle", value: { kind: "idle" } }, "*");
addEventListener("message", (e) => {
  const d = e.data;
  if (e.source !== to || !d || typeof d.probe !== "number") return;
  to.postMessage({ probe: d.probe, color: getComputedStyle(document.body).backgroundColor }, "*");
});
</script></body></html>`;

const box = { version: 1, status: "exploring" as const };

const seeded = [
  { id: "a00000000002", name: "fixture · walk", page: "map", x: 0, y: 0, w: 1024, h: 768 },
  { id: "a00000000003", name: "fixture · idle", page: "map", x: 1200, y: 0, w: 1024, h: 840 },
];

const open = operation({
  label: "test.schemeOpen",
  input: shareApi["share.open"].input,
  run: () => ({ kind: "open" as const, canvas, pass }),
});

const nameIt = operation({
  label: "test.schemeName",
  input: passApi["share.name"].input,
  run: (_, { input }) => ({ kind: "named" as const, name: input.name }),
});

const passOnly = operation({
  label: "test.schemePass",
  input: transport.hook.start,
  run: (_, { input }) =>
    passMeta.safeParse(input.meta).data?.pass === pass ? undefined : input.refuse({ ended: true }),
});

const add = operation({
  label: "test.schemeAdd",
  input: addInput,
  run: () => ({ kind: "added" as const, n: 1 }),
});

const addOnly = capsule({
  label: "test.schemeQueue",
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
  label: "test.schemeSeed",
  depends: {
    cells: frameCells.controller,
    list: pages.controller,
    docCells: docs.controller,
    clocks: serverClock.controller,
  },
  run: ({ cells, list, docCells, clocks }) => {
    for (const f of seeded) cells.set({ canvas, ...f, ...box });

    list.set({ canvas, key: "map", name: "Map · fixture", order: 0, frames: 2 });
    docCells.set({ canvas, id: "a00000000002", version: 1, html: walkDoc, css: null });
    clocks.set({ canvas, now: 1_800_000_000_000 });
  },
});

async function serve() {
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

async function darkPage() {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "" }],
  });
  document.documentElement.style.colorScheme = "dark";
  onTestFinished(() => {
    document.documentElement.style.removeProperty("color-scheme");
  });
}

async function walkTab(search: string) {
  const server = await serve();
  const url = new URL(startUrl);
  url.search = search;
  history.replaceState(history.state, "", url);
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

  await page.getByRole("button", { name: "Walk fixture" }).click();
  await expect.element(page.getByRole("region", { name: "Walk fixture" })).toBeVisible();
}

const walkScreen = () => document.querySelector<HTMLIFrameElement>("iframe.e-walk-doc");

const probeAnswer = z.object({ probe: z.number(), color: z.string() });

let probes = 0;

function screenColor() {
  const asked = ++probes;
  return new Promise<string>((done) => {
    const answer = (event: MessageEvent) => {
      const read = probeAnswer.safeParse(event.data);
      if (!read.success || read.data.probe !== asked) return;
      removeEventListener("message", answer);
      done(read.data.color);
    };
    addEventListener("message", answer);
    setTimeout(() => {
      removeEventListener("message", answer);
      done("");
    }, 500);
    walkScreen()?.contentWindow?.postMessage({ probe: asked }, "*");
  });
}

test("SPEC-pieces decision 5 in a walk on a dark viewer page: with the theme light, the walk screen has the color-scheme light and shows the light value of its look", async () => {
  await darkPage();
  await walkTab("?page=map&theme=light");

  expect(getComputedStyle(document.body).colorScheme).toBe("dark");
  await expect.poll(() => walkScreen()?.style.colorScheme).toBe("light");
  await expect.poll(screenColor).toBe(light);
});

test("SPEC-pieces decision 5 in a walk on a dark viewer page: with no theme in the address, the walk screen shows the light value of its look", async () => {
  await darkPage();
  await walkTab("?page=map");

  await expect.poll(screenColor).toBe(light);
});

test("SPEC-pieces decision 5 in a walk on a dark viewer page: with the theme dark, the walk screen shows the dark value of its look", async () => {
  await darkPage();
  await walkTab("?page=map&theme=dark");

  await expect.poll(() => walkScreen()?.style.colorScheme).toBe("dark");
  await expect.poll(screenColor).toBe(dark);
});
