import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import { imageType } from "@/frames/contract";
import { imageAddress, readImage } from "@/frames/images.server";
import { pictureKey } from "@/frames/keys.server";
import { pictureAddress } from "@/frames/pictures.server";

import { requestApi } from "./contract";

const storedShot = z
  .object({
    kind: z.enum(["image", "region"]),
    sha: z.string().nullable(),
    type: imageType,
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    frameId: z.string().nullable(),
    version: z.number().nullable(),
    kit: z.number(),
    gen: z.number(),
  })
  .nullable();

const readShot = `SELECT s.kind, s.sha, s.type, s.x, s.y, s.w, s.h,
    r.frame_id AS frameId, r.version, COALESCE(r.kit, 1) AS kit,
    COALESCE((SELECT gen FROM frames_keygen WHERE canvas = s.canvas), 0) AS gen
  FROM queue_shots s JOIN queue_requests r ON r.id = s.request
  WHERE s.canvas = $canvas AND s.request = $id`;

const regionAddress = operation({
  label: "queue.regionAddress",
  input: z.object({
    canvas: z.string(),
    frameId: z.string(),
    version: z.number(),
    kit: z.number(),
    gen: z.number(),
    box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  }),
  depends: { pictureKey, pictureAddress },
  run: ({ pictureKey, pictureAddress }, { input }) => {
    const { canvas, frameId: id, version, gen, kit, box } = input;
    const k = pictureKey.run({ input: { canvas, id, version, gen } });
    const r = `${box.x},${box.y},${box.w},${box.h}`;
    return pictureAddress.run({ input: { canvas, id, version, s: "1", k, kit, r } });
  },
});

export const shotOf = operation({
  label: "queue.shotOf",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { connection: bunSqlite.connection, imageAddress, regionAddress },
  run: async ({ connection, imageAddress, regionAddress }, { input }) => {
    const row = storedShot.parse(
      connection.db.$client.query(readShot).get({ $canvas: input.canvas, $id: input.id }) ?? null,
    );
    if (row === null) return null;

    const { canvas } = input;
    const { kind, w, h, gen } = row;
    if (row.sha !== null) {
      const url = imageAddress.run({ input: { canvas, sha: row.sha, gen } });
      return { kind, mimeType: row.type, w, h, url };
    }
    if (row.frameId === null || row.version === null) return null;

    const at = { canvas, frameId: row.frameId, version: row.version, kit: row.kit, gen };
    const url = regionAddress.run({ input: { ...at, box: { x: row.x, y: row.y, w, h } } });
    return { kind, mimeType: row.type, w, h, url };
  },
});

export const loadShots = operation({
  label: "queue.loadShots",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { shotOf },
  run: async ({ shotOf }, { input }) => {
    const shot = await shotOf.run({ input });
    return shot === null ? [] : [{ ...input, ...shot }];
  },
});

export const shotWriteOf = operation({
  label: "queue.shotWriteOf",
  input: requestApi["request.add"].input,
  depends: { readImage },
  run: async ({ readImage }, { input }) => {
    const shot = input.shot;
    if (shot === undefined) return { kind: "none" as const, shot: null };
    if (shot.kind === "region") return { kind: "ready" as const, shot };

    const read = await readImage.run({ input: shot.image });
    switch (read.kind) {
      case "image":
        return { kind: "ready" as const, shot: read };
      case "tooBig":
      case "badImage":
        return { kind: "refused" as const, answer: read };
    }
  },
});
