import { createSocket } from "node:dgram";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { connect, createServer, Socket } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Operation } from "@tinkered/core";
import { makeTestClock, memory, preset } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { routes } from "~/components/requests/index.server";

import { frames } from "@/frames";
import { frames as frameCells, kept, picturePath, removed } from "@/frames/contract";
import { secretName, keyMatches, pictureKey } from "@/frames/keys.server";
import { createCanvas, deleteFrame, framesLoads, putFrame } from "@/frames/ops.server";
import {
  chromiumBrowser,
  chromiumCheck,
  drawLimitMs,
  drawPage,
  drawSlots,
  drawsAtOnce,
  egressProxy,
  hostLookup,
  pictureCache,
  pictureRoute,
  picturesServer,
  proxyDial,
  proxyWaitMs,
  publicAddress,
  render,
  shotFrame,
  slotWaitMs,
} from "@/frames/pictures.server";
import { bumpKeys, framesServer } from "@/frames/store.server";
import { queueServer, saveRequest } from "@/queue/store.server";

import { localChromium } from "./support/chromium";

// Pictures (SPEC-frames.md § Pictures), against the frames-pictures chart (docs/statecharts/
// frames-pictures.md, models/frames/Pictures.tla). Each test that follows an arrow or a rule is
// named by its wording. The route runs as the cmd's table runs it; a test draw stands in for
// Chromium where the test is about the route, and the last tests draw with a real one.
//
// The chart's "the link ends" is the bump, `bumpKeys`: its tests here reach it. Its callers,
// `easel unshare` and a password set or changed, are wired in ship 5.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/** Lets a run reach its next wait. */
const tick = (ms = 5) => new Promise((done) => setTimeout(done, ms));

/** Waits until `ok` holds, a tick at a time, up to 2 s. */
async function until(ok: () => boolean) {
  for (let i = 0; i < 400 && !ok(); i++) await tick();
  expect(ok()).toBe(true);
}

/** The answer, which must come within 1 s: a wait the clock should have ended fails here, not by timeout. */
async function soon<T>(answer: Promise<T>) {
  const late = Symbol("late");
  const got = await Promise.race([answer, tick(1_000).then(() => late)]);
  expect(got).not.toBe(late);
  return answer;
}

type DrawInput = Operation.Ctx<z.infer<typeof drawInput>>;

const drawInput = z.object({
  html: z.string(),
  w: z.number(),
  h: z.number(),
  scale: z.number(),
  region: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});

/**
 * The test's Chromium: each draw is kept, with what it was given, and answers its document's
 * text as its bytes. Held, a draw waits until the test lets it go, or until it is stopped.
 * Lingering, a stopped draw ends only when the test ends it, as a page slow to close.
 */
function testDraws() {
  const seen: Array<{
    input: DrawInput["input"];
    go: () => void;
    end: () => void;
    stopped: boolean;
  }> = [];
  const state = { held: false, fail: false, linger: false };
  return {
    seen,
    hold: () => (state.held = true),
    linger: () => (state.linger = true),
    /** Each draw from now fails, as a Chromium that crashed. */
    fail: () => (state.fail = true),
    run: async (ctx: DrawInput) => {
      const gate = Promise.withResolvers<void>();
      const end = () => gate.reject(new Error("stopped"));
      const draw = { input: ctx.input, go: gate.resolve, end, stopped: false };
      seen.push(draw);

      ctx.signal.addEventListener("abort", () => {
        draw.stopped = true;
        if (!state.linger) end();
      });

      if (!state.held) gate.resolve();
      await gate.promise;

      if (state.fail) throw new Error("Chromium crashed");
      return new TextEncoder().encode(`drawn:${ctx.input.html}`);
    },
  };
}

/** The board's member for a frame, on the server: what a tab reads, with its key `k`. */
const boardMember = operation({
  label: "test.boardMember",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { cells: frameCells.atScope.controller },
  run: ({ cells }, { input }) => cells.of(input).get(),
});

/** The board's kept versions and removed frames of a canvas, on the server. */
const boardKept = operation({
  label: "test.boardKept",
  input: z.object({ canvas: z.string() }),
  depends: { versions: kept.atScope.controller, gone: removed.atScope.controller },
  run: ({ versions, gone }, { input }) => ({
    kept: versions
      .where(input)
      .get()
      .toSorted((a, b) => a.version - b.version),
    removed: gone.where(input).get(),
  }),
});

let requestKeys = 0;

type Boot = {
  /** EASEL_CHROMIUM; by default a file that runs, with the test's draws. */
  chromium?: string | null;
  /** The real Chromium draws: no test draws. */
  real?: boolean;
  file?: string;
  /** How the proxy resolves a name, and how it dials an address; by default the real ones. */
  lookup?: (host: string) => Promise<Array<{ address: string; family: number }>>;
  dial?: (address: string) => Socket;
};

/** One server: SQLite, pictures and frames, the board on a memory transport, and the route. */
async function boot(options: Boot = {}) {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const draws = testDraws();
  const stdout = { write: () => undefined };
  const stop = new AbortController();
  const file = options.file ?? ":memory:";
  const server = await createScope({
    clock,
    tags: [
      ...(options.lookup ? [hostLookup(options.lookup)] : []),
      ...(options.dial ? [proxyDial(options.dial)] : []),
    ],
    presets: options.real ? [] : [preset(drawPage, (_, ctx) => draws.run(ctx))],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file }),
      picturesServer({
        chromium: options.chromium === undefined ? process.execPath : options.chromium,
        database: file,
      }),
      framesServer({ stdout }),
      queueServer({ stdout }),
      frames.board({ serve: true, load: framesLoads }),
      memory.server({ services: [frames.board] }),
      routes({
        stop: stop.signal,
        table: { "GET /api/pictures/{canvas}/{id}/{version}": pictureRoute },
      }),
    ],
  }).ready;
  closers.push(() => (stop.abort(), server.close()));
  const fetch = server.resolve(routes).fetch;

  return {
    server,
    clock,
    draws,
    /** One request to the route, as a browser sends it. */
    get: async (path: string, signal?: AbortSignal) => {
      const answer = await fetch(new Request(`http://easel.test${path}`, { signal }), server);
      if (!answer) throw new Error(`no route answers ${path}`);
      return answer;
    },
    canvas: (name: string) => server.run(createCanvas, { input: { name } }),
    /** A new frame: its id. */
    put: async (input: { canvas: string; html: string; size?: { w: number; h: number } }) => {
      const made = await server.run(putFrame, { input });
      if (made.kind !== "created") throw new Error(made.kind);
      return made;
    },
    write: (canvas: string, id: string, base: number, html: string) =>
      server.run(putFrame, { input: { canvas, id, base, html } }),
    rm: (canvas: string, id: string) => server.run(deleteFrame, { input: { canvas, id } }),
    bump: (canvas: string) => server.run(bumpKeys, { input: { canvas } }),
    member: async (canvas: string, id: string) => {
      const got = server.run(boardMember, { input: { canvas, id } });
      if (!got) throw new Error(`no member ${canvas}/${id}`);
      return got;
    },
    /** The address a tab builds from the board: `s=0.5` and the member's key. */
    address: async (canvas: string, id: string, query = "s=0.5") => {
      const got = server.run(boardMember, { input: { canvas, id } });
      return `/api/pictures/${canvas}/${id}/${got?.version}?${query}&k=${got?.k}`;
    },
    keyFor: (canvas: string, id: string, version: number, gen: number) =>
      server.run(pictureKey, { input: { canvas, id, version, gen } }),
    /** A viewer asks for a change on version `version` of the frame: the queue refers to it. */
    refer: async (canvas: string, id: string, version: number) => {
      const n = ++requestKeys;
      const now = clock.currentTimeMillis();
      const added = await server.run(saveRequest, {
        input: {
          canvas,
          id: `req${String(n).padStart(9, "0")}`,
          frameId: id,
          version,
          x: 1,
          y: 2,
          text: "Change it.",
          key: `pictures-key-${String(n).padStart(8, "0")}`,
          author: "Mai",
          message: `msg${String(n).padStart(9, "0")}`,
          now,
        },
      });
      expect(added.kind).toBe("added");
    },
    /** The kept versions and removed frames that the board carries for a canvas. */
    kept: (canvas: string) => server.run(boardKept, { input: { canvas } }),
    /** The address of a kept version, from the board's key for it. */
    keptAddress: (canvas: string, id: string, version: number, query = "s=0.5") => {
      const got = server
        .run(boardKept, { input: { canvas } })
        .kept.find((v) => v.id === id && v.version === version);
      return `/api/pictures/${canvas}/${id}/${version}?${query}&k=${got?.k}`;
    },
  };
}

type Server = Awaited<ReturnType<typeof boot>>;

/** A server with a canvas `flow` and one frame on it, `<p>1</p>` at 400x300. */
async function withFrame(options: Boot = {}) {
  const srv = await boot(options);
  await srv.canvas("Flow");
  const made = await srv.put({ canvas: "flow", html: "<p>1</p>", size: { w: 400, h: 300 } });

  return { ...srv, id: made.id };
}

const text = async (answer: Response) => new TextDecoder().decode(await answer.arrayBuffer());

/** A refusal: its status, no body, and nothing kept. */
async function refused(answer: Response, status: number) {
  expect(answer.status).toBe(status);
  expect(answer.headers.get("cache-control")).toBe("no-store");
  expect(await answer.arrayBuffer()).toHaveProperty("byteLength", 0);
}

// ---- The board's keys, and the current version

test("the board carries each frame's key: HMAC of the secret, the canvas, the id, the version and the generation", async () => {
  const srv = await withFrame();
  const member = await srv.member("flow", srv.id);
  expect(member.k).toBe(srv.keyFor("flow", srv.id, 1, 0));
  expect(member.k).toMatch(/^[\w-]{43}$/);

  const tab = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: srv.server }),
      frames.board({ read: memory.client }),
    ],
  }).ready;
  closers.push(() => tab.close());
  const read = tab.resolve(frames.board.frames.where({ canvas: "flow" }));
  const stopWatch = read.watch(() => undefined);
  await until(() => read.get().length === 1);
  expect(read.get()[0]?.k).toBe(member.k);
  stopWatch();
});

test("the tab asks for its address; the server takes that version's document; the picture goes out, private and immutable", async () => {
  const srv = await withFrame();
  const answer = await srv.get(await srv.address("flow", srv.id));

  expect(answer.status).toBe(200);
  expect(answer.headers.get("content-type")).toBe("image/webp");
  expect(answer.headers.get("cache-control")).toBe(pictureCache);
  expect(pictureCache).toBe("private, max-age=31536000, immutable");
  expect(await text(answer)).toBe("drawn:<p>1</p>");
  expect(srv.draws.seen.map((d) => d.input)).toEqual([
    { html: "<p>1</p>", w: 400, h: 300, scale: 0.5, region: { x: 0, y: 0, w: 400, h: 300 } },
  ]);
});

test("a region and each of the four scales go to the draw as asked", async () => {
  const srv = await withFrame();
  for (const s of ["0.25", "0.5", "1", "2"]) {
    const answer = await srv.get(await srv.address("flow", srv.id, `s=${s}&r=10,20,30,40`));
    expect(answer.status).toBe(200);
  }
  expect(srv.draws.seen.map((d) => [d.input.scale, d.input.region])).toEqual(
    [0.25, 0.5, 1, 2].map((scale) => [scale, { x: 10, y: 20, w: 30, h: 40 }]),
  );
});

// ---- 404: a wrong key, a missing frame, a version not yet made

test("a wrong key, no key, or another frame's key answers 404, and nothing is drawn", async () => {
  const srv = await withFrame();
  const other = await srv.put({ canvas: "flow", html: "<p>2</p>" });
  const good = await srv.address("flow", srv.id);
  const theirs = (await srv.member("flow", other.id)).k;

  await refused(await srv.get(good.replace(/k=[\w-]+/, "k=AAAA")), 404);
  await refused(await srv.get(good.replace(/&k=[\w-]+/, "")), 404);
  await refused(await srv.get(good.replace(/k=[\w-]+/, `k=${theirs}`)), 404);
  const flipped = good.replace(/k=([\w-])/, (_, c: string) => `k=${c === "A" ? "B" : "A"}`);
  await refused(await srv.get(flipped), 404);
  expect(srv.draws.seen).toEqual([]);
});

test("a frame that is not there, a canvas that is not there, or a version that is not a number answers 404", async () => {
  const srv = await withFrame();

  const k = (await srv.member("flow", srv.id)).k;
  await refused(await srv.get(`/api/pictures/flow/000000000000/1?s=1&k=${k}`), 404);
  await refused(await srv.get(`/api/pictures/nope/${srv.id}/1?s=1&k=${k}`), 404);
  await refused(await srv.get(`/api/pictures/flow/${srv.id}/one?s=1&k=${k}`), 404);
  await refused(await srv.get(`/api/pictures/flow/${srv.id}/0?s=1&k=${k}`), 404);
  expect(srv.draws.seen).toEqual([]);
});

test("a version not yet made answers 404, even with its right key", async () => {
  const srv = await withFrame();
  const k = srv.keyFor("flow", srv.id, 2, 0);
  await refused(await srv.get(`/api/pictures/flow/${srv.id}/2?s=1&k=${k}`), 404);
  expect(srv.draws.seen).toEqual([]);
});

// ---- 307: an old address (AnOldAddressIsRedirectedNotDrawn)

test("an agent writes the frame; the tab asks for its old address; the server redirects to the current version", async () => {
  const srv = await withFrame();
  const old = await srv.address("flow", srv.id, "s=2&r=1,2,3,4");
  expect((await srv.write("flow", srv.id, 1, "<p>2</p>")).kind).toBe("updated");

  const answer = await srv.get(old);
  expect(answer.status).toBe(307);
  expect(answer.headers.get("cache-control")).toBe("no-store");
  const now = await srv.member("flow", srv.id);
  expect(answer.headers.get("location")).toBe(
    `/api/pictures/flow/${srv.id}/2?s=2&k=${now.k}&r=1,2,3,4`,
  );
  expect(srv.draws.seen).toEqual([]);

  // The browser follows it: the current version, drawn.
  const followed = await srv.get(answer.headers.get("location") ?? "");
  expect(followed.status).toBe(200);
  expect(await text(followed)).toBe("drawn:<p>2</p>");
});

test("the board shows the current address: a write gives the member the new version's key", async () => {
  const srv = await withFrame();
  const before = await srv.member("flow", srv.id);
  await srv.write("flow", srv.id, 1, "<p>2</p>");
  const after = await srv.member("flow", srv.id);

  expect(after.version).toBe(2);
  expect(after.k).toBe(srv.keyFor("flow", srv.id, 2, 0));
  expect(after.k).not.toBe(before.k);
});

// ---- APictureShowsTheVersionItsAddressNames

test("a write that lands during the draw: the picture sent is still the version its address names", async () => {
  const srv = await withFrame();
  srv.draws.hold();
  const asked = srv.get(await srv.address("flow", srv.id));
  await until(() => srv.draws.seen.length === 1);
  await srv.write("flow", srv.id, 1, "<p>2</p>");
  srv.draws.seen[0]?.go();

  const answer = await asked;
  expect(answer.status).toBe(200);
  expect(answer.headers.get("cache-control")).toBe(pictureCache);
  expect(await text(answer)).toBe("drawn:<p>1</p>");
});

// ---- ADeletedFramesPictureIsSentOnlyIfKept

test("an agent deletes the frame; the tab asks for its address; the server answers 404", async () => {
  const srv = await withFrame();
  const address = await srv.address("flow", srv.id);
  await srv.rm("flow", srv.id);
  await refused(await srv.get(address), 404);
  expect(srv.draws.seen).toEqual([]);
});

test("a delete that lands during the draw: the server answers 404 [frame deleted]", async () => {
  const srv = await withFrame();
  srv.draws.hold();
  const asked = srv.get(await srv.address("flow", srv.id));
  await until(() => srv.draws.seen.length === 1);

  await srv.rm("flow", srv.id);
  srv.draws.seen[0]?.go();

  await refused(await asked, 404);
});

test("an old address of a deleted frame answers 404, not a redirect", async () => {
  const srv = await withFrame();
  const old = await srv.address("flow", srv.id);
  await srv.write("flow", srv.id, 1, "<p>2</p>");
  await srv.rm("flow", srv.id);
  await refused(await srv.get(old), 404);
});

// ---- Kept versions (AKeptVersionIsDrawnNotRedirected, judged rule 16)

test("a request refers to an old version; the tab asks for its kept address; the server takes that version's document, private and immutable, and redirects nothing (AKeptVersionIsDrawnNotRedirected)", async () => {
  const srv = await withFrame();
  await srv.refer("flow", srv.id, 1);
  // Before the put, version 1 is current: the board has no kept key for it yet.
  expect(srv.kept("flow").kept).toEqual([]);
  await srv.write("flow", srv.id, 1, "<p>2</p>");

  // The put kept version 1, and the board carries its key.
  expect(srv.kept("flow").kept).toEqual([
    { canvas: "flow", id: srv.id, version: 1, k: srv.keyFor("flow", srv.id, 1, 0) },
  ]);
  const answer = await srv.get(srv.keptAddress("flow", srv.id, 1));
  expect(answer.status).toBe(200);
  expect(answer.headers.get("cache-control")).toBe(pictureCache);
  expect(await text(answer)).toBe("drawn:<p>1</p>");
  expect(srv.draws.seen.map((d) => [d.input.w, d.input.h])).toEqual([[400, 300]]);

  // A version no request refers to is not kept: its address still redirects.
  await srv.write("flow", srv.id, 2, "<p>3</p>");
  const two = `/api/pictures/flow/${srv.id}/2?s=0.5&k=${srv.keyFor("flow", srv.id, 2, 0)}`;
  expect((await srv.get(two)).status).toBe(307);
  expect(srv.kept("flow").kept.map((v) => v.version)).toEqual([1]);
});

test("an agent deletes the frame: its kept versions are still drawn, at the box it had; its other versions answer 404; the board says where it was (ADeletedFramesPictureIsSentOnlyIfKept)", async () => {
  const srv = await withFrame();
  await srv.refer("flow", srv.id, 1);
  await srv.write("flow", srv.id, 1, "<p>2</p>");
  await srv.refer("flow", srv.id, 2);
  await srv.write("flow", srv.id, 2, "<p>3</p>");
  const three = await srv.address("flow", srv.id);
  srv.clock.advance(60_000);
  await srv.rm("flow", srv.id);

  const board = srv.kept("flow");
  expect(board.kept.map((v) => v.version)).toEqual([1, 2]);
  expect(board.removed).toEqual([
    {
      canvas: "flow",
      id: srv.id,
      name: "untitled",
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      removed: 1_800_000_060_000,
    },
  ]);
  const one = await srv.get(srv.keptAddress("flow", srv.id, 2, "s=1"));
  expect(one.status).toBe(200);
  expect(await text(one)).toBe("drawn:<p>2</p>");
  expect(srv.draws.seen.map((d) => [d.input.w, d.input.h])).toEqual([[400, 300]]);
  // Version 3 was current at the delete, and no request refers to it.
  await refused(await srv.get(three), 404);
});

test("a delete that lands during the draw of a kept version: the picture still goes out", async () => {
  const srv = await withFrame();
  await srv.refer("flow", srv.id, 1);
  await srv.write("flow", srv.id, 1, "<p>2</p>");
  srv.draws.hold();
  const asked = srv.get(srv.keptAddress("flow", srv.id, 1));
  await until(() => srv.draws.seen.length === 1);

  await srv.rm("flow", srv.id);
  srv.draws.seen[0]?.go();

  const answer = await asked;
  expect(answer.status).toBe(200);
  expect(await text(answer)).toBe("drawn:<p>1</p>");
});

test("the link ends: each kept version gets its key again, and a key from before answers 404", async () => {
  const srv = await withFrame();
  await srv.refer("flow", srv.id, 1);
  await srv.write("flow", srv.id, 1, "<p>2</p>");
  const before = srv.keptAddress("flow", srv.id, 1);
  await srv.bump("flow");

  expect(srv.kept("flow").kept).toEqual([
    { canvas: "flow", id: srv.id, version: 1, k: srv.keyFor("flow", srv.id, 1, 1) },
  ]);
  await refused(await srv.get(before), 404);
  expect((await srv.get(srv.keptAddress("flow", srv.id, 1))).status).toBe(200);
});

test("the kept versions and the removed frames are on the board again after a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-pictures-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "data", "easel.db");

  const first = await withFrame({ file });
  await first.refer("flow", first.id, 1);
  await first.write("flow", first.id, 1, "<p>2</p>");
  await first.rm("flow", first.id);
  const before = first.kept("flow");
  await first.server.close();

  const again = await boot({ file });
  expect(again.kept("flow")).toEqual(before);
}, 30_000);

test("with pictures off, a kept version is on the board with no key", async () => {
  const srv = await withFrame({ chromium: null });
  await srv.refer("flow", srv.id, 1);
  await srv.write("flow", srv.id, 1, "<p>2</p>");
  expect(srv.kept("flow").kept).toEqual([{ canvas: "flow", id: srv.id, version: 1 }]);
});

// ---- The bump (AnEndedViewerSeesNoNewerPicture)

test("the link ends: the canvas's generation goes up and every frame on it gets its key again; another canvas keeps its keys", async () => {
  const srv = await withFrame();
  const second = await srv.put({ canvas: "flow", html: "<p>b</p>" });
  await srv.canvas("Other");
  const elsewhere = await srv.put({ canvas: "other", html: "<p>o</p>" });
  const before = [
    (await srv.member("flow", srv.id)).k,
    (await srv.member("flow", second.id)).k,
    (await srv.member("other", elsewhere.id)).k,
  ];

  expect(await srv.bump("flow")).toEqual({ gen: 1 });
  expect((await srv.member("flow", srv.id)).k).toBe(srv.keyFor("flow", srv.id, 1, 1));
  expect((await srv.member("flow", second.id)).k).toBe(srv.keyFor("flow", second.id, 1, 1));
  expect((await srv.member("flow", srv.id)).k).not.toBe(before[0]);
  expect((await srv.member("flow", second.id)).k).not.toBe(before[1]);
  expect((await srv.member("other", elsewhere.id)).k).toBe(before[2]);

  expect(await srv.bump("flow")).toEqual({ gen: 2 });
  expect((await srv.member("flow", srv.id)).k).toBe(srv.keyFor("flow", srv.id, 1, 2));
});

test("a canvas with no frames bumps too, and its next frame is keyed with the new generation", async () => {
  const srv = await boot();
  await srv.canvas("Empty");
  expect(await srv.bump("empty")).toEqual({ gen: 1 });
  const made = await srv.put({ canvas: "empty", html: "<p>1</p>" });
  expect((await srv.member("empty", made.id)).k).toBe(srv.keyFor("empty", made.id, 1, 1));
});

test("the link ends; the tab asks with a key from before: 404, also for an old version, and the new key works", async () => {
  const srv = await withFrame();
  const first = await srv.address("flow", srv.id);
  await srv.write("flow", srv.id, 1, "<p>2</p>");
  const second = await srv.address("flow", srv.id);
  await srv.bump("flow");

  await refused(await srv.get(first), 404);
  await refused(await srv.get(second), 404);
  expect(srv.draws.seen).toEqual([]);
  const fresh = await srv.get(await srv.address("flow", srv.id));
  expect(fresh.status).toBe(200);
});

test("the link ends during the draw: the server answers 404 [link ended]", async () => {
  const srv = await withFrame();
  srv.draws.hold();
  const asked = srv.get(await srv.address("flow", srv.id));
  await until(() => srv.draws.seen.length === 1);

  await srv.bump("flow");
  srv.draws.seen[0]?.go();

  await refused(await asked, 404);
});

test("the generation and the secret survive a restart: the board's keys are the same after it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-pictures-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "data", "easel.db");

  const first = await withFrame({ file });
  await first.bump("flow");
  const before = (await first.member("flow", first.id)).k;
  await first.server.close();
  const secret = join(dir, "data", secretName);
  expect(statSync(secret).mode & 0o777).toBe(0o600);
  expect(readFileSync(secret)).toHaveLength(32);

  const again = await boot({ file });
  const after = await again.member("flow", first.id);
  expect(after.k).toBe(before);
  expect(after.k).toBe(again.keyFor("flow", first.id, 1, 1));
  expect((await again.get(await again.address("flow", first.id))).status).toBe(200);
}, 30_000);

test("a secret file that is not 256 bits stops the start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "easel-pictures-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  await Bun.write(join(dir, secretName), "short");
  await expect(boot({ file: join(dir, "easel.db") })).rejects.toThrow(/32-byte secret/);
});

test("two servers with different secrets make different keys", async () => {
  const a = await withFrame();
  const b = await boot();
  expect(b.keyFor("flow", a.id, 1, 0)).not.toBe((await a.member("flow", a.id)).k);
});

test("the same id, version and generation on two canvases make different keys", async () => {
  const srv = await boot();
  expect(srv.keyFor("flow", "000000000000", 1, 0)).not.toBe(
    srv.keyFor("other", "000000000000", 1, 0),
  );
});

// ---- 400: scales, regions and the size limits (judged rule 6)

test("a scale outside 0.25, 0.5, 1 and 2, or none, answers 400 and draws nothing", async () => {
  const srv = await withFrame();
  for (const s of ["3", "0.75", "1.0", "", "x"]) {
    await refused(await srv.get(await srv.address("flow", srv.id, `s=${s}`)), 400);
  }
  const address = await srv.address("flow", srv.id);
  await refused(await srv.get(address.replace("s=0.5&", "")), 400);
  expect(srv.draws.seen).toEqual([]);
});

test("a region that is not x,y,w,h, is empty, or runs off the frame answers 400", async () => {
  const srv = await withFrame();
  for (const r of ["1,2,3", "a,b,c,d", "0,0,0,10", "0,0,10,0", "390,0,11,10", "0,290,10,11"]) {
    await refused(await srv.get(await srv.address("flow", srv.id, `s=1&r=${r}`)), 400);
  }
  const edge = await srv.get(await srv.address("flow", srv.id, "s=1&r=390,290,10,10"));
  expect(edge.status).toBe(200);
  expect(srv.draws.seen).toHaveLength(1);
});

test("no picture is larger than 8 megapixels or 16000 px on a side", async () => {
  const srv = await boot();
  await srv.canvas("Big");
  const wide = await srv.put({ canvas: "big", html: "w", size: { w: 16000, h: 100 } });
  const square = await srv.put({ canvas: "big", html: "s", size: { w: 4000, h: 2000 } });

  // 32000 x 200 is 6.4 MP, but over 16000 px on a side.
  await refused(await srv.get(await srv.address("big", wide.id, "s=2")), 400);
  expect((await srv.get(await srv.address("big", wide.id, "s=1"))).status).toBe(200);
  // 4000 x 2000 is 8 MP: the limit itself is allowed; 8000 x 4000 is not.
  expect((await srv.get(await srv.address("big", square.id, "s=1"))).status).toBe(200);
  await refused(await srv.get(await srv.address("big", square.id, "s=2")), 400);
  // A region keeps it under: 2000 x 1000 at 2 is 8 MP.
  const part = await srv.get(await srv.address("big", square.id, "s=2&r=0,0,2000,1000"));
  expect(part.status).toBe(200);
});

// ---- The draw slots: 2 at once, 5 s to wait, 20 s to draw

test("at most 2 draws run at once; a third waits for a slot and draws when one is free", async () => {
  const srv = await withFrame();
  srv.draws.hold();
  const address = await srv.address("flow", srv.id);
  const asked = [srv.get(address), srv.get(address), srv.get(address)];
  await until(() => srv.draws.seen.length === 2);
  await tick(20);
  expect(srv.draws.seen).toHaveLength(2);

  srv.draws.seen[0]?.go();
  await until(() => srv.draws.seen.length === 3);
  srv.draws.seen[1]?.go();
  srv.draws.seen[2]?.go();
  expect((await Promise.all(asked)).map((a) => a.status)).toEqual([200, 200, 200]);
});

test("the requests that wait for a slot draw in the order they came", async () => {
  const srv = await boot();
  await srv.canvas("Flow");
  const ids: string[] = [];
  for (const html of ["<p>a</p>", "<p>b</p>", "<p>c</p>", "<p>d</p>", "<p>e</p>"]) {
    ids.push((await srv.put({ canvas: "flow", html })).id);
  }
  srv.draws.hold();
  const asked: Array<Promise<Response>> = [];
  for (const id of ids) {
    asked.push(srv.get(await srv.address("flow", id)));
    await tick(20);
  }
  await until(() => srv.draws.seen.length === 2);

  for (let i = 0; i < 5; i++) {
    await until(() => srv.draws.seen.length >= Math.min(i + 2, 5));
    srv.draws.seen[i]?.go();
  }
  await Promise.all(asked);
  expect(srv.draws.seen.map((draw) => draw.input.html)).toEqual([
    "<p>a</p>",
    "<p>b</p>",
    "<p>c</p>",
    "<p>d</p>",
    "<p>e</p>",
  ]);
});

test("a request that waits 5 s for a slot answers 503 with Retry-After: 1", async () => {
  const srv = await withFrame();
  srv.draws.hold();
  const address = await srv.address("flow", srv.id);
  const busy = [srv.get(address), srv.get(address)];
  await until(() => srv.draws.seen.length === 2);
  const third = srv.get(address);
  await tick(20);

  srv.clock.advance(slotWaitMs - 1);
  await tick(20);
  srv.clock.advance(1);
  const answer = await soon(third);
  expect(answer.status).toBe(503);
  expect(answer.headers.get("retry-after")).toBe("1");
  expect(answer.headers.get("cache-control")).toBe("no-store");
  expect(srv.draws.seen).toHaveLength(2);

  // The two that drew still answer, and their slots are free again.
  for (const draw of srv.draws.seen) draw.go();
  expect((await Promise.all(busy)).map((a) => a.status)).toEqual([200, 200]);
  srv.draws.seen.length = 0;
  const later = [srv.get(address), srv.get(address)];
  await until(() => srv.draws.seen.length === 2);
  for (const draw of srv.draws.seen) draw.go();
  expect((await Promise.all(later)).map((a) => a.status)).toEqual([200, 200]);
});

test("a draw that runs past 20 s answers 503 with Retry-After: 1, is stopped, and frees its slot", async () => {
  const srv = await withFrame();
  srv.draws.hold();
  const address = await srv.address("flow", srv.id);
  const slow = srv.get(address);
  await until(() => srv.draws.seen.length === 1);
  await tick(20);

  srv.clock.advance(drawLimitMs);
  const answer = await soon(slow);
  expect(answer.status).toBe(503);
  expect(answer.headers.get("retry-after")).toBe("1");
  expect(srv.draws.seen[0]?.stopped).toBe(true);

  const both = [srv.get(address), srv.get(address)];
  await until(() => srv.draws.seen.length === 3);
  await tick(20);
  // Both slots are free: the stopped draw gave its back.
  expect(srv.draws.seen).toHaveLength(3);
  srv.draws.seen[1]?.go();
  srv.draws.seen[2]?.go();
  expect((await Promise.all(both)).map((a) => a.status)).toEqual([200, 200]);
});

test("a stopped draw has ended before its 503 goes out", async () => {
  const srv = await withFrame();
  srv.draws.hold();
  srv.draws.linger();
  const slow = srv.get(await srv.address("flow", srv.id));
  const state = { answered: false };
  void slow.then(() => (state.answered = true));
  await until(() => srv.draws.seen.length === 1);
  await tick(20);

  srv.clock.advance(drawLimitMs);
  await until(() => srv.draws.seen[0]?.stopped === true);
  await tick(50);
  expect(state.answered).toBe(false);

  srv.draws.seen[0]?.end();
  const answer = await soon(slow);
  expect(answer.status).toBe(503);
  expect(srv.server.resolve(drawSlots).free).toBe(drawsAtOnce);
});

test("pictures.render itself answers late only once its stopped draw has ended", async () => {
  const srv = await withFrame();
  srv.draws.hold();
  srv.draws.linger();
  const drawn = srv.server.run(render, {
    input: { html: "<p>1</p>", w: 100, h: 100, scale: 0.5, region: { x: 0, y: 0, w: 100, h: 100 } },
  });
  const state = { answered: false };
  void drawn.then(() => (state.answered = true));
  await until(() => srv.draws.seen.length === 1);
  await tick(20);

  srv.clock.advance(drawLimitMs);
  await until(() => srv.draws.seen[0]?.stopped === true);
  await tick(50);
  expect(state.answered).toBe(false);
  expect(srv.server.resolve(drawSlots).free).toBe(drawsAtOnce - 1);

  srv.draws.seen[0]?.end();
  expect(await soon(drawn)).toEqual({ kind: "late" });
  expect(srv.server.resolve(drawSlots).free).toBe(drawsAtOnce);
});

test("a draw that fails answers 503 with Retry-After: 1 and frees its slot", async () => {
  const srv = await withFrame();
  srv.draws.fail();
  const address = await srv.address("flow", srv.id);
  for (let i = 0; i < 3; i++) {
    const answer = await srv.get(address);
    expect(answer.status).toBe(503);
    expect(answer.headers.get("retry-after")).toBe("1");
    expect(answer.headers.get("cache-control")).toBe("no-store");
  }
  expect(srv.draws.seen).toHaveLength(3);
});

// ---- frame.shot: the address, no draw

test("frame.shot answers the current version's address with the board's key, and draws nothing", async () => {
  const srv = await withFrame();
  await srv.write("flow", srv.id, 1, "<p>2</p>");
  const k = (await srv.member("flow", srv.id)).k;

  const whole = srv.server.run(shotFrame, {
    input: { canvas: "flow", id: srv.id, scale: 0.25 },
  });
  expect(whole).toEqual({
    kind: "ready",
    url: `/api/pictures/flow/${srv.id}/2?s=0.25&k=${k}`,
    version: 2,
  });
  const part = srv.server.run(shotFrame, {
    input: { canvas: "flow", id: srv.id, scale: 2, region: { x: 1, y: 2, w: 3, h: 4 } },
  });
  expect(part).toEqual({
    kind: "ready",
    url: `/api/pictures/flow/${srv.id}/2?s=2&k=${k}&r=1,2,3,4`,
    version: 2,
  });
  expect(picturePath.safeParse(whole.kind === "ready" ? whole.url : "").success).toBe(true);
  expect(srv.draws.seen).toEqual([]);

  expect((await srv.get(part.kind === "ready" ? part.url : "")).status).toBe(200);
});

test("frame.shot on a frame that is not there answers gone", async () => {
  const srv = await withFrame();
  const answer = srv.server.run(shotFrame, {
    input: { canvas: "flow", id: "000000000000", scale: 1 },
  });
  expect(answer).toEqual({ kind: "gone" });
});

// ---- Pictures off

test("with no EASEL_CHROMIUM, pictures are off: no keys on the board, every picture 404, frame.shot off, and readiness holds", async () => {
  const srv = await withFrame({ chromium: null });
  const member = await srv.member("flow", srv.id);
  expect(member.k).toBeUndefined();

  // A key made with the server's secret still opens nothing.
  const k = srv.keyFor("flow", srv.id, 1, 0);
  await refused(await srv.get(`/api/pictures/flow/${srv.id}/1?s=1&k=${k}`), 404);
  expect(srv.server.run(shotFrame, { input: { canvas: "flow", id: srv.id, scale: 1 } })).toEqual({
    kind: "off",
  });
  expect(await srv.server.run(chromiumCheck)).toEqual({
    ok: true,
    detail: "pictures off: no EASEL_CHROMIUM",
  });
  expect(srv.draws.seen).toEqual([]);
});

test("EASEL_CHROMIUM naming no Chromium: pictures are off, and readiness fails", async () => {
  const srv = await withFrame({ chromium: "/nonexistent/chromium" });
  expect((await srv.member("flow", srv.id)).k).toBeUndefined();
  expect(srv.server.run(shotFrame, { input: { canvas: "flow", id: srv.id, scale: 1 } })).toEqual({
    kind: "off",
  });
  expect(await srv.server.run(chromiumCheck)).toEqual({
    ok: false,
    detail: "pictures off: no Chromium at EASEL_CHROMIUM",
  });
});

test("EASEL_CHROMIUM naming a file that is not Chromium: readiness fails", async () => {
  const srv = await boot({ chromium: "/bin/true", real: true });
  expect(await srv.server.run(chromiumCheck)).toEqual({
    ok: false,
    detail: "Chromium does not start",
  });
});

// ---- The key compare (judged rule 9) and what a document may load (judged rule 5)

test("a key is compared whole: same length and same bytes", async () => {
  const srv = await boot();
  const want = srv.keyFor("flow", "000000000000", 1, 0);
  const run = (sent: string) => srv.server.run(keyMatches, { input: { sent, want } });

  expect(run(want)).toBe(true);
  expect(run(want.slice(0, -1))).toBe(false);
  expect(run(`${want}A`)).toBe(false);
  expect(run("")).toBe(false);
  expect(run(`${want.slice(0, -1)}${want.endsWith("A") ? "B" : "A"}`)).toBe(false);
});

test("a host opens only if every address it has is public: no loopback, private, benchmark, or IPv6 form of an IPv4 address", async () => {
  const srv = await boot();
  const open = (host: string) => srv.server.run(publicAddress, { input: host });
  for (const host of ["8.8.8.8", "[2606:4700:4700::1111]", "::ffff:8.8.8.8"]) {
    expect([host, await open(host)]).toEqual([host, [host.replace(/^\[(.*)\]$/, "$1")]]);
  }
  for (const host of [
    "127.0.0.1",
    "127.9.9.9",
    "localhost",
    "[::1]",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::127.0.0.1",
    "::ffff:0:7f00:1",
    "64:ff9b::7f00:1",
    "64:ff9b:1::7f00:1",
    "2002:7f00:1::",
    "2001:0:a00:1::",
    "fec0::1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "198.18.0.1",
    "198.19.255.255",
    "fd00::1",
    "fe80::1",
    "224.0.0.1",
    "no-such-host.invalid",
  ]) {
    expect([host, await open(host)]).toEqual([host, null]);
  }
});

test("a name with one closed address among public ones is refused; a name with none answers every address, in order", async () => {
  const srv = await boot({
    lookup: async (host) =>
      host === "mixed.test"
        ? [
            { address: "8.8.8.8", family: 4 },
            { address: "127.0.0.1", family: 4 },
          ]
        : [
            { address: "8.8.8.8", family: 4 },
            { address: "2606:4700:4700::1111", family: 6 },
          ],
  });
  const open = (host: string) => srv.server.run(publicAddress, { input: host });

  expect(await open("mixed.test")).toBeNull();
  expect(await open("public.test")).toEqual(["8.8.8.8", "2606:4700:4700::1111"]);
});

/** What the egress proxy answers to one request head: its status line, or "closed". */
async function throughProxy(srv: Server, head: string) {
  const port = await srv.server.resolve(egressProxy).port();
  const socket = connect({ host: "127.0.0.1", port });
  closers.push(() => socket.destroy());

  const answer = Promise.withResolvers<string>();
  let got = "";
  socket.on("data", (chunk) => {
    got += chunk.toString("latin1");
    if (got.includes("\r\n")) answer.resolve(got.slice(0, got.indexOf("\r\n")));
  });

  socket.on("close", () => answer.resolve(got.split("\r\n")[0] || "closed"));
  socket.on("error", () => answer.resolve("closed"));

  socket.write(head);
  return answer.promise;
}

test("the egress proxy opens no tunnel to this machine, a private host, or a port other than 443, and carries no plain http", async () => {
  const srv = await boot();
  const forbidden = "HTTP/1.1 403 Forbidden";
  for (const head of [
    "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n",
    "CONNECT localhost:443 HTTP/1.1\r\n\r\n",
    "CONNECT [::1]:443 HTTP/1.1\r\n\r\n",
    "CONNECT [::ffff:127.0.0.1]:443 HTTP/1.1\r\n\r\n",
    "CONNECT 10.0.0.1:443 HTTP/1.1\r\n\r\n",
    "CONNECT 169.254.169.254:443 HTTP/1.1\r\n\r\n",
    "CONNECT 8.8.8.8:80 HTTP/1.1\r\n\r\n",
    "CONNECT 8.8.8.8:4430 HTTP/1.1\r\n\r\n",
    "CONNECT no-such-host.invalid:443 HTTP/1.1\r\n\r\n",
    "GET http://8.8.8.8/ HTTP/1.1\r\nHost: 8.8.8.8\r\n\r\n",
    "GET http://127.0.0.1:1/ HTTP/1.1\r\n\r\n",
  ]) {
    expect([head.split("\r\n")[0], await throughProxy(srv, head)]).toEqual([
      head.split("\r\n")[0],
      forbidden,
    ]);
  }
  // A head with no end is cut off past 8 KiB.
  expect(await throughProxy(srv, `CONNECT ${"a".repeat(9000)}`)).toBe(forbidden);
});

/** Everything the egress proxy sends back to one request, up to its close. */
async function wholeProxy(srv: Server, head: string) {
  const port = await srv.server.resolve(egressProxy).port();
  const socket = connect({ host: "127.0.0.1", port });
  closers.push(() => socket.destroy());

  const answer = Promise.withResolvers<string>();
  let got = "";
  socket.on("data", (chunk) => (got += chunk.toString("latin1")));
  socket.on("close", () => answer.resolve(got));
  socket.on("error", () => undefined);

  socket.write(head);
  return { socket, answer: answer.promise };
}

/** A stand-in for a public host on 127.0.0.1: it answers each chunk with `pong:` and the chunk. */
async function upstreamHost(after: (socket: Socket) => void = () => undefined) {
  const server = createServer((socket) => {
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => {
      socket.write(`pong:${chunk.toString("latin1")}`);
      after(socket);
    });
  });
  closers.push(() => server.close());
  const port = await new Promise<number>((done) =>
    server.listen(0, "127.0.0.1", () => {
      const at = server.address();
      done(typeof at === "object" && at !== null ? at.port : 0);
    }),
  );

  return () => connect({ host: "127.0.0.1", port });
}

/** A socket that never connects, and one that fails at once. */
const neverConnects = () => new Socket();

const failsAtOnce = () => {
  const socket = new Socket();
  queueMicrotask(() => socket.destroy(new Error("connection refused")));
  return socket;
};

test("the egress proxy dials the addresses it checked, never the name; it tries the next when one fails, and refuses a name with one closed address", async () => {
  const dials: string[] = [];
  const reach = await upstreamHost();
  const srv = await boot({
    lookup: async (host) =>
      host === "mixed.test"
        ? [
            { address: "192.0.2.10", family: 4 },
            { address: "127.0.0.1", family: 4 },
          ]
        : [
            { address: "192.0.2.10", family: 4 },
            { address: "192.0.2.11", family: 4 },
          ],
    dial: (address) => (dials.push(address), address === "192.0.2.10" ? failsAtOnce() : reach()),
  });

  expect(await throughProxy(srv, "CONNECT mixed.test:443 HTTP/1.1\r\n\r\n")).toBe(
    "HTTP/1.1 403 Forbidden",
  );
  expect(dials).toEqual([]);

  const tunnel = await wholeProxy(srv, "CONNECT two.test:443 HTTP/1.1\r\n\r\nhello");
  await until(() => dials.length === 2);
  await tick(50);
  tunnel.socket.end();
  expect(await tunnel.answer).toBe("HTTP/1.1 200 Connection Established\r\n\r\npong:hello");
  expect(dials).toEqual(["192.0.2.10", "192.0.2.11"]);
});

test("the egress proxy gives each upstream connect 10 s, then tries the next; none: 502", async () => {
  const dials: string[] = [];
  const srv = await boot({
    lookup: async () => [
      { address: "192.0.2.20", family: 4 },
      { address: "192.0.2.21", family: 4 },
    ],
    dial: (address) => (dials.push(address), neverConnects()),
  });

  const tunnel = await wholeProxy(srv, "CONNECT slow.test:443 HTTP/1.1\r\n\r\n");
  await until(() => dials.length === 1);
  srv.clock.advance(proxyWaitMs - 1);
  await tick(20);
  expect(dials).toEqual(["192.0.2.20"]);

  srv.clock.advance(1);
  await until(() => dials.length === 2);
  await tick(20);
  srv.clock.advance(proxyWaitMs);
  expect(await soon(tunnel.answer)).toBe("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
});

test("the egress proxy cuts off a client that sends no head in 10 s", async () => {
  const srv = await boot();
  const port = await srv.server.resolve(egressProxy).port();
  const socket = connect({ host: "127.0.0.1", port });
  closers.push(() => socket.destroy());
  const state = { closed: false };
  socket.on("close", () => (state.closed = true));
  socket.on("error", () => undefined);
  await new Promise((done) => socket.once("connect", done));
  await tick(20);

  srv.clock.advance(proxyWaitMs - 1);
  await tick(20);
  expect(state.closed).toBe(false);
  srv.clock.advance(1);
  await until(() => state.closed);
});

test("a tunnel that answered 200 and then fails upstream is closed: no 403 is written into it", async () => {
  const reach = await upstreamHost((socket) => socket.resetAndDestroy());
  const srv = await boot({
    lookup: async () => [{ address: "192.0.2.30", family: 4 }],
    dial: () => reach(),
  });

  const tunnel = await wholeProxy(srv, "CONNECT reset.test:443 HTTP/1.1\r\n\r\nping");
  expect(await soon(tunnel.answer)).toBe("HTTP/1.1 200 Connection Established\r\n\r\npong:ping");
});

// ---- A real Chromium

test("a real Chromium draws a WebP at the scale and region asked, and readiness says it runs", async () => {
  const chromium = localChromium();
  expect(chromium).not.toBeNull();
  const srv = await boot({ chromium, real: true });
  await srv.canvas("Real");
  const made = await srv.put({
    canvas: "real",
    html: '<body style="margin:0;background:#c00"><h1>Hi</h1></body>',
    size: { w: 400, h: 300 },
  });

  const answer = await srv.get(await srv.address("real", made.id, "s=0.5"));
  expect(answer.status).toBe(200);
  const webp = new Uint8Array(await answer.arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...webp.slice(from, to));
  expect([ascii(0, 4), ascii(8, 12)]).toEqual(["RIFF", "WEBP"]);

  const part = await srv.get(await srv.address("real", made.id, "s=2&r=0,0,100,50"));
  expect(part.status).toBe(200);
  const size = sizeOf(new Uint8Array(await part.arrayBuffer()));
  expect(size).toEqual({ w: 200, h: 100 });

  expect(await srv.server.run(chromiumCheck)).toEqual({ ok: true, detail: "Chromium runs" });
}, 30_000);

test("a real draw does not reach this machine: a document's http, https, ws, wss, worker, frame and image loads to loopback are refused", async () => {
  const hits: string[] = [];
  const local = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => (hits.push(request.url), new Response("x")),
  });
  closers.push(() => local.stop(true));
  const port = local.port;

  const srv = await boot({ chromium: localChromium(), real: true });
  await srv.canvas("Leak");
  const made = await srv.put({
    canvas: "leak",
    html: `<img src="http://127.0.0.1:${port}/img"><link rel="stylesheet" href="https://127.0.0.1:${port}/css"><iframe src="http://localhost:${port}/frame"></iframe><script>fetch("http://127.0.0.1:${port}/fetch").catch(() => {}); new WebSocket("ws://127.0.0.1:${port}/ws"); new WebSocket("wss://127.0.0.1:${port}/wss"); new Worker(URL.createObjectURL(new Blob(['fetch("http://127.0.0.1:${port}/worker")']))); location.href = "http://127.0.0.1:${port}/nav";</script>`,
    size: { w: 200, h: 100 },
  });

  const answer = await srv.get(await srv.address("leak", made.id, "s=1"));
  expect([200, 503, 404]).toContain(answer.status);
  await tick(200);
  expect(hits).toEqual([]);
}, 30_000);

/** The pages open in the real Chromium, in every context. */
async function pagesOpen(srv: Server) {
  const chrome = await srv.server.resolve(chromiumBrowser).open();
  return (await chrome.pages()).length;
}

/** Fonts that are ready only after `ms`, or never: the draw waits for them. */
const fontsReadyIn = (ms: number | null) =>
  `<script>const ready = ${ms === null ? "new Promise(() => {})" : `new Promise((r) => setTimeout(r, ${ms}))`}; Object.defineProperty(document, "fonts", { get: () => ({ ready }) });</script>`;

test("a real draw sends no WebRTC UDP: STUN and TURN to this machine and to its network address get 0 packets", async () => {
  const lan =
    Object.values(networkInterfaces())
      .flat()
      .find((at) => at?.family === "IPv4" && !at.internal)?.address ?? "127.0.0.1";
  const got: string[] = [];
  const listeners = await Promise.all(
    [...new Set(["127.0.0.1", lan])].map(
      (host) =>
        new Promise<{ host: string; port: number }>((done) => {
          const udp = createSocket("udp4");
          closers.push(() => udp.close());
          udp.on("message", (_, from) => got.push(`${host} <- ${from.address}`));
          udp.bind(0, host, () => done({ host, port: udp.address().port }));
        }),
    ),
  );

  // The listeners hear a packet: the 0 below is Chromium's, not theirs.
  const probe = createSocket("udp4");
  closers.push(() => probe.close());
  for (const at of listeners) probe.send("probe", at.port, at.host);
  await until(() => got.length === listeners.length);
  got.length = 0;

  const ice = listeners
    .map(
      (at) =>
        `{urls:"stun:${at.host}:${at.port}"},{urls:"turn:${at.host}:${at.port}",username:"u",credential:"p"}`,
    )
    .join(",");
  const candidates = listeners
    .map(
      (at, i) =>
        `pc.addIceCandidate({candidate:"candidate:${i + 1} 1 udp 2122260223 ${at.host} ${at.port} typ host",sdpMid:"0",sdpMLineIndex:0}).catch(() => {});`,
    )
    .join("");
  const srv = await boot({ chromium: localChromium(), real: true });
  await srv.canvas("Rtc");
  const made = await srv.put({
    canvas: "rtc",
    html: `${fontsReadyIn(3_000)}<script>(async () => { const pc = new RTCPeerConnection({ iceServers: [${ice}] }); pc.createDataChannel("x"); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); const answer = offer.sdp.replace(/a=setup:actpass/g, "a=setup:active").replace(/a=ice-ufrag:.*/g, "a=ice-ufrag:abcd").replace(/a=ice-pwd:.*/g, "a=ice-pwd:aaaaaaaaaaaaaaaaaaaaaaaa"); await pc.setRemoteDescription({ type: "answer", sdp: answer }); ${candidates} })();</script><p>rtc</p>`,
    size: { w: 200, h: 100 },
  });

  const answer = await srv.get(await srv.address("rtc", made.id, "s=1"));
  expect(answer.status).toBe(200);
  await tick(500);
  expect(got).toEqual([]);
}, 30_000);

test("a popup a document opens is gone when its draw is: each draw has its own browser context", async () => {
  const srv = await boot({ chromium: localChromium(), real: true });
  await srv.canvas("Pop");
  const made = await srv.put({
    canvas: "pop",
    html: `<script>for (let i = 0; i < 3; i++) { const w = window.open("about:blank"); if (w) w.document.write("<script>setInterval(() => {}, 1000)<\\/script>"); }</script><a id="a" href="data:text/html,<p>t</p>" target="_blank">x</a><script>a.click()</script>`,
    size: { w: 200, h: 100 },
  });
  const before = await pagesOpen(srv);

  const answer = await srv.get(await srv.address("pop", made.id, "s=1"));
  expect(answer.status).toBe(200);
  await tick(200);
  expect(await pagesOpen(srv)).toBe(before);
}, 30_000);

test("a dialog does not hold the slot: alert and confirm are dismissed and the draw answers", async () => {
  const srv = await boot({ chromium: localChromium(), real: true });
  await srv.canvas("Dlg");
  const made = await srv.put({
    canvas: "dlg",
    html: `<script>alert(1); confirm("2");</script><p>x</p>`,
    size: { w: 200, h: 100 },
  });

  const asked = srv.get(await srv.address("dlg", made.id, "s=1"));
  const late = Symbol("late");
  const got = await Promise.race([asked, tick(10_000).then(() => late)]);
  expect(got).not.toBe(late);
  expect((await asked).status).toBe(200);
  expect(srv.server.resolve(drawSlots).free).toBe(drawsAtOnce);
}, 30_000);

test("a real draw waits for the document's fonts; past 20 s it is stopped, and its slot and page are back", async () => {
  const srv = await boot({ chromium: localChromium(), real: true });
  await srv.canvas("Font");
  const made = await srv.put({
    canvas: "font",
    html: `${fontsReadyIn(null)}<p>x</p>`,
    size: { w: 200, h: 100 },
  });
  const before = await pagesOpen(srv);
  const asked = srv.get(await srv.address("font", made.id, "s=1"));
  const state = { answered: false };
  void asked.then(() => (state.answered = true));

  await tick(1_500);
  expect(state.answered).toBe(false);
  srv.clock.advance(drawLimitMs);
  expect((await asked).status).toBe(503);
  expect(srv.server.resolve(drawSlots).free).toBe(drawsAtOnce);
  expect(await pagesOpen(srv)).toBe(before);
}, 30_000);

test("a request that goes away at once, while its draw starts, gives its slot back", async () => {
  const srv = await boot({ chromium: localChromium(), real: true });
  await srv.canvas("Gone");
  // A first draw starts Chromium, so the next ones start at once.
  const warm = await srv.put({ canvas: "gone", html: "<p>w</p>", size: { w: 100, h: 100 } });
  expect((await srv.get(await srv.address("gone", warm.id, "s=1"))).status).toBe(200);

  for (const delay of [0, 0, 1, 1, 3, 8]) {
    const made = await srv.put({
      canvas: "gone",
      html: `${fontsReadyIn(null)}<p>${delay}</p>`,
      size: { w: 100, h: 100 },
    });
    const stop = new AbortController();
    const asked = srv.get(await srv.address("gone", made.id, "s=1"), stop.signal).catch(() => null);
    setTimeout(() => stop.abort(), delay);
    await Promise.race([asked, tick(5_000)]);

    await until(() => srv.server.resolve(drawSlots).free === drawsAtOnce);
  }
}, 60_000);

/** A WebP's size from its first chunk: VP8, VP8L or VP8X. */
function sizeOf(b: Uint8Array) {
  const at = (i: number) => b[i] ?? 0;
  const chunk = String.fromCharCode(...b.slice(12, 16));
  const u24 = (i: number) => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16);

  if (chunk === "VP8X") return { w: u24(24) + 1, h: u24(27) + 1 };
  if (chunk === "VP8L") {
    const bits = at(21) | (at(22) << 8) | (at(23) << 16) | (at(24) << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return { w: (at(26) | (at(27) << 8)) & 0x3fff, h: (at(28) | (at(29) << 8)) & 0x3fff };
}
