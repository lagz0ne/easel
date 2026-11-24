import { Database } from "bun:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { kit } from "@/kit";
import { fillCopies, mainsOf, type PartBody } from "@/kit/copies.server";
import { kitOps } from "@/kit/ops.server";
import { fillAt } from "@/kit/parts.server";
import { parts } from "@/parts";
import { partsOps, partsServer } from "@/parts/ops.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

async function until(ok: () => boolean) {
  for (let i = 0; i < 150 && !ok(); i++) await tick();
  expect(ok()).toBe(true);
}

const count = "cw8rv3bcji";
const dock = "clbzalz58t";

const page = (head: string, body: string) =>
  `<!doctype html>\n<html><head><meta name="easel-kit" content="off">\n${head}</head>\n<body>\n${body}\n</body></html>`;

const countCss = [
  ".count {display:inline-flex}",
  ".count[data-tone=accent] {background:var(--e-accent)}",
  ".count[data-shape=dot] {width:8px}",
].join("\n");

const countMain = (attrs = "") =>
  page(
    `<style data-doop-component-source="${count}">\n${countCss}\n</style>\n`,
    `<span class="count"${attrs} data-doop-prop="value" data-doop-part="lyrk" data-doop-component="${count}">3</span>`,
  );

const props = (value: string) =>
  `{&quot;tone&quot;:&quot;accent&quot;,&quot;value&quot;:&quot;${value}&quot;}`;

const countCopy = (id: string, inner: string, rev = 5) =>
  `<span class="count" data-doop-instance="${count}" data-doop-rev="${rev}" data-doop-id="${id}" data-tone="accent" data-doop-props="${props(inner)}">${inner}</span>`;

const editedCopy = `<span class="count" data-doop-instance="${count}" data-doop-rev="5" data-doop-id="ed1ted" data-tone="accent" data-doop-props="${props("2")}"><b>2</b></span>`;

const oldScoped = `:where([data-doop-instance="${count}"]) .count, .count:where([data-doop-instance="${count}"]) {display:inline-flex}`;

const productFrame = page(
  `<style data-doop-component-css="${count}">\n${oldScoped}\n</style>\n`,
  `${countCopy("tqhcbt", "2")}\n${editedCopy}`,
);

const plainFrame = page("", "<p>No part here</p>");

async function boot(file = ":memory:") {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, frames.board, kit.api, parts.api];
  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      kit.api({ implement: kitOps, onStart: [user] }),
      partsServer,
      parts.api({ implement: partsOps, onStart: [user] }),
      memory.server({ services }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, setupCode };
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
      frames.board({ read: memory.client }),
      parts.api({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return scope;
}

async function easel(file?: string) {
  const srv = await boot(file);
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await client(srv.server);
  await login.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  const agent = await client(srv.server, text);
  for (const name of ["design-system", "product"]) {
    await agent.run(frames.api["canvas.create"], { input: { name } });
  }

  return { srv, token: text, agent };
}

async function put(agent: Scope.Handle, canvas: string, html: string, name: string) {
  const answer = await agent.run(frames.api["frame.put"], { input: { canvas, html, name } });
  if (answer.kind !== "created") throw new Error(`put ${name}: ${answer.kind}`);
  return answer.id;
}

async function design(agent: Scope.Handle) {
  const main = await put(agent, "design-system", countMain(), "Count");
  const copies = await put(agent, "product", productFrame, "Inbox");
  const plain = await put(agent, "product", plainFrame, "Empty");
  return { main, copies, plain };
}

const publish = (agent: Scope.Handle, canvas: string) =>
  agent.run(parts.api["parts.publish"], { input: { canvas } });

const show = (agent: Scope.Handle, canvas: string, id: string) =>
  agent.run(parts.api["parts.show"], { input: { canvas, id } });

async function shown(agent: Scope.Handle, canvas: string, id: string) {
  const answer = await show(agent, canvas, id);
  if (answer.kind !== "found") throw new Error(`show ${id}: ${answer.kind}`);
  return answer;
}

async function fill(html: string, revisions: PartBody[]) {
  const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => scope.close());

  const byId = new Map<string, PartBody[]>();
  const now = new Map<string, PartBody>();
  for (const one of revisions) {
    byId.set(one.id, [...(byId.get(one.id) ?? []), one]);
    now.set(one.id, one);
  }
  return scope.run(fillCopies, { input: { html, revisions: byId, now } });
}

async function mains(html: string) {
  const scope = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => scope.close());
  return scope.run(mainsOf, { input: html });
}

test("rule 1: a main is an element with data-doop-component, with the CSS of its source style", async () => {
  const found = await mains(countMain());

  expect(found).toEqual([
    {
      id: count,
      html: `<span class="count" data-doop-prop="value" data-doop-part="lyrk" data-doop-component="${count}">3</span>`,
      css: `\n${countCss}\n`,
    },
  ]);
});

test("rule 6: a linked copy gets the part of the kit with its own props, its revision and the scoped CSS of the part", async () => {
  const [main] = await mains(countMain(' title="Count"'));
  if (main === undefined) throw new Error("no main");
  const old = { ...main, rev: 5, html: main.html.replace(' title="Count"', "") };
  const filled = await fill(productFrame, [old, { ...main, rev: 6 }]);

  expect(filled.linked).toEqual([count]);
  expect(filled.copies).toEqual([{ id: count, linked: 1, edited: 1 }]);
  expect(filled.html).toContain(
    `<span class="count" title="Count" data-doop-instance="${count}" data-doop-rev="6" data-doop-id="tqhcbt" data-tone="accent" data-doop-props="${props("2")}">2</span>`,
  );
  expect(filled.html).toContain(
    `:where([data-doop-instance="${count}"]) .count[data-shape=dot], .count[data-shape=dot]:where([data-doop-instance="${count}"]) {width:8px}`,
  );
});

test("rule 7: an edited copy keeps each byte after a change of its part", async () => {
  const [main] = await mains(countMain(' title="Count"'));
  if (main === undefined) throw new Error("no main");
  const filled = await fill(productFrame, [{ ...main, rev: 6 }]);

  expect(filled.copies).toEqual([{ id: count, linked: 0, edited: 2 }]);
  expect(filled.html).toContain(editedCopy);
  expect(filled.html).toContain(countCopy("tqhcbt", "2"));
});

test("rule 6: overrides hide or set attributes on a part, a slot keeps the content of the copy, and a copy in a slot follows its own part", async () => {
  const dockCss = "@keyframes pop {from {opacity:0}}\n.dock {animation:pop 1s}";
  const dockMain = (label: string) =>
    `<nav class="dock" data-doop-component="${dock}"><button data-doop-part="ab12" aria-label="${label}">Zoom</button><i data-doop-part="cd34">x</i><span data-doop-slot="badge" data-doop-part="ef56">none</span></nav>`;
  const countPart = {
    id: count,
    rev: 1,
    html: `<span class="count" data-doop-prop="value" data-doop-part="lyrk">3</span>`,
    css: ".count {color:red}",
  };
  const overrides = `{&quot;ab12&quot;:{&quot;attrs&quot;:{&quot;title&quot;:&quot;Fit&quot;}},&quot;cd34&quot;:{&quot;hidden&quot;:true}}`;
  const copy = (label: string) =>
    `<nav class="dock" data-doop-instance="${dock}" data-doop-rev="1" data-doop-id="d0ck01" data-doop-overrides="${overrides}"><button data-doop-part="ab12" aria-label="${label}" title="Fit">Zoom</button><span data-doop-slot="badge" data-doop-part="ef56"><span class="count" data-doop-instance="${count}" data-doop-rev="1" data-doop-id="c0un71" data-doop-props="{&quot;value&quot;:&quot;7&quot;}">7</span></span></nav>`;
  const html = page(
    `<style data-doop-component-css="${dock}">\n</style>\n<style data-doop-component-css="${count}">\n</style>\n`,
    copy("Zoom"),
  );
  const filled = await fill(html, [
    { id: dock, rev: 1, html: dockMain("Zoom"), css: dockCss },
    { id: dock, rev: 2, html: dockMain("Zoom steps"), css: dockCss },
    countPart,
    { ...countPart, rev: 2, html: countPart.html.replace("count", "count count-2") },
  ]);

  expect(filled.copies).toEqual(
    expect.arrayContaining([
      { id: dock, linked: 1, edited: 0 },
      { id: count, linked: 1, edited: 0 },
    ]),
  );
  expect(filled.html).toContain('aria-label="Zoom steps" title="Fit"');
  expect(filled.html).not.toContain(`<i data-doop-part="cd34">`);
  expect(filled.html).toContain(
    `class="count count-2" data-doop-instance="${count}" data-doop-rev="2"`,
  );
  expect(filled.html).toContain(`@keyframes pop__${dock}`);
  expect(filled.html).toContain(`animation:pop__${dock} 1s`);
});

test("rule 3: parts.publish makes each main of a canvas a part at the highest revision of its copies, in a new kit version, and gives gone for no canvas", async () => {
  const { agent } = await easel();
  const ids = await design(agent);

  expect(await publish(agent, "design-system")).toEqual({
    kind: "updated",
    kit: 2,
    rev: 1,
    parts: [{ id: count, name: "Count", rev: 5 }],
  });
  expect(await publish(agent, "design-system")).toEqual({
    kind: "unchanged",
    kit: 2,
    rev: 1,
    parts: [{ id: count, name: "Count", rev: 5 }],
  });
  expect(await publish(agent, "nope")).toEqual({ kind: "gone" });
  expect(await agent.run(parts.api["parts.list"], { input: {} })).toEqual({
    kind: "found",
    kit: 2,
    rev: 1,
    parts: [
      {
        id: count,
        name: "Count",
        rev: 5,
        source: { canvas: "design-system", frame: ids.main, version: 1 },
        copies: [{ canvas: "product", id: ids.copies, linked: 1, edited: 1 }],
      },
    ],
  });
});

test("rule 4 and 8: a put of the main publishes the next revision, each tab with a linked copy gets a new document, and no frame version changes", async () => {
  const { srv, token, agent } = await easel();
  const ids = await design(agent);
  await publish(agent, "design-system");
  const tab = await client(srv.server, token);
  const copies = tab.resolve(frames.board.docs.of({ canvas: "product", id: ids.copies }));
  const plain = tab.resolve(frames.board.docs.of({ canvas: "product", id: ids.plain }));
  let plainDocs = 0;
  closers.push(copies.watch(() => undefined));
  closers.push(plain.watch(() => plainDocs++));
  await until(() => copies.get()?.parts === 2 && plain.get() !== undefined);
  expect(plain.get()?.parts).toBeUndefined();
  const before = plainDocs;

  const changed = countMain(' title="Count"');
  const answer = await agent.run(frames.api["frame.put"], {
    input: { canvas: "design-system", html: changed, id: ids.main, base: 1 },
  });
  expect(answer.kind).toBe("updated");
  await until(() => copies.get()?.parts === 3);
  expect(copies.get()?.html).toContain(
    `title="Count" data-doop-instance="${count}" data-doop-rev="6"`,
  );
  expect(copies.get()?.html).toContain(editedCopy);
  await tick(100);
  expect(plainDocs).toBe(before);

  expect(await shown(agent, "product", ids.copies)).toMatchObject({ kit: 3, version: 1 });
  expect(await agent.run(frames.api["frame.list"], { input: { canvas: "product" } })).toMatchObject(
    {
      kind: "found",
      frames: expect.arrayContaining([expect.objectContaining({ id: ids.copies, version: 1 })]),
    },
  );
});

test("rule 9: a request keeps its parts: the kit version before the publish gives the old part", async () => {
  const { srv, agent } = await easel();
  const ids = await design(agent);
  await publish(agent, "design-system");
  await agent.run(frames.api["frame.put"], {
    input: { canvas: "design-system", html: countMain(' title="Count"'), id: ids.main, base: 1 },
  });

  const old = await srv.server.run(fillAt, { input: { html: productFrame, kit: 2 } });
  const now = await srv.server.run(fillAt, { input: { html: productFrame, kit: 3 } });
  expect(old.html).toContain(countCopy("tqhcbt", "2"));
  expect(now.html).toContain('title="Count"');
  expect((await srv.server.run(fillAt, { input: { html: plainFrame, kit: 3 } })).html).toBe(
    plainFrame,
  );
});

test("parts.show gives the document of a frame as a tab gets it, and gone for no frame", async () => {
  const { agent } = await easel();
  const ids = await design(agent);

  expect((await shown(agent, "product", ids.copies)).html).toBe(productFrame);
  await publish(agent, "design-system");
  const after = await shown(agent, "product", ids.copies);
  expect(after).toMatchObject({ kind: "found", kit: 2, version: 1 });
  expect(after.html).toContain(".count[data-shape=dot]");
  expect(await show(agent, "product", "000000000000")).toEqual({ kind: "gone" });
});

test("rule 5: a start publishes a main that a put left out of the kit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-parts-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "easel.db");
  const first = await easel(file);
  const ids = await design(first.agent);
  await publish(first.agent, "design-system");
  await first.srv.server.close();

  const db = new Database(file);
  db.query("UPDATE frames_frames SET html = ?, version = 2 WHERE id = ?").run(
    countMain(' title="Count"'),
    ids.main,
  );
  db.close();

  const again = await boot(file);
  const listed = await again.server.run(partsOps["parts.list"], { input: {} });
  expect(listed).toMatchObject({ kit: 3, rev: 2, parts: [{ id: count, rev: 6 }] });
  await again.server.close();

  const later = new Database(file);
  later
    .query("UPDATE frames_frames SET html = ?, version = 3 WHERE id = ?")
    .run(countMain(' title="Count"').replace("</body>", "<p>Notes</p></body>"), ids.main);
  later.close();

  const third = await boot(file);
  const same = await third.server.run(partsOps["parts.list"], { input: {} });
  expect(same).toMatchObject({ kit: 3, rev: 2, parts: [{ id: count, rev: 6 }] });
}, 30_000);

test("rule 4: a put of a source frame that keeps its main publishes nothing new", async () => {
  const { agent } = await easel();
  const ids = await design(agent);
  await publish(agent, "design-system");

  const html = countMain().replace("</body>", "<p>Notes</p></body>");
  const answer = await agent.run(frames.api["frame.put"], {
    input: { canvas: "design-system", html, id: ids.main, base: 1 },
  });
  expect(answer.kind).toBe("updated");
  expect(await agent.run(parts.api["parts.list"], { input: {} })).toMatchObject({
    kit: 2,
    rev: 1,
    parts: [{ id: count, rev: 5, source: { version: 1 } }],
  });
});
