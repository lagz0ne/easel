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
import { type TeamTexts, teamTexts } from "@/kit/texts";
import { Canvas } from "@/viewer/canvas";

const canvas = "home";
const restMs = 120;

const looks = {
  1: { look: ":root {\n  --primary: #112233;\n}\n", rgb: "rgb(17, 34, 51)" },
  2: { look: ":root {\n  --primary: #aa0011;\n}\n", rgb: "rgb(170, 0, 17)" },
  3: { look: ":root {\n  --primary: #006644;\n}\n", rgb: "rgb(0, 102, 68)" },
} as const;

const probeDoc = (id: string) =>
  `<p id="t">${id}</p><script>(()=>{const me=Math.random();addEventListener("message",(e)=>{if(e.source!==parent||!e.data||typeof e.data.probe!=="number")return;parent.postMessage({probe:e.data.probe,id:${JSON.stringify(id)},me,color:getComputedStyle(document.getElementById("t")).color},"*")})})()</script>`;

const madeCss = "#t { color: var(--primary); }";

const probeJs = (id: string) =>
  `const t=document.body.appendChild(document.createElement("p"));t.id="t";t.textContent=${JSON.stringify(id)};const me=Math.random();addEventListener("message",(e)=>{if(e.source!==parent||!e.data||typeof e.data.probe!=="number")return;parent.postMessage({probe:e.data.probe,id:${JSON.stringify(id)},me,color:getComputedStyle(t).color},"*")});`;

const capsuleJs = (id: string) =>
  `const me=Math.random();let port=null;const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};addEventListener("message",(e)=>{if(e.source!==parent)return;if(e.ports[0]&&!port){port=e.ports[0];port.postMessage({easel:"axes",locales:["en","vi"],config:{sample:{values:["many","empty"],default:"many"}}})}const d=e.data;if(d&&typeof d.probe==="number")parent.postMessage({probe:d.probe,id:${JSON.stringify(id)},me,color:document.getElementById("easel-axes").textContent},"*")});hello();`;

const textsJs = (id: string) =>
  `const me=Math.random();let port=null;let texts=JSON.parse(document.getElementById("easel-texts").textContent);const take=(d)=>{if(d&&d.easel==="kit")texts=d.texts};const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};addEventListener("message",(e)=>{if(e.source!==parent)return;if(e.ports[0]&&!port){port=e.ports[0];port.onmessage=(m)=>take(m.data);port.postMessage({easel:"axes",locales:["en","vi"],config:{}})}take(e.data);const d=e.data;if(d&&typeof d.probe==="number")parent.postMessage({probe:d.probe,id:${JSON.stringify(id)},me,color:JSON.stringify({locale:JSON.parse(document.getElementById("easel-axes").textContent).locale??"en",texts})},"*")});hello();`;

const closerJs = (id: string) =>
  `let port=null;const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};const take=(d,via)=>{if(!d||d.easel!=="close")return;parent.postMessage({seen:"close",id:${JSON.stringify(id)},via},"*");setTimeout(()=>port?port.postMessage({easel:"closed"}):parent.postMessage({easel:"closed"},"*"),300)};addEventListener("message",(e)=>{if(e.source!==parent)return;if(e.ports[0]&&!port){port=e.ports[0];port.onmessage=(m)=>take(m.data,"port")}take(e.data,"window");if(e.data&&typeof e.data.probe==="number")parent.postMessage({probe:e.data.probe,id:${JSON.stringify(id)},me:0,color:port?"port":"none"},"*")});hello();`;

const plainControls = [
  { key: "add", label: "Add one", kind: "action" },
  { key: "on", label: "On", kind: "switch" },
  { key: "size", label: "Size", kind: "select", values: ["s", "m", "l"] },
  { key: "count", label: "Count", kind: "number", min: 0 },
  { key: "bad", label: "Fail", kind: "action" },
];

const placedControls = [
  { key: "add", label: "Add one", kind: "action", place: "right" },
  { key: "on", label: "On", kind: "switch", place: "top" },
  { key: "size", label: "Size", kind: "select", values: ["s", "m", "l"], place: "left" },
  { key: "count", label: "Count", kind: "number", min: 0, place: "panel" },
  { key: "bad", label: "Fail", kind: "action", place: "right" },
];

const controlsJs = (id: string, placed: boolean) =>
  `let port=null;const s={on:false,size:"s",count:0};const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};const values=()=>port.postMessage({easel:"values",values:{on:s.on,size:s.size,count:s.count}});addEventListener("message",(e)=>{if(e.source!==parent)return;if(e.ports[0]&&!port){port=e.ports[0];port.onmessage=(m)=>{const d=m.data;if(!d||d.easel!=="control")return;parent.postMessage({seen:"control",id:${JSON.stringify(id)},key:d.key,value:d.value},"*");if(d.key==="bad"){port.postMessage({easel:"ran",key:"bad",failed:"Nope"});return}if(d.key==="add")s.count+=1;else s[d.key]=d.value;values()};port.postMessage({easel:"controls",controls:${JSON.stringify(placed ? placedControls : plainControls)}});values()}});hello();`;

const paneedJs = (id: string) =>
  `const me=Math.random();let port=null;const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};const pane=document.getElementById("easel-pane");if(pane){const place=JSON.parse(pane.textContent).place;addEventListener("message",(e)=>{if(e.source!==parent||!e.ports[0]||port)return;port=e.ports[0];port.postMessage({easel:"size",w:90,h:30});port.onmessage=(m)=>{if(!m.data||m.data.easel!=="link"||!m.ports[0])return;const link=m.ports[0];link.onmessage=(r)=>parent.postMessage({seen:"pane",id:${JSON.stringify(id)},place,me:r.data.me},"*");link.postMessage({ping:place})}})}else{const link=(place)=>{const c=new MessageChannel();c.port1.onmessage=()=>c.port1.postMessage({me});port.postMessage({easel:"link",place},[c.port2])};addEventListener("message",(e)=>{if(e.source!==parent||!e.ports[0]||port)return;port=e.ports[0];port.onmessage=(m)=>{if(m.data&&m.data.easel==="link")link(m.data.place)};port.postMessage({easel:"panes",places:["top","right"]});link("top");link("right")})}hello();`;

const appJs = (
  id: string,
  kind: {
    capsule?: boolean;
    closer?: boolean;
    controls?: true | "placed";
    panes?: boolean;
    texts?: boolean;
  },
) =>
  kind.texts
    ? textsJs(id)
    : kind.panes
      ? paneedJs(id)
      : kind.controls
        ? controlsJs(id, kind.controls === "placed")
        : kind.closer
          ? closerJs(id)
          : kind.capsule
            ? capsuleJs(id)
            : probeJs(id);

const noRuntime = { address: "/api/runtime/1/none/", imports: {} };

type ServedDoc = {
  version: number;
  html: string;
  app?: { js: string; kit: number; runtime: typeof noRuntime };
};

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
    texts: z.boolean().optional(),
    version: z.number().optional(),
  }),
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async (
    { cells, invalidate },
    { input: { app, capsule, closer, controls, panes, texts, version = 1, ...input } },
  ) => {
    const js = appJs(input.id, { capsule, closer, controls, panes, texts });
    const served: ServedDoc =
      app || capsule || closer || controls || panes || texts
        ? { version, html: "", app: { js, kit: 1, runtime: noRuntime } }
        : { version, html: probeDoc(input.id) };
    htmls.set(input.id, served);
    cells.set({
      ...input,
      canvas,
      page: "page-1",
      name: `Frame ${input.id}`,
      w: 320,
      h: 200,
      version,
      status: "exploring",
    });
    await invalidate.run({ input: { docs: { canvas, id: input.id } } });
  },
});

const drop = operation({
  label: "test.drop",
  input: z.string(),
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async ({ cells, invalidate }, { input }) => {
    htmls.delete(input);
    cells.delete({ canvas, page: "page-1", id: input });
    await invalidate.run({ input: { docs: { canvas, id: input } } });
  },
});

const setKit = operation({
  label: "test.setKit",
  input: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  depends: { cells: kitCells.atScope.controller },
  run: async ({ cells }, { input }) =>
    cells.set({ canvas, kit: input, look: looks[input].look, css: "", pieces: [], texts: {} }),
});

const setTexts = operation({
  label: "test.setTexts",
  input: z.object({ kit: z.number(), texts: teamTexts }),
  depends: { cells: kitCells.atScope.controller },
  run: async ({ cells }, { input: { kit, texts } }) =>
    cells.set({ canvas, kit, look: looks[1].look, css: "", pieces: [], texts }),
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
    texts?: boolean;
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

const docs = () => [
  ...region().querySelectorAll<HTMLIFrameElement>("iframe.e-doc:not([data-closing])"),
];

const closingDocs = () => [...region().querySelectorAll<HTMLIFrameElement>("iframe[data-closing]")];
const docOf = (id: string) => docs().find((d) => d.dataset.id === id);

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

async function answerOf(id: string) {
  const last: { answer: Probe | null } = { answer: null };
  await expect
    .poll(async () => {
      last.answer = await probe(id);
      return last.answer;
    })
    .not.toBeNull();
  return last.answer;
}

const colorOf = async (id: string) => (await answerOf(id))?.color ?? "";
const drawnOf = async (id: string) => (await answerOf(id))?.me ?? -1;
const winOf = (id: string) => docOf(id)?.contentWindow ?? null;

const hello = z.object({ easel: z.literal("hello") });

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

  expect(await colorOf("a")).toBe(looks[1].rgb);
  const drawn = await drawnOf("a");
  const win = winOf("a");
  await expect.poll(() => ear.heard.filter((h) => h.from === win).length).toBeGreaterThan(3);

  await server.run(setKit, { input: 2 });
  await expect.poll(() => kitOf(at)).toBe(2);
  await tick(100);
  expect(await colorOf("a")).toBe(looks[1].rgb);

  const iframe = docOf("a");
  ear.deaf = false;
  await expect.poll(() => colorOf("a"), { timeout: 1_000 }).toBe(looks[2].rgb);
  const ported = performance.now();
  expect(docOf("a")).toBe(iframe);
  expect(await drawnOf("a")).toBe(drawn);

  await tick(300);
  const after = ear.heard.filter((h) => h.from === win && h.at > ported + 60);
  expect(after).toEqual([]);

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
  await expect.poll(() => colorOf("b")).toBe(looks[1].rgb);
  await expect.poll(() => colorOf("a")).toBe(looks[1].rgb);
});

const statesButton = () => page.getByRole("button", { name: "States" });
const statesMenu = () => page.getByRole("menu", { name: "States" });
const localeGroup = () => statesMenu().getByRole("group", { name: "locale" });

const languageOf = (code: string) =>
  new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;

async function chooseLocale(code: string) {
  await statesButton().click();
  await localeGroup()
    .getByRole("menuitemradio", { name: languageOf(code) })
    .click();
  await expect.poll(() => statesMenu().elements()).toHaveLength(0);
}

const boxOf = (el: Element) => el.getBoundingClientRect();

test("viewer-overlays States, product#27: the locale is the first group of States in the dock, not its own button; it has a radio item for each locale in its own language; a pick closes the menu, and so do a press out of it, Escape and Pages (APickClosesItsMenu, AnOutsidePressClosesAMenu, EscapeClosesTheTop, OneMenuAtMost)", async () => {
  const server = await boot([{ id: "b", x: 0, y: 0, capsule: true }]);
  const at = await tab(server);
  await rested(at, 1);

  const button = statesButton();
  const pages = page.getByRole("button", { name: "Pages" });
  await expect.element(button).toBeVisible();
  expect(page.getByRole("button", { name: "Locale" }).elements()).toEqual([]);
  expect(button.element().getAttribute("title")).toContain("locale en");

  await button.click();
  await expect.element(statesMenu()).toBeVisible();
  await expect.element(button).toHaveAttribute("aria-expanded", "true");
  const named = statesMenu()
    .getByRole("group")
    .elements()
    .flatMap((group) => group.getAttribute("aria-label") ?? []);
  expect(named).toEqual(["locale", "sample"]);
  const items = localeGroup().getByRole("menuitemradio");
  expect(items.elements().map((item) => item.getAttribute("aria-checked"))).toEqual([
    "true",
    "false",
  ]);
  expect(items.elements().map((item) => [item.getAttribute("lang"), item.textContent])).toEqual([
    ["en", `${languageOf("en")}EN`],
    ["vi", `${languageOf("vi")}VI`],
  ]);
  expect(boxOf(statesMenu().element()).bottom).toBeLessThanOrEqual(boxOf(button.element()).top);

  await localeGroup()
    .getByRole("menuitemradio", { name: languageOf("vi") })
    .click();
  await expect.poll(() => statesMenu().elements()).toHaveLength(0);
  await expect.poll(() => button.element().getAttribute("title")).toContain("locale vi");
  await expect.poll(() => colorOf("b")).toBe('{"locale":"vi","config":{}}');

  await button.click();
  await expect.element(statesMenu()).toBeVisible();
  await page.getByRole("region", { name: "Frames" }).click({ position: { x: 30, y: 140 } });
  await expect.poll(() => statesMenu().elements()).toHaveLength(0);

  await button.click();
  await expect.element(statesMenu()).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => statesMenu().elements()).toHaveLength(0);
  await expect.poll(() => document.activeElement).toBe(button.element());

  await button.click();
  await expect.element(statesMenu()).toBeVisible();
  await pages.click();
  await expect.element(page.getByRole("menu", { name: "Pages" })).toBeVisible();
  expect(statesMenu().elements()).toHaveLength(0);
  await button.click();
  await expect.element(statesMenu()).toBeVisible();
  expect(page.getByRole("menu", { name: "Pages" }).elements()).toHaveLength(0);
});

test("viewer-overlays States on a phone (390 x 844): the dock has no Locale button, it fits, each of its buttons is 40 x 40 px at least, and the States menu stays in the view", async () => {
  const server = await boot([{ id: "b", x: 0, y: 0, capsule: true }]);
  const at = await tab(server);
  await rested(at, 1);
  await page.viewport(390, 844);
  await expect.poll(() => innerWidth).toBe(390);

  const dock = page.getByRole("toolbar", { name: "Canvas" });
  await expect.element(statesButton()).toBeVisible();
  const shown = dock
    .getByRole("button")
    .elements()
    .filter((b) => boxOf(b).width > 0);
  expect(shown.map((b) => b.getAttribute("aria-label")?.replace(/ \d+%$/, ""))).toEqual([
    "Request",
    "Requests",
    "Find",
    "Pages",
    "States",
    "Zoom",
  ]);
  for (const one of shown) {
    const box = boxOf(one);
    expect([box.width >= 40, box.height >= 40], one.getAttribute("aria-label") ?? "").toEqual([
      true,
      true,
    ]);
  }
  const width = boxOf(dock.element()).width;
  console.log(`size: the dock with States is ${width.toFixed(0)} px wide at 390 px`);
  expect(width).toBeLessThan(390 - 48);

  await statesButton().click();
  await expect.element(statesMenu()).toBeVisible();
  const menu = boxOf(statesMenu().element());
  expect([menu.left >= 0, menu.right <= 390]).toEqual([true, true]);
  await localeGroup()
    .getByRole("menuitemradio", { name: languageOf("vi") })
    .click();
  await expect.poll(() => statesMenu().elements()).toHaveLength(0);
  await expect.poll(() => statesButton().element().getAttribute("title")).toContain("locale vi");
});

test("viewer-overlays Requests on a phone (390 x 844): the list opens as a bottom drawer, as in Doop and the Drawer of shadcn: full width, on the bottom edge, with round top corners and a handle, and the canvas shows above it", async () => {
  const server = await boot([{ id: "b", x: 0, y: 0, capsule: true }]);
  const at = await tab(server);
  await rested(at, 1);
  await page.viewport(390, 844);
  await expect.poll(() => innerWidth).toBe(390);

  await page.getByRole("button", { name: "Requests" }).click();
  const drawer = page.getByRole("complementary", { name: "Requests" });
  await expect.element(drawer).toBeVisible();
  const box = boxOf(drawer.element());
  const style = getComputedStyle(drawer.element());
  const handle = getComputedStyle(drawer.element(), "::before");
  console.log(`size: the drawer is ${box.height.toFixed(0)} px high at 844 px`);
  expect({
    left: box.left,
    right: box.right,
    bottom: Math.round(box.bottom),
    canvasAbove: box.top >= 844 * 0.15,
    round: [style.borderTopLeftRadius !== "0px", style.borderBottomLeftRadius],
    handle: [handle.content, handle.width, handle.height],
  }).toEqual({
    left: 0,
    right: 390,
    bottom: 844,
    canvasAbove: true,
    round: [true, "0px"],
    handle: ['""', "36px", "4px"],
  });

  const dock = page.getByRole("toolbar", { name: "Canvas" }).element();
  const dockBox = boxOf(dock);
  const onTheDock = document.elementFromPoint(
    dockBox.left + dockBox.width / 2,
    dockBox.top + dockBox.height / 2,
  );
  const lastInDrawer = drawer.element().lastElementChild;
  expect({
    dockOnTop: onTheDock !== null && dock.contains(onTheDock),
    contentAboveDock: lastInDrawer !== null && boxOf(lastInDrawer).bottom <= Math.ceil(dockBox.top),
  }).toEqual({ dockOnTop: true, contentAboveDock: true });
});

test("X1 kit-frame-axes: a capsule frame posts its axes; the page offers the locale and its data states; a pick composes it again with them, and an app frame with no axes is not drawn again", async () => {
  const server = await boot([
    { id: "a", x: 0, y: 0, app: true },
    { id: "b", x: 400, y: 0, capsule: true },
  ]);
  const at = await tab(server);
  await rested(at, 2);

  const states = page.getByRole("button", { name: "States of Frame b" });
  const statesMenu = page.getByRole("menu", { name: "States of Frame b" });
  const pickSample = async (value: string) => {
    await states.click();
    await statesMenu.getByRole("menuitemradio", { name: `sample ${value}` }).click();
    await expect.poll(() => statesMenu.elements()).toHaveLength(0);
  };
  await expect.element(statesButton()).toBeVisible();
  await expect.element(states).toBeVisible();
  expect(page.getByRole("button", { name: "States of Frame a" }).elements()).toEqual([]);
  expect(await colorOf("b")).toBe("{}");
  const [plain, first] = [await drawnOf("a"), await drawnOf("b")];

  await chooseLocale("vi");
  await expect.poll(() => colorOf("b")).toBe('{"locale":"vi","config":{}}');
  expect(await drawnOf("b")).not.toBe(first);
  expect(await drawnOf("a")).toBe(plain);

  await pickSample("empty");
  await expect.poll(() => colorOf("b")).toBe('{"locale":"vi","config":{"sample":"empty"}}');
  await chooseLocale("en");
  await pickSample("many");
  await expect.poll(() => colorOf("b")).toBe("{}");
  expect(await drawnOf("a")).toBe(plain);
});

const firstTexts: TeamTexts = {
  "trial.start": { en: "Start the trial", vi: "Dùng thử" },
  "people.empty": { en: "No people yet" },
};

const changedTexts: TeamTexts = {
  "trial.start": { en: "Try it free", vi: "Dùng thử miễn phí" },
  "people.empty": { en: "No people yet" },
};

const shownTexts = (locale: string, texts: TeamTexts) => JSON.stringify({ locale, texts });

test("L5: after one change of the texts, a live app frame gets the new texts within 1 s on its port, in the same document, with no new frame version", async () => {
  const server = await boot([{ id: "t", x: 0, y: 0, texts: true }]);
  await server.run(setTexts, { input: { kit: 1, texts: firstTexts } });
  const at = await tab(server);
  await rested(at, 1);

  await expect.poll(() => colorOf("t")).toBe(shownTexts("en", firstTexts));
  const [iframe, drawn, doc] = [docOf("t"), await drawnOf("t"), docOf("t")?.srcdoc];
  expect(doc).toContain(
    `<script type="application/json" id="easel-texts">${JSON.stringify(firstTexts)}</script>`,
  );

  const sent = performance.now();
  await server.run(setTexts, { input: { kit: 2, texts: changedTexts } });
  await expect
    .poll(() => colorOf("t"), { timeout: 1_000, interval: 10 })
    .toBe(shownTexts("en", changedTexts));
  console.log(
    `speed: L5 one live document had the new texts ${(performance.now() - sent).toFixed(0)} ms after the write`,
  );
  expect(docOf("t")).toBe(iframe);
  expect(docOf("t")?.srcdoc).toBe(doc);
  expect(await drawnOf("t")).toBe(drawn);
  expect(
    at.scope.resolve(frames.board.frames.of({ canvas, page: "page-1", id: "t" })).get()?.version,
  ).toBe(1);
});

test("L12: the locale pick vi composes the app frame again with the locale vi and the texts of the kit", async () => {
  const server = await boot([{ id: "t", x: 0, y: 0, texts: true }]);
  await server.run(setTexts, { input: { kit: 2, texts: changedTexts } });
  const at = await tab(server);
  await rested(at, 1);

  await chooseLocale("vi");
  await expect.poll(() => colorOf("t")).toBe(shownTexts("vi", changedTexts));
  expect(docOf("t")?.srcdoc).toContain(`id="easel-texts">${JSON.stringify(changedTexts)}</script>`);
});

const seenClose = z.object({ seen: z.literal("close"), id: z.string(), via: z.string() });

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

test("X1, X2, X4 kit-frame-controls: an app frame posts its controls; the panel draws them with its values; each change goes to the live document and shows its new values within 1 s; a refused change changes nothing and says why; a new document starts them again", async () => {
  const seen = controlsSeen();
  const server = await boot([
    { id: "a", x: 0, y: 0, controls: true },
    { id: "b", x: 400, y: 0 },
  ]);
  const at = await tab(server);
  await rested(at, 2);

  const button = page.getByRole("button", { name: "Controls of Frame a" });
  await expect.element(button).toBeInTheDocument();
  expect(page.getByRole("button", { name: "Controls of Frame b" }).elements()).toEqual([]);
  await button.click();
  const panel = page.getByRole("complementary", { name: "Controls" });
  await expect.element(panel.getByText("Frame a", { exact: true })).toBeInTheDocument();
  await expect.element(button).toHaveAttribute("aria-pressed", "true");
  const iframe = docOf("a");

  const on = panel.getByRole("switch", { name: "On" });
  const size = panel.getByRole("combobox", { name: "Size" });
  const count = panel.getByRole("spinbutton", { name: "Count" });
  await expect.element(on).not.toBeChecked();
  await expect.element(size).toHaveValue("s");
  await expect.element(count).toHaveValue(0);

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

  await panel.getByRole("button", { name: "Fail" }).click();
  await expect.element(panel.getByRole("alert")).toHaveTextContent("The frame refused it: Nope.");
  await expect.element(count).toHaveValue(7);
  await expect.element(on).toBeChecked();
  expect(docOf("a")).toBe(iframe);

  await server.run(put, { input: { id: "a", x: 0, y: 0, controls: true, version: 2 } });
  await expect.poll(() => docOf("a")?.dataset.version).toBe("2");
  await expect.element(size).toHaveValue("s");
  await expect.element(count).toHaveValue(0);
  expect(panel.getByRole("alert").elements()).toEqual([]);
  await panel.getByRole("button", { name: "Add one" }).click();
  await expect.element(count).toHaveValue(1);
  await expect.poll(() => seen.length).toBe(6);

  await page.getByRole("button", { name: "Requests" }).click();
  await expect.element(panel).not.toBeInTheDocument();
  await expect.element(button).toHaveAttribute("aria-pressed", "false");
});

function shellOf(id: string) {
  const shell = region().querySelector<HTMLElement>(`.e-shell[data-id="${id}"]`);
  if (!shell) throw new Error(`no shell ${id}`);
  return shell;
}

const long = "alpha-with-a-long-name";

test("X5 kit-frame-controls places: the frame places each control in its label row, in a column at its left or right edge, or in the panel, at the same size at each zoom; each place shows the same live values", async () => {
  const seen = controlsSeen();
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
  await userEvent.hover(shellOf(long));
  await expect.element(right).toBeVisible();
  await expect.element(left).toBeVisible();
  await expect.element(on).not.toBeChecked();
  await expect.element(size).toHaveValue("s");
  expect(
    right
      .getByRole("button")
      .elements()
      .map((b) => b.textContent),
  ).toEqual(["Add one", "Fail"]);

  const shell = shellOf(long);
  expect(shell.querySelector("[data-label]")?.contains(on.element())).toBe(true);
  const button = page
    .getByRole("button", { name: `Controls of Frame ${long}`, exact: true })
    .element();
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

  const sizeOf = (el: Element) => {
    const box = el.getBoundingClientRect();
    return { w: Math.round(box.width), h: Math.round(box.height) };
  };
  const placed = [on.element(), left.element(), right.element()];
  const before = placed.map(sizeOf);
  const zoom = page.getByRole("status", { name: "Zoom" });
  const zoomBefore = zoom.element().textContent;
  await page.getByRole("button", { name: /^Zoom \d/ }).click();
  await page.getByRole("menuitem", { name: /^Zoom in/ }).click();
  await expect.poll(() => zoom.element().textContent).not.toBe(zoomBefore);
  await expect
    .poll(() => shellOf(long).getBoundingClientRect().width)
    .toBeGreaterThan(frameBox.width);
  expect(placed.map(sizeOf)).toEqual(before);

  await right.getByRole("button", { name: "Add one" }).click();
  await on.click();
  await size.selectOptions("m");
  await expect.element(on).toBeChecked();

  await right.getByRole("button", { name: "Fail" }).click();
  await expect.element(right.getByRole("alert")).toHaveTextContent("The frame refused it: Nope.");

  await page.getByRole("button", { name: `Controls of Frame ${long}`, exact: true }).click();
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

const foldDelayMs = 300;

const cornerOf = (el: Element) => {
  const box = boxOf(el);
  return { x: box.width - 6, y: box.height - 6 };
};

const hitAt = (x: number, y: number) => document.elementFromPoint(x, y);

test("kit-control-fold: a side column folds to its tab while its frame is not in use, so the frame beside it can be pressed; the pointer on the frame opens it, the way to the column keeps it open, a control in it runs, and it folds 300 ms after the pointer leaves (OpenOnlyInUse, OutOfUseItFolds, FromTheFrameToTheColumnItStaysOpen, AControlCanBePressed)", async () => {
  const seen = controlsSeen();
  const server = await boot([
    { id: "p", x: 0, y: 0, controls: "placed" },
    { id: "n", x: 360, y: 0 },
  ]);
  const at = await tab(server);
  await rested(at, 2);

  const tabOf = page.getByRole("button", { name: "Right controls of Frame p" });
  const column = page.getByRole("group", { name: "Right controls of Frame p" });
  const col = shellOf("p").querySelector(".e-ctl-right .e-ctl-col");
  if (!col) throw new Error("no right column");
  await expect.element(tabOf).toHaveAttribute("aria-expanded", "false");
  await expect.element(tabOf).toHaveTextContent("2");
  expect(getComputedStyle(col).visibility).toBe("hidden");
  const over = boxOf(col);
  const spot = { x: over.left + over.width / 2, y: over.top + over.height / 2 };
  expect(shellOf("n").contains(hitAt(spot.x, spot.y))).toBe(true);
  const tabBox = boxOf(tabOf.element());
  expect(tabBox.left).toBeGreaterThanOrEqual(boxOf(shellOf("p")).right);
  expect(tabBox.width).toBeLessThan(48);

  await userEvent.hover(shellOf("p"));
  await expect.element(tabOf).toHaveAttribute("aria-expanded", "true");
  await expect.element(column).toBeVisible();
  expect(col.contains(hitAt(spot.x, spot.y))).toBe(true);
  const edge = boxOf(shellOf("p")).right;
  const way = Array.from({ length: 12 }, (_, i) => edge - 2 + i);
  expect(way.filter((x) => !shellOf("p").contains(hitAt(x, over.top + 12)))).toEqual([]);

  await column.getByRole("button", { name: "Add one" }).click();
  await expect.poll(() => seen).toEqual([{ key: "add" }]);
  await expect.element(tabOf).toHaveAttribute("aria-expanded", "true");

  await userEvent.hover(shellOf("n"), { position: cornerOf(shellOf("n")) });
  await rafs(2);
  expect(tabOf.element()).toHaveAttribute("aria-expanded", "true");
  at.clock.advance(foldDelayMs - 10);
  await rafs(2);
  expect(tabOf.element()).toHaveAttribute("aria-expanded", "true");
  await userEvent.hover(shellOf("p"));
  at.clock.advance(foldDelayMs);
  await rafs(2);
  expect(tabOf.element()).toHaveAttribute("aria-expanded", "true");

  await userEvent.hover(shellOf("n"), { position: cornerOf(shellOf("n")) });
  at.clock.advance(foldDelayMs);
  await expect.element(tabOf).toHaveAttribute("aria-expanded", "false");
  expect(getComputedStyle(col).visibility).toBe("hidden");
  expect(shellOf("n").contains(hitAt(spot.x, spot.y))).toBe(true);
});

test("kit-control-fold: from the tab, one press opens a folded column; it stays open while the shown focus is in it, and folds when the focus leaves; a press out of it folds it; the mark of Find opens it (OnePressOnTheTabOpens, OutOfUseItFolds)", async () => {
  const server = await boot([
    { id: "p", x: 0, y: 0, controls: "placed" },
    { id: "n", x: 360, y: 0 },
  ]);
  const at = await tab(server);
  await rested(at, 2);

  const tabOf = page.getByRole("button", { name: "Right controls of Frame p" });
  const column = page.getByRole("group", { name: "Right controls of Frame p" });
  const away = () => userEvent.hover(shellOf("n"), { position: cornerOf(shellOf("n")) });
  await away();
  at.clock.advance(foldDelayMs);

  tabOf.element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(tabOf).toHaveAttribute("aria-expanded", "true");
  await userEvent.tab();
  await expect.poll(() => document.activeElement?.textContent).toBe("Add one");
  await userEvent.tab();
  await expect.poll(() => document.activeElement?.textContent).toBe("Fail");
  expect(tabOf.element()).toHaveAttribute("aria-expanded", "true");
  await userEvent.tab();
  await expect.element(tabOf).toHaveAttribute("aria-expanded", "false");

  tabOf.element().focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(column).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(tabOf).toHaveAttribute("aria-expanded", "false");
  await userEvent.keyboard("{Enter}");
  await expect.element(tabOf).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(shellOf("n"), { position: cornerOf(shellOf("n")) });
  await expect.element(tabOf).toHaveAttribute("aria-expanded", "false");

  await page.getByRole("button", { name: "Find" }).click();
  await userEvent.keyboard("Frame p{Enter}");
  await expect.poll(() => shellOf("p").hasAttribute("data-found")).toBe(true);
  await expect.element(tabOf).toHaveAttribute("aria-expanded", "true");
  at.clock.advance(foldDelayMs);
  await rafs(2);
  expect(tabOf.element()).toHaveAttribute("aria-expanded", "true");
});

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

test("X3 kit-control-link: the page draws an iframe for each pane of a frame's current document, at its place and the size of its content, and gives each link of the frame to its pane, unread; a new document gives new links", async () => {
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

  const placesOf = (me?: number) =>
    [
      ...new Set(seen.filter((one) => me === undefined || one.me !== me).map((one) => one.place)),
    ].sort();
  await expect.poll(() => placesOf()).toEqual(["right", "top"]);
  const first = seen[0]?.me;

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
  expect(cards.map((id) => picOf(id))).toEqual(imgs);
  for (const id of cards) {
    expect(region().querySelector(`[data-id="${id}"] .e-card`)?.hasAttribute("hidden")).toBe(false);
  }
  expect(cards.map((id) => picOf(id)?.getAttribute("src")?.split("?")[0])).toEqual(
    cards.map((id) => `/api/pictures/${canvas}/${id}/1`),
  );
});

const paintPost = z.object({ easel: z.literal("painted"), v: z.number() });

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

  at.clock.advance(1_500);
  await tick();
  expect(marks("easel:")).toEqual([]);

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

  gate.shut = true;
  await server.run(put, { input: { id: "a", x: 0, y: 0, version: 2 } });
  await expect.poll(() => gate.held.length).toBe(1);
  at.clock.advance(1_500);
  await tick();
  expect(marks("easel:change:a:")).toEqual(["easel:change:a:1"]);

  gate.release();
  expect(marks("easel:change:a:")).toEqual(["easel:change:a:1", "easel:change:a:2"]);
  dispatchEvent(
    new MessageEvent("message", { data: { easel: "painted", v: 2 }, source: winOf("a") }),
  );
  expect(marks("easel:")).toEqual(["easel:change:a:1", "easel:open", "easel:change:a:2"]);
});
