import { createHash } from "node:crypto";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import {
  canvasKey,
  imageInput,
  imagePrefix,
  imageType,
  maxImageBytes,
  maxImagePixels,
  maxImageSide,
} from "./contract";
import { imageKey, keyMatches } from "./keys.server";

export const imageCache = "private, max-age=31536000, immutable";

const formatOfType = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
} as const;

const errorCode = z
  .unknown()
  .transform((error) => z.object({ code: z.string() }).safeParse(error).data?.code ?? "");

const reasonOfCode = z.string().transform((code) => {
  if (code === "ERR_IMAGE_UNKNOWN_FORMAT") return "type" as const;
  return code === "ERR_IMAGE_TOO_MANY_PIXELS" ? ("pixels" as const) : ("unreadable" as const);
});

const imageLimits = { maxSide: maxImageSide, maxPixels: maxImagePixels } as const;

export const sanitizedImage = z.object({
  sha: z.string(),
  type: imageType,
  w: z.number(),
  h: z.number(),
  bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
});

export type SanitizedImage = z.infer<typeof sanitizedImage>;

const failedCode = z
  .unknown()
  .transform((error) => ({ kind: "failed" as const, code: errorCode.parse(error) }));

const reencode = operation({
  label: "images.reencode",
  input: z.object({ bytes: z.custom<Uint8Array>(), type: imageType }),
  run: async (_, { input: { bytes, type } }) => {
    const meta = await new Bun.Image(bytes, { maxPixels: maxImagePixels })
      .metadata()
      .catch((error: unknown) => failedCode.parse(error));
    if ("kind" in meta) return meta;
    if (meta.format !== formatOfType[type]) return { kind: "badImage", reason: "type" } as const;
    if (Math.max(meta.width, meta.height) > maxImageSide) {
      return { kind: "badImage", reason: "pixels" } as const;
    }

    const clean = new Bun.Image(bytes, { maxPixels: maxImagePixels });
    const encoder =
      type === "image/png"
        ? clean.png()
        : type === "image/jpeg"
          ? clean.jpeg({ quality: 90 })
          : clean.webp({ quality: 90 });
    const out = await encoder.bytes().catch((error: unknown) => failedCode.parse(error));
    if (!(out instanceof Uint8Array)) return out;

    const sha = createHash("sha256").update(out).digest("hex");
    return { kind: "image" as const, sha, type, w: clean.width, h: clean.height, bytes: out };
  },
});

export const readImage = operation({
  label: "images.read",
  input: imageInput,
  depends: { reencode },
  run: async ({ reencode }, { input }) => {
    const bytes = new Uint8Array(Buffer.from(input.data, "base64"));
    if (bytes.byteLength > maxImageBytes) {
      return { kind: "tooBig" as const, maxBytes: maxImageBytes };
    }

    const made = await reencode.run({ input: { bytes, type: input.mimeType } });
    switch (made.kind) {
      case "image":
        return made;
      case "badImage":
        return { kind: "badImage" as const, reason: made.reason, ...imageLimits };
      case "failed":
        return { kind: "badImage" as const, reason: reasonOfCode.parse(made.code), ...imageLimits };
    }
  },
});

export const imageAddress = operation({
  label: "images.address",
  input: z.object({ canvas: z.string(), sha: z.string(), gen: z.number() }),
  depends: { imageKey },
  run: ({ imageKey }, { input }) =>
    `${imagePrefix}${input.canvas}/${input.sha}?k=${imageKey.run({ input })}`,
});

const htmlAttribute = z
  .string()
  .transform((text) =>
    text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
  );

export const imageDoc = operation({
  label: "images.doc",
  input: z.object({ src: z.string(), name: z.string() }),
  run: (_, { input }) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="easel-kit" content="off">` +
    `<style>html,body{margin:0;height:100%;overflow:hidden}img{display:block;width:100%;height:100%}</style>` +
    `</head><body><img src="${htmlAttribute.parse(input.src)}" alt="${htmlAttribute.parse(input.name)}"></body></html>`,
});

const storedImage = z.object({
  type: imageType,
  bytes: z.custom<Uint8Array<ArrayBuffer>>((value) => value instanceof Uint8Array),
  gen: z.number(),
});

export const readStoredImage = operation({
  label: "images.readStored",
  input: z.object({ canvas: z.string(), sha: z.string() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    storedImage.safeParse(
      connection.db.$client
        .query(
          `SELECT type, bytes, COALESCE((SELECT gen FROM frames_keygen WHERE canvas = $canvas), 0) AS gen
           FROM frames_images WHERE canvas = $canvas AND sha = $sha`,
        )
        .get({ $canvas: input.canvas, $sha: input.sha }),
    ).data ?? null,
});

export const imageDataUri = operation({
  label: "images.dataUri",
  input: z.object({ canvas: z.string(), sha: z.string() }),
  depends: { readStoredImage },
  run: async ({ readStoredImage }, { input }) => {
    const found = await readStoredImage.run({ input });
    if (found === null) return null;

    return `data:${found.type};base64,${Buffer.from(found.bytes).toString("base64")}`;
  },
});

const imageRouteInput = z.object({
  canvas: z.string(),
  sha: z.string(),
  k: z.string().optional(),
});

const shaOf = z.string().regex(/^[0-9a-f]{64}$/);

const notFound = operation({
  label: "images.notFound",
  run: () =>
    new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    }),
});

export const imageRoute = operation({
  label: "images.route",
  input: imageRouteInput,
  depends: { readStoredImage, imageKey, keyMatches, notFound },
  run: async ({ readStoredImage, imageKey, keyMatches, notFound }, { input }) => {
    const canvas = canvasKey.safeParse(input.canvas);
    const sha = shaOf.safeParse(input.sha);
    if (!canvas.success || !sha.success) return notFound.run();

    const at = { canvas: canvas.data, sha: sha.data };
    const found = await readStoredImage.run({ input: at });
    if (found === null) return notFound.run();
    const want = imageKey.run({ input: { ...at, gen: found.gen } });
    if (!keyMatches.run({ input: { sent: input.k ?? "", want } })) return notFound.run();

    return new Response(found.bytes, {
      status: 200,
      headers: {
        "Content-Type": found.type,
        "Content-Length": String(found.bytes.byteLength),
        "Cache-Control": imageCache,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Content-Disposition": "inline",
      },
    });
  },
});
