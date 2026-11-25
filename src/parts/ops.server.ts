import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, operation } from "@tinkered/core";
import { z } from "zod";

import { framesBoard } from "@/frames/contract";
import { copyRevs, mainsOf } from "@/kit/copies.server";
import { designNow, fillNow, partSources, publishMains, type Source } from "@/kit/parts.server";

import { partsApi } from "./contract";

const frameText = z.object({
  canvas: z.string(),
  id: z.string(),
  name: z.string(),
  version: z.number(),
  html: z.string(),
});

type FrameText = z.infer<typeof frameText>;

const frameKey = z.object({ canvas: z.string(), id: z.string() });

const textsOf = z
  .array(z.unknown())
  .transform((rows) => rows.flatMap((row) => frameText.safeParse(row).data ?? []));

const keysOf = z
  .array(z.unknown())
  .transform((rows) => rows.flatMap((row) => frameKey.safeParse(row).data ?? []));

const columns = "canvas, id, name, version, html";

export const usersOf = operation({
  label: "parts.usersOf",
  input: z.array(z.string()),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: ids }) => {
    const db = connection.db.$client;
    const found = new Map<string, z.infer<typeof frameKey>>();
    for (const id of ids) {
      const rows = db
        .query("SELECT canvas, id FROM frames_frames WHERE instr(html, ?) > 0 ORDER BY canvas, id")
        .all(`data-doop-instance="${id}"`);
      for (const row of keysOf.parse(rows)) found.set(`${row.canvas}/${row.id}`, row);
    }
    return [...found.values()];
  },
});

export const copyFramesOf = operation({
  label: "parts.copyFramesOf",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: id }) =>
    keysOf.parse(
      connection.db.$client
        .query(
          "SELECT canvas, id FROM frames_frames WHERE source IS NULL AND instr(html, ?) > 0 ORDER BY canvas, id",
        )
        .all(`data-doop-instance="${id}"`),
    ),
});

const floorsOf = operation({
  label: "parts.floorsOf",
  depends: { connection: bunSqlite.connection, copyRevs },
  run: async ({ connection, copyRevs }) => {
    const rows = connection.db.$client
      .query("SELECT html FROM frames_frames WHERE instr(html, 'data-doop-rev') > 0")
      .all();
    const floors: Record<string, number> = {};
    for (const { html } of z.array(z.object({ html: z.string() })).parse(rows)) {
      for (const [id, rev] of copyRevs.run({ input: html })) {
        floors[id] = Math.max(floors[id] ?? 0, rev);
      }
    }
    return floors;
  },
});

const publishFrames = operation({
  label: "parts.publishFrames",
  input: z.object({ frames: z.array(frameText), first: z.boolean() }),
  depends: {
    mainsOf,
    floorsOf,
    publishMains,
    usersOf,
    invalidate: framesBoard.invalidate,
  },
  run: async ({ mainsOf, floorsOf, publishMains, usersOf, invalidate }, { input }) => {
    const sources: Source[] = input.frames
      .map((f) => ({
        canvas: f.canvas,
        frame: f.id,
        version: f.version,
        name: f.name,
        mains: mainsOf.run({ input: f.html }),
      }))
      .filter((s) => s.mains.length > 0);
    const floors = input.first ? await floorsOf.run() : {};
    const answer = await publishMains.run({ input: { sources, floors } });

    for (const docs of await usersOf.run({ input: answer.changed })) {
      await invalidate.run({ input: { docs } });
    }
    return answer;
  },
});

const readCanvas = operation({
  label: "parts.readCanvas",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: canvas }) => {
    const db = connection.db.$client;
    if (db.query("SELECT 1 FROM frames_canvases WHERE key = ?").get(canvas) === null) return null;

    const rows = db
      .query(`SELECT ${columns} FROM frames_frames WHERE canvas = ? ORDER BY made, rowid`)
      .all(canvas);
    return textsOf.parse(rows);
  },
});

const readFrame = operation({
  label: "parts.readFrame",
  input: frameKey,
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }): Promise<FrameText | null> =>
    frameText.safeParse(
      connection.db.$client
        .query(`SELECT ${columns} FROM frames_frames WHERE canvas = ? AND id = ?`)
        .get(input.canvas, input.id),
    ).data ?? null,
});

export const publishCanvas = operation({
  label: "parts.publish.do",
  input: partsApi["parts.publish"].input,
  depends: { readCanvas, publishFrames },
  run: async ({ readCanvas, publishFrames }, { input }) => {
    const frames = await readCanvas.run({ input: input.canvas });
    if (frames === null) return { kind: "gone" as const };

    const { kind, kit, rev, parts } = await publishFrames.run({ input: { frames, first: true } });
    return { kind, kit, rev, parts };
  },
});

export const publishFrom = operation({
  label: "parts.publishFrom",
  input: frameKey,
  depends: { partSources, readFrame, publishFrames },
  run: async ({ partSources, readFrame, publishFrames }, { input }) => {
    const source = (await partSources.run()).some(
      (part) => part.canvas === input.canvas && part.frame === input.id,
    );
    const frame = source ? await readFrame.run({ input }) : null;
    if (frame === null) return null;

    return publishFrames.run({ input: { frames: [frame], first: false } });
  },
});

export const catchUp = operation({
  label: "parts.catchUp",
  depends: { partSources, readFrame, publishFrames },
  run: async ({ partSources, readFrame, publishFrames }) => {
    const late = new Map<string, FrameText>();
    for (const part of await partSources.run()) {
      const frame = await readFrame.run({ input: { canvas: part.canvas, id: part.frame } });
      if (frame && frame.version > part.version) late.set(`${frame.canvas}/${frame.id}`, frame);
    }
    if (late.size === 0) return null;

    return publishFrames.run({ input: { frames: [...late.values()], first: false } });
  },
});

type Counts = Map<string, { linked: number; edited: number }>;

const countsIn = operation({
  label: "parts.countsIn",
  input: frameKey,
  depends: { readFrame, fillNow },
  run: async ({ readFrame, fillNow }, { input }): Promise<Counts> => {
    const html = (await readFrame.run({ input }))?.html ?? "";
    const filled = await fillNow.run({ input: html });
    return new Map(filled.copies.map((c) => [c.id, { linked: c.linked, edited: c.edited }]));
  },
});

export const listParts = operation({
  label: "parts.list.do",
  input: partsApi["parts.list"].input,
  depends: { designNow, copyFramesOf, countsIn },
  run: async ({ designNow, copyFramesOf, countsIn }) => {
    const design = await designNow.run();
    const counted = new Map<string, Counts>();
    const parts = [];
    for (const part of design.now.values()) {
      const copies = [];
      for (const key of await copyFramesOf.run({ input: part.id })) {
        const at = `${key.canvas}/${key.id}`;
        const counts = counted.get(at) ?? (await countsIn.run({ input: key }));
        counted.set(at, counts);
        const mine = counts.get(part.id);
        if (mine) copies.push({ canvas: key.canvas, id: key.id, ...mine });
      }

      const { id, name, rev, canvas, frame, version } = part;
      parts.push({ id, name, rev, source: { canvas, frame, version }, copies });
    }
    return { kind: "found" as const, kit: design.kit, rev: design.rev, parts };
  },
});

export const showFrame = operation({
  label: "parts.show.do",
  input: partsApi["parts.show"].input,
  depends: { readFrame, fillNow },
  run: async ({ readFrame, fillNow }, { input }) => {
    const frame = await readFrame.run({ input });
    if (frame === null) return { kind: "gone" as const };

    const filled = await fillNow.run({ input: frame.html });
    return { kind: "found" as const, kit: filled.kit, version: frame.version, html: filled.html };
  },
});

export const partsOps = {
  "parts.list": listParts,
  "parts.publish": publishCanvas,
  "parts.show": showFrame,
} as const;

export const partsServer = capsule({
  label: "partsServer",
  hooks: {
    async start({ run, next }) {
      await run(catchUp, {}, { role: "setup", explain: "Publishes each main that a put left" });
      await next();
    },
  },
});
