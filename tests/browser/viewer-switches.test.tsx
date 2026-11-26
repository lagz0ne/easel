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

const light = "rgb(17, 34, 51)";
const dark = "rgb(221, 238, 255)";

const probeScript = (id: string, read: string) =>
  `<script>(()=>{const me=Math.random();addEventListener("message",(e)=>{if(e.source!==parent||!e.data||typeof e.data.probe!=="number")return;parent.postMessage({probe:e.data.probe,id:${JSON.stringify(id)},me,color:${read}},"*")})})()</script>`;

const colorRead = `getComputedStyle(document.getElementById("t")).color`;

const schemeDoc = (id: string) =>
  `<style>#t{color:#112233}@media (prefers-color-scheme: dark){#t{color:#ddeeff}}</style><p id="t">${id}</p>${probeScript(id, colorRead)}`;

const kitLook =
  ":root {\n  color-scheme: light dark;\n  --foreground: light-dark(#112233, #ddeeff);\n}\n";

const kitDoc = (id: string) =>
  `<!doctype html>\n<style id="easel-look">${kitLook}</style>\n<style id="easel-kit">@layer base { html { color-scheme: light; } body { color: var(--foreground); } }</style>\n<p id="t">${id}</p>${probeScript(id, colorRead)}`;

const plainDoc = (id: string) =>
  `<style>#t{color:#112233}</style><p id="t">${id}</p>${probeScript(id, colorRead)}`;

const axesJs = (id: string, offer: string) =>
  `const me=Math.random();let port=null;const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};addEventListener("message",(e)=>{if(e.source!==parent)return;if(e.ports[0]&&!port){port=e.ports[0];port.postMessage(${offer})}const d=e.data;if(d&&typeof d.probe==="number")parent.postMessage({probe:d.probe,id:${JSON.stringify(id)},me,color:document.getElementById("easel-axes").textContent},"*")});hello();`;

const planJs = (id: string) =>
  axesJs(
    id,
    `{easel:"axes",locales:[],config:{plan:{values:["free","pro"],default:"free",name:"billing.plan"}}}`,
  );

const fixturesJs = (id: string) =>
  axesJs(id, `{easel:"axes",locales:[],config:{},fixtures:["empty","many"]}`);

const noRuntime = { address: "/api/runtime/1/none/", imports: {} };

type Kind = "scheme" | "plain" | "plan" | "fixtures" | "kit";

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

    return doc ? [{ canvas: input.canvas, id, ...doc, css: doc.app ? "" : null }] : [];
  },
});

const appJs = { plan: planJs, fixtures: fixturesJs };

const docOfKind = (id: string, kind: Kind): ServedDoc =>
  kind === "plan" || kind === "fixtures"
    ? { version: 1, html: "", app: { js: appJs[kind](id), kit: 1, runtime: noRuntime } }
    : { version: 1, html: { scheme: schemeDoc, plain: plainDoc, kit: kitDoc }[kind](id) };

const put = operation({
  label: "test.put",
  input: z.object({
    id: z.string(),
    x: z.number(),
    kind: z.enum(["scheme", "plain", "plan", "fixtures", "kit"]),
  }),
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async ({ cells, invalidate }, { input: { id, x, kind } }) => {
    htmls.set(id, docOfKind(id, kind));
    cells.set({
      id,
      x,
      y: 0,
      canvas,
      page: "page-1",
      name: `Frame ${id}`,
      w: 320,
      h: 200,
      version: 1,
      status: "exploring",
    });
    await invalidate.run({ input: { docs: { canvas, id } } });
  },
});

const setKit = operation({
  label: "test.setKit",
  depends: { cells: kitCells.atScope.controller },
  run: async ({ cells }) =>
    cells.set({ canvas, kit: 1, look: ":root{}", css: "", pieces: [], texts: {} }),
});

async function boot(ids: Array<{ id: string; x: number; kind: Kind }>) {
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
  await server.run(setKit);
  for (const f of ids) await server.run(put, { input: f });

  return server;
}

async function noSchemeEmulation() {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "" }],
  });
}

function address(search: string) {
  const url = new URL(startUrl);
  url.search = search;
  history.replaceState(history.state, "", url);
  onTestFinished(() => history.replaceState(history.state, "", startUrl));
}

async function tab(server: Scope.Handle) {
  await page.viewport(1200, 800);
  await noSchemeEmulation();
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

const docs = () => [
  ...region().querySelectorAll<HTMLIFrameElement>("iframe.e-doc:not([data-closing])"),
];

const docOf = (id: string) => docs().find((d) => d.dataset.id === id);

async function rested(at: Awaited<ReturnType<typeof tab>>, n: number) {
  await expect.poll(() => region().querySelectorAll('[role="group"]').length).toBe(n);
  await rafs(2);
  at.clock.advance(restMs);
  await rafs(n + 6);
  await expect.poll(() => docs().length).toBe(n);
}

const probeAnswer = z.object({
  probe: z.number(),
  id: z.string(),
  me: z.number(),
  color: z.string(),
});

let probes = 0;

function probe(id: string) {
  const asked = ++probes;
  return new Promise<z.infer<typeof probeAnswer> | null>((done) => {
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
  const last: { answer: z.infer<typeof probeAnswer> | null } = { answer: null };
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

const statesButton = () => page.getByRole("button", { name: "States" });
const statesMenu = () => page.getByRole("menu", { name: "States" });
const addressOf = (name: string) => new URLSearchParams(location.search).get(name);

const frameButton = (id: string) => page.getByRole("button", { name: `States of Frame ${id}` });
const frameMenu = (id: string) => page.getByRole("menu", { name: `States of Frame ${id}` });

async function chooseFrameState(id: string, name: string, value: string) {
  await frameButton(id).click();
  await frameMenu(id)
    .getByRole("menuitemradio", { name: `${name} ${value}` })
    .click();
  await expect.poll(() => frameMenu(id).elements()).toHaveLength(0);
}

async function frameStateOf(id: string, name: string) {
  await frameButton(id).click();
  const checked = frameMenu(id)
    .getByRole("menuitemradio")
    .elements()
    .filter((item) => item.getAttribute("aria-checked") === "true")
    .map((item) => item.getAttribute("aria-label") ?? "")
    .filter((label) => label.startsWith(`${name} `));
  await frameButton(id).click();
  await expect.poll(() => frameMenu(id).elements()).toHaveLength(0);
  return checked.map((label) => label.slice(name.length + 1));
}

async function chooseState(name: string, value: string) {
  await statesButton().click();
  await statesMenu()
    .getByRole("menuitemradio", { name: `${name} ${value}` })
    .click();
  await expect.poll(() => statesMenu().elements()).toHaveLength(0);
}

test("X6 board-switch: one pick of dark in the dock shows each frame that follows the color scheme in dark within 1 s, in the same document; a frame that does not take theme does not change; the address keeps theme=dark", async () => {
  address("");
  const server = await boot([
    { id: "s", x: 0, kind: "scheme" },
    { id: "p", x: 400, kind: "plain" },
  ]);
  const at = await tab(server);
  await rested(at, 2);

  await expect.element(statesButton()).toBeVisible();
  await expect.poll(() => colorOf("s")).toBe(light);
  const [scheme, plain] = [await drawnOf("s"), await drawnOf("p")];
  expect(docOf("p")?.style.colorScheme).toBe("");

  await statesButton().click();
  const items = statesMenu().getByRole("menuitemradio");
  expect(items.elements().map((item) => item.getAttribute("aria-label"))).toEqual([
    "theme light",
    "theme dark",
  ]);
  expect(items.elements().map((item) => item.getAttribute("aria-checked"))).toEqual([
    "true",
    "false",
  ]);
  await statesMenu().getByRole("menuitemradio", { name: "theme dark" }).click();
  const picked = performance.now();
  await expect.poll(() => docOf("s")?.style.colorScheme).toBe("dark");
  await expect.poll(() => colorOf("s"), { timeout: 1000 }).toBe(dark);
  console.log(`speed: dark shows ${(performance.now() - picked).toFixed(0)} ms after the pick`);

  expect(await drawnOf("s")).toBe(scheme);
  expect(await drawnOf("p")).toBe(plain);
  expect(await colorOf("p")).toBe(light);
  expect(docOf("p")?.style.colorScheme).toBe("");
  expect(addressOf("theme")).toBe("dark");

  await chooseState("theme", "light");
  await expect.poll(() => colorOf("s")).toBe(light);
  expect(addressOf("theme")).toBe("light");
});

test("SPEC-pieces decision 5: a kit frame whose look has light-dark() values shows the light value with no pick, as its iframe has the color-scheme light; a pick of dark shows the dark value, and light the light value again", async () => {
  address("");
  const server = await boot([{ id: "k", x: 0, kind: "kit" }]);
  const at = await tab(server);
  await rested(at, 1);

  await expect.poll(() => docOf("k")?.style.colorScheme).toBe("light");
  await expect.poll(() => colorOf("k")).toBe(light);

  await chooseState("theme", "dark");
  await expect.poll(() => colorOf("k"), { timeout: 1000 }).toBe(dark);

  await chooseState("theme", "light");
  await expect.poll(() => colorOf("k")).toBe(light);
});

test("SPEC-pieces decision 5 in a viewer page that is dark, as on a dark OS: the look block has color-scheme: light dark, but the iframe of a kit frame has the color-scheme of its theme, so light stays light and dark is dark", async () => {
  address("?theme=light");
  document.documentElement.style.colorScheme = "dark";
  onTestFinished(() => {
    document.documentElement.style.removeProperty("color-scheme");
  });
  const server = await boot([{ id: "k", x: 0, kind: "kit" }]);
  const at = await tab(server);
  await rested(at, 1);

  expect(getComputedStyle(document.body).colorScheme).toBe("dark");
  await expect.poll(() => docOf("k")?.style.colorScheme).toBe("light");
  await expect.poll(() => colorOf("k")).toBe(light);

  await chooseState("theme", "dark");
  await expect.poll(() => colorOf("k"), { timeout: 1000 }).toBe(dark);

  await chooseState("theme", "light");
  await expect.poll(() => docOf("k")?.style.colorScheme).toBe("light");
  await expect.poll(() => colorOf("k")).toBe(light);
});

test("X9 board-switch: a tag of the team in the config of an app frame gets its group in the dock with the values of its parse; a pick draws the frame again in a new scope with the value", async () => {
  address("");
  const server = await boot([
    { id: "a", x: 0, kind: "plan" },
    { id: "p", x: 400, kind: "plain" },
  ]);
  const at = await tab(server);
  await rested(at, 2);

  await expect.element(statesButton()).toBeVisible();
  expect(await colorOf("a")).toBe("{}");
  const [first, plain] = [await drawnOf("a"), await drawnOf("p")];

  await statesButton().click();
  await expect
    .poll(() =>
      statesMenu()
        .getByRole("menuitemradio")
        .elements()
        .map((item) => item.getAttribute("aria-label")),
    )
    .toEqual(["billing.plan free", "billing.plan pro"]);
  await statesMenu().getByRole("menuitemradio", { name: "billing.plan pro" }).click();

  await expect.poll(() => colorOf("a"), { timeout: 1000 }).toBe('{"config":{"plan":"pro"}}');
  expect(await drawnOf("a")).not.toBe(first);
  expect(await drawnOf("p")).toBe(plain);
  expect(addressOf("billing.plan")).toBe("pro");
  expect(await frameStateOf("a", "billing.plan")).toEqual(["Use the board"]);
  expect(frameButton("a").element().hasAttribute("data-own")).toBe(false);
});

test("X10 board-switch: an app frame that names its fixtures gets the fixture switch, with initial first; a pick draws the frame again with the fixture in its axes", async () => {
  address("");
  const server = await boot([{ id: "a", x: 0, kind: "fixtures" }]);
  const at = await tab(server);
  await rested(at, 1);

  await expect.element(statesButton()).toBeVisible();
  expect(await colorOf("a")).toBe("{}");

  await statesButton().click();
  await expect
    .poll(() =>
      statesMenu()
        .getByRole("menuitemradio")
        .elements()
        .map((item) => item.getAttribute("aria-label")),
    )
    .toEqual(["fixture initial", "fixture empty", "fixture many"]);
  await statesMenu().getByRole("menuitemradio", { name: "fixture many" }).click();

  await expect.poll(() => colorOf("a"), { timeout: 1000 }).toBe('{"fixture":"many","config":{}}');
  expect(addressOf("fixture")).toBe("many");

  await chooseFrameState("a", "fixture", "empty");
  await expect.poll(() => colorOf("a")).toBe('{"fixture":"empty","config":{}}');

  await chooseFrameState("a", "fixture", "initial");
  await expect.poll(() => colorOf("a")).toBe("{}");
});

test("X7 X8 board-switch: a frame value wins over the board value; a link with the board value and a frame value opens each frame in that state", async () => {
  address("?theme=dark&billing.plan=pro&f.a.billing.plan=free&page=page-1");
  const server = await boot([
    { id: "a", x: 0, kind: "plan" },
    { id: "s", x: 400, kind: "scheme" },
  ]);
  const at = await tab(server);
  await rested(at, 2);

  await expect.poll(() => colorOf("s")).toBe(dark);
  await expect.element(frameButton("a")).toHaveTextContent("free");
  expect(frameButton("a").element().hasAttribute("data-own")).toBe(true);
  expect(await frameStateOf("a", "billing.plan")).toEqual(["free"]);
  expect(await colorOf("a")).toBe("{}");

  await chooseState("billing.plan", "free");
  await chooseState("billing.plan", "pro");
  expect(await colorOf("a")).toBe("{}");

  await chooseFrameState("a", "billing.plan", "pro");
  await expect.poll(() => colorOf("a")).toBe('{"config":{"plan":"pro"}}');
  expect(addressOf("f.a.billing.plan")).toBe("pro");
  expect(addressOf("page")).toBe("page-1");
});

test("X7 board-switch: a pick in the controls of one frame changes only that frame, and the frame says it has its own value; Use the board gives it the board value again, and a board pick then reaches it", async () => {
  address("");
  const server = await boot([
    { id: "s", x: 0, kind: "scheme" },
    { id: "t", x: 400, kind: "scheme" },
    { id: "p", x: 800, kind: "plain" },
  ]);
  const at = await tab(server);
  await rested(at, 3);

  expect(frameButton("p").elements()).toEqual([]);
  await expect.poll(() => colorOf("s")).toBe(light);
  const other = await drawnOf("t");

  await chooseFrameState("s", "theme", "dark");
  await expect.poll(() => colorOf("s"), { timeout: 1000 }).toBe(dark);
  expect(await colorOf("t")).toBe(light);
  expect(await drawnOf("t")).toBe(other);
  await expect.element(frameButton("s")).toHaveTextContent("dark");
  expect(frameButton("s").element().hasAttribute("data-own")).toBe(true);
  expect(addressOf("f.s.theme")).toBe("dark");

  await chooseState("theme", "light");
  expect(await colorOf("s")).toBe(dark);

  await chooseFrameState("s", "theme", "Use the board");
  await expect.poll(() => colorOf("s")).toBe(light);
  expect(frameButton("s").element().hasAttribute("data-own")).toBe(false);
  expect(addressOf("f.s.theme")).toBe(null);

  await chooseState("theme", "dark");
  await expect.poll(() => colorOf("s")).toBe(dark);
  expect(await colorOf("t")).toBe(dark);
});
