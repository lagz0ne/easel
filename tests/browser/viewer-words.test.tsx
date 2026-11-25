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
import { type TeamTexts, teamTexts } from "@/kit/texts";
import { Canvas } from "@/viewer/canvas";

const canvas = "words";
const restMs = 120;

const probeScript = (id: string) =>
  `<script>(()=>{addEventListener("message",(e)=>{if(e.source!==parent||!e.data||typeof e.data.probe!=="number")return;const marks=CSS.highlights.get("easel-missing");parent.postMessage({probe:e.data.probe,id:${JSON.stringify(id)},text:document.body.innerText.replace(/\\s+/g," ").trim(),lang:document.documentElement.lang,marked:marks?[...marks].map((r)=>r.toString()):[]},"*")})})()</script>`;

const checkout = `<h1>Your order</h1>
<button data-easel-text="trial.start">Start</button>
<span data-easel-text="plan.name">Pro plan</span>
<span data-easel-text="no.such">Own words</span>
<p><span data-easel-text="cart.items" data-easel-count="1">items</span>, <span data-easel-text="cart.items" data-easel-count="3">items</span></p>`;

const plain = "<h1>Your order</h1><p>Pay now</p>";

const appJs = (id: string) =>
  `const p=document.body.appendChild(document.createElement("p"));p.textContent="Dùng thử | \\u2068No people yet\\u2069";let port=null;const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};addEventListener("message",(e)=>{if(e.source!==parent)return;if(e.ports[0]&&!port){port=e.ports[0];port.postMessage({easel:"axes",locales:["en","vi"],config:{}})}const d=e.data;if(!d||typeof d.probe!=="number")return;const marks=CSS.highlights.get("easel-missing");parent.postMessage({probe:d.probe,id:${JSON.stringify(id)},text:p.textContent,lang:document.documentElement.lang,marked:marks?[...marks].map((r)=>r.toString()):[]},"*")});hello();`;

const noRuntime = { address: "/api/runtime/1/none/", imports: {} };

type ServedDoc = {
  version: number;
  html: string;
  app?: { js: string; kit: number; runtime: typeof noRuntime };
};

const htmls = new Map<string, ServedDoc>();

const loadDocs = operation({
  label: "test.wordsDocs",
  input: z.object({ canvas: z.string() }).catchall(z.unknown()),
  run: (_, { input }) => {
    const id = typeof input.id === "string" ? input.id : "";
    const doc = htmls.get(id);

    return doc ? [{ canvas: input.canvas, id, ...doc, css: "" }] : [];
  },
});

const shown = z.object({ id: z.string(), x: z.number(), html: z.string(), app: z.boolean() });

const put = operation({
  label: "test.wordsPut",
  input: shown,
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async ({ cells, invalidate }, { input: { id, x, html, app } }) => {
    htmls.set(
      id,
      app
        ? { version: 1, html: "", app: { js: appJs(id), kit: 1, runtime: noRuntime } }
        : { version: 1, html: html + probeScript(id) },
    );
    const box = { x, y: 0, w: 320, h: 200 };
    const shell = { canvas, page: "page-1", name: `Frame ${id}`, version: 1 };
    cells.set({ ...shell, ...box, id, status: "exploring" });
    await invalidate.run({ input: { docs: { canvas, id } } });
  },
});

const setTexts = operation({
  label: "test.wordsTexts",
  input: z.object({ kit: z.number(), texts: teamTexts }),
  depends: { cells: kitCells.atScope.controller },
  run: async ({ cells }, { input: { kit, texts } }) =>
    cells.set({ canvas, kit, look: ":root{}", css: "", pieces: [], texts }),
});

const team: TeamTexts = {
  "trial.start": { en: "Start", vi: "Bắt đầu" },
  "plan.name": { en: "Pro plan" },
  "cart.items": {
    en: { one: "{count} item", other: "{count} items" },
    vi: { one: "{count} món", other: "{count} món" },
  },
};

async function boot(docs: Array<z.infer<typeof shown>>, texts: TeamTexts = team) {
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

  await server.run(setTexts, { input: { kit: 1, texts } });
  for (const doc of docs) await server.run(put, { input: doc });
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
  return { clock };
}

const rafs = (n: number) =>
  new Promise<void>((done) => {
    const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : done());
    step(n);
  });

const region = () => page.getByRole("region", { name: "Frames" }).element();

const docOf = (id: string) =>
  [...region().querySelectorAll<HTMLIFrameElement>("iframe.e-doc:not([data-closing])")].find(
    (d) => d.dataset.id === id,
  );

async function rested(at: Awaited<ReturnType<typeof tab>>, n: number) {
  await expect.poll(() => region().querySelectorAll('[role="group"]').length).toBe(n);
  await rafs(2);
  at.clock.advance(restMs);
  await rafs(n + 6);
  await expect.poll(() => (docOf("a") ? 1 : 0)).toBe(1);
}

const probeAnswer = z.object({
  probe: z.number(),
  id: z.string(),
  text: z.string(),
  lang: z.string(),
  marked: z.array(z.string()),
});

type Shown = Omit<z.infer<typeof probeAnswer>, "probe" | "id">;

let probes = 0;

function probe(id: string) {
  const asked = ++probes;
  return new Promise<Shown | null>((done) => {
    const answer = (event: MessageEvent) => {
      const read = probeAnswer.safeParse(event.data);
      if (!read.success || read.data.probe !== asked) return;
      removeEventListener("message", answer);
      done({ text: read.data.text, lang: read.data.lang, marked: read.data.marked });
    };
    addEventListener("message", answer);
    setTimeout(() => {
      removeEventListener("message", answer);
      done(null);
    }, 500);
    docOf(id)?.contentWindow?.postMessage({ probe: asked }, "*");
  });
}

const statesButton = () => page.getByRole("button", { name: "States" });

async function chooseLocale(code: string) {
  const name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  await statesButton().click();
  await page.getByRole("group", { name: "locale" }).getByRole("menuitemradio", { name }).click();
  await expect.poll(() => page.getByRole("menu", { name: "States" }).elements()).toHaveLength(0);
}

test("L13, L14: an HTML frame shows the text of each data-easel-text in the locale; in vi each text with no vi text has the mark, and in en no text has it", async () => {
  const at = await tab(await boot([{ id: "a", x: 0, html: checkout, app: false }]));
  await rested(at, 1);

  await expect.poll(() => statesButton().element().getAttribute("title")).toContain("locale en");
  await expect
    .poll(() => probe("a"))
    .toEqual({
      text: "Your order Start Pro plan Own words 1 item, 3 items",
      lang: "en",
      marked: [],
    });

  await chooseLocale("vi");
  await expect
    .poll(() => probe("a"))
    .toEqual({
      text: "Your order Bắt đầu Pro plan Own words 1 món, 3 món",
      lang: "vi",
      marked: ["Pro plan", "Own words", "Your order"],
    });

  await chooseLocale("en");
  await expect.poll(async () => (await probe("a"))?.marked).toEqual([]);
});

test("L14: after a change of the texts, a live HTML frame with data-easel-text shows the new text within 1 s, and its mark goes", async () => {
  const server = await boot([{ id: "a", x: 0, html: checkout, app: false }]);
  const at = await tab(server);
  await rested(at, 1);
  await chooseLocale("vi");
  await expect.poll(async () => (await probe("a"))?.marked).toContain("Pro plan");

  const sent = performance.now();
  const given = { ...team, "plan.name": { en: "Pro plan", vi: "Gói Pro" } };
  await server.run(setTexts, { input: { kit: 2, texts: given } });
  await expect
    .poll(async () => (await probe("a"))?.text, { timeout: 1_000, interval: 20 })
    .toContain("Bắt đầu Gói Pro");
  console.log(
    `speed: L14 a live HTML frame showed the new text ${(performance.now() - sent).toFixed(0)} ms after the write`,
  );
  expect((await probe("a"))?.marked).not.toContain("Gói Pro");
});

test("L13: in vi, an app frame marks each text between U+2068 and U+2069, the en text that say gives for a text key with no vi text", async () => {
  const at = await tab(await boot([{ id: "a", x: 0, html: "", app: true }]));
  await rested(at, 1);

  await chooseLocale("vi");
  await expect.poll(async () => (await probe("a"))?.marked).toEqual(["No people yet"]);
  expect((await probe("a"))?.lang).toBe("vi");
});

test("an HTML frame with no data-easel-text in en gets no words script; with no vi text in the team and no frame that offers a locale, the dock has no locale pick", async () => {
  const at = await tab(
    await boot([{ id: "a", x: 0, html: plain, app: false }], { "plan.name": { en: "Pro plan" } }),
  );
  await rested(at, 1);

  expect(docOf("a")?.srcdoc).not.toContain("easel-words-data");
  await expect.element(page.getByRole("button", { name: "Pages" })).toBeVisible();
  const titles = statesButton()
    .elements()
    .map((button) => button.getAttribute("title") ?? "");
  expect(titles.filter((title) => title.includes("locale"))).toEqual([]);
});
