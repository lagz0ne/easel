import { exits } from "@tinkered/cli/test";
import { createScope, type Scope } from "@tinkered/core";
import { chromium } from "playwright";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { composeApp } from "@/kit/compose";
import { lookValues } from "@/kit/look.server";
import { type BuiltRuntime, buildRuntime } from "@/kit/runtime.server";
import { seedKitCss, seedLook } from "@/kit/seed.server";
import type { TeamTexts } from "@/kit/texts";

import { localChromium } from "./support/chromium";

const root = createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] });
const closers: Array<() => unknown> = [];

const served: {
  scope: Scope.Handle | null;
  runtime: BuiltRuntime | null;
  look: string;
  docs: Map<string, string>;
} = { scope: null, runtime: null, look: "", docs: new Map() };

const frameJs = `import { mount } from "@easel/frame";
import { copy } from "@easel/kit";
import { resource } from "@tinkered/core";
import { createElement } from "react";

const own = {
  en: { "trial.start": "Own start", "people.empty": "Own empty", "own.note": "Own note" },
  vi: { "trial.start": "Bắt đầu", "people.empty": "Trống", "own.note": "Ghi chú" },
};
const part = resource({ label: "live.part", depends: { say: copy.say }, factory: ({ say }) => say(own) });
const team = resource({
  label: "live.team",
  depends: { say: copy.say },
  factory: ({ say }) => say(["trial.start", "people.empty"]),
});
const View = resource({
  label: "live.View",
  depends: { p: part, t: team },
  factory: ({ p, t }) =>
    function View() {
      return createElement(
        "main",
        null,
        createElement("p", { id: "part" }, ["trial.start", "people.empty", "own.note"].map((key) => p(key)).join(" | ")),
        createElement("p", { id: "team" }, ["trial.start", "people.empty"].map((key) => t(key)).join(" | ")),
      );
    },
});
mount({ View });
`;

const parentPage = (doc: string, look: string, css: string) => `<!doctype html>
<iframe sandbox="allow-scripts" style="width:800px;height:300px"></iframe>
<script>
  const frame = document.querySelector("iframe");
  let port = null;
  let kit = null;
  addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow || event.data?.easel !== "hello") return;
    if (!kit || port) return;
    const channel = new MessageChannel();
    port = channel.port1;
    port.start();
    frame.contentWindow.postMessage(kit, "*", [channel.port2]);
  });
  window.sendKit = (texts) => {
    kit = { easel: "kit", kit: 2, look: ${JSON.stringify(look).replaceAll("<", "\\u003c")}, css: ${JSON.stringify(css).replaceAll("<", "\\u003c")}, texts };
    port?.postMessage(kit);
  };
  frame.srcdoc = ${JSON.stringify(doc).replaceAll("<", "\\u003c")};
</script>`;

const first: TeamTexts = {
  "trial.start": { en: "Start the trial", vi: "Dùng thử" },
  "people.empty": { en: "No people yet" },
};

const changed: TeamTexts = {
  "trial.start": { en: "Try it free", vi: "Dùng thử miễn phí" },
  "people.empty": { en: "No people yet" },
};

const withVi: TeamTexts = {
  ...changed,
  "people.empty": { en: "No people yet", vi: "Chưa có ai" },
};

let address = "";

beforeAll(async () => {
  served.scope = await root.ready;
  served.runtime = await root.run(buildRuntime);
  const values = await root.run(lookValues, { input: await root.run(seedLook) });
  const lines = Object.entries(values).map(([name, value]) => `  ${name}: ${value};\n`);
  served.look = `:root {\n${lines.join("")}}\n`;

  const web = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    routes: {
      "/rt/:file": (request) => {
        const text = served.runtime?.files[request.params.file];
        const headers = {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "text/javascript; charset=utf-8",
        };
        return text === undefined
          ? new Response("", { status: 404, headers })
          : new Response(text, { headers });
      },
    },
    fetch: (request) => {
      const doc = served.docs.get(new URL(request.url).searchParams.get("doc") ?? "") ?? "";
      return new Response(parentPage(doc, served.look, seedKitCss), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  });
  closers.push(() => web.stop(true));
  address = `http://127.0.0.1:${web.port}`;
}, 90_000);

afterAll(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  await root.close();
});

const docWith = (name: string, texts: TeamTexts, locale?: "en" | "vi") => {
  const { scope, runtime } = served;
  if (scope === null || runtime === null) throw new Error("no runtime");

  const doc = scope.run(composeApp, {
    input: {
      js: frameJs,
      css: "",
      kit: { look: served.look, css: seedKitCss, texts },
      runtime: { address: `${address}/rt/`, imports: runtime.imports },
      ...(locale ? { axes: { locale } } : {}),
    },
  });
  served.docs.set(name, doc);
  return `${address}/?doc=${name}`;
};

async function opened(url: string) {
  const executablePath = localChromium();
  if (executablePath === null) {
    throw new Error("no local Chromium: run `bunx playwright install chromium`");
  }

  const browser = await chromium.launch({ executablePath });
  closers.push(() => browser.close());
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);

  const frame = page.frameLocator("iframe");
  const textOf = (id: string) => frame.locator(`#${id}`).textContent({ timeout: 20_000 });
  const sendKit = (texts: TeamTexts) =>
    page.evaluate((given) => Reflect.get(window, "sendKit")(given), texts);
  const origin = () => page.frames()[1]?.evaluate(() => performance.timeOrigin);
  return { page, frame, textOf, sendKit, origin, errors };
}

test("L5: the first draw of an app frame shows the texts of the team that the document holds; one change of the texts on its port shows within 1 s, in the same document", async () => {
  const at = await opened(docWith("en", first));
  await expect
    .poll(() => at.textOf("part"), { timeout: 20_000 })
    .toBe("Start the trial | No people yet | Own note");
  expect(await at.textOf("team")).toBe("Start the trial | No people yet");
  const origin = await at.origin();

  const sent = performance.now();
  await at.sendKit(changed);
  await expect
    .poll(() => at.textOf("team"), { timeout: 1_000, interval: 10 })
    .toBe("Try it free | No people yet");
  console.log(
    `speed: L5 a live app frame showed the new text ${(performance.now() - sent).toFixed(0)} ms after the kit message`,
  );
  expect(await at.textOf("part")).toBe("Try it free | No people yet | Own note");
  expect(await at.origin()).toBe(origin);
  expect(at.errors).toEqual([]);
}, 60_000);

test("L12: in the locale vi, an app frame shows the vi text of the team; a text key with no vi text shows its en text; a vi text given later shows on the port", async () => {
  const at = await opened(docWith("vi", changed, "vi"));
  await expect
    .poll(() => at.textOf("part"), { timeout: 20_000 })
    .toBe("Dùng thử miễn phí | No people yet | Ghi chú");
  expect(await at.textOf("team")).toBe("Dùng thử miễn phí | No people yet");

  await at.sendKit(withVi);
  await expect
    .poll(() => at.textOf("team"), { timeout: 1_000, interval: 10 })
    .toBe("Dùng thử miễn phí | Chưa có ai");
  expect(at.errors).toEqual([]);
}, 60_000);

test("an app frame that says a text key that the team does not have does not start: CopyGaps", async () => {
  const at = await opened(docWith("none", {}));
  const alert = at.frame.getByRole("alert");
  await expect.poll(() => alert.count(), { timeout: 20_000 }).toBe(1);
  expect(await alert.getAttribute("data-easel-refused")).toBe("CopyGaps");
}, 60_000);
