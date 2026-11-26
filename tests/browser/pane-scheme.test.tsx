import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { cdp, page } from "vite-plus/test/browser/context";
import { z } from "zod";

import { frames } from "@/frames";
import { frames as frameCells, framesBoard } from "@/frames/contract";
import { kit as kitCells } from "@/kit/cells";
import { Canvas } from "@/viewer/canvas";

const canvas = "home";
const restMs = 120;
const startUrl = location.href;

const light = "rgb(250, 250, 250)";
const dark = "rgb(18, 18, 18)";

const look =
  ":root {\n  color-scheme: light dark;\n  --background: light-dark(#fafafa, #121212);\n}\n";

const panedJs = `const pane=document.getElementById("easel-pane");const role=pane?"pane":"frame";let port=null;document.body.style.background="var(--background)";const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};addEventListener("message",(e)=>{if(e.source!==parent)return;if(e.ports[0]&&!port){port=e.ports[0];if(pane){port.postMessage({easel:"size",w:90,h:30})}else{port.postMessage({easel:"axes",locales:[],config:{}});port.postMessage({easel:"panes",places:["right"]})}}const d=e.data;if(d&&typeof d.probe==="number")parent.postMessage({probe:d.probe,role,color:getComputedStyle(document.body).backgroundColor},"*")});hello();`;

const noRuntime = { address: "/api/runtime/1/none/", imports: {} };

const served = { version: 1, html: "", app: { js: panedJs, kit: 1, runtime: noRuntime } };

const loadDocs = operation({
  label: "test.paneLoadDocs",
  input: z.object({ canvas: z.string() }).catchall(z.unknown()),
  run: (_, { input }) =>
    input.id === "a" ? [{ canvas: input.canvas, id: "a", ...served, css: "" }] : [],
});

const put = operation({
  label: "test.panePut",
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async ({ cells, invalidate }) => {
    cells.set({
      id: "a",
      x: 0,
      y: 0,
      canvas,
      page: "page-1",
      name: "Frame a",
      w: 320,
      h: 200,
      version: 1,
      status: "exploring",
    });
    await invalidate.run({ input: { docs: { canvas, id: "a" } } });
  },
});

const setKit = operation({
  label: "test.paneSetKit",
  depends: { cells: kitCells.atScope.controller },
  run: async ({ cells }) => cells.set({ canvas, kit: 1, look, css: "", pieces: [], texts: {} }),
});

async function boot() {
  const server = await createScope({
    capsules: [
      exits({ store: localStorage }),
      frames.board({ serve: true, load: { docs: loadDocs } }),
      memory.server({ services: [frames.board] }),
    ],
  }).ready;
  onTestFinished(async () => {
    await server.close();
  });
  await server.run(setKit);
  await server.run(put);
  return server;
}

async function darkPage(search: string) {
  const url = new URL(startUrl);
  url.search = search;
  history.replaceState(history.state, "", url);

  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "" }],
  });
  document.documentElement.style.colorScheme = "dark";

  onTestFinished(() => {
    document.documentElement.style.removeProperty("color-scheme");
    history.replaceState(history.state, "", startUrl);
  });
}

async function tab(server: Scope.Handle) {
  await page.viewport(1200, 800);

  const clock = makeTestClock();
  const scope = await createScope({
    clock,
    capsules: [
      exits({ store: localStorage }),
      memory.client({ peer: server }),
      frames.board({ read: memory.client }),
    ],
  }).ready;

  const root = createRoot(document.body.appendChild(document.createElement("div")));
  onTestFinished(async () => {
    root.unmount();
    await scope.close();
  });

  root.render(
    <ScopeProvider scope={scope}>
      <Canvas canvas={canvas} opening={<p>Opening</p>} />
    </ScopeProvider>,
  );

  return { clock, scope };
}

const rafs = (n: number) =>
  new Promise<void>((done) => {
    const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : done());
    step(n);
  });

const region = () => page.getByRole("region", { name: "Frames" }).element();

const frameDoc = () =>
  region().querySelector<HTMLIFrameElement>('iframe.e-doc[data-id="a"]:not([data-closing])');

const paneDoc = () => region().querySelector<HTMLIFrameElement>('iframe.e-pane[data-id="a"]');

async function rested(at: Awaited<ReturnType<typeof tab>>) {
  await expect.poll(() => region().querySelectorAll('[role="group"]').length).toBeGreaterThan(0);
  await rafs(2);
  at.clock.advance(restMs);
  await rafs(7);
  await expect.poll(() => Boolean(frameDoc() && paneDoc())).toBe(true);
}

const probeAnswer = z.object({ probe: z.number(), role: z.string(), color: z.string() });

let probes = 0;

function colorOf(doc: () => HTMLIFrameElement | null) {
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
    doc()?.contentWindow?.postMessage({ probe: asked }, "*");
  });
}

const statesButton = () => page.getByRole("button", { name: "States" });
const statesMenu = () => page.getByRole("menu", { name: "States" });

async function chooseState(name: string, value: string) {
  await statesButton().click();
  await statesMenu()
    .getByRole("menuitemradio", { name: `${name} ${value}` })
    .click();
  await expect.poll(() => statesMenu().elements()).toHaveLength(0);
}

test("SPEC-pieces decision 5 for a pane on a dark viewer page: with the theme light, the pane of an app frame has the color-scheme light and shows the light value of its look", async () => {
  await darkPage("?theme=light");
  const at = await tab(await boot());
  await rested(at);

  expect(getComputedStyle(document.body).colorScheme).toBe("dark");
  await expect.poll(() => colorOf(frameDoc)).toBe(light);
  await expect.poll(() => paneDoc()?.style.colorScheme).toBe("light");
  await expect.poll(() => colorOf(paneDoc)).toBe(light);
});

test("SPEC-pieces decision 5 for a pane on a dark viewer page: with no theme in the address, the pane shows the light value of its look", async () => {
  await darkPage("");
  const at = await tab(await boot());
  await rested(at);

  await expect.poll(() => colorOf(frameDoc)).toBe(light);
  await expect.poll(() => colorOf(paneDoc)).toBe(light);
});

test("SPEC-pieces decision 5 for a pane on a dark viewer page: with theme=dark in the address, the pane has the color-scheme dark and shows the dark value of its look, as its frame does", async () => {
  await darkPage("?theme=dark");
  const at = await tab(await boot());
  await rested(at);

  await expect.poll(() => colorOf(frameDoc)).toBe(dark);
  await expect.poll(() => paneDoc()?.style.colorScheme).toBe("dark");
  await expect.poll(() => colorOf(paneDoc)).toBe(dark);
});

test("SPEC-pieces decision 5 for a pane on a dark viewer page: a board pick of dark shows the dark value in the pane within 1 s, and a pick of light shows the light value again", async () => {
  await darkPage("");
  const at = await tab(await boot());
  await rested(at);
  await expect.poll(() => colorOf(paneDoc)).toBe(light);

  await chooseState("theme", "dark");
  await expect.poll(() => colorOf(frameDoc), { timeout: 1000 }).toBe(dark);
  await expect.poll(() => colorOf(paneDoc), { timeout: 1000 }).toBe(dark);

  await chooseState("theme", "light");
  await expect.poll(() => colorOf(paneDoc)).toBe(light);
});
