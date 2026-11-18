import { data, remoteData, rpc } from "@tinkered/core";
import { z } from "zod";

import { sharePath } from "./share";

// frames' contract (SPEC-frames.md § Contract): the CLI, MCP and the page import it. `framesApi`
// is a user's calls (the `user` guard runs first, fact rule 1). `framesBoard` is the board a live
// tab watches (`easel.board`): its cells are keyed by canvas, and `mayRead` guards every read
// (fact rule 6). `frames` holds each frame's metadata and version; `docs` holds no member on the
// server: each read loads the document from SQLite (decision C12).

/** The largest document: 1 MiB of UTF-8, measured on its bytes, not its string length. */
export const maxDocBytes = 1024 * 1024;

/**
 * The socket's `maxPayload`, set by the cmd (SPEC.md rule 3, decision C11): 2 MiB, above
 * `maxDocBytes`, so a document a little too big gets `tooBig` and not a closed socket.
 */
export const socketMaxPayload = 2 * 1024 * 1024;

/**
 * The largest document as it goes on the socket, JSON-encoded: each `"`, `\` and control
 * character takes 2 to 6 bytes there. 64 KiB under `socketMaxPayload` leaves room for the rest of
 * the message. The CLI answers `tooBig` over it before it sends, so the socket stays open.
 */
export const maxSentDocBytes = socketMaxPayload - 64 * 1024;

/** A canvas's key: `checkout-flow`. 1 to 40 of a-z and 0-9, dashes between (decision C3). */
export const canvasKey = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "not a canvas key: 1 to 40 of a-z, 0-9 and -");

/**
 * The key a canvas's name gives (decision C3): lower case, each run of other characters one dash,
 * no dash at either end, cut at 40.
 */
export const keyOfName = z.string().transform((name) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .slice(0, 41)
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, ""),
);

/** A canvas's name. A name with no letter or digit gives no key, and is `invalid` (decision C3). */
export const canvasName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (name) => canvasKey.safeParse(keyOfName.parse(name)).success,
    "a canvas name needs a letter or a digit",
  );

/** A frame's id: 12 hex digits, made by the server. */
export const frameId = z.string().regex(/^[0-9a-f]{12}$/, "not a frame id");

/** A frame's name: what `easel ls` shows. */
export const frameName = z.string().trim().min(1).max(200);

/** A side of a frame's box, in CSS pixels: no picture is over 16000 px a side (judged rule 6). */
const side = z.number().int().min(1).max(16_000);

export const size = z.object({ w: side, h: side });

/** A frame's version: 1 when it is made, one up on each change of its document. */
export const version = z.number().int().positive();

/** A canvas as `easel canvas ls` lists it (decision C1). `shared`: it has a live share link. */
export const canvasInfo = z.object({
  key: z.string(),
  name: z.string(),
  created: z.number(),
  shared: z.boolean(),
});

export type CanvasInfo = z.infer<typeof canvasInfo>;

/** A frame without its document (decision C1): its box on the canvas, and its version. */
export const frameInfo = z.object({
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  version: z.number(),
});

export type FrameInfo = z.infer<typeof frameInfo>;

/** A frame with its document (decision C1). */
export const frame = frameInfo.extend({ html: z.string() });

export type Frame = z.infer<typeof frame>;

/**
 * The board's frame: a frame's metadata, keyed by canvas and id, with its picture key `k` for its
 * version (SPEC-frames § Pictures). No `k`: pictures are off, and the shell is a plain card.
 */
const boardFrame = frameInfo.extend({ canvas: z.string(), k: z.string().optional() });

/** The board's document: one version of one frame's html. */
const boardDoc = z.object({
  canvas: z.string(),
  id: z.string(),
  version: z.number(),
  html: z.string(),
});

/** Each canvas's frames, as the board serves them: a tab reads one canvas with `where`. */
export const frames = data({
  label: "frames.frames",
  mode: "keyed",
  parse: boardFrame,
  key: (f) => ({ canvas: f.canvas, id: f.id }),
});

/** Each frame's document: a tab reads one with `of({ canvas, id })` (SPEC-viewer fact rule 5). */
export const docs = data({
  label: "frames.docs",
  mode: "keyed",
  parse: boardDoc,
  key: (d) => ({ canvas: d.canvas, id: d.id }),
});

/** `easel.board`: what a live tab watches. */
export const framesBoard = remoteData({ frames, docs });

const gone = z.object({ kind: z.literal("gone") });

/** The answer of a put that wrote, or found the same document: the frame's id and version. */
const written = z.object({
  kind: z.enum(["created", "updated", "unchanged"]),
  id: z.string(),
  version: z.number(),
});

/**
 * `frame.put`'s input: a new frame (`name`, `size`), or a write on an id at the version the agent
 * read (`id` with `base`). The two shapes are strict: `id` without `base`, `base` without `id`, or
 * `name` or `size` with `id` (decision C5) is `invalid`.
 */
export const putInput = z.union([
  z.strictObject({
    canvas: canvasKey,
    html: z.string(),
    name: frameName.optional(),
    size: size.optional(),
  }),
  z.strictObject({ canvas: canvasKey, html: z.string(), id: frameId, base: version }),
]);

/** `frame.put`'s answer. */
export const putOutput = z.union([
  written,
  z.object({ kind: z.literal("stale"), id: z.string(), version: z.number() }),
  gone,
  z.object({ kind: z.literal("tooBig"), maxBytes: z.number() }),
]);

const one = z.object({ canvas: canvasKey, id: frameId });

/** Where pictures are: `/api/pictures/<canvas>/<id>/<version>?s=<scale>&k=<key>[&r=x,y,w,h]`. */
export const picturePrefix = "/api/pictures/";

/** A picture's scales: 0.25, 0.5, 1 and 2. Any other answers 400. */
export const pictureScale = z.union([z.literal(0.25), z.literal(0.5), z.literal(1), z.literal(2)]);

/** A region of a frame, in its CSS pixels: `--region x,y,w,h`. */
export const pictureRegion = z.object({
  x: z.number().int().min(0).max(16_000),
  y: z.number().int().min(0).max(16_000),
  w: side,
  h: side,
});

/** No picture is over 8 megapixels or 16000 px on a side (judged rule 6). */
export const maxPicturePixels = 8_000_000;
export const maxPictureSide = 16_000;

/**
 * What `frame.shot` answers: a picture's address on this server, as a path. The CLI joins it to
 * its own server only in this shape, so an answer cannot send the fetch to another host.
 */
export const picturePath = z
  .string()
  .regex(
    /^\/api\/pictures\/[a-z0-9-]+\/[0-9a-f]{12}\/[1-9]\d*\?s=[0-9.]+&k=[\w-]+(&r=\d+,\d+,\d+,\d+)?$/,
    "not a picture's path",
  );

/** A user's calls. Each needs a live user token (`{ signIn: true }` without one). */
export const framesApi = rpc({
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
  // Strict: a `password` field is `invalid` until passwords are built (SPEC-frames § Inputs).
  "canvas.share": {
    input: z.strictObject({ canvas: canvasKey }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("shared"), path: sharePath }),
      gone,
    ]),
  },
  "frame.put": {
    input: putInput,
    output: putOutput,
  },
  "frame.list": {
    input: z.object({ canvas: canvasKey }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("found"), frames: z.array(frameInfo) }),
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
  // The picture's address for the current version; it draws nothing (fact rule 3). `off`: the
  // server has no Chromium.
  "frame.shot": {
    input: z.strictObject({
      canvas: canvasKey,
      id: frameId,
      scale: pictureScale,
      region: pictureRegion.optional(),
    }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ready"), url: picturePath, version: z.number() }),
      z.object({ kind: z.literal("off") }),
      gone,
    ]),
  },
});

export type FramesAddress = Extract<keyof typeof framesApi.contracts, string>;

type KindOf<A extends FramesAddress> =
  Awaited<ReturnType<(typeof framesApi)[A]["run"]>> extends infer O
    ? O extends { kind: infer K }
      ? K
      : never
    : never;

/**
 * SPEC.md rule 1: the one list of success kinds, by call (SPEC-frames.md § Contract). The CLI's
 * exit code and MCP's `isError` read it. `always`: the call answers no kind, and is a success.
 */
export const framesSuccessKinds = {
  "canvas.create": ["created"],
  "canvas.list": "always",
  "canvas.share": ["shared"],
  "frame.put": ["created", "updated", "unchanged"],
  "frame.list": ["found"],
  "frame.get": ["found"],
  "frame.delete": ["deleted"],
  "frame.shot": ["ready"],
} as const satisfies {
  readonly [A in FramesAddress]: KindOf<A> extends never ? "always" : readonly KindOf<A>[];
};
