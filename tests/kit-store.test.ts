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
import { maxFindings } from "@/frames/contract";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer, readDoc } from "@/frames/store.server";
import { compose, contrast } from "@/kit/compose";
import { makeFrame } from "@/kit/make.server";
import { frameKit, readKit, seedKit } from "@/kit/store.server";

import { bad, frame } from "./kit/fixture";

// The kit's state and its use at a put and at a show (SPEC-kit.md; ADR kit-on-tailwind, build
// order step 2), against the Kit model (docs/statecharts/models/kit/Kit.tla, its Init and the
// rules that a store with only the seed reaches): a new easel's frames are in the seed look (K1),
// a stored frame version shows the same bytes after a new make and after a restart (K11), a put
// answers the findings of K5, and the board's cell `kit` is written at scope.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const tick = (ms = 20) => new Promise((done) => setTimeout(done, ms));

async function until(ok: () => boolean) {
  for (let i = 0; i < 150 && !ok(); i++) await tick();
  expect(ok()).toBe(true);
}

/** One server: SQLite, access, frames (with the kit) and a memory transport, as cmds/server.ts. */
async function boot(file = ":memory:") {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const services = [access.login, access.user, frames.api, frames.board];
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
      memory.server({ services }),
    ],
  }).ready;
  closers.push(() => server.close());
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, setupCode };
}

type Server = Awaited<ReturnType<typeof boot>>;

/** One client: an agent's CLI or a viewer's tab, signed in with `token`, or with none. */
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
    ],
  }).ready;
  closers.push(() => scope.close());

  return scope;
}

/** Ann, the first owner: her token. */
async function signedIn(srv: Server) {
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await client(srv.server);
  const answer = await login.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  expect(answer.kind).toBe("granted");
  await login.close();

  return text;
}

/** A server, Ann's agent, and the canvas `flow`. */
async function easel(file?: string) {
  const srv = await boot(file);
  const token = await signedIn(srv);
  const agent = await client(srv.server, token);
  await agent.run(frames.api["canvas.create"], { input: { name: "flow" } });
  return { srv, token, agent };
}

/** Puts a new frame on `flow`: its answer. */
const put = (agent: Scope.Handle, html: string) =>
  agent.run(frames.api["frame.put"], { input: { canvas: "flow", html } });

/** A tab's read of the board: the frame's document and the canvas's kit, once both have come. */
async function shown(tab: Scope.Handle, id: string) {
  const doc = tab.resolve(frames.board.docs.of({ canvas: "flow", id }));
  const kit = tab.resolve(frames.board.kit.of({ canvas: "flow" }));
  const stops = [doc.watch(() => undefined), kit.watch(() => undefined)];
  closers.push(() => stops.forEach((stop) => stop()));
  await until(() => doc.get() !== undefined && kit.get() !== undefined);

  const at = doc.get();
  const look = kit.get();
  if (!at || !look) throw new Error("not read");

  return { doc: at, kit: look, html: tab.run(compose, { input: { ...at, kit: look } }) };
}

/** The id of a put that made a frame. */
function idOf(answer: Awaited<ReturnType<typeof put>>) {
  if (answer.kind !== "created") throw new Error(`not created: ${answer.kind}`);
  return answer.id;
}

// ---- K1: a new easel's first frame is in the seed look

test("K1: a new easel's first frame shows in the seed look: compose holds the look, the kit's CSS and the frame's CSS", async () => {
  const { srv, token, agent } = await easel();
  const answer = await put(agent, await frame("form"));
  const tab = await client(srv.server, token);
  const { doc, kit, html } = await shown(tab, idOf(answer));

  // K5: a seed fixture finds nothing.
  expect(answer).toMatchObject({ kind: "created", findings: [], more: 0 });
  expect(kit.kit).toBe(1);
  expect(html.startsWith('<!doctype html>\n<style id="easel-look">:root {\n')).toBe(true);
  expect(html).toContain("  --primary: #171717;\n");
  expect(html).toContain("  --warning: #8a5a00;\n");
  expect(html).toContain("  --text-sm: 0.875rem;\n");
  expect(html).toContain(`<style id="easel-kit">${kit.css}</style>`);
  expect(kit.css).toContain(".btn-primary {");
  expect(kit.css).toContain("box-sizing: border-box;");
  expect(kit.css).toContain("@layer base");
  expect(kit.css).not.toMatch(/--primary:/);
  expect(html).toContain(`<style id="easel-frame">${doc.css}</style>`);
  expect(doc.css).toContain("@layer utilities");
  expect(html).toContain('{easel:"hello"}');
  expect(html.endsWith((await frame("form")).replace(/^<!doctype html>/i, ""))).toBe(true);
});

test("K5: each seed fixture finds nothing at its put", async () => {
  const { agent } = await easel();
  for (const name of ["form", "list", "dashboard"]) {
    expect(await put(agent, await frame(name))).toMatchObject({ findings: [], more: 0 });
  }
});

test("K5 fixes in the seed look: a palette red or green gives the semantic color (destructive, success), not a chart color; a yellow, with no semantic color near it, gives chart-4", async () => {
  const { agent } = await easel();
  const html =
    '<p class="text-red-500">a</p><p class="bg-green-600">b</p><p class="text-yellow-400">c</p>' +
    '<p style="color: #ef4444">d</p>';
  const answer = await put(agent, html);
  if (answer.kind !== "created") throw new Error(`not created: ${answer.kind}`);

  expect(answer.findings.map((f) => f.fix)).toEqual([
    "use text-destructive",
    "use bg-success",
    "use text-chart-4",
    "use var(--destructive)",
  ]);
});

// ---- The seed: DTCG 2025.10, K8, and the model's Init

test("the seed is kit version 1: a DTCG 2025.10 look with revision 1, from shadcn/ui, that passes K8", async () => {
  const { srv } = await easel();
  const now = await srv.server.run(readKit);
  if (!now) throw new Error("no kit version");

  expect(now).toMatchObject({ version: 1, lookRev: 1, pieces: [] });
  expect(now.look.$schema).toBe("https://www.designtokens.org/schemas/2025.10/format.json");
  expect(now.look).toMatchObject({
    color: {
      $type: "color",
      warning: { $value: { colorSpace: "srgb", hex: "#8a5a00" } },
      primary: { $value: { colorSpace: "srgb", components: [0.0902, 0.0902, 0.0902] } },
    },
    font: { display: { $value: "{font.sans}" } },
    spacing: { $type: "dimension", $value: { value: 0.25, unit: "rem" } },
  });
  // An alias takes the value that it names.
  expect(now.values["--font-display"]).toBe(now.values["--font-sans"]);
  expect(now.values["--shadow-sm"]).toBe("0px 1px 3px 0px #0000001a, 0px 1px 2px -1px #0000001a");
  expect(now.root).toContain(
    '  --font-sans: ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji"',
  );

  // NoStoredLookIsUnreadable: each pair of K8 passes, warning on muted with the fixed #8a5a00.
  const pairs = srv.server.run(contrast, { input: { look: now.values, css: now.source } });
  expect(pairs.filter((p) => p.ratio < p.min)).toEqual([]);
  expect(pairs.find((p) => p.text === "warning" && p.on === "muted")?.ratio).toBe(5.44);
  expect(pairs).toContainEqual({
    text: "success",
    on: "success-soft",
    ratio: expect.any(Number),
    min: 4.5,
    where: "the kit rule .badge-success",
  });
  expect(pairs.find((p) => p.text === "input")).toMatchObject({ on: "background", min: 3 });
});

test("contrast finds a failing pair: the shadcn/ui muted-foreground on muted is 4.35:1; a color it cannot read fails", async () => {
  const { srv } = await easel();
  const now = await srv.server.run(readKit);
  if (!now) throw new Error("no kit version");

  const look = { ...now.values, "--muted-foreground": "#737373", "--ring": "oklch(0.7 0 0)" };
  const fails = srv.server
    .run(contrast, { input: { look, css: now.source } })
    .filter((p) => p.ratio < p.min);
  expect(fails).toContainEqual({
    text: "muted-foreground",
    on: "muted",
    ratio: 4.35,
    min: 4.5,
    where: "text on --muted",
  });
  expect(fails).toContainEqual({
    text: "ring",
    on: "background",
    ratio: 0,
    min: 3,
    where: "the focus ring",
  });
  // A text color with alpha is laid on its surface first: half black on white.
  const half = { ...now.values, "--foreground": "#00000080" };
  const pairs = srv.server.run(contrast, { input: { look: half, css: "" } });
  expect(pairs.find((p) => p.text === "foreground" && p.on === "background")?.ratio).toBe(4);
});

// ---- K11: the bytes of a stored frame version never change

test("K11: a stored frame version composes to the same bytes after the make runs again and after a restart; a show makes no CSS", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-kit-"));
  const file = join(dir, "easel.db");
  try {
    const first = await easel(file);
    const html = await frame("dashboard");
    const id = idOf(await put(first.agent, html));
    const before = await shown(await client(first.srv.server, first.token), id);
    // The make step again, on the same document and kit: the same bytes as stored.
    const kit = await first.srv.server.run(frameKit);
    const again = await first.srv.server.run(makeFrame, { input: { html, kit } });
    expect(again).toMatchObject({ kind: "made", css: before.doc.css });
    for (const close of closers.splice(0).reverse()) await close();

    const rows = () => {
      const db = new Database(file);
      const all = db.query("SELECT version, css, root FROM kit_versions").all();
      db.close();
      return all;
    };
    const stored = rows();
    expect(stored).toHaveLength(1);

    // A restart: the seed is not written again (AKitVersionNeverChanges), and the tab shows the
    // stored rows, byte for byte. The users are in the same file: Ann's token still works.
    const second = await boot(file);
    expect(await second.server.run(seedKit)).toEqual({ kind: "kept" });
    const after = await shown(await client(second.server, first.token), id);
    expect(after.html).toBe(before.html);
    expect(rows()).toEqual(stored);

    // A show reads only the stored CSS: a changed row is what the tab gets, with no new make.
    for (const close of closers.splice(0).reverse()) await close();
    const db = new Database(file);
    db.run("UPDATE frames_frames SET css = ? WHERE id = ?", [`${before.doc.css}/* kept */`, id]);
    db.close();
    const third = await boot(file);
    const kept = await shown(await client(third.server, first.token), id);
    expect(kept.doc.css).toBe(`${before.doc.css}/* kept */`);
  } finally {
    for (const close of closers.splice(0).reverse()) await close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);

// ---- The make step through put: the same frame gives the same bytes, in any order

test("two orders of puts give each frame the same made CSS, with no class of another frame", async () => {
  const a = `<p class="p-4 text-primary">a</p>`;
  const b = `<p class="mt-8 bg-muted rounded-md">b</p>`;
  const c = await frame("list");
  const cssOf = async (srv: Server, answer: Awaited<ReturnType<typeof put>>) =>
    (await srv.server.run(readDoc, { input: { canvas: "flow", id: idOf(answer) } }))?.css;

  const one = await easel();
  const first = [await put(one.agent, a), await put(one.agent, b), await put(one.agent, c)];
  const two = await easel();
  const second = [await put(two.agent, c), await put(two.agent, b), await put(two.agent, a)];

  const [a1, b1, c1] = await Promise.all(first.map((x) => cssOf(one.srv, x)));
  const [c2, b2, a2] = await Promise.all(second.map((x) => cssOf(two.srv, x)));
  expect(a2).toBe(a1);
  expect(b2).toBe(b1);
  expect(c2).toBe(c1);
  expect(b1).toContain(".mt-8");
  expect(b1).not.toContain(".p-4");
  expect(a2).not.toContain(".mt-8");
});

// ---- K5 at put

test("K5 at put: a put answers each finding with its line and column, saves the frame, and keeps only the classes that pass", async () => {
  const { srv, agent } = await easel();
  const answer = await put(agent, await bad());
  if (answer.kind !== "created") throw new Error(`not created: ${answer.kind}`);

  expect(answer.findings.map((f) => `${f.line}:${f.col} ${f.rule}`)).toEqual([
    "3:37 look/color",
    "4:13 look/color",
    "7:15 look/color",
    "8:15 kit/class",
    "8:42 kit/class",
    "9:16 look/color",
    "9:59 look/size",
    "10:13 look/color",
    "12:52 look/color",
    "13:3 kit/piece",
    "16:3 look/color",
    "18:3 look/override",
    "22:43 kit/script",
  ]);
  expect(answer.more).toBe(0);
  const doc = await srv.server.run(readDoc, { input: { canvas: "flow", id: answer.id } });
  expect(doc?.css).toContain("padding: 13px");
  expect(doc?.css).not.toContain("red-500");
});

test("a put with more than 20 findings answers the first 20 and the count of the rest; unchanged answers them too", async () => {
  const { agent } = await easel();
  const html = Array.from({ length: 27 }, (_, i) => `<p class="bgg-primary">${i}</p>`).join("\n");
  const made = await put(agent, html);
  if (made.kind !== "created") throw new Error(`not created: ${made.kind}`);
  expect(made.findings).toHaveLength(maxFindings);
  expect(made.more).toBe(7);
  expect(made.findings[19]).toMatchObject({ line: 20, rule: "kit/class" });

  const again = await agent.run(frames.api["frame.put"], {
    input: { canvas: "flow", id: made.id, base: 1, html },
  });
  expect(again).toMatchObject({ kind: "unchanged", more: 7 });
});

test("a frame with the kit off gets no made CSS and no finding, and shows as it is", async () => {
  const { srv, token, agent } = await easel();
  const html = `<!doctype html><meta name="easel-kit" content="off"><p class="text-red-500" style="color:#f00">x</p>`;
  const answer = await put(agent, html);
  expect(answer).toMatchObject({ kind: "created", findings: [], more: 0 });

  const { doc, html: composed } = await shown(await client(srv.server, token), idOf(answer));
  expect(doc.css).toBeNull();
  expect(composed).toBe(html);
});

test("a put whose made CSS would be over 256 KiB answers tooBig and writes nothing", async () => {
  const { agent } = await easel();
  const classes = Array.from({ length: 9000 }, (_, i) => `w-[${i + 1}px]`).join(" ");

  expect(await put(agent, `<p class="${classes}">`)).toEqual({ kind: "tooBig", maxBytes: 262144 });
  expect(await agent.run(frames.api["frame.list"], { input: { canvas: "flow" } })).toEqual({
    kind: "found",
    frames: [],
  });
}, 30_000);

// ---- The board's cell `kit`: at scope, under mayRead (SPEC-kit judged rule 6)

test("the board's cell kit is set at scope: a second session sees it, for a canvas made in another session too", async () => {
  const { srv, token, agent } = await easel();
  await agent.run(frames.api["canvas.create"], { input: { name: "later" } });
  const now = await srv.server.run(readKit);

  const tab = await client(srv.server, token);
  for (const canvas of ["flow", "later"]) {
    const read = tab.resolve(frames.board.kit.of({ canvas }));
    const stop = read.watch(() => undefined);
    closers.push(stop);
    await until(() => read.get() !== undefined);
    // TheNewestKitVersionIsTheStoredOne, ATabShowsOnlyAStoredKitVersion.
    expect(read.get()).toEqual({
      canvas,
      kit: now?.version,
      look: now?.root,
      css: now?.css,
      pieces: [],
    });
  }
});

test("a read of the cell kit with no user is refused, sign in", async () => {
  const { srv } = await easel();
  const guest = await client(srv.server);
  const read = guest.resolve(frames.board.kit.of({ canvas: "flow" }));
  const stop = read.watch(() => undefined);
  closers.push(stop);

  await until(() => guest.resolve(frames.board.faults).get().kit !== undefined);
  const error = guest.resolve(frames.board.faults).get().kit;
  expect(frames.board.fault.is(error) && error.fault).toBe("refused");
  expect(read.get()).toBeUndefined();
});

// ---- compose

test("compose: no made CSS gives the document as it is; else the doctype once, and no style text ends its element", async () => {
  const { srv } = await easel();
  const kit = { look: ":root {\n  --primary: #171717;\n}\n", css: ".x{content:'</style>'}" };
  const run = (html: string, css: string | null) =>
    srv.server.run(compose, { input: { html, css, kit } });

  expect(run("<p>as is</p>", null)).toBe("<p>as is</p>");
  const made = run("﻿ <!DOCTYPE html>\n<p>x</p>", ".p{}</STYLE>");
  expect(made.match(/<!doctype/gi)).toHaveLength(1);
  expect(made).toContain(".x{content:'<\\/style>'}");
  expect(made).toContain(".p{}<\\/STYLE>");
  expect(made.endsWith("\n\n<p>x</p>")).toBe(true);
});

test("the piece script is at most 3 KiB, holds no color, size or font, and says only hello to its parent", async () => {
  const { pieceScript } = await import("@/kit/compose");

  expect(new TextEncoder().encode(pieceScript).length).toBeLessThanOrEqual(3 * 1024);
  expect(pieceScript).not.toMatch(/#[0-9a-f]{3}|rgb|hsl|\dpx|\drem|font/i);
  expect(pieceScript.match(/postMessage\(/g)).toHaveLength(1);
  expect(pieceScript).toContain('parent.postMessage({easel:"hello"},"*")');
  expect(pieceScript).toContain("setTimeout(h,50)");
  expect(pieceScript).toContain("e.source!==parent");
});

test("the preflight in the kit is the one of the pinned Tailwind, byte for byte", async () => {
  const { preflight } = await import("@/kit/preflight.server");
  const file = new URL("../node_modules/tailwindcss/preflight.css", import.meta.url);
  expect(preflight).toBe(await Bun.file(file).text());
});

// ---- The speed budget at put (SPEC-kit § The make step): the check and the make in frame.put

test("speed: a put with the check and the make stays in the budget, for a usual frame and for 1 MiB", async () => {
  const { srv } = await easel();
  const { putFrame } = await import("@/frames/ops.server");
  const one = await frame("dashboard");
  const big = one.repeat(Math.ceil((1024 * 1024 - 4096) / one.length)).slice(0, 1024 * 1024 - 4096);
  const p50 = async (html: string, runs: number) => {
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      await srv.server.run(putFrame, { input: { canvas: "flow", html: `${html}<!--${i}-->` } });
      times.push(performance.now() - start);
    }
    return times.toSorted((x, y) => x - y)[Math.floor(runs / 2)] ?? Infinity;
  };
  await p50(one, 1);

  const usual = await p50(one, 15);
  const large = await p50(big, 3);
  // Measured on 2026-11-22: p50 4 ms usual, 32 to 43 ms for 1 MiB. The budget is 50 ms for the
  // chain; the put adds its write. Loose, so a loaded host does not fail it.
  expect(usual).toBeLessThan(50);
  expect(large).toBeLessThan(400);
}, 60_000);
