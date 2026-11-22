import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { page } from "vite-plus/test/browser/context";
import { z } from "zod";

import { frames } from "@/frames";
import { frames as frameCells, framesBoard } from "@/frames/contract";
import { kit as kitCells } from "@/kit/cells";
import { compose } from "@/kit/compose";
import { Canvas } from "@/viewer/canvas";

// The live look in a real Chromium (SPEC-kit.md § compose, § Change the look step 3; SPEC-viewer.md
// § Watch an agent work step 4, judged rule 12; the kit-look chart and kit-look-hello-once). The
// server is the board alone over `memory`, with the cell `kit` and each frame's made CSS. A frame's
// own script answers a probe with the color of its text, which its made CSS takes from the look
// value `--primary`, and with a number that its document drew once: a reload gives a new one.

const canvas = "home";
const restMs = 120;

/** A look value `--primary`, as the cell `kit` carries it, and the color that a browser computes. */
const looks = {
  1: { look: ":root {\n  --primary: #112233;\n}\n", rgb: "rgb(17, 34, 51)" },
  2: { look: ":root {\n  --primary: #aa0011;\n}\n", rgb: "rgb(170, 0, 17)" },
  3: { look: ":root {\n  --primary: #006644;\n}\n", rgb: "rgb(0, 102, 68)" },
} as const;

/** A frame's document: its text takes `--primary`; its script answers a probe from its parent. */
const probeDoc = (id: string) =>
  `<p id="t">${id}</p><script>(()=>{const me=Math.random();addEventListener("message",(e)=>{if(e.source!==parent||!e.data||typeof e.data.probe!=="number")return;parent.postMessage({probe:e.data.probe,id:${JSON.stringify(id)},me,color:getComputedStyle(document.getElementById("t")).color},"*")})})()</script>`;

/** The made CSS of each frame version: the only rule is the color of the probe's text. */
const madeCss = "#t { color: var(--primary); }";

/** Each frame's document on the "server", by id. */
const htmls = new Map<string, { version: number; html: string }>();

const loadDocs = operation({
  label: "test.loadDocs",
  input: z.object({ canvas: z.string() }).catchall(z.unknown()),
  run: (_, { input }) => {
    const id = typeof input.id === "string" ? input.id : "";
    const doc = htmls.get(id);

    return doc ? [{ canvas: input.canvas, id, ...doc, css: madeCss }] : [];
  },
});

/** An agent's put of a new frame, at its box, with its picture key `k` when pictures are on. */
const put = operation({
  label: "test.put",
  input: z.object({ id: z.string(), x: z.number(), y: z.number(), k: z.string().optional() }),
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async ({ cells, invalidate }, { input }) => {
    htmls.set(input.id, { version: 1, html: probeDoc(input.id) });
    cells.set({ ...input, canvas, name: `Frame ${input.id}`, w: 320, h: 200, version: 1 });
    await invalidate.run({ input: { docs: { canvas, id: input.id } } });
  },
});

/** A change of the look: the server sets the cell `kit` at scope, as `showKit` does. */
const setKit = operation({
  label: "test.setKit",
  input: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  depends: { cells: kitCells.atScope.controller },
  run: async ({ cells }, { input }) =>
    cells.set({ canvas, kit: input, look: looks[input].look, css: "", pieces: [] }),
});

async function boot(ids: Array<{ id: string; x: number; y: number; k?: string }>) {
  htmls.clear();
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
  await server.run(setKit, { input: 1 });
  for (const f of ids) await server.run(put, { input: f });

  return server;
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

const tick = (ms = 30) => new Promise((done) => setTimeout(done, ms));

const rafs = (n: number) =>
  new Promise<void>((done) => {
    const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : done());
    step(n);
  });

const region = () => page.getByRole("region", { name: "Frames" }).element();
const docs = () => [...region().querySelectorAll<HTMLIFrameElement>("iframe")];
const docOf = (id: string) => docs().find((d) => d.dataset.id === id);

/** The camera rests, and the frames in view go live: `live` of the `n` (all, by default). */
async function rested(at: Awaited<ReturnType<typeof tab>>, n: number, live = n) {
  await expect.poll(() => region().querySelectorAll('[role="group"]').length).toBe(n);
  await rafs(2);
  at.clock.advance(restMs);
  await rafs(live + 6);
  await expect.poll(() => docs().length).toBe(live);
}

const probeAnswer = z.object({
  probe: z.number(),
  id: z.string(),
  me: z.number(),
  color: z.string(),
});

type Probe = z.infer<typeof probeAnswer>;

let probes = 0;

/** Asks a live document for the color of its text; null when it does not answer in 500 ms. */
function probe(id: string) {
  const asked = ++probes;
  return new Promise<Probe | null>((done) => {
    const answer = (event: MessageEvent) => {
      const read = probeAnswer.safeParse(event.data);
      if (!read.success || read.data.probe !== asked) return;
      removeEventListener("message", answer);
      done(read.data);
    };
    addEventListener("message", answer);
    setTimeout(() => {
      removeEventListener("message", answer);
      done(null);
    }, 500);
    docOf(id)?.contentWindow?.postMessage({ probe: asked }, "*");
  });
}

/** The color of a live document's text, as it answers a probe; "" with no answer. */
const colorOf = async (id: string) => (await probe(id))?.color ?? "";
/** The number that a live document drew once: a reload gives a new one. */
const drawnOf = async (id: string) => (await probe(id))?.me ?? -1;
/** The window of a frame's live iframe. */
const winOf = (id: string) => docOf(id)?.contentWindow ?? null;

const hello = z.object({ easel: z.literal("hello") });

/**
 * The hellos that reach the page, by the window that said them. While `deaf` is true, the page
 * does not hear them: this listener is first on the window, so it stops each hello before the
 * stage's own listener (a document that starts before the page listens).
 */
function hellos() {
  const heard: Array<{ from: MessageEventSource | null; at: number }> = [];
  const ear = { deaf: false, heard };
  const listen = (event: MessageEvent) => {
    if (!hello.safeParse(event.data).success) return;
    heard.push({ from: event.source, at: performance.now() });
    if (ear.deaf) event.stopImmediatePropagation();
  };
  addEventListener("message", listen, { capture: true });
  onTestFinished(() => removeEventListener("message", listen, { capture: true }));

  return ear;
}

const kitOf = (at: Awaited<ReturnType<typeof tab>>) =>
  at.scope.resolve(frames.board.kit.of({ canvas })).get()?.kit;

test("a document whose hellos the page does not hear at first gets the new look with its port, and says no hello after it (K7, kit-look-hello-once)", async () => {
  const ear = hellos();
  ear.deaf = true;
  const server = await boot([{ id: "a", x: 0, y: 0 }]);
  const at = await tab(server);
  await rested(at, 1);

  // The page does not hear the document: it says hello again and again, each 50 ms.
  expect(await colorOf("a")).toBe(looks[1].rgb);
  const drawn = await drawnOf("a");
  const win = winOf("a");
  await expect.poll(() => ear.heard.filter((h) => h.from === win).length).toBeGreaterThan(3);

  // The look changes while the document has no port: the document cannot show it yet.
  await server.run(setKit, { input: 2 });
  await expect.poll(() => kitOf(at)).toBe(2);
  await tick(100);
  expect(await colorOf("a")).toBe(looks[1].rgb);

  // The page hears the next hello: the port and the current kit come at once, with no reload.
  const iframe = docOf("a");
  ear.deaf = false;
  await expect.poll(() => colorOf("a"), { timeout: 1_000 }).toBe(looks[2].rgb);
  const ported = performance.now();
  expect(docOf("a")).toBe(iframe);
  expect(await drawnOf("a")).toBe(drawn);

  // The hello stops after the port: none more from that document.
  await tick(300);
  const after = ear.heard.filter((h) => h.from === win && h.at > ported + 60);
  expect(after).toEqual([]);

  // A later change goes on the port: within 1 s, the same document, no new iframe.
  const sent = performance.now();
  await server.run(setKit, { input: 3 });
  await expect.poll(() => colorOf("a"), { timeout: 1_000 }).toBe(looks[3].rgb);
  console.log(
    `speed: K7 one live document showed the new look ${(performance.now() - sent).toFixed(0)} ms after the write`,
  );
  expect(docOf("a")).toBe(iframe);
  expect(await drawnOf("a")).toBe(drawn);
});

test("two hellos in flight: the page answers each with a new port and closes the one before; the document takes the newest port, so a later kit message reaches it", async () => {
  const html = createScope().run(compose, {
    input: { html: probeDoc("two"), css: madeCss, kit: { look: looks[1].look, css: "" } },
  });
  const frame = document.createElement("iframe");
  document.body.append(frame);
  onTestFinished(() => frame.remove());
  const channels: MessageChannel[] = [];
  const answered = new Promise<void>((done) => {
    const answer = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      if (!z.object({ easel: z.literal("hello") }).safeParse(event.data).success) return;
      removeEventListener("message", answer);
      // As the page does for two hellos that came before its first answer: a port for each.
      for (let i = 0; i < 2; i++) {
        channels.at(-1)?.port1.close();
        const channel = new MessageChannel();
        channels.push(channel);
        const first = { easel: "kit", kit: 1, look: looks[1].look, css: "" };
        frame.contentWindow?.postMessage(first, "*", [channel.port2]);
      }
      done();
    };
    addEventListener("message", answer);
  });
  frame.srcdoc = html;
  await answered;

  channels[1]?.port1.postMessage({ easel: "kit", kit: 2, look: looks[2].look, css: "" });
  const look = () => frame.contentDocument?.getElementById("easel-look")?.textContent;
  await expect.poll(look, { timeout: 1_000 }).toBe(looks[2].look);
});

test("the page answers no hello from a window that is not one of its live iframes (SPEC-viewer judged rule 12)", async () => {
  const server = await boot([{ id: "a", x: 0, y: 0 }]);
  const at = await tab(server);
  await rested(at, 1);

  // A stray iframe, not one of the canvas's: its hello gets no port and no kit.
  const stray = document.body.appendChild(document.createElement("iframe"));
  stray.sandbox.add("allow-scripts");
  stray.srcdoc = `<script>let got=0;addEventListener("message",(e)=>{if(e.ports[0]||(e.data&&e.data.easel==="kit"))got++;if(e.data&&e.data.ask)parent.postMessage({stray:got},"*")});parent.postMessage({easel:"hello"},"*");setTimeout(()=>parent.postMessage({easel:"hello"},"*"),50)</script>`;
  onTestFinished(() => stray.remove());
  await tick(300);

  const told = new Promise<unknown>((done) => {
    const answer = (event: MessageEvent) => {
      const read = z.object({ stray: z.number() }).safeParse(event.data);
      if (!read.success) return;
      removeEventListener("message", answer);
      done(read.data.stray);
    };
    addEventListener("message", answer);
  });
  stray.contentWindow?.postMessage({ ask: 1 }, "*");
  expect(await told).toBe(0);
});

test("K7: with 20 frames in view, each live document shows a new color.primary within 1 s, in the same document, with no new iframe", async () => {
  // 20 frames, 5 across and 4 down: Fit shows them all, and 12 are live (decision C7).
  const grid = Array.from({ length: 20 }, (_, i) => ({
    id: `f${String(i).padStart(2, "0")}`,
    x: (i % 5) * 340,
    y: Math.floor(i / 5) * 220,
  }));
  const server = await boot(grid);
  const at = await tab(server);
  await rested(at, 20, 12);
  const live = docs().map((d) => d.dataset.id ?? "");
  const iframes = docs();
  // Each live document has its port: its hello was answered.
  for (const id of live) {
    await expect.poll(() => colorOf(id), { timeout: 1_000 }).toBe(looks[1].rgb);
  }
  const drawn = await Promise.all(live.map((id) => drawnOf(id)));

  const sent = performance.now();
  await server.run(setKit, { input: 2 });
  const times = await Promise.all(
    live.map(async (id) => {
      await expect.poll(() => colorOf(id), { timeout: 1_000, interval: 10 }).toBe(looks[2].rgb);
      return performance.now() - sent;
    }),
  );
  console.log(
    `speed: K7 ${live.length} live documents of 20 in view showed the new look in ${Math.max(...times).toFixed(0)} ms at most (p50 ${[...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]?.toFixed(0)} ms)`,
  );
  expect(Math.max(...times)).toBeLessThan(1_000);
  expect(docs()).toEqual(iframes);
  expect(await Promise.all(live.map((id) => drawnOf(id)))).toEqual(drawn);
});

test("K7: each frame in view that is not live asks for the picture of the new kit version in the same img, so its last picture stays until the new one comes; no frame is written", async () => {
  const grid = Array.from({ length: 20 }, (_, i) => ({
    id: `f${String(i).padStart(2, "0")}`,
    x: (i % 5) * 340,
    y: Math.floor(i / 5) * 220,
    k: `key-${i}`,
  }));
  const server = await boot(grid);
  const at = await tab(server);
  await rested(at, 20, 12);
  const live = new Set(docs().map((d) => d.dataset.id ?? ""));
  const shown = grid.filter((f) => !live.has(f.id));
  const cards = shown.map((f) => f.id);
  const picOf = (id: string) =>
    region().querySelector<HTMLImageElement>(`[data-id="${id}"] .e-card img.e-pic`);
  expect(cards).toHaveLength(8);
  const imgs = cards.map((id) => picOf(id));
  expect(imgs.map((img) => img?.getAttribute("src"))).toEqual(
    shown.map((f) => `/api/pictures/${canvas}/${f.id}/1?s=0.5&k=${f.k}&kit=1`),
  );

  await server.run(setKit, { input: 2 });
  await expect
    .poll(() => cards.map((id) => picOf(id)?.getAttribute("src")?.endsWith("&kit=2")), {
      timeout: 1_000,
    })
    .toEqual(cards.map(() => true));
  // The same img, and its card shows: the browser keeps the last picture until the new one has
  // come, so no frame shows a white box.
  expect(cards.map((id) => picOf(id))).toEqual(imgs);
  for (const id of cards) {
    expect(region().querySelector(`[data-id="${id}"] .e-card`)?.hasAttribute("hidden")).toBe(false);
  }
  // No frame is written: each frame is at its first version.
  expect(cards.map((id) => picOf(id)?.getAttribute("src")?.split("?")[0])).toEqual(
    cards.map((id) => `/api/pictures/${canvas}/${id}/1`),
  );
});
