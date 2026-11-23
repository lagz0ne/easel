import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";
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

/**
 * An app frame's JS (SPEC-kit.md § App frames): it draws the probe's text and answers the probe as
 * `probeDoc` does. It imports nothing, so it needs no runtime file.
 */
const probeJs = (id: string) =>
  `const t=document.body.appendChild(document.createElement("p"));t.id="t";t.textContent=${JSON.stringify(id)};const me=Math.random();addEventListener("message",(e)=>{if(e.source!==parent||!e.data||typeof e.data.probe!=="number")return;parent.postMessage({probe:e.data.probe,id:${JSON.stringify(id)},me,color:getComputedStyle(t).color},"*")});`;

/**
 * A capsule frame's JS, as `@easel/frame` acts on the port (chart kit-frame-axes): it says hello
 * each 50 ms until it gets a port, then posts its axes on it. It answers the probe with its axes
 * (the `easel-axes` JSON of its document) as its color, and the number it drew once.
 */
const capsuleJs = (id: string) =>
  `const me=Math.random();let port=null;const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};addEventListener("message",(e)=>{if(e.source!==parent)return;if(e.ports[0]&&!port){port=e.ports[0];port.postMessage({easel:"axes",locales:["en","vi"],config:{sample:{values:["many","empty"],default:"many"}}})}const d=e.data;if(d&&typeof d.probe==="number")parent.postMessage({probe:d.probe,id:${JSON.stringify(id)},me,color:document.getElementById("easel-axes").textContent},"*")});hello();`;

/**
 * An app frame's JS that closes as `@easel/frame` does (chart kit-app-frame): it says hello each
 * 50 ms until it gets a port. On `close` (on its port, or from its parent's window) it tells the
 * test how it got it, then posts `closed` 300 ms later (of real time: the test clock holds the page's wait), on its port or to its parent.
 */
const closerJs = (id: string) =>
  `let port=null;const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};const take=(d,via)=>{if(!d||d.easel!=="close")return;parent.postMessage({seen:"close",id:${JSON.stringify(id)},via},"*");setTimeout(()=>port?port.postMessage({easel:"closed"}):parent.postMessage({easel:"closed"},"*"),300)};addEventListener("message",(e)=>{if(e.source!==parent)return;if(e.ports[0]&&!port){port=e.ports[0];port.onmessage=(m)=>take(m.data,"port")}take(e.data,"window");if(e.data&&typeof e.data.probe==="number")parent.postMessage({probe:e.data.probe,id:${JSON.stringify(id)},me:0,color:port?"port":"none"},"*")});hello();`;

/** The controls of the frame with controls, as a runtime from before the places posts them. */
const plainControls = [
  { key: "add", label: "Add one", kind: "action" },
  { key: "on", label: "On", kind: "switch" },
  { key: "size", label: "Size", kind: "select", values: ["s", "m", "l"] },
  { key: "count", label: "Count", kind: "number", min: 0 },
  { key: "bad", label: "Fail", kind: "action" },
];

/** The same controls, each at a place: the label row, each edge, and the panel. */
const placedControls = [
  { key: "add", label: "Add one", kind: "action", place: "right" },
  { key: "on", label: "On", kind: "switch", place: "top" },
  { key: "size", label: "Size", kind: "select", values: ["s", "m", "l"], place: "left" },
  { key: "count", label: "Count", kind: "number", min: 0, place: "panel" },
  { key: "bad", label: "Fail", kind: "action", place: "right" },
];

/**
 * An app frame's JS with controls, as `@easel/frame` posts them (chart kit-frame-controls): on its
 * port, its controls and their values; on each `control`, it changes its state, then posts its
 * values. The key `bad` is refused. It tells the test each control that reaches it.
 */
const controlsJs = (id: string, placed: boolean) =>
  `let port=null;const s={on:false,size:"s",count:0};const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};const values=()=>port.postMessage({easel:"values",values:{on:s.on,size:s.size,count:s.count}});addEventListener("message",(e)=>{if(e.source!==parent)return;if(e.ports[0]&&!port){port=e.ports[0];port.onmessage=(m)=>{const d=m.data;if(!d||d.easel!=="control")return;parent.postMessage({seen:"control",id:${JSON.stringify(id)},key:d.key,value:d.value},"*");if(d.key==="bad"){port.postMessage({easel:"ran",key:"bad",failed:"Nope"});return}if(d.key==="add")s.count+=1;else s[d.key]=d.value;values()};port.postMessage({easel:"controls",controls:${JSON.stringify(placed ? placedControls : plainControls)}});values()}});hello();`;

/**
 * A frame with two panes, as `@easel/frame` acts on the ports (chart kit-control-link). The
 * frame's document posts the places of its panes, then a link for each one, and one more when the
 * page asks; it answers each ping on a link with its own number. A pane's document (it has
 * `easel-pane`) posts its size, pings on each link that it gets, and tells the test the answer.
 */
const paneedJs = (id: string) =>
  `const me=Math.random();let port=null;const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};const pane=document.getElementById("easel-pane");if(pane){const place=JSON.parse(pane.textContent).place;addEventListener("message",(e)=>{if(e.source!==parent||!e.ports[0]||port)return;port=e.ports[0];port.postMessage({easel:"size",w:90,h:30});port.onmessage=(m)=>{if(!m.data||m.data.easel!=="link"||!m.ports[0])return;const link=m.ports[0];link.onmessage=(r)=>parent.postMessage({seen:"pane",id:${JSON.stringify(id)},place,me:r.data.me},"*");link.postMessage({ping:place})}})}else{const link=(place)=>{const c=new MessageChannel();c.port1.onmessage=()=>c.port1.postMessage({me});port.postMessage({easel:"link",place},[c.port2])};addEventListener("message",(e)=>{if(e.source!==parent||!e.ports[0]||port)return;port=e.ports[0];port.onmessage=(m)=>{if(m.data&&m.data.easel==="link")link(m.data.place)};port.postMessage({easel:"panes",places:["top","right"]});link("top");link("right")})}hello();`;

/** The JS of a put's app frame: panes, controls, a closer, a capsule frame, or the probe. */
const appJs = (
  id: string,
  kind: { capsule?: boolean; closer?: boolean; controls?: true | "placed"; panes?: boolean },
) =>
  kind.panes
    ? paneedJs(id)
    : kind.controls
      ? controlsJs(id, kind.controls === "placed")
      : kind.closer
        ? closerJs(id)
        : kind.capsule
          ? capsuleJs(id)
          : probeJs(id);

/** The runtime of an app frame that imports nothing. */
const noRuntime = { address: "/api/runtime/1/none/", imports: {} };

type ServedDoc = {
  version: number;
  html: string;
  app?: { js: string; kit: number; runtime: typeof noRuntime };
};

/** Each frame's document on the "server", by id. */
const htmls = new Map<string, ServedDoc>();

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
  input: z.object({
    id: z.string(),
    x: z.number(),
    y: z.number(),
    k: z.string().optional(),
    app: z.boolean().optional(),
    capsule: z.boolean().optional(),
    closer: z.boolean().optional(),
    controls: z.union([z.literal(true), z.literal("placed")]).optional(),
    panes: z.boolean().optional(),
    version: z.number().optional(),
  }),
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async (
    { cells, invalidate },
    { input: { app, capsule, closer, controls, panes, version = 1, ...input } },
  ) => {
    const js = appJs(input.id, { capsule, closer, controls, panes });
    const served: ServedDoc =
      app || capsule || closer || controls || panes
        ? { version, html: "", app: { js, kit: 1, runtime: noRuntime } }
        : { version, html: probeDoc(input.id) };
    htmls.set(input.id, served);
    cells.set({ ...input, canvas, name: `Frame ${input.id}`, w: 320, h: 200, version });
    await invalidate.run({ input: { docs: { canvas, id: input.id } } });
  },
});

/** An agent's delete. */
const drop = operation({
  label: "test.drop",
  input: z.string(),
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async ({ cells, invalidate }, { input }) => {
    htmls.delete(input);
    cells.delete({ canvas, id: input });
    await invalidate.run({ input: { docs: { canvas, id: input } } });
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

async function boot(
  ids: Array<{
    id: string;
    x: number;
    y: number;
    k?: string;
    app?: boolean;
    capsule?: boolean;
    closer?: boolean;
    controls?: true | "placed";
    panes?: boolean;
  }>,
) {
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

/** The live documents that show; an app document that is closing (hidden) is not one. */
const docs = () => [
  ...region().querySelectorAll<HTMLIFrameElement>("iframe.e-doc:not([data-closing])"),
];

/** The app documents that are closing: hidden, until their app posts `closed`. */
const closingDocs = () => [...region().querySelectorAll<HTMLIFrameElement>("iframe[data-closing]")];
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

test("an app frame draws its JS in the composed document (composeApp), with the look and its made CSS, and not its text", async () => {
  const server = await boot([
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 400, y: 0, app: true },
  ]);
  const at = await tab(server);
  await rested(at, 2);

  expect(docOf("b")?.srcdoc).toContain('<script type="importmap">');
  expect(await colorOf("b")).toBe(looks[1].rgb);
  expect(await colorOf("a")).toBe(looks[1].rgb);
});

test("kit-frame-axes: a capsule frame posts its axes; the page offers the locale and its data states; a pick composes it again with them, and the other frame is not drawn again", async () => {
  const server = await boot([
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 400, y: 0, capsule: true },
  ]);
  const at = await tab(server);
  await rested(at, 2);

  // The frame posted its axes: the dock offers the locales, and its label its data states.
  const locale = page.getByRole("combobox", { name: "Locale" });
  const sample = page.getByRole("combobox", { name: "sample of Frame b" });
  await expect.element(locale).toBeInTheDocument();
  await expect.element(sample).toHaveValue("many");
  expect(page.getByRole("combobox", { name: /of Frame a$/ }).elements()).toEqual([]);
  expect(await colorOf("b")).toBe("{}");
  const [plain, first] = [await drawnOf("a"), await drawnOf("b")];

  // Vietnamese: frame b gets a new document with the locale, in a new scope; frame a stays.
  await locale.selectOptions("vi");
  await expect.poll(() => colorOf("b")).toBe('{"locale":"vi","config":{}}');
  expect(await drawnOf("b")).not.toBe(first);
  expect(await drawnOf("a")).toBe(plain);

  // The data state empty, then the defaults again: the default values are left out.
  await sample.selectOptions("empty");
  await expect.poll(() => colorOf("b")).toBe('{"locale":"vi","config":{"sample":"empty"}}');
  await locale.selectOptions("en");
  await sample.selectOptions("many");
  await expect.poll(() => colorOf("b")).toBe("{}");
  expect(await drawnOf("a")).toBe(plain);
});

const seenClose = z.object({ seen: z.literal("close"), id: z.string(), via: z.string() });

/** Each `close` that a closer frame got, with how it got it (`port` or `window`). */
function closes() {
  const seen: Array<{ id: string; via: string }> = [];
  const listen = (event: MessageEvent) => {
    const read = seenClose.safeParse(event.data);
    if (read.success) seen.push({ id: read.data.id, via: read.data.via });
  };
  addEventListener("message", listen);
  onTestFinished(() => removeEventListener("message", listen));
  return seen;
}

test("kit-app-frame: a new version of an app frame: the page posts close on its port and keeps the old iframe, hidden, until the app posts closed", async () => {
  const seen = closes();
  const server = await boot([{ id: "a", x: 0, y: 0, closer: true }]);
  const at = await tab(server);
  await rested(at, 1);
  await expect.poll(() => colorOf("a")).toBe("port");
  const old = docOf("a");

  await server.run(put, { input: { id: "a", x: 0, y: 0, closer: true, version: 2 } });
  await expect.poll(() => docOf("a")?.dataset.version).toBe("2");
  expect(closingDocs()).toEqual([old]);
  expect(old && getComputedStyle(old).visibility).toBe("hidden");
  expect(old?.getAttribute("aria-hidden")).toBe("true");

  // The app got close on its port; 300 ms later it posts closed, and only then its iframe goes.
  await expect.poll(() => seen).toEqual([{ id: "a", via: "port" }]);
  await expect.poll(() => old?.isConnected).toBe(false);
  expect(docs().map((d) => d.dataset.version)).toEqual(["2"]);
});

test("kit-app-frame: an app that does not answer close loses its iframe after 200 ms all the same; an HTML frame's goes at once", async () => {
  const server = await boot([
    { id: "a", x: 0, y: 0, app: true },
    { id: "b", x: 400, y: 0 },
  ]);
  const at = await tab(server);
  await rested(at, 2);
  const [app, html] = [docOf("a"), docOf("b")];

  await server.run(put, { input: { id: "a", x: 0, y: 0, app: true, version: 2 } });
  await server.run(put, { input: { id: "b", x: 400, y: 0, version: 2 } });
  await expect.poll(() => docs().map((d) => d.dataset.version)).toEqual(["2", "2"]);
  expect(html?.isConnected).toBe(false);
  expect(closingDocs()).toEqual([app]);

  // The probe app never posts closed: its iframe stays until the wait of 200 ms ends.
  await tick(100);
  at.clock.advance(199);
  await tick();
  expect(app?.isConnected).toBe(true);
  at.clock.advance(1);
  await expect.poll(() => app?.isConnected).toBe(false);
});

test("kit-app-frame: a deleted app frame: its shell goes from the canvas at once, its iframe stays hidden until the app posts closed", async () => {
  const seen = closes();
  const server = await boot([
    { id: "a", x: 0, y: 0, closer: true },
    { id: "b", x: 400, y: 0 },
  ]);
  const at = await tab(server);
  await rested(at, 2);
  await expect.poll(() => colorOf("a")).toBe("port");
  const old = docOf("a");

  await server.run(drop, { input: "a" });
  await expect.poll(() => region().querySelectorAll('[role="group"]').length).toBe(1);
  expect(page.getByRole("group", { name: "Frame a" }).elements()).toEqual([]);
  await expect.poll(() => closingDocs()).toEqual([old]);
  expect(old?.closest(".e-shell")?.hasAttribute("hidden")).toBe(true);

  await expect.poll(() => seen).toEqual([{ id: "a", via: "port" }]);
  await expect.poll(() => old?.isConnected).toBe(false);
  expect(region().querySelectorAll(".e-shell").length).toBe(1);
  expect(docs().map((d) => d.dataset.id)).toEqual(["b"]);
});

const seenControl = z.object({
  seen: z.literal("control"),
  id: z.string(),
  key: z.string(),
  value: z.unknown().optional(),
});

/** Each control that reached a frame's document, with its value. */
function controlsSeen() {
  const seen: Array<{ key: string; value?: unknown }> = [];
  const listen = (event: MessageEvent) => {
    const read = seenControl.safeParse(event.data);
    if (!read.success) return;
    const { key, value } = read.data;
    seen.push(value === undefined ? { key } : { key, value });
  };
  addEventListener("message", listen);
  onTestFinished(() => removeEventListener("message", listen));
  return seen;
}

test("kit-frame-controls: an app frame posts its controls; the panel draws them with its values; each change goes to the live document and shows its new values; a new document starts them again", async () => {
  const seen = controlsSeen();
  const server = await boot([
    { id: "a", x: 0, y: 0, controls: true },
    { id: "b", x: 400, y: 0 },
  ]);
  const at = await tab(server);
  await rested(at, 2);

  // Only the frame that posted controls has the button; it opens the panel for that frame.
  const button = page.getByRole("button", { name: "Controls of Frame a" });
  await expect.element(button).toBeInTheDocument();
  expect(page.getByRole("button", { name: "Controls of Frame b" }).elements()).toEqual([]);
  await button.click();
  const panel = page.getByRole("complementary", { name: "Controls" });
  await expect.element(panel.getByText("Frame a", { exact: true })).toBeInTheDocument();
  await expect.element(button).toHaveAttribute("aria-pressed", "true");
  const iframe = docOf("a");

  // Each kind of control, with the values that the document posted.
  const on = panel.getByRole("switch", { name: "On" });
  const size = panel.getByRole("combobox", { name: "Size" });
  const count = panel.getByRole("spinbutton", { name: "Count" });
  await expect.element(on).not.toBeChecked();
  await expect.element(size).toHaveValue("s");
  await expect.element(count).toHaveValue(0);

  // A change goes on the port, runs in the same document, and the panel shows its new values.
  await panel.getByRole("button", { name: "Add one" }).click();
  await expect.element(count).toHaveValue(1);
  await on.click();
  await expect.element(on).toBeChecked();
  await size.selectOptions("l");
  await expect.element(size).toHaveValue("l");
  await count.fill("7");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => seen)
    .toEqual([
      { key: "add" },
      { key: "on", value: true },
      { key: "size", value: "l" },
      { key: "count", value: 7 },
    ]);
  await expect.element(count).toHaveValue(7);
  expect(docOf("a")).toBe(iframe);

  // A refused run says its kind under the control.
  await panel.getByRole("button", { name: "Fail" }).click();
  await expect.element(panel.getByRole("alert")).toHaveTextContent("The frame refused it: Nope.");

  // A new version: a new document, whose values start again; the old one gets no control.
  await server.run(put, { input: { id: "a", x: 0, y: 0, controls: true, version: 2 } });
  await expect.poll(() => docOf("a")?.dataset.version).toBe("2");
  await expect.element(size).toHaveValue("s");
  await expect.element(count).toHaveValue(0);
  expect(panel.getByRole("alert").elements()).toEqual([]);
  await panel.getByRole("button", { name: "Add one" }).click();
  await expect.element(count).toHaveValue(1);
  await expect.poll(() => seen.length).toBe(6);

  // Requests takes the side of the page: the panel Controls closes.
  await page.getByRole("button", { name: "Requests" }).click();
  await expect.element(panel).not.toBeInTheDocument();
  await expect.element(button).toHaveAttribute("aria-pressed", "false");
});

/** The shell of the frame `id`. */
function shellOf(id: string) {
  const shell = region().querySelector<HTMLElement>(`.e-shell[data-id="${id}"]`);
  if (!shell) throw new Error(`no shell ${id}`);
  return shell;
}

/** A frame's id, and so its name, that is longer than its label row at a far zoom. */
const long = "alpha-with-a-long-name";

test("kit-frame-controls places: the frame places each control in its label row, in a column at its left or right edge, or in the panel; each place shows the same live values", async () => {
  const seen = controlsSeen();
  // Frames on each side: the fit zooms out, so the label row, with a long name, is narrower than
  // its controls.
  const server = await boot([
    { id: "b", x: 0, y: 0 },
    { id: long, x: 1300, y: 0, controls: "placed" },
    { id: "c", x: 2600, y: 0 },
  ]);
  const at = await tab(server);
  await rested(at, 3);

  const top = page.getByRole("group", { name: `Top controls of Frame ${long}` });
  const left = page.getByRole("group", { name: `Left controls of Frame ${long}` });
  const right = page.getByRole("group", { name: `Right controls of Frame ${long}` });
  const on = top.getByRole("switch", { name: "On" });
  const size = left.getByRole("combobox", { name: "Size" });
  await expect.element(on).not.toBeChecked();
  await expect.element(size).toHaveValue("s");
  expect(
    right
      .getByRole("button")
      .elements()
      .map((b) => b.textContent),
  ).toEqual(["Add one", "Fail"]);

  // The label row holds the top controls; each column sits outside the frame, at its edge.
  const shell = shellOf(long);
  expect(shell.querySelector("[data-label]")?.contains(on.element())).toBe(true);
  // The row is narrower than its controls: the name gets shorter, and no control is cut off.
  const button = page.getByRole("button", { name: `Controls of Frame ${long}` }).element();
  for (const el of [on.element(), button]) {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    expect(el.contains(hit)).toBe(true);
  }
  const name = shell.querySelector(".e-label-name");
  expect(name instanceof HTMLElement && name.scrollWidth > name.clientWidth).toBe(true);
  const frameBox = shell.getBoundingClientRect();
  expect(left.element().getBoundingClientRect().right).toBeLessThanOrEqual(frameBox.left);
  expect(right.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(frameBox.right);

  // A change at one place goes to the live document; the panel shows the new value too.
  await right.getByRole("button", { name: "Add one" }).click();
  await on.click();
  await size.selectOptions("m");
  await expect.element(on).toBeChecked();

  // A refused run says its kind beside the control, in its column.
  await right.getByRole("button", { name: "Fail" }).click();
  await expect.element(right.getByRole("alert")).toHaveTextContent("The frame refused it: Nope.");

  await page.getByRole("button", { name: `Controls of Frame ${long}` }).click();
  const panel = page.getByRole("complementary", { name: "Controls" });
  await expect.element(panel.getByRole("spinbutton", { name: "Count" })).toHaveValue(1);
  expect(
    panel
      .getByRole("button")
      .elements()
      .map((b) => b.getAttribute("aria-label")),
  ).toEqual(["Close the controls"]);
  await expect
    .poll(() => seen)
    .toEqual([
      { key: "add" },
      { key: "on", value: true },
      { key: "size", value: "m" },
      { key: "bad" },
    ]);
});

/** What each pane told the test: its place, and the number of the frame's document that answered. */
function panesSeen() {
  const seen: Array<{ place: string; me: number }> = [];
  const told = z.object({ seen: z.literal("pane"), place: z.string(), me: z.number() });

  const listen = (event: MessageEvent) => {
    const read = told.safeParse(event.data);
    if (read.success) seen.push({ place: read.data.place, me: read.data.me });
  };
  addEventListener("message", listen);
  onTestFinished(() => removeEventListener("message", listen));
  return seen;
}

test("kit-control-link: the page draws an iframe for each pane of a frame's current document, at its place and the size of its content, and gives each link of the frame to its pane, unread; a new document gives new links", async () => {
  const seen = panesSeen();
  const server = await boot([{ id: "a", x: 0, y: 0, panes: true }]);
  const at = await tab(server);
  await rested(at, 1);

  const paneOf = (place: string) =>
    region().querySelector<HTMLIFrameElement>(`iframe.e-pane[data-id="a"][data-place="${place}"]`);
  await expect.poll(() => Boolean(paneOf("top") && paneOf("right"))).toBe(true);
  expect(paneOf("top")?.closest(".e-label")).not.toBeNull();
  expect(paneOf("right")?.closest(".e-ctl-right")).not.toBeNull();
  await expect.poll(() => paneOf("top")?.style.width).toBe("90px");
  expect(paneOf("top")?.style.height).toBe("30px");
  await expect.poll(() => paneOf("right")?.style.width).toBe("90px");

  // Each pane pings on its link, and the frame's document answers: the page only passed the end.
  const placesOf = (me?: number) =>
    [
      ...new Set(seen.filter((one) => me === undefined || one.me !== me).map((one) => one.place)),
    ].sort();
  await expect.poll(() => placesOf()).toEqual(["right", "top"]);
  const first = seen[0]?.me;

  // A new version: a new document, with new panes, and links of its own scope.
  await server.run(put, { input: { id: "a", x: 0, y: 0, panes: true, version: 2 } });
  await expect.poll(() => placesOf(first)).toEqual(["right", "top"]);
  await expect.poll(() => region().querySelectorAll("iframe.e-pane").length).toBe(2);
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

const paintPost = z.object({ easel: z.literal("painted"), v: z.number() });

/**
 * The paint posts of the live documents. While `shut` is true, the page does not hear them: this
 * listener is first on the window, and it keeps each one. `release` gives them to the page, in
 * order, from the window that said them.
 */
function paintGate() {
  const held: MessageEvent[] = [];
  const gate = {
    shut: false,
    held,
    release: () => {
      gate.shut = false;
      for (const e of held.splice(0)) {
        dispatchEvent(new MessageEvent("message", { data: e.data, source: e.source }));
      }
    },
  };
  const listen = (event: MessageEvent) => {
    if (!gate.shut || !paintPost.safeParse(event.data).success) return;
    held.push(event);
    event.stopImmediatePropagation();
  };
  addEventListener("message", listen, { capture: true });
  onTestFinished(() => removeEventListener("message", listen, { capture: true }));

  return gate;
}

/** The names of the page's marks that start with `prefix`, in order. */
const marks = (prefix: string) =>
  performance
    .getEntriesByType("mark")
    .filter((m) => m.name.startsWith(prefix))
    .map((m) => m.name);

const markAt = (name: string) => performance.getEntriesByName(name, "mark")[0]?.startTime ?? -1;

test("SPEC-speed marks: easel:open comes once, after the last frame in view shows its live document or its picture, and not before; the paint cap is no show", async () => {
  performance.clearMarks();
  const gate = paintGate();
  gate.shut = true;
  const grid = Array.from({ length: 20 }, (_, i) => ({
    id: `f${String(i).padStart(2, "0")}`,
    x: (i % 5) * 340,
    y: Math.floor(i / 5) * 220,
    k: `key-${i}`,
  }));
  const server = await boot(grid);
  const at = await tab(server);
  await rested(at, 20, 12);
  await expect.poll(() => gate.held.length).toBe(12);

  // The cap takes each card off its live document, but no document said that it painted.
  at.clock.advance(1_500);
  await tick();
  expect(marks("easel:")).toEqual([]);

  // The 12 live documents paint; the 8 pictures have not come.
  gate.release();
  expect(marks("easel:change:")).toHaveLength(12);
  expect(marks("easel:open")).toEqual([]);
  const live = new Set(docs().map((d) => d.dataset.id ?? ""));
  const pics = grid
    .filter((f) => !live.has(f.id))
    .map((f) => region().querySelector(`[data-id="${f.id}"] .e-card img.e-pic`));
  expect(pics).toHaveLength(8);
  for (const img of pics.slice(0, 7)) img?.dispatchEvent(new Event("load"));
  expect(marks("easel:open")).toEqual([]);

  // The last picture comes: open, after each frame's first version showed.
  pics[7]?.dispatchEvent(new Event("load"));
  expect(marks("easel:open")).toEqual(["easel:open"]);
  expect(marks("easel:change:")).toHaveLength(20);
  const last = Math.max(...grid.map((f) => markAt(`easel:change:${f.id}:1`)));
  expect(markAt("easel:open")).toBeGreaterThanOrEqual(last);
  for (const img of pics) img?.dispatchEvent(new Event("load"));
  expect(marks("easel:open")).toEqual(["easel:open"]);
});

test("SPEC-speed marks: easel:change:<id>:<v> comes when version v shows, and not before; the paint cap is no show, and a version shows once", async () => {
  performance.clearMarks();
  const gate = paintGate();
  const server = await boot([{ id: "a", x: 0, y: 0 }]);
  const at = await tab(server);
  await rested(at, 1);
  await expect.poll(() => marks("easel:change:a:")).toEqual(["easel:change:a:1"]);
  expect(marks("easel:open")).toEqual(["easel:open"]);

  // An agent puts version 2: its document has not said that it painted.
  gate.shut = true;
  await server.run(put, { input: { id: "a", x: 0, y: 0, version: 2 } });
  await expect.poll(() => gate.held.length).toBe(1);
  at.clock.advance(1_500);
  await tick();
  expect(marks("easel:change:a:")).toEqual(["easel:change:a:1"]);

  gate.release();
  expect(marks("easel:change:a:")).toEqual(["easel:change:a:1", "easel:change:a:2"]);
  // The same post again, or the picture of that version, marks nothing more.
  dispatchEvent(
    new MessageEvent("message", { data: { easel: "painted", v: 2 }, source: winOf("a") }),
  );
  expect(marks("easel:")).toEqual(["easel:change:a:1", "easel:open", "easel:change:a:2"]);
});
