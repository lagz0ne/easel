import { createHash, randomBytes } from "node:crypto";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { makeTestClock, memory, preset } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { routes } from "~/components/requests/index.server";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { type ImageType, maxImageBytes, maxImagePixels, maxImageSide } from "@/frames/contract";
import { imageRoute } from "@/frames/images.server";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { drawPage, pictureRoute, picturesServer } from "@/frames/pictures.server";
import { framesServer } from "@/frames/store.server";

import {
  base64,
  gpsMark,
  jpegOf,
  jpegWithGps,
  pngHeaderOnly,
  pngOf,
  webpOf,
} from "./support/images";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function boot() {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const stop = new AbortController();
  const drawn: string[] = [];
  const server = await createScope({
    clock,
    presets: [
      preset(drawPage, async (_, { input }) => {
        drawn.push(input.html);
        return new TextEncoder().encode("webp");
      }),
    ],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      picturesServer({ chromium: process.execPath, database: ":memory:" }),
      framesServer({ stdout }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      memory.server({ services: [access.login, access.user, frames.api, frames.board] }),
      routes({
        stop: stop.signal,
        table: {
          "GET /api/pictures/{canvas}/{id}/{version}": pictureRoute,
          "GET /api/images/{canvas}/{sha}": imageRoute,
        },
      }),
    ],
  }).ready;
  closers.push(() => (stop.abort(), server.close()));
  const route = server.resolve(routes).fetch;
  const get = async (path: string) => {
    const answer = await route(new Request(`https://easel.test${path}`), server);
    if (!answer) throw new Error(`no route answers ${path}`);
    return answer;
  };
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { server, get, drawn, setupCode };
}

type Srv = Awaited<ReturnType<typeof boot>>;

async function agent(server: Scope.Handle, token?: string) {
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

async function ann(srv: Srv) {
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await agent(srv.server);
  await login.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });
  await login.close();
  const scope = await agent(srv.server, text);
  await scope.run(frames.api["canvas.create"], { input: { name: "Flow" } });

  const image = (mimeType: ImageType, bytes: Uint8Array) => ({ mimeType, data: base64(bytes) });
  return {
    scope,
    put: (mimeType: ImageType, bytes: Uint8Array, at: { id: string; base: number } | null = null) =>
      scope.run(frames.api["frame.put"], {
        input: at
          ? { canvas: "flow", image: image(mimeType, bytes), ...at }
          : { canvas: "flow", image: image(mimeType, bytes), name: "Shot" },
      }),
    get: (id: string) => scope.run(frames.api["frame.get"], { input: { canvas: "flow", id } }),
  };
}

async function imageOf(a: Awaited<ReturnType<typeof ann>>, id: string) {
  const got = await a.get(id);
  if (got.kind !== "found" || !("image" in got.frame)) throw new Error("not an image frame");
  return got.frame;
}

test("a PNG put makes an image frame at the size of the image, version 1, and get answers its type, size and address", async () => {
  const srv = await boot();
  const a = await ann(srv);

  const made = await a.put("image/png", await pngOf(390, 844));
  expect(made).toMatchObject({ kind: "created", version: 1, findings: [], more: 0 });
  const id = made.kind === "created" ? made.id : "";

  const frame = await imageOf(a, id);
  expect(frame).toMatchObject({ id, name: "Shot", x: 0, y: 0, w: 390, h: 844, version: 1 });
  expect(frame.image).toMatchObject({ mimeType: "image/png", w: 390, h: 844 });
  expect(frame.image.url).toMatch(/^\/api\/images\/flow\/[0-9a-f]{64}\?k=[\w-]+$/);
  const list = await a.scope.run(frames.api["frame.list"], { input: { canvas: "flow" } });
  expect(list).toMatchObject({ kind: "found", frames: [{ id, w: 390, h: 844 }] });
});

test("a JPEG and a WebP put make image frames of their own types", async () => {
  const srv = await boot();
  const a = await ann(srv);

  for (const [type, bytes] of [
    ["image/jpeg", await jpegOf(40, 30)],
    ["image/webp", await webpOf(40, 30)],
  ] as const) {
    const made = await a.put(type, bytes);
    const frame = await imageOf(a, made.kind === "created" ? made.id : "");
    expect(frame.image).toMatchObject({ mimeType: type, w: 40, h: 30 });
  }
});

test("the image route answers the image that easel wrote again, so the EXIF and its GPS place are gone", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const sent = await jpegWithGps(64, 48);
  expect(Buffer.from(sent).includes(gpsMark)).toBe(true);

  const made = await a.put("image/jpeg", sent);
  const frame = await imageOf(a, made.kind === "created" ? made.id : "");
  const answer = await srv.get(frame.image.url);

  expect(answer.status).toBe(200);
  const kept = Buffer.from(await answer.arrayBuffer());
  expect(kept.includes(gpsMark)).toBe(false);
  expect(kept.includes("Exif")).toBe(false);
  expect(await new Bun.Image(kept).metadata()).toEqual({ width: 64, height: 48, format: "jpeg" });
  expect(frame.image.bytes).toBe(kept.byteLength);
});

test("the image route answers the type of the image, nosniff, a sandbox policy and a private immutable cache", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const made = await a.put("image/png", await pngOf(20, 10));
  const frame = await imageOf(a, made.kind === "created" ? made.id : "");

  const answer = await srv.get(frame.image.url);
  expect(answer.status).toBe(200);
  expect(answer.headers.get("content-type")).toBe("image/png");
  expect(answer.headers.get("x-content-type-options")).toBe("nosniff");
  expect(answer.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  expect(answer.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
});

test("the image route answers 404 for a wrong key, no key, a sha that is not stored, or a path that is not one", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const made = await a.put("image/png", await pngOf(20, 10));
  const { url } = (await imageOf(a, made.kind === "created" ? made.id : "")).image;
  const [path = "", key = ""] = url.split("?k=");

  for (const bad of [
    `${path}?k=${key.slice(1)}x`,
    path,
    `/api/images/flow/${"0".repeat(64)}?k=${key}`,
    `/api/images/Flow/${"0".repeat(64)}?k=${key}`,
    `/api/images/flow/abc?k=${key}`,
  ]) {
    const answer = await srv.get(bad);
    expect(answer.status).toBe(404);
    expect(answer.headers.get("cache-control")).toBe("no-store");
  }
});

test("the same image again answers unchanged; a new image on the id is a new version at the size of the new image", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const first = await pngOf(30, 20);
  const made = await a.put("image/png", first);
  const id = made.kind === "created" ? made.id : "";

  expect(await a.put("image/png", first, { id, base: 1 })).toMatchObject({
    kind: "unchanged",
    version: 1,
  });
  expect(await a.put("image/png", await pngOf(60, 50), { id, base: 1 })).toMatchObject({
    kind: "updated",
    version: 2,
  });
  expect(await imageOf(a, id)).toMatchObject({ version: 2, w: 60, h: 50 });
  expect(await a.put("image/png", await pngOf(10, 10), { id, base: 1 })).toEqual({
    kind: "stale",
    id,
    version: 2,
  });
});

test("an HTML put on an image frame is a new version, and an image put on an HTML frame is too", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const made = await a.put("image/png", await pngOf(30, 20));
  const id = made.kind === "created" ? made.id : "";

  const html = await a.scope.run(frames.api["frame.put"], {
    input: { canvas: "flow", html: "<p>now HTML</p>", id, base: 1 },
  });
  expect(html).toMatchObject({ kind: "updated", version: 2 });
  expect(await a.get(id)).toMatchObject({ frame: { html: "<p>now HTML</p>", version: 2 } });

  expect(await a.put("image/png", await pngOf(30, 20), { id, base: 2 })).toMatchObject({
    kind: "updated",
    version: 3,
  });
});

test("a new image replaces the old one: the old address answers 404, as no version refers to it", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const made = await a.put("image/png", await pngOf(30, 20));
  const id = made.kind === "created" ? made.id : "";
  const old = (await imageOf(a, id)).image.url;
  expect((await srv.get(old)).status).toBe(200);

  await a.put("image/png", await pngOf(31, 20), { id, base: 1 });
  expect((await srv.get(old)).status).toBe(404);
});

test("a frame delete and a canvas delete remove the image", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const one = await a.put("image/png", await pngOf(30, 20));
  const two = await a.put("image/png", await pngOf(40, 20));
  const urlOne = (await imageOf(a, one.kind === "created" ? one.id : "")).image.url;
  const urlTwo = (await imageOf(a, two.kind === "created" ? two.id : "")).image.url;

  await a.scope.run(frames.api["frame.delete"], {
    input: { canvas: "flow", id: one.kind === "created" ? one.id : "" },
  });
  expect((await srv.get(urlOne)).status).toBe(404);
  expect((await srv.get(urlTwo)).status).toBe(200);

  await a.scope.run(frames.api["canvas.delete"], { input: { canvas: "flow" } });
  expect((await srv.get(urlTwo)).status).toBe(404);
});

test("bytes that are not the type the put names answer badImage type: SVG, HTML, a GIF, and a JPEG sent as PNG", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  const limits = { maxSide: maxImageSide, maxPixels: maxImagePixels };

  for (const [type, bytes] of [
    ["image/png", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')],
    ["image/png", Buffer.from("<!doctype html><script>alert(1)</script>")],
    ["image/png", gif],
    ["image/png", await jpegOf(10, 10)],
    ["image/webp", await pngOf(10, 10)],
  ] as const) {
    expect(await a.put(type, new Uint8Array(bytes))).toEqual({
      kind: "badImage",
      reason: "type",
      ...limits,
    });
  }
  const list = await a.scope.run(frames.api["frame.list"], { input: { canvas: "flow" } });
  expect(list).toEqual({ kind: "found", rev: 0, frames: [] });
});

test("an image of more pixels than the limit answers badImage pixels from its header, before a decode", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const limits = { maxSide: maxImageSide, maxPixels: maxImagePixels };

  expect(await a.put("image/png", pngHeaderOnly(50_000, 50_000))).toEqual({
    kind: "badImage",
    reason: "pixels",
    ...limits,
  });
  expect(await a.put("image/png", await pngOf(maxImageSide + 1, 1))).toEqual({
    kind: "badImage",
    reason: "pixels",
    ...limits,
  });
});

test("bytes with the head of a PNG that do not decode answer badImage unreadable", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const head = pngHeaderOnly(10, 10);

  expect(await a.put("image/png", head.subarray(0, 40))).toEqual({
    kind: "badImage",
    reason: "unreadable",
    maxSide: maxImageSide,
    maxPixels: maxImagePixels,
  });
});

test("an image over 10 MiB answers tooBig and writes nothing", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const big = new Uint8Array(maxImageBytes + 1);
  big.set(await pngOf(4, 4));

  expect(await a.put("image/png", big)).toEqual({ kind: "tooBig", maxBytes: maxImageBytes });
  const list = await a.scope.run(frames.api["frame.list"], { input: { canvas: "flow" } });
  expect(list).toEqual({ kind: "found", rev: 0, frames: [] });
});

test("the board document of an image frame is an img of the image's address, with the kit off", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const made = await a.put("image/png", await pngOf(30, 20));
  const id = made.kind === "created" ? made.id : "";
  const { url } = (await imageOf(a, id)).image;

  const read = a.scope.resolve(frames.board.docs.of({ canvas: "flow", id }));
  const stop = read.watch(() => {});
  closers.push(stop);
  for (let i = 0; i < 100 && !read.get(); i++) await new Promise((done) => setTimeout(done, 20));

  const doc = read.get();
  expect(doc).toMatchObject({ version: 1, css: null, app: null });
  expect(doc?.html).toContain(`<img src="${url}" alt="Shot">`);
  expect(doc?.html).toContain('<meta name="easel-kit" content="off">');
});

test("the picture of an image frame draws the image from a data address, not from the network", async () => {
  const srv = await boot();
  const a = await ann(srv);
  const made = await a.put("image/png", await pngOf(30, 20));
  const id = made.kind === "created" ? made.id : "";
  const shot = await a.scope.run(frames.api["frame.shot"], {
    input: { canvas: "flow", id, scale: 1 },
  });

  const answer = await srv.get(shot.kind === "ready" ? shot.url : "");
  expect(answer.status).toBe(200);
  expect(srv.drawn.at(-1)).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="">/);
});
