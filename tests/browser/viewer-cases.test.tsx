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
import { Canvas } from "@/viewer/canvas";

const canvas = "home";
const restMs = 120;
const startUrl = location.href;

const offer = `{easel:"axes",locales:[],config:{theme:{values:["light","dark"],default:"light",name:"theme"}},fixtures:["empty","many"]}`;

const appJs = (id: string) =>
  `const me=Math.random();let port=null;const hello=()=>{if(port)return;parent.postMessage({easel:"hello"},"*");setTimeout(hello,50)};addEventListener("message",(e)=>{if(e.source!==parent)return;if(e.ports[0]&&!port){port=e.ports[0];port.postMessage(${offer})}const d=e.data;if(d&&typeof d.probe==="number")parent.postMessage({probe:d.probe,id:${JSON.stringify(id)},me,axes:document.getElementById("easel-axes").textContent},"*")});hello();`;

const noRuntime = { address: "/api/runtime/1/none/", imports: {} };

const sourceId = "src";

const shownCase = z.object({
  name: z.string(),
  fixture: z.string().nullable(),
  switches: z.record(z.string(), z.string()),
});

const servedIds = new Set<string>();

const loadDocs = operation({
  label: "test.loadCaseDocs",
  input: z.object({ canvas: z.string() }).catchall(z.unknown()),
  run: (_, { input }) => {
    const id = typeof input.id === "string" ? input.id : "";
    if (!servedIds.has(id)) return [];

    const app = { js: appJs(id), kit: 1, runtime: noRuntime };
    return [{ canvas: input.canvas, id, version: 1, html: "", css: "", app }];
  },
});

const put = operation({
  label: "test.putCaseFrame",
  input: z.object({ id: z.string(), x: z.number(), shown: shownCase.nullable() }),
  depends: { cells: frameCells.controller, invalidate: framesBoard.invalidate },
  run: async ({ cells, invalidate }, { input: { id, x, shown } }) => {
    servedIds.add(id);
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
      case: shown === null ? null : { source: sourceId, ...shown },
    });
    await invalidate.run({ input: { docs: { canvas, id } } });
  },
});

const setKit = operation({
  label: "test.setCaseKit",
  depends: { cells: kitCells.atScope.controller },
  run: async ({ cells }) =>
    cells.set({ canvas, kit: 1, look: ":root{}", css: "", pieces: [], texts: {} }),
});

const manyCase = { name: "many", fixture: "many", switches: {} };

const darkEmptyCase = { name: "dark-empty", fixture: "empty", switches: { theme: "dark" } };

async function boot() {
  servedIds.clear();
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
  await server.run(put, { input: { id: sourceId, x: 0, shown: null } });
  await server.run(put, { input: { id: "many", x: 400, shown: manyCase } });
  await server.run(put, { input: { id: "dark-empty", x: 800, shown: darkEmptyCase } });

  return server;
}

function address(search: string) {
  const url = new URL(startUrl);
  url.search = search;
  history.replaceState(history.state, "", url);
  onTestFinished(() => history.replaceState(history.state, "", startUrl));
}

async function tab(server: Scope.Handle) {
  await page.viewport(1400, 800);
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
  axes: z.string(),
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

const axesOf = async (id: string) => (await answerOf(id))?.axes ?? "";
const drawnOf = async (id: string) => (await answerOf(id))?.me ?? -1;

const statesButton = () => page.getByRole("button", { name: "States" });
const statesMenu = () => page.getByRole("menu", { name: "States" });
const addressOf = (name: string) => new URLSearchParams(location.search).get(name);

const frameButton = (id: string) => page.getByRole("button", { name: `States of Frame ${id}` });
const frameMenu = (id: string) => page.getByRole("menu", { name: `States of Frame ${id}` });

async function chooseState(name: string, value: string) {
  await statesButton().click();
  await statesMenu()
    .getByRole("menuitemradio", { name: `${name} ${value}` })
    .click();
  await expect.poll(() => statesMenu().elements()).toHaveLength(0);
}

async function chooseFrameState(id: string, name: string, value: string) {
  await frameButton(id).click();
  await frameMenu(id)
    .getByRole("menuitemradio", { name: `${name} ${value}` })
    .click();
  await expect.poll(() => frameMenu(id).elements()).toHaveLength(0);
}

async function useTheBoardText(id: string, name: string) {
  await frameButton(id).click();
  const item = frameMenu(id).getByRole("menuitemradio", { name: `${name} Use the board` });
  const text = item.element().textContent ?? "";

  await frameButton(id).click();
  await expect.poll(() => frameMenu(id).elements()).toHaveLength(0);
  return text;
}

const manyAxes = (theme: string) =>
  theme === "light"
    ? '{"fixture":"many","config":{}}'
    : `{"fixture":"many","config":{"theme":"${theme}"}}`;

const darkEmptyAxes = '{"fixture":"empty","config":{"theme":"dark"}}';

test("SPEC-cases decision 4: a case frame draws the code of its source frame with the fixture and the switches of its case; the source frame keeps its own data; the address gets no value of a case", async () => {
  address("");
  const server = await boot();
  const at = await tab(server);
  await rested(at, 3);

  await expect.poll(() => axesOf("many"), { timeout: 5_000 }).toBe(manyAxes("light"));
  await expect.poll(() => axesOf("dark-empty")).toBe(darkEmptyAxes);
  expect(await axesOf(sourceId)).toBe("{}");
  expect(addressOf("fixture")).toBeNull();
  expect(addressOf("theme")).toBeNull();
  expect(await useTheBoardText("many", "fixture")).toContain("many");
});

test("SPEC-cases decision 4: one pick of dark on the board changes each case frame that does not set theme; a case that sets theme keeps its value; the frame that is not a case follows the board", async () => {
  address("");
  const server = await boot();
  const at = await tab(server);
  await rested(at, 3);
  await expect.poll(() => axesOf("many"), { timeout: 5_000 }).toBe(manyAxes("light"));
  await expect.poll(() => axesOf("dark-empty")).toBe(darkEmptyAxes);
  const darkEmpty = await drawnOf("dark-empty");

  await chooseState("theme", "dark");
  await expect.poll(() => axesOf("many"), { timeout: 5_000 }).toBe(manyAxes("dark"));
  await expect.poll(() => axesOf(sourceId), { timeout: 5_000 }).toBe('{"config":{"theme":"dark"}}');
  expect(await axesOf("dark-empty")).toBe(darkEmptyAxes);
  expect(await drawnOf("dark-empty")).toBe(darkEmpty);
  expect(addressOf("theme")).toBe("dark");
  expect(addressOf("fixture")).toBeNull();

  await chooseState("theme", "light");
  await expect.poll(() => axesOf("many"), { timeout: 5_000 }).toBe(manyAxes("light"));
  expect(await axesOf("dark-empty")).toBe(darkEmptyAxes);
});

test("SPEC-cases decision 4: a pick on one case frame wins over its case and changes only that frame; Use the board gives back the value of the case, not the board value", async () => {
  address("?fixture=empty");
  const server = await boot();
  const at = await tab(server);
  await rested(at, 3);
  await expect.poll(() => axesOf("many"), { timeout: 5_000 }).toBe(manyAxes("light"));
  await expect
    .poll(() => axesOf(sourceId), { timeout: 5_000 })
    .toBe('{"fixture":"empty","config":{}}');
  const [source, darkEmpty] = [await drawnOf(sourceId), await drawnOf("dark-empty")];

  await chooseFrameState("many", "fixture", "initial");
  await expect.poll(() => axesOf("many"), { timeout: 5_000 }).toBe("{}");
  expect(frameButton("many").element().hasAttribute("data-own")).toBe(true);
  expect(addressOf("f.many.fixture")).toBe("initial");
  expect(await drawnOf(sourceId)).toBe(source);
  expect(await drawnOf("dark-empty")).toBe(darkEmpty);
  expect(await axesOf("dark-empty")).toBe(darkEmptyAxes);

  expect(await useTheBoardText("many", "fixture")).toContain("many");
  await chooseFrameState("many", "fixture", "Use the board");
  await expect.poll(() => axesOf("many"), { timeout: 5_000 }).toBe(manyAxes("light"));
  expect(frameButton("many").element().hasAttribute("data-own")).toBe(false);
  expect(addressOf("f.many.fixture")).toBeNull();
  expect(addressOf("fixture")).toBe("empty");
  expect(await drawnOf(sourceId)).toBe(source);
});
