import { preset } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import type { z } from "zod";

import { routes } from "~/components/requests/index.server";

import { frames } from "@/frames";
import { maxImageBytes, maxImagePixels, maxImageSide } from "@/frames/contract";
import { imageRoute } from "@/frames/images.server";
import { drawPage, pictureRoute, picturesServer } from "@/frames/pictures.server";
import { queue } from "@/queue";
import type { frameShot } from "@/queue/contract";

import { base64, pngOf } from "./support/images";
import { boot, claimOf, closers, newKey, sharedFlow, until, viewer } from "./support/queue";
import type { Client } from "./support/queue";

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function bootWithRoutes() {
  const stop = new AbortController();
  closers.push(() => stop.abort());
  const drawn: Array<{ w: number; h: number; region: unknown; scale: number }> = [];
  const draw = preset(drawPage, async (_, { input }) => {
    drawn.push({ w: input.w, h: input.h, region: input.region, scale: input.scale });
    return new Bun.Image(await pngOf(input.region.w, input.region.h)).webp().bytes();
  });
  const srv = await boot(":memory:", [draw], {
    extra: [
      picturesServer({ chromium: process.execPath, database: ":memory:" }),
      routes({
        stop: stop.signal,
        table: {
          "GET /api/pictures/{canvas}/{id}/{version}": pictureRoute,
          "GET /api/images/{canvas}/{sha}": imageRoute,
        },
      }),
    ],
  });
  const route = srv.server.resolve(routes).fetch;
  const get = async (path: string) =>
    (await route(new Request(`https://easel.test${path}`), srv.server)) ??
    new Response(null, { status: 404 });

  return { ...srv, get, drawn };
}

const pasted = async (w: number, h: number) => ({
  kind: "image" as const,
  image: { mimeType: "image/png" as const, data: base64(await pngOf(w, h)) },
});

type Shot = z.input<typeof frameShot>;

const ask = { x: 40, y: 60, text: "Look." };

const addWith = (tab: Client, frameId: string, shot: Shot) =>
  tab.scope.run(queue.viewer["request.add"], {
    input: { canvas: "flow", frameId, version: 1, ...ask, key: newKey(), shot },
  });

const addOnCanvas = (tab: Client, shot: Extract<Shot, { kind: "image" }>) =>
  tab.scope.run(queue.viewer["request.add"], {
    input: { canvas: "flow", frameId: null, version: null, ...ask, key: newKey(), shot },
  });

const forgeOnCanvas = (tab: Client, shot: Shot): Promise<unknown> =>
  Reflect.apply(Reflect.get(tab.scope, "run"), tab.scope, [
    queue.viewer["request.add"],
    { input: { canvas: "flow", frameId: null, version: null, ...ask, key: newKey(), shot } },
  ]);

async function shotOfRequest(tab: Client, n: number) {
  const list = tab.scope.resolve(frames.board.requests.where({ canvas: "flow" }));
  closers.push(list.watch(() => undefined));
  await until(() => list.get().some((r) => r.n === n));
  const id = list.get().find((r) => r.n === n)?.id ?? "";

  const shot = tab.scope.resolve(frames.board.shots.of({ canvas: "flow", id }));
  closers.push(shot.watch(() => undefined));
  await until(() => shot.get() !== undefined);
  return shot;
}

async function requestCount(a: Client) {
  return (await a.list()).requests.length;
}

test("a request with a pasted PNG keeps it: the board carries its shot, and its address answers the PNG with nosniff", async () => {
  const srv = await bootWithRoutes();
  const { id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");

  expect(await addWith(bo, id, await pasted(320, 200))).toEqual({ kind: "added", n: 1 });
  const shot = (await shotOfRequest(bo, 1)).get();
  expect(shot).toMatchObject({ kind: "image", mimeType: "image/png", w: 320, h: 200 });

  const answer = await srv.get(shot?.url ?? "");
  expect(answer.status).toBe(200);
  expect(answer.headers.get("Content-Type")).toBe("image/png");
  expect(answer.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(await new Bun.Image(await answer.bytes()).metadata()).toEqual({
    width: 320,
    height: 200,
    format: "png",
  });
});

test("a request with a part of its frame keeps the box: its shot is the picture of the request's version, kit and box, at scale 1", async () => {
  const srv = await bootWithRoutes();
  const { id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");

  const part = { kind: "region", x: 10, y: 20, w: 100, h: 50 } as const;
  expect(await addWith(bo, id, part)).toEqual({ kind: "added", n: 1 });
  const shot = (await shotOfRequest(bo, 1)).get();
  expect(shot).toMatchObject({ kind: "region", mimeType: "image/webp", w: 100, h: 50 });
  expect(shot?.url).toMatch(
    new RegExp(`^/api/pictures/flow/${id}/1\\?s=1&k=[\\w-]+&kit=\\d+&r=10,20,100,50$`),
  );

  const answer = await srv.get(shot?.url ?? "");
  expect(answer.status).toBe(200);
  expect(srv.drawn.at(-1)).toMatchObject({ region: { x: 10, y: 20, w: 100, h: 50 }, scale: 1 });
});

test("a part over the edge of the frame answers offFrame, and nothing is saved", async () => {
  const srv = await bootWithRoutes();
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  const frame = await a.scope.run(frames.api["frame.get"], { input: { canvas: "flow", id } });
  const w = frame.kind === "found" ? frame.frame.w : 0;

  const over = { kind: "region", x: w - 10, y: 0, w: 20, h: 20 } as const;
  expect(await addWith(bo, id, over)).toEqual({ kind: "offFrame" });
  expect(await requestCount(a)).toBe(0);
});

test("a request on the canvas takes a pasted image, but a part of a frame there is invalid", async () => {
  const srv = await bootWithRoutes();
  const { a, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");

  expect(await addOnCanvas(bo, await pasted(40, 30))).toEqual({ kind: "added", n: 1 });
  const part = { kind: "region", x: 0, y: 0, w: 10, h: 10 } as const;
  await expect(Promise.resolve().then(() => forgeOnCanvas(bo, part))).rejects.toThrow(
    "DataValidationFailed",
  );
  expect(await requestCount(a)).toBe(1);
});

test("a pasted SVG answers badImage type, bytes over 10 MiB answer tooBig, and neither saves a request", async () => {
  const srv = await bootWithRoutes();
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");

  const svg = {
    mimeType: "image/png" as const,
    data: base64(new TextEncoder().encode("<svg></svg>")),
  };
  expect(await addWith(bo, id, { kind: "image", image: svg })).toEqual({
    kind: "badImage",
    reason: "type",
    maxSide: maxImageSide,
    maxPixels: maxImagePixels,
  });
  const big = { mimeType: "image/png" as const, data: base64(new Uint8Array(maxImageBytes + 1)) };
  expect(await addWith(bo, id, { kind: "image", image: big })).toEqual({
    kind: "tooBig",
    maxBytes: maxImageBytes,
  });
  expect(await requestCount(a)).toBe(0);
});

test("next answers the shot of the request, and shot null for a request with none", async () => {
  const srv = await bootWithRoutes();
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  await addWith(bo, id, await pasted(64, 48));
  await bo.add("flow", id);

  const first = await a.next({ canvas: "flow", n: 1 });
  expect(first).toMatchObject({
    kind: "claimed",
    shot: {
      mimeType: "image/png",
      w: 64,
      h: 48,
      url: expect.stringMatching(/^\/api\/images\/flow\//),
    },
  });
  claimOf(first);
  const second = await a.next({ canvas: "flow", n: 2 });
  expect(second).toMatchObject({ kind: "claimed", shot: null });
});

test("a frame delete keeps the pasted image of its request; a canvas delete removes it", async () => {
  const srv = await bootWithRoutes();
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  await addWith(bo, id, await pasted(30, 20));
  const url = (await shotOfRequest(bo, 1)).get()?.url ?? "";

  await a.scope.run(frames.api["frame.delete"], { input: { canvas: "flow", id } });
  expect((await srv.get(url)).status).toBe(200);

  await a.scope.run(frames.api["canvas.delete"], { input: { canvas: "flow" } });
  expect((await srv.get(url)).status).toBe(404);
});

test("an unshare ends the old address of a shot, and the board carries a new one", async () => {
  const srv = await bootWithRoutes();
  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  await addWith(bo, id, await pasted(30, 20));
  const shot = await shotOfRequest(a, 1);
  const before = shot.get()?.url ?? "";

  await a.scope.run(frames.api["canvas.unshare"], { input: { canvas: "flow" } });
  await until(() => (shot.get()?.url ?? before) !== before);
  expect((await srv.get(before)).status).toBe(404);
  expect((await srv.get(shot.get()?.url ?? "")).status).toBe(200);
});
