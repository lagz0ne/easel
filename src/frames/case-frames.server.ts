import type { Database } from "bun:sqlite";

import { operation } from "@tinkered/core";
import { z } from "zod";

export const casesSchema = `
CREATE TABLE IF NOT EXISTS frames_cases (
  canvas TEXT NOT NULL,
  source TEXT NOT NULL,
  list TEXT NOT NULL,
  rev INTEGER NOT NULL,
  PRIMARY KEY (canvas, source)
);`;

const idRow = z.object({ id: z.string() });

export const caseFrameIdsOf = operation({
  label: "frames.caseFrameIdsOf",
  input: z.object({
    canvas: z.string(),
    source: z.string(),
    db: z.custom<Database>(),
  }),
  run: (_, { input: { canvas, source, db } }) =>
    db
      .query("SELECT id FROM frames_frames WHERE canvas = ? AND source = ? ORDER BY made, rowid")
      .all(canvas, source)
      .map((row) => idRow.parse(row).id),
});

export const sourceOf = operation({
  label: "frames.sourceOf",
  input: z.object({
    canvas: z.string(),
    id: z.string(),
    db: z.custom<Database>(),
  }),
  run: (_, { input: { canvas, id, db } }) =>
    z
      .object({ source: z.string().nullable() })
      .nullable()
      .parse(
        db.query("SELECT source FROM frames_frames WHERE canvas = ? AND id = ?").get(canvas, id),
      )?.source ?? null,
});

export const followSource = operation({
  label: "frames.followSource",
  input: z.object({
    canvas: z.string(),
    source: z.string(),
    db: z.custom<Database>(),
  }),
  run: (_, { input: { canvas, source, db } }) =>
    db
      .query(
        `UPDATE frames_frames
         SET html = s.html, css = s.css, kit = s.kit, js = s.js, image = s.image,
           w = s.w, h = s.h, version = s.version, status = s.status
         FROM (SELECT html, css, kit, js, image, w, h, version, status
               FROM frames_frames WHERE canvas = ?1 AND id = ?2) AS s
         WHERE frames_frames.canvas = ?1 AND frames_frames.source = ?2
         RETURNING frames_frames.id`,
      )
      .all(canvas, source)
      .map((row) => idRow.parse(row).id),
});

export const dropCaseList = operation({
  label: "frames.dropCaseList",
  input: z.object({
    canvas: z.string(),
    source: z.string(),
    db: z.custom<Database>(),
  }),
  run: (_, { input: { canvas, source, db } }) => {
    db.query("DELETE FROM frames_cases WHERE canvas = ? AND source = ?").run(canvas, source);
  },
});
