import { createHash, randomBytes } from "node:crypto";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { userOps } from "@/access/users.server";
import { frames } from "@/frames";
import type { PutInput } from "@/frames/contract";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { kit } from "@/kit";
import { kitOps } from "@/kit/ops.server";
import { runtimeNames } from "@/kit/runtime";
import type { BuiltRuntime } from "@/kit/runtime.server";
import type { TextsPatch } from "@/kit/texts";
import { words } from "@/words";
import { wordsOps } from "@/words/ops.server";
import { htmlTexts, plainText } from "@/words/read.server";

import { base64, pngOf } from "./support/images";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

function fakeRuntime(): BuiltRuntime {
  const imports = Object.fromEntries(
    runtimeNames.map((name) => [name, `${name.replace(/^@/, "").replaceAll("/", "__")}.js`]),
  );
  const files = Object.fromEntries(Object.values(imports).map((file) => [file, "export {};"]));
  return { sha: createHash("sha256").update("fake").digest("hex"), imports, files };
}

async function boot() {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, kit.api, words.api];

  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout, runtime: fakeRuntime() }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      kit.api({ implement: kitOps, onStart: [user] }),
      words.api({ implement: wordsOps, onStart: [user] }),
      memory.server({ services }),
    ],
  }).ready;
  closers.push(() => server.close());
  return { server, setupCode: () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "" };
}

async function client(server: Scope.Handle, token?: string) {
  const meta = operation({
    label: "test.meta",
    run: async (): Promise<Record<string, string>> =>
      token ? { authorization: `Bearer ${token}` } : {},
  });
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: server, headers: { "x-easel-peer": "198.51.100.1" }, meta }),
      access.login({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      kit.api({ remote: memory.client }),
      words.api({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());
  return scope;
}

async function easel() {
  const srv = await boot();
  const token = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(token).digest("hex");
  await (
    await client(srv.server)
  ).run(access.login["login.setup"], { input: { name: "ann", code: srv.setupCode(), digest } });
  const agent = await client(srv.server, token);

  for (const name of ["shop", "docs"]) {
    await agent.run(frames.api["canvas.create"], { input: { name } });
  }

  const put = async (input: PutInput) => {
    const answer = await agent.run(frames.api["frame.put"], { input });
    if (answer.kind !== "created") throw new Error(`not created: ${JSON.stringify(answer)}`);
    return answer.id;
  };
  return {
    srv,
    agent,
    put,
    uses: (canvas?: string) =>
      agent.run(words.api["texts.uses"], { input: canvas === undefined ? {} : { canvas } }),
    texts: (texts: TextsPatch) => agent.run(kit.api["texts.set"], { input: { texts } }),
  };
}

const checkout = `<!doctype html>
<html><head><title>Not shown</title><style>.a { color: red }</style>
<script>document.title = "Not read"</script></head>
<body>
  <h1>Your   order</h1>
  <p>Pay <b>now</b> &amp; save &mdash; 10&nbsp;%</p>
  <button data-easel-text="trial.start">Start</button>
  <span data-easel-text="plan.name"><b>Pro</b> plan</span>
  <input placeholder="Card number" aria-label="Card">
  <img alt="A card" src="x.png">
  <span title="Help text">3</span>
  <template><p>In a template</p></template>
  <!-- <p>In a comment</p> -->
  <p>12:04 · →</p>
  <p>Your order</p>
</body></html>`;

const view = [
  'import { copy, ui } from "@easel/kit";',
  'import { resource } from "@tinkered/core";',
  "",
  'const texts = { en: { "cart.title": "Cart" }, vi: { "cart.title": "Giỏ" } };',
  "",
  "const text = resource({",
  '  label: "cart.text",',
  "  depends: { say: copy.say, pieces: ui.pieces },",
  '  factory: ({ say }) => [say(texts), say(["trial.start", "cart.empty"])],',
  "});",
  "",
  "export function View() {",
  '  return <section title="Cart help">Your order <b>now</b></section>;',
  "}",
  "",
].join("\n");

const shop = { canvas: "shop", id: "", name: "", page: "page-1" };

test("L9: texts.uses lists each text of an HTML frame and of an app frame, one for one, and counts the image frames; L11: a text of the team with no use is not used; L13: missing.vi names each text key with no vi text", async () => {
  const { put, uses, texts } = await easel();
  await texts({ "trial.start": { en: "Start", vi: "Bắt đầu" }, "plan.name": { en: "Pro plan" } });
  const html = await put({ canvas: "shop", html: checkout, name: "Checkout" });
  const tsx = await put({ canvas: "shop", tsx: view, name: "Cart" });
  await put({
    canvas: "shop",
    image: { mimeType: "image/png", data: base64(await pngOf(20, 10)) },
  });

  const answer = await uses();
  const checkoutUse = { ...shop, id: html, name: "Checkout" };
  const cartUse = { ...shop, id: tsx, name: "Cart" };
  expect(answer).toMatchObject({ kind: "found", kit: 2, rev: 2, frames: 3, pictures: 1 });
  if (answer.kind !== "found") throw new Error("not found");
  expect(answer.texts).toEqual([
    { key: "plan.name", en: "Pro plan", uses: [checkoutUse] },
    { key: "trial.start", en: "Start", vi: "Bắt đầu", uses: [checkoutUse, cartUse] },
    { key: "ui.close", en: "Close", vi: "Đóng", uses: [cartUse] },
    { key: "ui.empty", en: "Nothing here yet", vi: "Chưa có gì", uses: [cartUse] },
  ]);
  expect(answer.unknown).toEqual([
    { key: "cart.empty", uses: [cartUse] },
    { key: "cart.title", uses: [cartUse] },
  ]);
  expect(answer.own).toEqual(
    [
      ["Your order", checkoutUse, cartUse],
      ["A card", checkoutUse],
      ["Card", checkoutUse],
      ["Card number", checkoutUse],
      ["Cart help", cartUse],
      ["Help text", checkoutUse],
      ["now", cartUse],
      ["Pay now & save — 10 %", checkoutUse],
    ].map(([text, ...list]) => ({ text, uses: list })),
  );
  expect(answer.missing).toEqual({ vi: ["plan.name"] });
});

test("L11: a text that no frame uses has no use; after a put of a frame that uses it, the next read shows the use", async () => {
  const { put, uses, texts } = await easel();
  await texts({ "trial.start": { en: "Start" } });

  expect((await uses()).texts.find((t) => t.key === "trial.start")?.uses).toEqual([]);
  const id = await put({
    canvas: "docs",
    html: '<p data-easel-text="trial.start">Start</p>',
    name: "Hero",
  });
  expect((await uses()).texts.find((t) => t.key === "trial.start")?.uses).toEqual([
    { canvas: "docs", id, name: "Hero", page: "page-1" },
  ]);
});

test("texts.uses with a canvas reads the frames of that canvas only", async () => {
  const { put, uses } = await easel();
  await put({ canvas: "shop", html: "<p>On the shop</p>", name: "A" });
  await put({ canvas: "docs", html: "<p>In the docs</p>", name: "B" });

  const all = await uses();
  const docs = await uses("docs");
  expect(all.own.map((t) => t.text)).toEqual(["In the docs", "On the shop"]);
  expect(docs).toMatchObject({ frames: 1, pictures: 0, own: [{ text: "In the docs" }] });
});

test("texts.uses runs the user guard first: a tab with no token is refused", async () => {
  const { srv } = await easel();
  const stranger = await client(srv.server);

  await expect(stranger.run(words.api["texts.uses"], { input: {} })).rejects.toMatchObject({
    fault: "refused",
  });
});

test("an HTML frame: the phrase elements stay in one text, each other element starts a new one; character references are read; a text with no letter is not a word", async () => {
  const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => scope.close());
  const read = (html: string) => scope.run(htmlTexts, { input: html });

  expect(await read("<p>Click <a href=x>here</a> to <em>go</em></p><p>Next</p>")).toEqual({
    keys: [],
    own: ["Click here to go", "Next"],
  });
  expect(await read("<div>One<span>Two</span>Three<br>Four</div>")).toEqual({
    keys: [],
    own: ["One", "Two", "Three", "Four"],
  });
  expect(await read("<p data-easel-text=a.b><p>inner</p> still keyed</p><p>after</p>")).toEqual({
    keys: ["a.b"],
    own: ["after"],
  });
  expect(await read("<img data-easel-text='a.c'><p>shown</p>")).toEqual({
    keys: ["a.c"],
    own: ["shown"],
  });
  expect(await read("<p>Stop <script>x()</script")).toEqual({ keys: [], own: ["Stop"] });
  expect(
    await read("<textarea>Write here</textarea><p>&#x1F600; &#9731;</p><p>&bogus; &#0;</p>"),
  ).toEqual({ keys: [], own: ["Write here", "&bogus; &#0;"] });
  expect(await scope.run(plainText, { input: "  a&lt;b&gt;&quot;&apos;&#39;\n c " })).toBe(
    "a<b>\"'' c",
  );
});
