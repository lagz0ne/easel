import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { chromium } from "playwright";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { type PutInput, socketMaxPayload } from "@/frames/contract";
import { framesLoads, framesOps, loadDocs, mayRead, putFrame } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { composeApp } from "@/kit/compose";
import { fontRoute } from "@/kit/fonts.server";
import { runtimeNames } from "@/kit/runtime";
import { type BuiltRuntime, runtimeNamesOf, runtimeRoute } from "@/kit/runtime.server";
import { readKit } from "@/kit/store.server";

import { localChromium } from "./support/chromium";
import { wsServer } from "./support/ws";

// frame.put of an app frame (SPEC-frames § Contract, "An app frame"; SPEC-kit § App frames, "The
// put"): the check, the fixes, the JS, the made CSS, kept with the frame version and its kit
// version; `offKit` writes nothing; `frame.get` answers the TSX as written; the board's document
// carries the JS and the runtime of its kit version; and the put stays in the speed budget.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const pricing = () => Bun.file(new URL("kit/frames/pricing.tsx", import.meta.url)).text();

/** The folder frame `people`: each file, by its path in the folder. */
const people = async () => {
  const dir = new URL("kit/frames/people/", import.meta.url);
  const paths = ["index.tsx", "entities.ts", "copy.ts", "view.tsx"];
  const texts = await Promise.all(paths.map((path) => Bun.file(new URL(path, dir)).text()));
  return Object.fromEntries(paths.map((path, i) => [path, texts[i] ?? ""]));
};

/** A runtime that a test gives the server in place of a build: each name, one small file each. */
function fakeRuntime(): BuiltRuntime {
  const imports = Object.fromEntries(
    runtimeNames.map((name) => [name, `${name.replace(/^@/, "").replaceAll("/", "__")}.js`]),
  );
  const files = Object.fromEntries(Object.values(imports).map((file) => [file, "export {};"]));
  return { sha: createHash("sha256").update("fake").digest("hex"), imports, files };
}

/**
 * One server: SQLite, access, frames and a memory transport, as cmds/server.ts wires them. With
 * `runtime: null` the scope builds the real runtime, as in dev.
 */
async function boot(options: { runtime?: BuiltRuntime | null; file?: string } = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, frames.board];
  const transport = wsServer.server({ path: "/rpc", services, maxPayload: socketMaxPayload });
  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: options.file ?? ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({
        stdout,
        runtime: options.runtime === undefined ? fakeRuntime() : options.runtime,
      }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      transport,
      memory.server({ services }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, setupCode };
}

/** Ann's agent, signed in, with the canvas `flow`. */
async function annOn(srv: Awaited<ReturnType<typeof boot>>) {
  const client = async (token?: string) => {
    const meta = operation({
      label: "test.meta",
      run: async (): Promise<Record<string, string>> =>
        token ? { authorization: `Bearer ${token}` } : {},
    });
    const scope = await createScope({
      capsules: [
        exits({ file: process.env.TINKER_EXITS }),
        memory.client({ peer: srv.server, headers: { "x-easel-peer": "198.51.100.1" }, meta }),
        access.login({ remote: memory.client }),
        frames.api({ remote: memory.client }),
      ],
    }).ready;
    closers.push(() => scope.close());
    return scope;
  };
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  await (
    await client()
  ).run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  const scope = await client(text);
  await scope.run(frames.api["canvas.create"], { input: { name: "flow" } });

  return {
    put: (input: PutInput) => scope.run(frames.api["frame.put"], { input }),
    get: (id: string) => scope.run(frames.api["frame.get"], { input: { canvas: "flow", id } }),
    list: () => scope.run(frames.api["frame.list"], { input: { canvas: "flow" } }),
  };
}

const at = (findings: Array<{ line: number; col: number; rule: string }>) =>
  findings.map((f) => `${f.line}:${f.col} ${f.rule}`);

test("a put of a TSX frame checks it, fixes it, and keeps its TSX, JS and CSS with the frame version", async () => {
  const srv = await boot();
  const ann = await annOn(srv);
  const tsx = (await pricing()).replace('"btn w-full"', '"btn w-full text-red-500"');

  const made = await ann.put({ canvas: "flow", tsx, name: "Pricing" });
  if (made.kind !== "created") throw new Error(`not created: ${made.kind}`);
  expect(made.version).toBe(1);
  expect(made.findings.map((f) => f.rule)).toContain("look/color");

  // frame.get answers the TSX as the agent wrote it, not the fixed text.
  const got = await ann.get(made.id);
  expect(got).toMatchObject({ kind: "found", frame: { id: made.id, name: "Pricing", tsx } });

  // The board's document: the JS of the fixed text, the made CSS, and the runtime of kit 1.
  const [doc] = await srv.server.run(loadDocs, { input: { canvas: "flow", id: made.id } });
  if (!doc?.app) throw new Error("no app");
  expect(doc.app.js).toContain('"btn w-full text-destructive"');
  expect(doc.app.js).toContain('from"react/jsx-runtime"');
  expect(doc.css).toContain(".text-destructive");
  expect(doc.app.kit).toBe(1);
  expect(doc.app.runtime.address).toBe(`/api/runtime/1/${fakeRuntime().sha}/`);
  expect(doc.app.runtime.imports["@easel/frame"]).toBe("easel__frame.js");

  // The first app frame gave kit version 1 its runtime.
  expect(await srv.server.run(runtimeNamesOf, { input: 1 })).toEqual([...runtimeNames]);
});

test("an app frame that the check refuses answers offKit with its findings, and nothing is written", async () => {
  const srv = await boot();
  const ann = await annOn(srv);
  const tsx = [
    'import { useState } from "react";',
    'import { motion } from "framer-motion";',
    "export const logic = {};",
    "export function View() {",
    '  return <p className="p-4">x</p>;',
    "}",
  ].join("\n");

  const refused = await ann.put({ canvas: "flow", tsx });
  expect(refused.kind).toBe("offKit");
  if (refused.kind !== "offKit") return;
  expect(at(refused.findings)).toEqual(["1:10 kit/react-state", "2:24 kit/import"]);
  expect(refused.more).toBe(0);
  expect(await ann.list()).toEqual({ kind: "found", frames: [] });

  // A TSX that does not parse is offKit with kit/parse.
  const unparsed = await ann.put({
    canvas: "flow",
    tsx: "export function View() {\n  return <p>;\n}",
  });
  expect(unparsed.kind === "offKit" && at(unparsed.findings)).toEqual(["3:1 kit/parse"]);

  // At most 20 findings; more counts the rest.
  const many = Array.from({ length: 23 }, (_, i) => `import { a${i} } from "left-pad-${i}";`);
  const lots = await ann.put({ canvas: "flow", tsx: many.join("\n") });
  expect(lots.kind === "offKit" && [lots.findings.length, lots.more]).toEqual([20, 4]);
  expect(await ann.list()).toEqual({ kind: "found", frames: [] });
});

test("an app frame over 256 KiB is tooBig with maxBytes 262144, and nothing is written", async () => {
  const srv = await boot();
  const ann = await annOn(srv);

  const big = `export const logic = {};\n//${"x".repeat(256 * 1024)}`;
  expect(await ann.put({ canvas: "flow", tsx: big })).toEqual({ kind: "tooBig", maxBytes: 262144 });
  expect(await ann.list()).toEqual({ kind: "found", frames: [] });

  // Under 256 KiB of TSX, but its made CSS would be over 256 KiB: tooBig too.
  const classes = Array.from({ length: 9000 }, (_, i) => `w-[${i + 1}px]`).join(" ");
  const wide = `export const logic = {};\nexport function View() {\n  return <p className="${classes}" />;\n}`;
  expect(await ann.put({ canvas: "flow", tsx: wide })).toEqual({
    kind: "tooBig",
    maxBytes: 262144,
  });
  expect(await ann.list()).toEqual({ kind: "found", frames: [] });
}, 30_000);

test("a frame is one kind for each version: a TSX put on an HTML frame is its next version, and back", async () => {
  const srv = await boot();
  const ann = await annOn(srv);
  const tsx = await pricing();

  const made = await ann.put({ canvas: "flow", html: "<p>a</p>" });
  if (made.kind !== "created") throw new Error("not created");
  const { id } = made;

  expect(await ann.put({ canvas: "flow", id, base: 1, tsx })).toMatchObject({
    kind: "updated",
    version: 2,
  });
  expect(await ann.get(id)).toMatchObject({ kind: "found", frame: { version: 2, tsx } });
  // The same TSX on its version is unchanged; an old base is stale.
  expect(await ann.put({ canvas: "flow", id, base: 2, tsx })).toMatchObject({
    kind: "unchanged",
    version: 2,
  });
  expect(await ann.put({ canvas: "flow", id, base: 1, tsx })).toEqual({
    kind: "stale",
    id,
    version: 2,
  });
  // The same text as HTML is another kind: a new version, an HTML frame again.
  expect(await ann.put({ canvas: "flow", id, base: 2, html: tsx })).toMatchObject({
    kind: "updated",
    version: 3,
  });
  expect(await ann.get(id)).toMatchObject({ kind: "found", frame: { version: 3, html: tsx } });
  const [doc] = await srv.server.run(loadDocs, { input: { canvas: "flow", id } });
  expect(doc?.app).toBeNull();
});

test("the composed document of an app frame: the look, the CSS, the import map of its runtime and its JS", async () => {
  const srv = await boot();
  const ann = await annOn(srv);
  const made = await ann.put({ canvas: "flow", tsx: await pricing() });
  if (made.kind !== "created") throw new Error("not created");
  const [doc] = await srv.server.run(loadDocs, { input: { canvas: "flow", id: made.id } });
  if (!doc?.app) throw new Error("no app");

  const kit = { look: ":root{--primary:#111}", css: ".btn{color:red}</style>" };
  const html = srv.server.run(composeApp, {
    input: {
      js: `${doc.app.js}\nconst t = "</script><!--";`,
      css: doc.css ?? "",
      kit,
      runtime: doc.app.runtime,
    },
  });

  expect(
    html.startsWith('<!doctype html>\n<style id="easel-look">:root{--primary:#111}</style>'),
  ).toBe(true);
  expect(html).toContain(".btn{color:red}<\\/style>");
  const map = /<script type="importmap">(.*?)<\/script>/.exec(html)?.[1] ?? "";
  expect(JSON.parse(map).imports.react).toBe(`${doc.app.runtime.address}react.js`);
  expect(html).toContain('const t = "<\\/script><\\!--";');
  expect(html).toContain('<script type="application/json" id="easel-axes">{}</script>');
  expect(html).toContain('import{mount}from"@easel/frame"');
  expect(html.match(/<\/script>/g)?.length).toBe(3);

  // The axes of a capsule frame, as JSON that cannot end its element.
  const axes = srv.server.run(composeApp, {
    input: { js: "", css: "", kit, runtime: doc.app.runtime, axes: { locale: "</script>" } },
  });
  expect(axes).toContain('id="easel-axes">{"locale":"\\u003c/script>"}</script>');
});

test("speed: a put of a usual TSX frame spends less than 50 ms in the check and the make", async () => {
  const srv = await boot();
  await annOn(srv);
  const tsx = await pricing();
  // The first put of a kit version gives it its runtime, and the design system is made once.
  await srv.server.run(putFrame, { input: { canvas: "flow", tsx } });

  const times: number[] = [];
  for (let i = 0; i < 30; i++) {
    const start = performance.now();
    const made = await srv.server.run(putFrame, {
      input: { canvas: "flow", tsx: `${tsx}\n// ${i}` },
    });
    times.push(performance.now() - start);
    expect(made.kind).toBe("created");
  }
  times.sort((a, b) => a - b);
  const p50 = times[15] ?? Infinity;
  const p95 = times[28] ?? Infinity;
  process.stderr.write(
    `frame.put of pricing.tsx: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms\n`,
  );
  // The budget is 50 ms; loose here, so a loaded host does not fail it.
  expect(p50).toBeLessThan(50);
});

/**
 * The page of the browser test: one sandboxed iframe (scripts only, so its origin is null) with
 * the composed document as its srcdoc. It answers the frame's hello with a port, as the viewer
 * does, and keeps each message of the frame in `window.told`.
 */
const parentPage = (html: string) => `<!doctype html>
<iframe sandbox="allow-scripts" style="width:1200px;height:900px"></iframe>
<script>
  window.told = [];
  const frame = document.querySelector("iframe");
  const channel = new MessageChannel();
  channel.port1.onmessage = (event) => {
    window.told.push(event.data.easel);
    if (event.data.easel === "axes") window.offer = event.data;
    if (event.data.easel === "controls") window.controls = event.data.controls;
    if (event.data.easel === "values") window.values = event.data.values;
    if (event.data.easel === "ran") window.ran = event.data;
  };
  addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return;
    window.told.push(event.data.easel);
    if (event.data.easel === "hello" && !window.port) {
      window.port = channel.port1;
      frame.contentWindow.postMessage({ easel: "port" }, "*", [channel.port2]);
    }
  });
  window.closeFrame = () => window.port.postMessage({ easel: "close" });
  window.sendKit = (look, css) => window.port.postMessage({ easel: "kit", look, css });
  window.control = (key, value) => window.port.postMessage({ easel: "control", key, value });
  frame.srcdoc = ${JSON.stringify(html).replaceAll("<", "\\u003c")};
</script>`;

test(
  "a real Chromium loads one composed app frame in a sandboxed srcdoc iframe; a click runs its operation; close gives closed",
  { timeout: 60_000 },
  async () => {
    const executablePath = localChromium();
    if (executablePath === null) {
      throw new Error("no local Chromium: run `bunx playwright install chromium`");
    }

    const srv = await boot({ runtime: null });
    const ann = await annOn(srv);
    const made = await ann.put({ canvas: "flow", tsx: await pricing() });
    if (made.kind !== "created") throw new Error(`not created: ${made.kind}`);
    const [doc] = await srv.server.run(loadDocs, { input: { canvas: "flow", id: made.id } });
    if (!doc?.app) throw new Error("no app");
    const now = await srv.server.run(readKit);
    if (now === null) throw new Error("no kit");
    const html = srv.server.run(composeApp, {
      input: {
        js: doc.app.js,
        css: doc.css ?? "",
        kit: { look: now.root, css: now.css },
        runtime: doc.app.runtime,
      },
    });

    // The parent page, the runtime's route and the fonts' route, at one origin, as easel serves
    // them.
    const web = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      routes: {
        "/api/runtime/:kit/:sha/:file": (request) =>
          srv.server.run(runtimeRoute, { input: request.params }),
        "/api/fonts/:dir/:file": (request) => srv.server.run(fontRoute, { input: request.params }),
      },
      fetch: () =>
        new Response(parentPage(html), { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    });
    closers.push(() => web.stop(true));
    const browser = await chromium.launch({ executablePath });
    closers.push(() => browser.close());
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await page.goto(`http://127.0.0.1:${web.port}/`);
    const frame = page.frameLocator("iframe");
    await frame.getByRole("button", { name: "Choose Pro" }).click({ timeout: 20_000 });
    await expect.poll(() => frame.getByRole("button", { name: "Chosen" }).count()).toBe(1);
    await frame.getByRole("tab", { name: "Yearly" }).click();
    await expect.poll(() => frame.getByText("$290").count()).toBe(1);

    await page.evaluate(() => Reflect.get(window, "closeFrame")());
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "told"))).toContain("closed");
    expect(await frame.locator("main").count()).toBe(0);
    // A frame with no capsule posts no axes: the page offers it no pick.
    expect(await page.evaluate(() => Reflect.get(window, "told"))).not.toContain("axes");
    expect(errors).toEqual([]);
  },
);

/** Before the composed document: a script that tells the parent the body's text at `load`. */
const atLoad = `<script>addEventListener("load", () => parent.postMessage({ easel: "load:" + document.body.textContent }, "*"));</script>\n`;

test("a folder frame: frame.put takes its files, keeps them as written, and frame.get answers them; a second put of the same files is unchanged", async () => {
  const srv = await boot();
  const ann = await annOn(srv);
  const files = await people();
  const made = await ann.put({ canvas: "flow", files });
  if (made.kind !== "created") throw new Error(`not created: ${made.kind}`);
  expect(made.findings).toEqual([]);

  const got = await ann.get(made.id);
  expect(got).toMatchObject({ kind: "found", frame: { version: 1, files } });
  const [doc] = await srv.server.run(loadDocs, { input: { canvas: "flow", id: made.id } });
  expect(doc?.app?.js).toContain('import{mount}from"@easel/frame"');

  const same = await ann.put({ canvas: "flow", files, id: made.id, base: 1 });
  expect(same.kind).toBe("unchanged");

  // A file of the folder with a gap: the finding names its file.
  const bad = { ...files, "view.tsx": `${files["view.tsx"] ?? ""}\nimport "./none";\n` };
  const refused = await ann.put({ canvas: "flow", files: bad, id: made.id, base: 1 });
  expect(refused.kind === "offKit" && refused.findings.map((f) => f.file)).toEqual(["view.tsx"]);

  // No index.tsx, or a path above the folder: rpc refuses the input on the client, and nothing
  // is sent.
  const shapes: Array<Record<string, string>> = [
    { "copy.ts": "export {};" },
    { "index.tsx": "", "../x.ts": "" },
  ];
  for (const files of shapes) {
    const sent = await Promise.resolve()
      .then(() => ann.put({ canvas: "flow", files }))
      .then(
        () => "sent",
        (error: unknown) => String(error),
      );
    expect(sent).toContain("DataValidationFailed");
  }
  expect((await ann.list()).kind === "found" && (await ann.list())).toMatchObject({
    frames: [{ id: made.id, version: 1 }],
  });
});

// Three starts on a database file, each with `synchronous = FULL`: a budget as for the other
// tests that write to disk.
test(
  "the JS of an app frame made before the JS called the mount gets the old mount line, one time",
  { timeout: 30_000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "easel-mount-old-"));
    closers.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "easel.db");
    const first = await boot({ file });
    const ann = await annOn(first);
    const made = await ann.put({ canvas: "flow", tsx: await pricing() });
    if (made.kind !== "created") throw new Error("not created");
    // As a store of the week before: transpiled JS with no mount, and no migration recorded.
    await first.server.run(
      operation({
        label: "test.oldStore",
        depends: { connection: bunSqlite.connection },
        run: async ({ connection }) => {
          connection.db.$client.run("UPDATE frames_frames SET js = 'export function View() {}'");
          connection.db.$client.run("DELETE FROM frames_migrations");
        },
      }),
    );
    await first.server.close();

    const jsOf = async () => {
      const srv = await boot({ file });
      const [doc] = await srv.server.run(loadDocs, { input: { canvas: "flow", id: made.id } });
      await srv.server.close();
      return doc?.app?.js ?? "";
    };
    const again = await jsOf();
    expect(again.startsWith("export function View() {}\nimport { mount as __easelMount }")).toBe(
      true,
    );
    expect(await jsOf()).toBe(again);
  },
);

test(
  "a capsule frame in a folder draws in a scope of the kit's capsules, with the locale and the data state of its axes, before load; a refused start shows its kind; a kit message draws it in a new scope",
  { timeout: 90_000 },
  async () => {
    const executablePath = localChromium();
    if (executablePath === null) {
      throw new Error("no local Chromium: run `bunx playwright install chromium`");
    }

    const srv = await boot({ runtime: null });
    const ann = await annOn(srv);
    const made = await ann.put({ canvas: "flow", files: await people() });
    if (made.kind !== "created") throw new Error(`not created: ${made.kind}`);
    const [doc] = await srv.server.run(loadDocs, { input: { canvas: "flow", id: made.id } });
    if (!doc?.app) throw new Error("no app");
    const now = await srv.server.run(readKit);
    if (now === null) throw new Error("no kit");
    const app = doc.app;
    const compose = (axes?: { locale?: string; config?: Record<string, unknown> }) =>
      atLoad +
      srv.server.run(composeApp, {
        input: {
          js: app.js,
          css: doc.css ?? "",
          kit: { look: now.root, css: now.css },
          runtime: app.runtime,
          axes,
        },
      });
    const docs = [
      compose(),
      compose({ locale: "vi", config: { sample: "one" } }),
      compose({ config: { sample: "bad" } }),
      compose({ config: { sample: "empty" } }),
    ];

    const web = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      routes: {
        "/api/runtime/:kit/:sha/:file": (request) =>
          srv.server.run(runtimeRoute, { input: request.params }),
        "/api/fonts/:dir/:file": (request) => srv.server.run(fontRoute, { input: request.params }),
      },
      fetch: (request) => {
        const html = docs[Number(new URL(request.url).searchParams.get("doc"))] ?? "";
        return new Response(parentPage(html), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    });
    closers.push(() => web.stop(true));
    const browser = await chromium.launch({ executablePath });
    closers.push(() => browser.close());
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const told = () => page.evaluate((): unknown => Reflect.get(window, "told"));
    const frame = page.frameLocator("iframe");

    // The axes by default: English, and the data state `many`. The View is drawn before `load`.
    await page.goto(`http://127.0.0.1:${web.port}/?doc=0`);
    await expect.poll(told, { timeout: 20_000 }).toContainEqual(expect.stringMatching(/^load:/));
    expect(await told()).toContainEqual("load:People3 peopleAnnRemoveBinhRemoveChiRemove");
    // With its port, the frame posts its axes: the locales, and the values of its config's enum.
    await expect
      .poll(() => page.evaluate((): unknown => Reflect.get(window, "offer")))
      .toEqual({
        easel: "axes",
        locales: ["en", "vi"],
        config: { sample: { values: ["empty", "one", "many", "bad"], default: "many" } },
      });
    await frame.getByRole("button", { name: "Remove" }).first().click();
    await expect.poll(() => frame.getByText("2 people").count()).toBe(1);

    // Its controls (chart kit-frame-controls): each kind from the input of its operation, and the
    // value of each value control. A control runs in the live scope: the state goes on from here.
    const read = (name: string) => page.evaluate((key): unknown => Reflect.get(window, key), name);
    await expect
      .poll(() => read("controls"))
      .toEqual([
        { key: "add", label: "Add a person", kind: "action" },
        { key: "clear", label: "Remove all", kind: "action" },
        { key: "capitals", label: "Names in capitals", kind: "switch" },
      ]);
    await expect.poll(() => read("values")).toEqual({ capitals: false });
    const control = (key: string, value?: unknown) =>
      page.evaluate(([k, v]) => Reflect.get(window, "control")(k, v), [key, value] as const);
    await control("add");
    await expect.poll(() => frame.getByText("3 people").count()).toBe(1);
    expect(await frame.getByText("Person 3").count()).toBe(1);
    await control("capitals", true);
    await expect.poll(() => read("values")).toEqual({ capitals: true });
    expect(await frame.getByText("BINH").count()).toBe(1);
    // A value that the operation's input refuses changes nothing: the page gets the refusal.
    await control("capitals", "yes");
    await expect.poll(() => read("ran")).toMatchObject({ easel: "ran", key: "capitals" });
    expect(await read("values")).toEqual({ capitals: true });
    await control("clear");
    await expect.poll(() => frame.getByText("0 people").count()).toBe(1);

    // A kit message: the frame draws in a new scope with that look, so its state starts again.
    await page.evaluate(({ look, css }) => Reflect.get(window, "sendKit")(look, css), {
      look: now.root,
      css: now.css,
    });
    await expect.poll(() => frame.getByText("3 people").count()).toBe(1);
    await page.evaluate(() => Reflect.get(window, "closeFrame")());
    await expect.poll(told).toContain("closed");
    expect(await frame.locator("main").count()).toBe(0);

    // Vietnamese, and the data state `one`.
    await page.goto(`http://127.0.0.1:${web.port}/?doc=1`);
    await expect.poll(() => frame.getByText("1 người").count(), { timeout: 20_000 }).toBe(1);
    expect(await frame.getByRole("heading", { name: "Mọi người" }).count()).toBe(1);
    expect(await frame.getByRole("button", { name: "Xóa" }).count()).toBe(1);

    // A row of the data state `bad` fails its schema: the start is refused, and the frame says so.
    await page.goto(`http://127.0.0.1:${web.port}/?doc=2`);
    const alert = frame.getByRole("alert");
    await expect.poll(() => alert.count(), { timeout: 20_000 }).toBe(1);
    expect(await alert.getAttribute("data-easel-refused")).toBe("SampleInvalid");
    expect(await alert.textContent()).toContain("This frame does not start: SampleInvalid.");

    // The data state `empty`: the Empty piece, with its own text.
    await page.goto(`http://127.0.0.1:${web.port}/?doc=3`);
    await expect
      .poll(() => frame.getByText("Nothing here yet").count(), { timeout: 20_000 })
      .toBe(1);
    expect(await frame.getByText("0 people").count()).toBe(1);
    expect(errors).toEqual([]);
  },
);
