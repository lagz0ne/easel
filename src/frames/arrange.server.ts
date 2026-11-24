import type { Database } from "bun:sqlite";

import { operation } from "@tinkered/core";
import { z } from "zod";

import {
  arrangeGap,
  clearance,
  type Finding,
  finding,
  maxLayoutFindings,
  sectionHead,
  sectionInfo,
  sectionSpace,
  touchSpace,
} from "./arrange";

const slot = z.object({
  id: z.string(),
  section: z.string(),
  col: z.number(),
  row: z.number(),
  w: z.number(),
  h: z.number(),
});

const box = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const sectionRow = z.object({
  key: z.string(),
  name: z.string(),
  ord: z.number(),
  atX: z.number().nullable(),
  atY: z.number().nullable(),
  wrap: z.number().nullable(),
  gap: z.number(),
});

export type SectionRow = z.infer<typeof sectionRow>;

export const layoutPage = operation({
  label: "frames.layoutPage",
  input: z.object({
    sections: z.array(sectionRow),
    slots: z.array(slot),
    fixed: z.array(box),
  }),
  run: (_, { input }) => {
    const shaped = input.sections
      .toSorted((a, b) => a.ord - b.ord || a.key.localeCompare(b.key))
      .flatMap((section) => {
        const mine = input.slots.filter((one) => one.section === section.key);
        const cols = [...new Set(mine.map((one) => one.col))].toSorted((a, b) => a - b);
        const columns = cols.map((col) =>
          mine.filter((one) => one.col === col).toSorted((a, b) => a.row - b.row),
        );
        if (columns.length === 0) return [];

        const { gap } = section;
        const perLine = section.wrap ?? columns.length;
        const inside: Array<{ id: string; dx: number; dy: number }> = [];
        let top = sectionHead;
        let w = 0;
        for (let start = 0; start < columns.length; start += perLine) {
          let x = 0;
          let tallest = 0;
          for (const column of columns.slice(start, start + perLine)) {
            let y = top;
            for (const one of column) {
              inside.push({ id: one.id, dx: x, dy: y });
              y += one.h + gap;
            }
            tallest = Math.max(tallest, y - gap - top);
            x += Math.max(...column.map((one) => one.w)) + gap;
          }
          w = Math.max(w, x - gap);
          top += tallest + gap;
        }
        const ids = columns.map((column) => column.map((one) => one.id));
        return [{ ...section, w, h: top - gap, inside, columns: ids }];
      });

    const placed = shaped.flatMap((s) =>
      s.atX === null || s.atY === null ? [] : [{ id: s.key, x: s.atX, y: s.atY, w: s.w, h: s.h }],
    );
    const fixed = [...input.fixed, ...placed];
    let cursor = 0;
    const origins = new Map<string, { x: number; y: number }>();
    for (const s of shaped) {
      if (s.atX !== null && s.atY !== null) {
        origins.set(s.key, { x: s.atX, y: s.atY });
        continue;
      }
      let y = cursor;
      for (;;) {
        const top = y;
        const hits = fixed.filter((o) => {
          const apartX = Math.max(o.x - s.w, -(o.x + o.w));
          const apartY = Math.max(o.y - (top + s.h), top - (o.y + o.h));
          return apartX < clearance && apartY < clearance;
        });
        if (hits.length === 0) break;
        y = Math.max(...hits.map((o) => o.y + o.h)) + clearance;
      }
      origins.set(s.key, { x: 0, y });
      cursor = y + s.h + sectionSpace;
    }

    const places = shaped.flatMap((s) => {
      const at = origins.get(s.key) ?? { x: 0, y: 0 };
      return s.inside.map((one) => ({ id: one.id, x: at.x + one.dx, y: at.y + one.dy }));
    });
    const boxes = shaped.map((s) => {
      const at = origins.get(s.key) ?? { x: 0, y: 0 };
      const { key, name, w, h, wrap, gap, columns } = s;
      return sectionInfo.parse({
        key,
        name,
        x: at.x,
        y: at.y,
        w,
        h,
        at: s.atX !== null,
        wrap,
        gap,
        columns,
      });
    });
    return { places, sections: boxes };
  },
});

const framed = box.extend({ section: z.string().nullable() });

export const findingsOf = operation({
  label: "frames.findingsOf",
  input: z.object({ frames: z.array(framed), sections: z.array(sectionInfo) }),
  run: (_, { input }): Finding[] => {
    const all = input.frames.toSorted((a, b) => a.x - b.x);
    const touches = all.flatMap((a, i) => {
      const near: Finding[] = [];
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (!b || b.x - (a.x + a.w) >= touchSpace) break;

        const apartY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
        if (apartY < touchSpace) near.push({ touch: [a.id, b.id] });
      }
      return near;
    });

    const strays = input.sections.flatMap((s) =>
      input.frames
        .filter((f) => f.section !== s.key)
        .filter((f) => f.x < s.x + s.w && s.x < f.x + f.w && f.y < s.y + s.h && s.y < f.y + f.h)
        .map((f): Finding => ({ stray: f.id, section: s.name })),
    );
    return [...touches, ...strays];
  },
});

const pageRow = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  section: z.string().nullable(),
  col: z.number().nullable(),
  row: z.number().nullable(),
});

export const sectionsSchema = `
CREATE TABLE IF NOT EXISTS frames_sections (
  canvas TEXT NOT NULL,
  page TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  ord INTEGER NOT NULL,
  at_x INTEGER,
  at_y INTEGER,
  wrap INTEGER,
  gap INTEGER NOT NULL DEFAULT ${arrangeGap},
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  w INTEGER NOT NULL DEFAULT 0,
  h INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (canvas, page, key)
);`;

const sectionsOf = `SELECT key, name, ord, at_x AS atX, at_y AS atY, wrap, gap
  FROM frames_sections WHERE canvas = ? AND page = ?`;

export const readSections = operation({
  label: "frames.readSections",
  input: z.object({ canvas: z.string(), page: z.string(), db: z.custom<Database>() }),
  run: (_, { input: { canvas, page, db } }) =>
    db
      .query(sectionsOf)
      .all(canvas, page)
      .map((row) => sectionRow.parse(row)),
});

export const readLayout = operation({
  label: "frames.readLayout",
  input: z.object({ canvas: z.string(), page: z.string(), db: z.custom<Database>() }),
  depends: { layoutPage, findingsOf, readSections },
  run: ({ layoutPage, findingsOf, readSections }, { input }) => {
    const { canvas, page, db } = input;
    const rows = db
      .query(
        "SELECT id, x, y, w, h, section, col, row FROM frames_frames WHERE canvas = ? AND page = ?",
      )
      .all(canvas, page)
      .map((row) => pageRow.parse(row));
    const slots = rows.flatMap(({ id, w, h, section, col, row }) =>
      section === null || col === null || row === null ? [] : [{ id, section, col, row, w, h }],
    );
    const fixed = rows.flatMap(({ id, x, y, w, h, section }) =>
      section === null ? [{ id, x, y, w, h }] : [],
    );
    const sections = readSections.run({ input });
    const laid = layoutPage.run({ input: { sections, slots, fixed } });

    const at = new Map(laid.places.map((place) => [place.id, place]));
    const frames = rows.map(({ id, w, h, section, ...row }) => {
      const now = at.get(id) ?? row;
      return { id, x: now.x, y: now.y, w, h, section };
    });
    const findings = findingsOf.run({ input: { frames, sections: laid.sections } });
    const was = new Map(rows.map((row) => [row.id, row]));
    const moved = laid.places.filter((place) => {
      const before = was.get(place.id);
      return !before || before.x !== place.x || before.y !== place.y;
    });
    return { moved, sections: laid.sections, findings };
  },
});

export const arrangePage = operation({
  label: "frames.arrangePage",
  input: z.object({ canvas: z.string(), page: z.string(), db: z.custom<Database>() }),
  depends: { readLayout },
  run: ({ readLayout }, { input }) => {
    const { canvas, page, db } = input;
    db.query(
      `DELETE FROM frames_sections WHERE canvas = ?1 AND page = ?2 AND key NOT IN
         (SELECT section FROM frames_frames
          WHERE canvas = ?1 AND page = ?2 AND section IS NOT NULL)`,
    ).run(canvas, page);
    const laid = readLayout.run({ input });

    const move = db.query("UPDATE frames_frames SET x = ?, y = ? WHERE canvas = ? AND id = ?");
    for (const place of laid.moved) move.run(place.x, place.y, canvas, place.id);
    const boxOfSection = db.query(
      "UPDATE frames_sections SET x = ?, y = ?, w = ?, h = ? WHERE canvas = ? AND page = ? AND key = ?",
    );
    for (const s of laid.sections) boxOfSection.run(s.x, s.y, s.w, s.h, canvas, page, s.key);
    const moved = laid.moved.map((place) => place.id);
    return { moved, sections: laid.sections, findings: laid.findings };
  },
});

const seat = z.object({
  page: z.string(),
  section: z.string(),
  col: z.number(),
  row: z.number(),
});

export const seatAt = z.discriminatedUnion("kind", [
  seat.extend({ kind: z.literal("after") }),
  seat.extend({ kind: z.literal("below") }),
  z.object({ kind: z.literal("section"), name: z.string(), key: z.string(), page: z.string() }),
]);

export type SeatAt = z.infer<typeof seatAt>;

export const revOf = operation({
  label: "frames.revOf",
  input: z.object({ canvas: z.string(), db: z.custom<Database>() }),
  run: (_, { input: { canvas, db } }) =>
    z
      .object({ rev: z.number() })
      .nullable()
      .parse(db.query("SELECT rev FROM frames_canvases WHERE key = ?").get(canvas))?.rev ?? 0,
});

export const bumpRev = operation({
  label: "frames.bumpRev",
  input: z.object({ canvas: z.string(), db: z.custom<Database>() }),
  run: (_, { input: { canvas, db } }) =>
    z
      .object({ rev: z.number() })
      .parse(
        db
          .query("UPDATE frames_canvases SET rev = rev + 1 WHERE key = ? RETURNING rev")
          .get(canvas),
      ).rev,
});

const seatOf = z.object({
  page: z.string(),
  section: z.string().nullable(),
  col: z.number().nullable(),
  row: z.number().nullable(),
});

export const targetOf = operation({
  label: "frames.targetOf",
  input: z.object({ canvas: z.string(), id: z.string(), db: z.custom<Database>() }),
  run: (_, { input: { canvas, id, db } }) => {
    const found = seatOf.safeParse(
      db
        .query("SELECT page, section, col, row FROM frames_frames WHERE canvas = ? AND id = ?")
        .get(canvas, id),
    ).data;
    if (!found) return { kind: "gone" as const };
    const { page, section, col, row } = found;
    if (section === null || col === null || row === null) return { kind: "placed" as const, id };
    return { kind: "seat" as const, page, section, col, row };
  },
});

export const unseatFrame = operation({
  label: "frames.unseatFrame",
  input: z.object({ canvas: z.string(), id: z.string(), db: z.custom<Database>() }),
  run: (_, { input: { canvas, id, db } }) => {
    db.query(
      "UPDATE frames_frames SET section = NULL, col = NULL, row = NULL WHERE canvas = ? AND id = ?",
    ).run(canvas, id);
  },
});

export const seatFrame = operation({
  label: "frames.seatFrame",
  input: z.object({ canvas: z.string(), id: z.string(), at: seatAt, db: z.custom<Database>() }),
  run: (_, { input: { canvas, id, at, db } }) => {
    const put = db.query(
      "UPDATE frames_frames SET page = ?, section = ?, col = ?, row = ? WHERE canvas = ? AND id = ?",
    );
    const same = "canvas = ? AND page = ? AND section = ? AND id <> ?";
    switch (at.kind) {
      case "section": {
        const { page, name, key } = at;
        db.query(
          `INSERT INTO frames_sections (canvas, page, key, name, ord)
           VALUES (?1, ?2, ?3, ?4,
             (SELECT COALESCE(MAX(ord) + 1, 0) FROM frames_sections WHERE canvas = ?1 AND page = ?2))
           ON CONFLICT (canvas, page, key) DO NOTHING`,
        ).run(canvas, page, key, name);
        const last = z
          .object({ col: z.number().nullable() })
          .parse(
            db
              .query(`SELECT MAX(col) AS col FROM frames_frames WHERE ${same}`)
              .get(canvas, page, key, id),
          ).col;
        put.run(page, key, last === null ? 0 : last + 1, 0, canvas, id);
        return page;
      }
      case "after": {
        const { page, section, col } = at;
        db.query(`UPDATE frames_frames SET col = col + 1 WHERE ${same} AND col > ?`).run(
          canvas,
          page,
          section,
          id,
          col,
        );
        put.run(page, section, col + 1, 0, canvas, id);
        return page;
      }
      case "below": {
        const { page, section, col, row } = at;
        db.query(
          `UPDATE frames_frames SET row = row + 1 WHERE ${same} AND col = ? AND row > ?`,
        ).run(canvas, page, section, id, col, row);
        put.run(page, section, col, row + 1, canvas, id);
        return page;
      }
    }
  },
});

export const pageState = operation({
  label: "frames.pageState",
  input: z.object({ canvas: z.string(), pages: z.array(z.string()), db: z.custom<Database>() }),
  run: (_, { input: { canvas, pages, db } }) => {
    const list = JSON.stringify(pages);
    const rows = db
      .query(
        `SELECT id, page, x, y, w, h, section FROM frames_frames
         WHERE canvas = ? AND page IN (SELECT value FROM json_each(?)) ORDER BY id`,
      )
      .all(canvas, list);
    const kept = db
      .query(
        `SELECT page, key, ord, at_x, at_y, wrap, gap FROM frames_sections
         WHERE canvas = ? AND page IN (SELECT value FROM json_each(?)) ORDER BY page, key`,
      )
      .all(canvas, list);
    return JSON.stringify([rows, kept]);
  },
});

export const layoutAnswer = operation({
  label: "frames.layoutAnswer",
  input: z.object({ page: z.string(), rev: z.number(), findings: z.array(finding) }),
  run: (_, { input: { page, rev, findings } }) => {
    const first = findings.slice(0, maxLayoutFindings);
    return { page, rev, findings: first, more: findings.length - first.length };
  },
});
