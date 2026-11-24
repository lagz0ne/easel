import { data, remoteData, rpc } from "@tinkered/core";
import { z } from "zod";

import { kit } from "@/kit/cells";
import { runtimeLink } from "@/kit/runtime";
import { findingShape, frameFiles } from "@/kit/schema";
import { messages, requests, serverClock } from "@/queue/cells";

import { sharePassword, sharePath } from "./share";

export const maxDocBytes = 1024 * 1024;

export const maxImageBytes = 10 * 1024 * 1024;

export const maxImageSide = 16_000;

export const maxImagePixels = 25_000_000;

export const imageTypes = ["image/png", "image/jpeg", "image/webp"] as const;

export const imageType = z.enum(imageTypes);

export type ImageType = z.infer<typeof imageType>;

export const imagePrefix = "/api/images/";

export const socketMaxPayload = 16 * 1024 * 1024;

export const maxSentDocBytes = socketMaxPayload - 64 * 1024;

export const canvasKey = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "not a canvas key: 1 to 40 of a-z, 0-9 and -");

export const keyOfName = z.string().transform((name) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .slice(0, 41)
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, ""),
);

export const canvasName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (name) => canvasKey.safeParse(keyOfName.parse(name)).success,
    "a canvas name needs a letter or a digit",
  );

export const pageKey = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "not a page key: 1 to 40 of a-z, 0-9 and -");

export const pageName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (name) => pageKey.safeParse(keyOfName.parse(name)).success,
    "a page name needs a letter or a digit",
  );

export const maxPages = 50;

export const firstPage = { key: "page-1", name: "Page 1" } as const;

export const placeAt = z.number().int().min(0).max(100_000);

export const frameId = z.string().regex(/^[0-9a-f]{12}$/, "not a frame id");

export const frameName = z.string().trim().min(1).max(200);

const side = z.number().int().min(1).max(16_000);

export const size = z.object({ w: side, h: side });

export const version = z.number().int().positive();

export const canvasInfo = z.object({
  key: z.string(),
  name: z.string(),
  created: z.number(),
  shared: z.boolean(),
});

export type CanvasInfo = z.infer<typeof canvasInfo>;

export const frameStatus = z.enum(["exploring", "ready"]);

export type FrameStatus = z.infer<typeof frameStatus>;

export const frameInfo = z.object({
  id: z.string(),
  name: z.string(),
  page: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  version: z.number(),
});

export type FrameInfo = z.infer<typeof frameInfo>;

export const listedFrame = frameInfo.extend({ status: frameStatus });

export type ListedFrame = z.infer<typeof listedFrame>;

export const imageInfo = z.object({
  mimeType: imageType,
  w: z.number(),
  h: z.number(),
  bytes: z.number(),
  url: z
    .string()
    .regex(/^\/api\/images\/[a-z0-9-]+\/[0-9a-f]{64}\?k=[\w-]+$/, "not an image's path"),
});

export type ImageInfo = z.infer<typeof imageInfo>;

export const frame = z.union([
  listedFrame.extend({ html: z.string() }),
  listedFrame.extend({ tsx: z.string() }),
  listedFrame.extend({ files: frameFiles }),
  listedFrame.extend({ image: imageInfo }),
]);

export type Frame = z.infer<typeof frame>;

const boardFrame = frameInfo.extend({
  canvas: z.string(),
  k: z.string().optional(),
  status: frameStatus,
});

export type BoardFrame = z.infer<typeof boardFrame>;

export const boardApp = z.object({ js: z.string(), kit: z.number(), runtime: runtimeLink });

export const boardDoc = z.object({
  canvas: z.string(),
  id: z.string(),
  version: z.number(),
  html: z.string(),
  css: z.string().nullable(),
  app: boardApp.nullable().optional(),
});

export const frames = data({
  label: "frames.frames",
  mode: "keyed",
  parse: boardFrame,
  key: (f) => ({ canvas: f.canvas, page: f.page, id: f.id }),
});

export const pageInfo = z.object({ key: z.string(), name: z.string(), frames: z.number() });

export type PageInfo = z.infer<typeof pageInfo>;

const boardPage = pageInfo.extend({ canvas: z.string(), order: z.number() });

export type BoardPage = z.infer<typeof boardPage>;

export const pages = data({
  label: "frames.pages",
  mode: "keyed",
  parse: boardPage,
  key: (p) => ({ canvas: p.canvas, key: p.key }),
});

export const docs = data({
  label: "frames.docs",
  mode: "keyed",
  parse: boardDoc,
  key: (d) => ({ canvas: d.canvas, id: d.id }),
});

export const kept = data({
  label: "frames.kept",
  mode: "keyed",
  parse: z.object({
    canvas: z.string(),
    id: z.string(),
    version: z.number(),
    k: z.string().optional(),
  }),
  key: (v) => ({ canvas: v.canvas, id: v.id, version: v.version }),
});

const removedFrame = frameInfo
  .omit({ version: true })
  .extend({ canvas: z.string(), removed: z.number() });

export type Removed = z.infer<typeof removedFrame>;

export const removed = data({
  label: "frames.removed",
  mode: "keyed",
  parse: removedFrame,
  key: (f) => ({ canvas: f.canvas, id: f.id }),
});

export const pageClient = data({
  label: "frames.client",
  mode: "keyed",
  parse: z.object({ canvas: z.string(), client: z.string().nullable() }),
  key: (c) => ({ canvas: c.canvas }),
});

export const framesBoard = remoteData({
  frames,
  pages,
  docs,
  kept,
  removed,
  requests,
  messages,
  serverClock,
  kit,
  client: pageClient,
});

const gone = z.object({ kind: z.literal("gone") });

export const maxFindings = 20;

export const maxMadeCssBytes = 256 * 1024;

const written = z.object({
  kind: z.enum(["created", "updated", "unchanged"]),
  id: z.string(),
  version: z.number(),
  findings: z.array(findingShape),
  more: z.number(),
});

const unsettled = z.object({
  kind: z.literal("unsettled"),
  findings: z.array(findingShape),
  more: z.number(),
});

export const imageInput = z.strictObject({
  mimeType: imageType,
  data: z.base64().max(Math.ceil((2 * maxImageBytes) / 3) * 4),
});

export type ImageInput = z.infer<typeof imageInput>;

export const badImageReason = z.enum(["type", "pixels", "unreadable"]);

export const badImage = z.object({
  kind: z.literal("badImage"),
  reason: badImageReason,
  maxSide: z.number(),
  maxPixels: z.number(),
});

const placeOfNew = {
  page: pageKey.optional(),
  x: placeAt.optional(),
  y: placeAt.optional(),
};

export const putInput = z.union([
  z.strictObject({
    canvas: canvasKey,
    html: z.string(),
    name: frameName.optional(),
    size: size.optional(),
    ...placeOfNew,
  }),
  z.strictObject({ canvas: canvasKey, html: z.string(), id: frameId, base: version }),
  z.strictObject({
    canvas: canvasKey,
    tsx: z.string(),
    name: frameName.optional(),
    size: size.optional(),
    ready: z.boolean().optional(),
    ...placeOfNew,
  }),
  z.strictObject({
    canvas: canvasKey,
    tsx: z.string(),
    id: frameId,
    base: version,
    ready: z.boolean().optional(),
  }),
  z.strictObject({
    canvas: canvasKey,
    files: frameFiles,
    name: frameName.optional(),
    size: size.optional(),
    ready: z.boolean().optional(),
    ...placeOfNew,
  }),
  z.strictObject({
    canvas: canvasKey,
    files: frameFiles,
    id: frameId,
    base: version,
    ready: z.boolean().optional(),
  }),
  z.strictObject({
    canvas: canvasKey,
    image: imageInput,
    name: frameName.optional(),
    ...placeOfNew,
  }),
  z.strictObject({ canvas: canvasKey, image: imageInput, id: frameId, base: version }),
]);

export type PutInput = z.infer<typeof putInput>;

export const putOutput = z.union([
  written,
  z.object({ kind: z.literal("stale"), id: z.string(), version: z.number() }),
  gone,
  z.object({ kind: z.literal("tooBig"), maxBytes: z.number() }),
  z.object({ kind: z.literal("offKit"), findings: z.array(findingShape), more: z.number() }),
  unsettled,
  badImage,
]);

const one = z.object({ canvas: canvasKey, id: frameId });

export const picturePrefix = "/api/pictures/";

export const pictureScale = z.union([z.literal(0.25), z.literal(0.5), z.literal(1), z.literal(2)]);

export const pictureRegion = z.object({
  x: z.number().int().min(0).max(16_000),
  y: z.number().int().min(0).max(16_000),
  w: side,
  h: side,
});

export const maxPicturePixels = 8_000_000;
export const maxPictureSide = 16_000;

export const picturePath = z
  .string()
  .regex(
    /^\/api\/pictures\/[a-z0-9-]+\/[0-9a-f]{12}\/[1-9]\d*\?s=[0-9.]+&k=[\w-]+&kit=[1-9]\d*(&r=\d+,\d+,\d+,\d+)?$/,
    "not a picture's path",
  );

export const framesContracts = {
  "canvas.create": {
    input: z.object({ name: canvasName }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("created"), key: z.string() }),
      z.object({ kind: z.literal("taken") }),
    ]),
  },
  "canvas.list": {
    input: z.null(),
    output: z.object({ canvases: z.array(canvasInfo) }),
  },
  "canvas.delete": {
    input: z.strictObject({ canvas: canvasKey }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("deleted") }), gone]),
  },
  "canvas.share": {
    input: z.strictObject({ canvas: canvasKey, password: sharePassword.nullable().optional() }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("shared"), path: sharePath }),
      gone,
    ]),
  },
  "canvas.unshare": {
    input: z.strictObject({ canvas: canvasKey }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("unshared") }), gone]),
  },
  "frame.put": {
    input: putInput,
    output: putOutput,
  },
  "frame.list": {
    input: z.object({ canvas: canvasKey }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("found"), frames: z.array(listedFrame) }),
      gone,
    ]),
  },
  "frame.get": {
    input: one,
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("found"), frame }), gone]),
  },
  "frame.delete": {
    input: one,
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("deleted") }), gone]),
  },
  "frame.ready": {
    input: one,
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.enum(["ready", "unchanged"]), version: z.number() }),
      unsettled,
      gone,
    ]),
  },
  "frame.explore": {
    input: one,
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.enum(["exploring", "unchanged"]) }),
      gone,
    ]),
  },
  "frame.move": {
    input: z.strictObject({
      canvas: canvasKey,
      id: frameId,
      x: placeAt,
      y: placeAt,
      page: pageKey.optional(),
    }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.enum(["moved", "unchanged"]) }),
      gone,
    ]),
  },
  "page.list": {
    input: z.strictObject({ canvas: canvasKey }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("found"), pages: z.array(pageInfo) }),
      gone,
    ]),
  },
  "page.create": {
    input: z.strictObject({ canvas: canvasKey, name: pageName }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("created"), key: z.string() }),
      z.object({ kind: z.literal("taken") }),
      z.object({ kind: z.literal("full") }),
      gone,
    ]),
  },
  "page.rename": {
    input: z.strictObject({ canvas: canvasKey, page: pageKey, name: pageName }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("renamed") }),
      z.object({ kind: z.literal("taken") }),
      gone,
    ]),
  },
  "page.order": {
    input: z.strictObject({ canvas: canvasKey, pages: z.array(pageKey).min(1).max(maxPages) }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("ordered") }), gone]),
  },
  "page.delete": {
    input: z.strictObject({ canvas: canvasKey, page: pageKey }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("deleted") }),
      z.object({ kind: z.literal("notEmpty"), frames: z.number() }),
      z.object({ kind: z.literal("last") }),
      gone,
    ]),
  },
  "frame.shot": {
    input: z.strictObject({
      canvas: canvasKey,
      id: frameId,
      scale: pictureScale,
      region: pictureRegion.optional(),
    }),
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("ready"),
        url: picturePath,
        version: z.number(),
        kit: z.number(),
      }),
      z.object({ kind: z.literal("off") }),
      gone,
    ]),
  },
};

export const framesApi = rpc(framesContracts);

export type FramesAddress = Extract<keyof typeof framesApi.contracts, string>;

type KindOf<A extends FramesAddress> =
  Awaited<ReturnType<(typeof framesApi)[A]["run"]>> extends infer O
    ? O extends { kind: infer K }
      ? K
      : never
    : never;

export const framesSuccessKinds = {
  "canvas.create": ["created"],
  "canvas.list": "always",
  "canvas.delete": ["deleted"],
  "canvas.share": ["shared"],
  "canvas.unshare": ["unshared"],
  "frame.put": ["created", "updated", "unchanged"],
  "frame.list": ["found"],
  "frame.get": ["found"],
  "frame.delete": ["deleted"],
  "frame.ready": ["ready", "unchanged"],
  "frame.explore": ["exploring", "unchanged"],
  "frame.shot": ["ready"],
  "frame.move": ["moved", "unchanged"],
  "page.list": ["found"],
  "page.create": ["created"],
  "page.rename": ["renamed"],
  "page.order": ["ordered"],
  "page.delete": ["deleted"],
} as const satisfies {
  readonly [A in FramesAddress]: KindOf<A> extends never ? "always" : readonly KindOf<A>[];
};
