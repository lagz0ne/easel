import type { Database } from "bun:sqlite";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, data, operation, tag } from "@tinkered/core";
import { z } from "zod";

import { kitRuntime } from "@/kit/runtime.server";
import { kitStart, showKit } from "@/kit/store.server";

import { boardSection, finding, sectionInfo, sections } from "./arrange";
import {
  arrangePage,
  bumpRev,
  layoutAnswer,
  pageState,
  revOf,
  seatAt,
  seatFrame,
  sectionsSchema,
  targetOf,
  unseatFrame,
} from "./arrange.server";
import {
  caseFrameIdsOf,
  casesSchema,
  dropCaseList,
  followSource,
  sourceOf,
} from "./case-frames.server";
import { caseValues } from "./cases";
import {
  canvasInfo,
  firstPage,
  frameStatus,
  frames,
  imageType,
  keyOfName,
  kept,
  pages,
  removed,
} from "./contract";
import { boardKey } from "./keys.server";
import { passwordCost } from "./password.server";
import { clearance, frameGap, sectionSpace, touchSpace } from "./settings";

export const canvases = data({
  label: "frames.canvases",
  mode: "keyed",
  parse: canvasInfo,
  key: (c) => ({ key: c.key }),
});

const schema = `
CREATE TABLE IF NOT EXISTS frames_canvases (
  key TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS frames_frames (
  canvas TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  version INTEGER NOT NULL,
  html TEXT NOT NULL,
  made INTEGER NOT NULL,
  css TEXT,
  kit INTEGER,
  js TEXT,
  status TEXT NOT NULL DEFAULT 'exploring',
  page TEXT,
  PRIMARY KEY (canvas, id)
);
CREATE TABLE IF NOT EXISTS frames_pages (
  canvas TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  ord INTEGER NOT NULL,
  PRIMARY KEY (canvas, key)
);
CREATE TABLE IF NOT EXISTS frames_keygen (
  canvas TEXT PRIMARY KEY NOT NULL,
  gen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS frames_kept (
  canvas TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  html TEXT NOT NULL,
  css TEXT,
  kit INTEGER,
  js TEXT,
  PRIMARY KEY (canvas, id, version)
);
CREATE TABLE IF NOT EXISTS frames_images (
  canvas TEXT NOT NULL,
  sha TEXT NOT NULL,
  type TEXT NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (canvas, sha)
);
CREATE TABLE IF NOT EXISTS frames_migrations (
  name TEXT PRIMARY KEY NOT NULL,
  ran INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS frames_removed (
  canvas TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  removed INTEGER NOT NULL,
  page TEXT,
  PRIMARY KEY (canvas, id)
);`;

const addedColumns = [
  ["frames_frames", "css", "TEXT"],
  ["frames_frames", "kit", "INTEGER"],
  ["frames_kept", "css", "TEXT"],
  ["frames_kept", "kit", "INTEGER"],
  ["frames_frames", "js", "TEXT"],
  ["frames_kept", "js", "TEXT"],
  ["frames_frames", "status", "TEXT NOT NULL DEFAULT 'exploring'"],
  ["frames_frames", "page", "TEXT"],
  ["frames_removed", "page", "TEXT"],
  ["frames_frames", "image", "TEXT"],
  ["frames_images", "held", "INTEGER NOT NULL DEFAULT 0"],
  ["frames_kept", "image", "TEXT"],
  ["frames_frames", "section", "TEXT"],
  ["frames_frames", "col", "INTEGER"],
  ["frames_frames", "row", "INTEGER"],
  ["frames_canvases", "rev", "INTEGER NOT NULL DEFAULT 0"],
  ["frames_frames", "source", "TEXT"],
  ["frames_frames", "case_name", "TEXT"],
  ["frames_frames", "case_values", "TEXT"],
] as const;

const frameColumns =
  "canvas, id, name, page, x, y, w, h, version, status, source, case_name, case_values";

const genOf = "COALESCE((SELECT gen FROM frames_keygen WHERE canvas = ?), 0)";

const sameRuntime = `((SELECT runtime FROM kit_versions WHERE version = frames_frames.kit)
  IS (SELECT runtime FROM kit_versions WHERE version = ?))`;

const frameRow = z.object({
  canvas: z.string(),
  id: z.string(),
  name: z.string(),
  page: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  version: z.number(),
  status: frameStatus,
  source: z.string().nullable(),
  case_name: z.string().nullable(),
  case_values: z.string().nullable(),
});

const canvasRow = z.object({ key: z.string(), name: z.string(), created: z.number() });

const keyedRow = frameRow.extend({ gen: z.number() });

const storedValues = z
  .string()
  .nullable()
  .transform((text) => {
    const empty = { fixture: null, switches: {} };
    if (text === null) return empty;
    try {
      return caseValues.safeParse(JSON.parse(text)).data ?? empty;
    } catch {
      return empty;
    }
  });

const caseOfRow = z
  .object({
    source: z.string().nullable(),
    case_name: z.string().nullable(),
    case_values: z.string().nullable(),
  })
  .transform(({ source, case_name: name, case_values: values }) =>
    source === null || name === null ? null : { source, name, ...storedValues.parse(values) },
  );

const boardFrame = operation({
  label: "frames.boardFrame",
  input: keyedRow,
  depends: { boardKey },
  run: ({ boardKey }, { input: { gen, source, case_name, case_values, ...row } }) => ({
    ...row,
    k: boardKey.run({ input: { canvas: row.canvas, id: row.id, version: row.version, gen } }),
    case: caseOfRow.parse({ source, case_name, case_values }),
  }),
});

const keptRow = z.object({
  canvas: z.string(),
  id: z.string(),
  version: z.number(),
  gen: z.number(),
});

const boardKept = operation({
  label: "frames.boardKept",
  input: keptRow,
  depends: { boardKey },
  run: ({ boardKey }, { input: { gen, ...at } }) => ({
    ...at,
    k: boardKey.run({ input: { ...at, gen } }),
  }),
});

const removedRow = z.object({
  canvas: z.string(),
  id: z.string(),
  name: z.string(),
  page: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  removed: z.number(),
});

const keptOf = `SELECT k.canvas, k.id, k.version, COALESCE(g.gen, 0) AS gen
  FROM frames_kept k LEFT JOIN frames_keygen g ON g.canvas = k.canvas`;

const isKept = "SELECT 1 FROM frames_kept WHERE canvas = ? AND id = ? AND version = ?";

const dropLooseImages = `DELETE FROM frames_images WHERE canvas = $canvas AND held = 0
  AND sha NOT IN (SELECT image FROM frames_frames WHERE canvas = $canvas AND image IS NOT NULL)
  AND sha NOT IN (SELECT image FROM frames_kept WHERE canvas = $canvas AND image IS NOT NULL)`;

const keepImage = `INSERT OR IGNORE INTO frames_images (canvas, sha, type, w, h, bytes)
  VALUES ($canvas, $sha, $type, $w, $h, $bytes)`;

const imageWrite = z
  .object({
    sha: z.string(),
    type: z.string(),
    w: z.number(),
    h: z.number(),
    bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
  })
  .nullable();

const imageParams = z
  .object({
    sha: z.string(),
    type: z.string(),
    w: z.number(),
    h: z.number(),
    bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
  })
  .transform((one) => ({
    $sha: one.sha,
    $type: one.type,
    $w: one.w,
    $h: one.h,
    $bytes: one.bytes,
  }));

const stdout = tag<{ write(chunk: string): unknown } | null>({
  label: "frames.stdout",
  default: null,
});

const pageRow = z.object({
  canvas: z.string(),
  key: z.string(),
  name: z.string(),
  order: z.number(),
  frames: z.number(),
});

const pagesOf = `SELECT p.canvas, p.key, p.name, p.ord AS "order",
  (SELECT COUNT(*) FROM frames_frames f WHERE f.canvas = p.canvas AND f.page = p.key) AS frames
  FROM frames_pages p`;

export const readPages = operation({
  label: "frames.readPages",
  input: z.object({ canvas: z.string(), db: z.custom<Database>() }),
  run: (_, { input: { canvas, db } }) =>
    db
      .query(`${pagesOf} WHERE p.canvas = ? ORDER BY p.ord, p.rowid`)
      .all(canvas)
      .map((row) => pageRow.parse(row)),
});

export const showPages = operation({
  label: "frames.showPages",
  input: z.object({ canvas: z.string(), db: z.custom<Database>() }),
  depends: { cells: pages.atScope.controller, readPages },
  run: ({ cells, readPages }, { input }) => {
    const { canvas } = input;
    const now = readPages.run({ input });

    const keys = new Set(now.map((page) => page.key));
    for (const old of cells.where({ canvas }).get()) {
      if (!keys.has(old.key)) cells.delete({ canvas, key: old.key });
    }
    for (const page of now) cells.set(page);
    return now;
  },
});

export const firstPageOf = operation({
  label: "frames.firstPageOf",
  input: z.object({ canvas: z.string(), db: z.custom<Database>() }),
  run: (_, { input: { canvas, db } }) =>
    z
      .object({ key: z.string() })
      .nullable()
      .parse(
        db
          .query("SELECT key FROM frames_pages WHERE canvas = ? ORDER BY ord, rowid LIMIT 1")
          .get(canvas),
      )?.key ?? null,
});

export const hasPage = operation({
  label: "frames.hasPage",
  input: z.object({ canvas: z.string(), page: z.string(), db: z.custom<Database>() }),
  run: (_, { input: { canvas, page, db } }) =>
    db.query("SELECT 1 FROM frames_pages WHERE canvas = ? AND key = ?").get(canvas, page) !== null,
});

const newPlace = operation({
  label: "frames.newPlace",
  input: z.object({
    canvas: z.string(),
    page: z.string().nullable(),
    x: z.number().nullable(),
    y: z.number().nullable(),
    db: z.custom<Database>(),
  }),
  depends: { firstPageOf, hasPage, frameGap },
  run: ({ firstPageOf, hasPage, frameGap }, { input: { canvas, x, y, db, ...asked } }) => {
    const page = asked.page ?? firstPageOf.run({ input: { canvas, db } });
    if (page === null || !hasPage.run({ input: { canvas, page, db } })) return null;
    if (x !== null) return { page, x, y: y ?? 0 };

    const right = z
      .object({ right: z.number().nullable() })
      .parse(
        db
          .query("SELECT MAX(x + w) AS right FROM frames_frames WHERE canvas = ? AND page = ?")
          .get(canvas, page),
      ).right;
    return { page, x: right === null ? 0 : right + frameGap, y: y ?? 0 };
  },
});

export const saveCanvas = operation({
  label: "frames.saveCanvas",
  input: z.object({ key: z.string(), name: z.string() }),
  depends: {
    connection: bunSqlite.connection,
    cells: canvases.atScope.controller,
    showKit,
    showPages,
  },
  run: async ({ connection, cells, showKit, showPages }, { input, clock }) => {
    const created = clock.currentTimeMillis();
    const db = connection.db.$client;
    const made = db.transaction(() => {
      const one = db
        .query(
          "INSERT INTO frames_canvases (key, name, created) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING",
        )
        .run(input.key, input.name, created);
      if (!one.changes) return false;

      db.query("INSERT INTO frames_pages (canvas, key, name, ord) VALUES (?, ?, ?, 0)").run(
        input.key,
        firstPage.key,
        firstPage.name,
      );
      return true;
    })();
    if (!made) return { kind: "taken" as const };

    cells.set({ ...input, created, shared: false });
    showPages.run({ input: { canvas: input.key, db } });
    await showKit.run({ input: [input.key] });
    return { kind: "created" as const, key: input.key };
  },
});

const writeMode = z.enum(["ready", "exploring", "html"]);

export const placeWrite = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact"), x: z.number().nullable(), y: z.number().nullable() }),
  z.object({ kind: z.literal("after"), id: z.string() }),
  z.object({ kind: z.literal("below"), id: z.string() }),
  z.object({ kind: z.literal("section"), name: z.string() }),
]);

export type PlaceWrite = z.infer<typeof placeWrite>;

const sectionSeat = operation({
  label: "frames.sectionSeat",
  input: z.object({
    canvas: z.string(),
    page: z.string().nullable(),
    name: z.string(),
    db: z.custom<Database>(),
  }),
  depends: { firstPageOf, hasPage },
  run: ({ firstPageOf, hasPage }, { input: { canvas, page, name, db } }) => {
    const on = page ?? firstPageOf.run({ input: { canvas, db } });
    if (on === null || !hasPage.run({ input: { canvas, page: on, db } })) {
      return { kind: "gone" as const };
    }

    const key = keyOfName.parse(name);
    return { kind: "seat" as const, at: { kind: "section" as const, name, key, page: on } };
  },
});

const seatOfPlace = operation({
  label: "frames.seatOfPlace",
  input: z.object({
    canvas: z.string(),
    page: z.string().nullable(),
    place: placeWrite,
    db: z.custom<Database>(),
  }),
  depends: { sectionSeat, targetOf },
  run: ({ sectionSeat, targetOf }, { input: { canvas, page, place, db } }) => {
    switch (place.kind) {
      case "exact":
        return { kind: "exact" as const };
      case "section":
        return sectionSeat.run({ input: { canvas, page, name: place.name, db } });
      case "after":
      case "below": {
        const target = targetOf.run({ input: { canvas, id: place.id, db } });
        if (target.kind !== "seat") return target;
        const { kind: _, ...at } = target;
        return { kind: "seat" as const, at: { ...at, kind: place.kind } };
      }
    }
  },
});

export const frameWrite = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("new"),
    canvas: z.string(),
    id: z.string(),
    name: z.string(),
    page: z.string().nullable(),
    place: placeWrite,
    rev: z.number().nullable(),
    w: z.number(),
    h: z.number(),
    html: z.string(),
    css: z.string().nullable(),
    kit: z.number().nullable(),
    js: z.string().nullable(),
    image: imageWrite,
    mode: writeMode,
  }),
  z.object({
    kind: z.literal("on"),
    canvas: z.string(),
    id: z.string(),
    base: z.number(),
    html: z.string(),
    css: z.string().nullable(),
    kit: z.number().nullable(),
    js: z.string().nullable(),
    image: imageWrite,
    mode: writeMode,
  }),
]);

const statusOf = writeMode.transform((mode) => (mode === "ready" ? "ready" : "exploring"));

const keptWrite = operation({
  label: "frames.keptWrite",
  input: z.object({
    canvas: z.string(),
    id: z.string(),
    base: z.number(),
    html: z.string(),
    kit: z.number().nullable(),
    app: z.number(),
    image: z.string().nullable(),
    mode: writeMode,
    db: z.custom<Database>(),
  }),
  run: (_, { input }) => {
    const { db } = input;
    const now = db
      .query(
        `SELECT version, html IS ? AND (js IS NOT NULL) = ? AND image IS ?
           AND (js IS NULL OR ${sameRuntime}) AS same
         FROM frames_frames WHERE canvas = ? AND id = ?`,
      )
      .get(input.html, input.app, input.image, input.kit, input.canvas, input.id);
    if (now === null) return { kind: "gone" as const };
    const { version, same } = z.object({ version: z.number(), same: z.number() }).parse(now);
    if (version !== input.base || !same) return { kind: "stale" as const, id: input.id, version };

    const marked = db
      .query(
        `UPDATE frames_frames SET status = 'ready'
         WHERE canvas = ? AND id = ? AND ? = 'ready' AND status = 'exploring'
         RETURNING ${frameColumns}, ${genOf} AS gen`,
      )
      .get(input.canvas, input.id, input.mode, input.canvas);
    if (marked !== null) return { kind: "marked" as const, row: keyedRow.parse(marked) };
    return { kind: "unchanged" as const, id: input.id, version };
  },
});

const storeImage = operation({
  label: "frames.storeImage",
  input: z.object({ canvas: z.string(), image: imageWrite, db: z.custom<Database>() }),
  run: (_, { input: { canvas, image, db } }) => {
    if (image) db.query(keepImage).run({ $canvas: canvas, ...imageParams.parse(image) });
    db.query(dropLooseImages).run({ $canvas: canvas });
  },
});

const newWrite = frameWrite.options[0];

const newSeat = operation({
  label: "frames.newSeat",
  input: z.object({ write: newWrite, db: z.custom<Database>() }),
  depends: { newPlace, revOf, seatOfPlace },
  run: ({ newPlace, revOf, seatOfPlace }, { input: { write, db } }) => {
    const { canvas } = write;
    const rev = revOf.run({ input: { canvas, db } });
    if (write.rev !== null && write.rev !== rev) return { kind: "changed" as const, rev };

    const seat = seatOfPlace.run({ input: { canvas, page: write.page, place: write.place, db } });
    if (seat.kind === "gone" || seat.kind === "placed") return seat;

    const exact = write.place.kind === "exact" ? write.place : { x: 0, y: 0 };
    const asked = seat.kind === "seat" ? seat.at.page : write.page;
    const place = newPlace.run({ input: { canvas, page: asked, x: exact.x, y: exact.y, db } });
    return place === null ? { kind: "gone" as const } : { kind: "free" as const, seat, place };
  },
});

const insertFrame = operation({
  label: "frames.insertFrame",
  input: z.object({ write: newWrite, db: z.custom<Database>() }),
  depends: { newSeat, showPages, storeImage, seatFrame },
  run: ({ newSeat, showPages, storeImage, seatFrame }, { input: { write, db }, clock }) => {
    const { canvas } = write;
    const found = newSeat.run({ input: { write, db } });
    if (found.kind !== "free") return found;

    const { seat, place } = found;
    const row = keyedRow.parse(
      db
        .query(
          `INSERT INTO frames_frames (canvas, id, name, page, x, y, w, h, version, html, made, css, kit, js, status, image)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
           RETURNING ${frameColumns}, ${genOf} AS gen`,
        )
        .get(
          write.canvas,
          write.id,
          write.name,
          place.page,
          place.x,
          place.y,
          write.w,
          write.h,
          write.html,
          clock.currentTimeMillis(),
          write.css,
          write.kit,
          write.js,
          statusOf.parse(write.mode),
          write.image?.sha ?? null,
          write.canvas,
        ),
    );
    storeImage.run({ input: { canvas: write.canvas, image: write.image, db } });
    if (seat.kind === "seat") seatFrame.run({ input: { canvas, id: row.id, at: seat.at, db } });
    showPages.run({ input: { canvas: write.canvas, db } });
    return { kind: "created" as const, row, keptBase: false };
  },
});

const onWrite = frameWrite.options[1];

const imageBox = imageWrite.transform((image) => ({
  sha: image?.sha ?? null,
  w: image?.w ?? null,
  h: image?.h ?? null,
}));

const updateFrame = operation({
  label: "frames.updateFrame",
  input: z.object({ write: onWrite, db: z.custom<Database>() }),
  depends: { keptWrite, storeImage },
  run: ({ keptWrite, storeImage }, { input: { write, db } }) => {
    const app = Number(write.js !== null);
    const { mode } = write;
    const image = imageBox.parse(write.image);
    const saved = db
      .query(
        `UPDATE frames_frames SET html = ?, css = ?, kit = ?, js = ?, image = ?,
           w = COALESCE(?, w), h = COALESCE(?, h), version = version + 1,
           status = CASE ? WHEN 'ready' THEN 'ready' WHEN 'html' THEN 'exploring' ELSE status END
         WHERE canvas = ? AND id = ? AND version = ? AND (? <> 'exploring' OR status = 'exploring')
           AND (html IS NOT ? OR (js IS NOT NULL) <> ? OR image IS NOT ?
             OR (js IS NOT NULL AND ${sameRuntime} = 0))
         RETURNING ${frameColumns}, ${genOf} AS gen`,
      )
      .get(
        write.html,
        write.css,
        write.kit,
        write.js,
        image.sha,
        image.w,
        image.h,
        mode,
        write.canvas,
        write.id,
        write.base,
        mode,
        write.html,
        app,
        image.sha,
        write.kit,
        write.canvas,
      );
    if (saved === null) return keptWrite.run({ input: { ...write, app, image: image.sha, db } });

    storeImage.run({ input: { canvas: write.canvas, image: write.image, db } });
    const keptBase = db.query(isKept).get(write.canvas, write.id, write.base) !== null;
    return { kind: "updated" as const, row: keyedRow.parse(saved), keptBase };
  },
});

const boxNow = operation({
  label: "frames.boxNow",
  input: z.object({ canvas: z.string(), id: z.string(), db: z.custom<Database>() }),
  run: (_, { input: { canvas, id, db } }) =>
    z
      .object({ page: z.string(), w: z.number(), h: z.number() })
      .nullable()
      .parse(
        db
          .query("SELECT page, w, h FROM frames_frames WHERE canvas = ? AND id = ?")
          .get(canvas, id),
      ),
});

export const arrangeAfter = operation({
  label: "frames.arrangeAfter",
  input: z.object({
    canvas: z.string(),
    pages: z.array(z.string()),
    changed: z.boolean(),
    db: z.custom<Database>(),
  }),
  depends: { arrangePage, bumpRev, revOf },
  run: ({ arrangePage, bumpRev, revOf }, { input: { canvas, pages, changed, db } }) => {
    const arranged = [...new Set(pages)].map((page) => ({
      page,
      ...arrangePage.run({ input: { canvas, page, db } }),
    }));
    const moved = arranged.some((one) => one.moved.length > 0);
    const rev =
      changed || moved
        ? bumpRev.run({ input: { canvas, db } })
        : revOf.run({ input: { canvas, db } });
    return { rev, arranged };
  },
});

const arrangedShape = z.object({
  rev: z.number(),
  arranged: z.array(
    z.object({
      page: z.string(),
      moved: z.array(z.string()),
      sections: z.array(sectionInfo),
      findings: z.array(finding),
    }),
  ),
});

export const showArranged = operation({
  label: "frames.showArranged",
  input: z.object({
    canvas: z.string(),
    done: arrangedShape,
    also: z.array(z.string()),
    db: z.custom<Database>(),
  }),
  depends: {
    cells: frames.atScope.controller,
    sectionCells: sections.atScope.controller,
    boardFrame,
  },
  run: ({ cells, sectionCells, boardFrame }, { input: { canvas, done, also, db } }) => {
    const ids = [...new Set([...also, ...done.arranged.flatMap((one) => one.moved)])];
    const rows = db
      .query(
        `SELECT ${frameColumns}, ${genOf} AS gen FROM frames_frames
         WHERE canvas = ? AND id IN (SELECT value FROM json_each(?))`,
      )
      .all(canvas, canvas, JSON.stringify(ids))
      .map((row) => keyedRow.parse(row));
    for (const row of rows) cells.set(boardFrame.run({ input: row }));
    for (const { page, sections: now } of done.arranged) {
      const keys = new Set(now.map((one) => one.key));
      for (const old of sectionCells.where({ canvas, page }).get()) {
        if (!keys.has(old.key)) sectionCells.delete({ canvas, page, key: old.key });
      }
      for (const { key, name, x, y, w, h } of now) {
        sectionCells.set({ canvas, page, key, name, x, y, w, h });
      }
    }
  },
});

export const layoutOf = operation({
  label: "frames.layoutOf",
  input: z.object({ page: z.string(), done: arrangedShape }),
  depends: { layoutAnswer },
  run: ({ layoutAnswer }, { input: { page, done } }) => {
    const findings = done.arranged.find((one) => one.page === page)?.findings ?? [];
    return layoutAnswer.run({ input: { page, rev: done.rev, findings } });
  },
});

const frameBox = z.object({ page: z.string(), w: z.number(), h: z.number() });

const grewOf = z
  .object({ before: frameBox.nullable(), now: frameBox.nullable() })
  .transform(({ before, now }) => {
    if (before === null || now === null) return false;
    return before.w !== now.w || before.h !== now.h;
  });

const arrangeWrite = operation({
  label: "frames.arrangeWrite",
  input: z.object({
    canvas: z.string(),
    id: z.string(),
    before: frameBox.nullable(),
    created: z.boolean(),
    db: z.custom<Database>(),
  }),
  depends: { boxNow, arrangeAfter },
  run: ({ boxNow, arrangeAfter }, { input: { canvas, id, before, created, db } }) => {
    const now = boxNow.run({ input: { canvas, id, db } });
    const page = now?.page ?? "";
    const changed = created || grewOf.parse({ before, now });
    const done = arrangeAfter.run({ input: { canvas, pages: [page], changed, db } });
    return { done, page };
  },
});

const saveNew = operation({
  label: "frames.saveNew",
  input: z.object({ write: newWrite, db: z.custom<Database>() }),
  depends: { insertFrame, arrangeWrite },
  run: ({ insertFrame, arrangeWrite }, { input: { write, db } }) => {
    const out = insertFrame.run({ input: { write, db } });
    switch (out.kind) {
      case "changed":
      case "gone":
      case "placed":
        return { out, done: null, page: "", cases: [] };
      case "created": {
        const id = out.row.id;
        const laid = arrangeWrite.run({
          input: { canvas: write.canvas, id, before: null, created: true, db },
        });
        return { out, cases: [], ...laid };
      }
    }
  },
});

const saveOn = operation({
  label: "frames.saveOn",
  input: z.object({ write: onWrite, db: z.custom<Database>() }),
  depends: { updateFrame, boxNow, arrangeWrite, sourceOf, followSource },
  run: (deps, { input: { write, db } }) => {
    const { updateFrame, boxNow, arrangeWrite, sourceOf, followSource } = deps;
    const { canvas, id } = write;
    const source = sourceOf.run({ input: { canvas, id, db } });
    if (source !== null) {
      return { out: { kind: "CaseFrame" as const, source }, done: null, page: "", cases: [] };
    }

    const before = boxNow.run({ input: { canvas, id, db } });
    const out = updateFrame.run({ input: { write, db } });
    switch (out.kind) {
      case "stale":
      case "gone":
        return { out, done: null, page: "", cases: [] };
      case "updated":
      case "marked":
      case "unchanged": {
        const cases = followSource.run({ input: { canvas, source: id, db } });
        return {
          out,
          cases,
          ...arrangeWrite.run({ input: { canvas, id, before, created: false, db } }),
        };
      }
    }
  },
});

export const saveFrame = operation({
  label: "frames.saveFrame",
  input: frameWrite,
  depends: {
    connection: bunSqlite.connection,
    keptCells: kept.atScope.controller,
    boardKept,
    saveNew,
    saveOn,
    showArranged,
    layoutOf,
  },
  run: async (units, { input }) => {
    const { connection, keptCells, boardKept, saveNew, saveOn, showArranged, layoutOf } = units;
    const db = connection.db.$client;
    const { canvas } = input;
    const answer = db.transaction(() =>
      input.kind === "new"
        ? saveNew.run({ input: { write: input, db } })
        : saveOn.run({ input: { write: input, db } }),
    )();

    const { out, done, page, cases } = answer;
    if (done === null) return out;
    const also = out.kind === "unchanged" ? cases : [out.row.id, ...cases];
    showArranged.run({ input: { canvas, done, also, db } });
    const layout = layoutOf.run({ input: { page, done } });
    switch (out.kind) {
      case "created":
      case "updated": {
        const { row } = out;
        if (out.keptBase) {
          const version = row.version - 1;
          keptCells.set(
            boardKept.run({ input: { canvas: row.canvas, id: row.id, version, gen: row.gen } }),
          );
        }
        return { kind: out.kind, id: row.id, version: row.version, layout, cases };
      }
      case "marked":
        return {
          kind: "unchanged" as const,
          id: out.row.id,
          version: out.row.version,
          layout,
          cases,
        };
      case "unchanged":
        return { ...out, layout, cases };
    }
  },
});

const markedRow = z.object({ version: z.number(), status: frameStatus });

export const markFrame = operation({
  label: "frames.markFrame",
  input: z.object({
    canvas: z.string(),
    id: z.string(),
    status: frameStatus,
    version: z.number().optional(),
  }),
  depends: { connection: bunSqlite.connection, cells: frames.atScope.controller, boardFrame },
  run: async ({ connection, cells, boardFrame }, { input }) => {
    const db = connection.db.$client;
    const answer = db.transaction(() => {
      const marked = db
        .query(
          `UPDATE frames_frames SET status = ?
           WHERE canvas = ? AND id = ? AND status IS NOT ? AND (? IS NULL OR version = ?)
           RETURNING ${frameColumns}, ${genOf} AS gen`,
        )
        .get(
          input.status,
          input.canvas,
          input.id,
          input.status,
          input.version ?? null,
          input.version ?? null,
          input.canvas,
        );
      if (marked !== null) return { kind: "marked" as const, row: keyedRow.parse(marked) };

      const now = db
        .query("SELECT version, status FROM frames_frames WHERE canvas = ? AND id = ?")
        .get(input.canvas, input.id);
      if (now === null) return { kind: "gone" as const };
      const row = markedRow.parse(now);
      if (row.status === input.status) return { kind: "unchanged" as const, version: row.version };
      return { kind: "moved" as const, version: row.version };
    })();

    if (answer.kind !== "marked") return answer;
    cells.set(boardFrame.run({ input: answer.row }));
    return { kind: "marked" as const, version: answer.row.version };
  },
});

export const readStatuses = operation({
  label: "frames.readStatuses",
  input: z.object({ canvas: z.string() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    new Map(
      connection.db.$client
        .query("SELECT id, status FROM frames_frames WHERE canvas = ?")
        .all(input.canvas)
        .flatMap((row) => {
          const one = z.object({ id: z.string(), status: frameStatus }).safeParse(row).data;
          return one ? [[one.id, one.status] as const] : [];
        }),
    ),
});

export const readStatus = operation({
  label: "frames.readStatus",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    z
      .object({ status: frameStatus })
      .safeParse(
        connection.db.$client
          .query("SELECT status FROM frames_frames WHERE canvas = ? AND id = ?")
          .get(input.canvas, input.id),
      ).data?.status ?? null,
});

export const removeFrameRow = operation({
  label: "frames.removeFrameRow",
  input: z.object({ canvas: z.string(), id: z.string(), db: z.custom<Database>() }),
  run: (_, { input: { canvas, id, db }, clock }) => {
    const found = db
      .query(
        `SELECT ${frameColumns}, ${genOf} AS gen
         FROM frames_frames WHERE canvas = ? AND id = ?`,
      )
      .get(canvas, canvas, id);
    if (found === null) return null;

    const row = keyedRow.parse(found);
    const gone = removedRow.parse(
      db
        .query(
          `INSERT OR REPLACE INTO frames_removed (canvas, id, name, page, x, y, w, h, removed)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING canvas, id, name, page, x, y, w, h, removed`,
        )
        .get(
          row.canvas,
          row.id,
          row.name,
          row.page,
          row.x,
          row.y,
          row.w,
          row.h,
          clock.currentTimeMillis(),
        ),
    );
    db.query("DELETE FROM frames_frames WHERE canvas = ? AND id = ?").run(canvas, id);
    const keptLast = db.query(isKept).get(row.canvas, row.id, row.version) !== null;
    return { row, gone, keptLast };
  },
});

const removedShape = z.object({
  row: keyedRow,
  gone: removedRow,
  keptLast: z.boolean(),
});

export const showRemoved = operation({
  label: "frames.showRemoved",
  input: z.array(removedShape),
  depends: {
    cells: frames.atScope.controller,
    keptCells: kept.atScope.controller,
    removedCells: removed.atScope.controller,
    boardKept,
  },
  run: ({ cells, keptCells, removedCells, boardKept }, { input }) => {
    for (const { row, gone, keptLast } of input) {
      cells.delete({ canvas: row.canvas, page: row.page, id: row.id });
      removedCells.set(gone);
      if (!keptLast) continue;
      keptCells.set(
        boardKept.run({
          input: { canvas: row.canvas, id: row.id, version: row.version, gen: row.gen },
        }),
      );
    }
  },
});

export const dropFrame = operation({
  label: "frames.dropFrame",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: {
    connection: bunSqlite.connection,
    removeFrameRow,
    showRemoved,
    sourceOf,
    caseFrameIdsOf,
    dropCaseList,
    showPages,
    arrangeAfter,
    showArranged,
    layoutOf,
  },
  run: async (units, { input }) => {
    const { connection, removeFrameRow, showRemoved, sourceOf, caseFrameIdsOf } = units;
    const { dropCaseList, showPages, arrangeAfter, showArranged, layoutOf } = units;
    const db = connection.db.$client;
    const { canvas } = input;
    const answer = db.transaction(() => {
      const source = sourceOf.run({ input: { canvas, id: input.id, db } });
      if (source !== null) return { kind: "CaseFrame" as const, source };

      const ids = caseFrameIdsOf.run({ input: { canvas, source: input.id, db } });
      const first = removeFrameRow.run({ input: { canvas, id: input.id, db } });
      if (first === null) return { kind: "gone" as const };

      const cases = ids.flatMap((id) => removeFrameRow.run({ input: { canvas, id, db } }) ?? []);
      dropCaseList.run({ input: { canvas, source: input.id, db } });
      db.query(dropLooseImages).run({ $canvas: canvas });
      const page = first.row.page;
      const done = arrangeAfter.run({ input: { canvas, pages: [page], changed: true, db } });
      return { kind: "deleted" as const, removed: [first, ...cases], page, done };
    })();
    if (answer.kind !== "deleted") return answer;

    const { removed: all, page, done } = answer;
    showRemoved.run({ input: all });
    showArranged.run({ input: { canvas, done, also: [], db } });
    showPages.run({ input: { canvas, db } });
    return {
      kind: "deleted" as const,
      layout: layoutOf.run({ input: { page, done } }),
      removed: all.map((one) => one.row.id),
    };
  },
});

const moveInput = z.object({
  canvas: z.string(),
  id: z.string(),
  page: z.string().nullable(),
  place: placeWrite.nullable(),
  size: z.object({ w: z.number(), h: z.number() }).nullable(),
  rev: z.number().nullable(),
});

const rowNow = operation({
  label: "frames.rowNow",
  input: z.object({ canvas: z.string(), id: z.string(), db: z.custom<Database>() }),
  run: (_, { input: { canvas, id, db } }) => {
    const found = db
      .query(
        `SELECT ${frameColumns}, ${genOf} AS gen FROM frames_frames WHERE canvas = ? AND id = ?`,
      )
      .get(canvas, canvas, id);
    return found === null ? null : keyedRow.parse(found);
  },
});

const moveStart = operation({
  label: "frames.moveStart",
  input: z.object({
    canvas: z.string(),
    id: z.string(),
    page: z.string().nullable(),
    rev: z.number().nullable(),
    db: z.custom<Database>(),
  }),
  depends: { revOf, rowNow, hasPage },
  run: ({ revOf, rowNow, hasPage }, { input: { canvas, id, db, ...asked } }) => {
    const rev = revOf.run({ input: { canvas, db } });
    if (asked.rev !== null && asked.rev !== rev) return { kind: "changed" as const, rev };

    const was = rowNow.run({ input: { canvas, id, db } });
    if (was === null) return { kind: "gone" as const };

    const page = asked.page ?? was.page;
    if (!hasPage.run({ input: { canvas, page, db } })) return { kind: "gone" as const };
    return { kind: "found" as const, was, page };
  },
});

const selfRelation = z
  .object({ id: z.string(), place: placeWrite })
  .transform(
    ({ id, place }) => (place.kind === "after" || place.kind === "below") && place.id === id,
  );

const moveSeat = operation({
  label: "frames.moveSeat",
  input: z.object({
    canvas: z.string(),
    id: z.string(),
    page: z.string(),
    place: placeWrite.nullable(),
    db: z.custom<Database>(),
  }),
  depends: { seatOfPlace },
  run: ({ seatOfPlace }, { input: { canvas, id, page, place, db } }) => {
    if (place === null || selfRelation.parse({ id, place })) return { kind: "none" as const };

    return seatOfPlace.run({ input: { canvas, page, place, db } });
  },
});

const applyMove = operation({
  label: "frames.applyMove",
  input: z.object({
    canvas: z.string(),
    was: keyedRow,
    page: z.string(),
    place: placeWrite.nullable(),
    size: z.object({ w: z.number(), h: z.number() }).nullable(),
    at: seatAt.nullable(),
    db: z.custom<Database>(),
  }),
  depends: { seatFrame, unseatFrame },
  run: ({ seatFrame, unseatFrame }, { input: { canvas, was, page, place, size, at, db } }) => {
    const { id } = was;
    if (size !== null) {
      const sized = "UPDATE frames_frames SET w = ?, h = ? WHERE canvas = ? AND id = ?";
      db.query(sized).run(size.w, size.h, canvas, id);
    }
    if (place !== null && place.kind === "exact") {
      unseatFrame.run({ input: { canvas, id, db } });
      const placed = "UPDATE frames_frames SET x = ?, y = ?, page = ? WHERE canvas = ? AND id = ?";
      db.query(placed).run(place.x ?? was.x, place.y ?? was.y, page, canvas, id);
    }
    if (at !== null) {
      unseatFrame.run({ input: { canvas, id, db } });
      seatFrame.run({ input: { canvas, id, at, db } });
    }
  },
});

const moveRow = operation({
  label: "frames.moveRow",
  input: moveInput.extend({ db: z.custom<Database>() }),
  depends: { moveStart, moveSeat, applyMove, rowNow, pageState, arrangeAfter },
  run: (deps, { input: { canvas, id, place, size, db, ...asked } }) => {
    const { moveStart, moveSeat, applyMove, rowNow, pageState, arrangeAfter } = deps;
    const start = moveStart.run({ input: { canvas, id, page: asked.page, rev: asked.rev, db } });
    if (start.kind !== "found") return start;

    const { was, page } = start;
    const seat = moveSeat.run({ input: { canvas, id, page, place, db } });
    if (seat.kind === "gone" || seat.kind === "placed") return seat;

    const at = seat.kind === "seat" ? seat.at : null;
    const pages = [was.page, at === null ? page : at.page];
    const before = pageState.run({ input: { canvas, pages, db } });
    applyMove.run({ input: { canvas, was, page, place, size, at, db } });

    const changed = pageState.run({ input: { canvas, pages, db } }) !== before;
    const done = arrangeAfter.run({ input: { canvas, pages, changed, db } });
    const moved = pageState.run({ input: { canvas, pages, db } }) !== before;
    const now = keyedRow.parse(rowNow.run({ input: { canvas, id, db } }));
    return { kind: moved ? ("moved" as const) : ("unchanged" as const), was, now, done };
  },
});

export const moveFrame = operation({
  label: "frames.moveFrame",
  input: moveInput,
  depends: {
    connection: bunSqlite.connection,
    cells: frames.atScope.controller,
    moveRow,
    showPages,
    showArranged,
    layoutOf,
  },
  run: async (deps, { input }) => {
    const { connection, cells, moveRow, showPages, showArranged, layoutOf } = deps;
    const db = connection.db.$client;
    const answer = db.transaction(() => moveRow.run({ input: { ...input, db } }))();
    switch (answer.kind) {
      case "changed":
      case "gone":
      case "placed":
        return answer;
      case "unchanged":
      case "moved":
        break;
    }

    const { was, now, done } = answer;
    const { canvas } = input;
    if (was.page !== now.page) cells.delete({ canvas, page: was.page, id: was.id });
    showArranged.run({ input: { canvas, done, also: [now.id], db } });
    if (was.page !== now.page) showPages.run({ input: { canvas, db } });
    return { kind: answer.kind, layout: layoutOf.run({ input: { page: now.page, done } }) };
  },
});

export const bumpKeys = operation({
  label: "frames.bumpKeys",
  input: z.object({ canvas: z.string() }),
  depends: {
    connection: bunSqlite.connection,
    cells: frames.atScope.controller,
    keptCells: kept.atScope.controller,
    boardFrame,
    boardKept,
  },
  run: async ({ connection, cells, keptCells, boardFrame, boardKept }, { input }) => {
    const db = connection.db.$client;
    const { rows, versions } = db.transaction(() => {
      db.query(
        "INSERT INTO frames_keygen (canvas, gen) VALUES (?, 1) ON CONFLICT (canvas) DO UPDATE SET gen = gen + 1",
      ).run(input.canvas);
      return {
        rows: db
          .query(`SELECT ${frameColumns}, ${genOf} AS gen FROM frames_frames WHERE canvas = ?`)
          .all(input.canvas, input.canvas)
          .map((row) => keyedRow.parse(row)),
        versions: db
          .query(`${keptOf} WHERE k.canvas = ?`)
          .all(input.canvas)
          .map((row) => keptRow.parse(row)),
      };
    })();

    for (const row of rows) cells.set(boardFrame.run({ input: row }));
    for (const row of versions) keptCells.set(boardKept.run({ input: row }));
    const gen = z
      .object({ gen: z.number() })
      .parse(db.query(`SELECT ${genOf} AS gen`).get(input.canvas)).gen;
    return { gen };
  },
});

export const readPicture = operation({
  label: "frames.readPicture",
  input: z.object({ canvas: z.string(), id: z.string(), version: z.number() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    z
      .object({
        current: z.number().nullable(),
        w: z.number().nullable(),
        h: z.number().nullable(),
        html: z.string().nullable(),
        css: z.string().nullable(),
        js: z.string().nullable(),
        kit: z.number().nullable(),
        image: z.string().nullable(),
        gen: z.number(),
      })
      .transform(({ current, w, h, html, css, js, kit, image, gen }) => ({
        current,
        gen,
        doc: html !== null && w !== null && h !== null ? { html, css, js, kit, image, w, h } : null,
      }))
      .parse(
        connection.db.$client
          .query(
            `SELECT f.version AS current, COALESCE(f.w, r.w) AS w, COALESCE(f.h, r.h) AS h,
               CASE WHEN f.version = $version THEN f.html
                 ELSE (SELECT html FROM frames_kept
                   WHERE canvas = $canvas AND id = $id AND version = $version) END AS html,
               CASE WHEN f.version = $version THEN f.css
                 ELSE (SELECT css FROM frames_kept
                   WHERE canvas = $canvas AND id = $id AND version = $version) END AS css,
               CASE WHEN f.version = $version THEN f.js
                 ELSE (SELECT js FROM frames_kept
                   WHERE canvas = $canvas AND id = $id AND version = $version) END AS js,
               CASE WHEN f.version = $version THEN f.kit
                 ELSE (SELECT kit FROM frames_kept
                   WHERE canvas = $canvas AND id = $id AND version = $version) END AS kit,
               CASE WHEN f.version = $version THEN f.image
                 ELSE (SELECT image FROM frames_kept
                   WHERE canvas = $canvas AND id = $id AND version = $version) END AS image,
               COALESCE((SELECT gen FROM frames_keygen WHERE canvas = $canvas), 0) AS gen
             FROM (SELECT 1)
               LEFT JOIN frames_frames f ON f.canvas = $canvas AND f.id = $id
               LEFT JOIN frames_removed r ON r.canvas = $canvas AND r.id = $id`,
          )
          .get({ $canvas: input.canvas, $id: input.id, $version: input.version }),
      ),
});

export const readStill = operation({
  label: "frames.readStill",
  input: z.object({ canvas: z.string(), id: z.string(), version: z.number() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    z.object({ live: z.number(), gen: z.number() }).parse(
      connection.db.$client
        .query(
          `SELECT EXISTS (SELECT 1 FROM frames_frames WHERE canvas = $canvas AND id = $id)
             OR EXISTS (SELECT 1 FROM frames_kept
               WHERE canvas = $canvas AND id = $id AND version = $version) AS live,
             COALESCE((SELECT gen FROM frames_keygen WHERE canvas = $canvas), 0) AS gen`,
        )
        .get({ $canvas: input.canvas, $id: input.id, $version: input.version }),
    ),
});

const docRow = frameRow
  .omit({ source: true, case_name: true, case_values: true })
  .extend({
    html: z.string(),
    css: z.string().nullable(),
    js: z.string().nullable(),
    kit: z.number().nullable(),
    image: z.string().nullable(),
    type: imageType.nullable(),
    bytes: z.number().nullable(),
    gen: z.number(),
  })
  .transform(({ image, type, bytes, gen, ...row }) => ({
    ...row,
    gen,
    image: image !== null && type !== null && bytes !== null ? { sha: image, type, bytes } : null,
  }));

export const readDoc = operation({
  label: "frames.readDoc",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    docRow.safeParse(
      connection.db.$client
        .query(
          `SELECT f.canvas, f.id, f.name, f.page, f.x, f.y, f.w, f.h, f.version, f.status,
             f.html, f.css, f.js, f.kit, f.image, i.type, LENGTH(i.bytes) AS bytes, ${genOf} AS gen
           FROM frames_frames f
             LEFT JOIN frames_images i ON i.canvas = f.canvas AND i.sha = f.image
           WHERE f.canvas = ? AND f.id = ?`,
        )
        .get(input.canvas, input.canvas, input.id),
    ).data,
});

const addColumns = operation({
  label: "frames.addColumns",
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }) => {
    const db = connection.db.$client;
    for (const [table, column, definition] of addedColumns) {
      const known = db.query(`PRAGMA table_info(${table})`).all();
      if (!known.some((c) => z.object({ name: z.literal(column) }).safeParse(c).success)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
  },
});

const oldMount =
  '\nimport { mount as __easelMount } from "@easel/frame";\n' +
  '__easelMount({ View, frame: typeof frame === "undefined" ? undefined : frame });';

const mountOldJs = operation({
  label: "frames.mountOldJs",
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { clock }) => {
    const db = connection.db.$client;
    db.transaction(() => {
      const done = db.query("SELECT 1 FROM frames_migrations WHERE name = 'mount-old-js'").get();
      if (done !== null) return;

      for (const table of ["frames_frames", "frames_kept"]) {
        db.query(`UPDATE ${table} SET js = js || ? WHERE js IS NOT NULL`).run(oldMount);
      }
      db.query("INSERT INTO frames_migrations (name, ran) VALUES ('mount-old-js', ?)").run(
        clock.currentTimeMillis(),
      );
    })();
  },
});

const onFirstPage = [
  `UPDATE frames_frames SET page = (SELECT p.key FROM frames_pages p
     WHERE p.canvas = frames_frames.canvas ORDER BY p.ord, p.rowid LIMIT 1) WHERE page IS NULL`,
  `UPDATE frames_removed SET page = (SELECT p.key FROM frames_pages p
     WHERE p.canvas = frames_removed.canvas ORDER BY p.ord, p.rowid LIMIT 1) WHERE page IS NULL`,
];

const putOnFirstPages = operation({
  label: "frames.putOnFirstPages",
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }) => {
    const db = connection.db.$client;
    db.transaction(() => {
      db.query(
        `INSERT INTO frames_pages (canvas, key, name, ord)
         SELECT c.key, ?, ?, 0 FROM frames_canvases c
         WHERE NOT EXISTS (SELECT 1 FROM frames_pages p WHERE p.canvas = c.key)`,
      ).run(firstPage.key, firstPage.name);
      for (const sql of onFirstPage) db.exec(sql);
      db.exec("CREATE INDEX IF NOT EXISTS frames_frames_page ON frames_frames (canvas, page)");
    })();
  },
});

const loadSections = operation({
  label: "frames.loadSections",
  depends: { connection: bunSqlite.connection, cells: sections.atScope.controller },
  run: async ({ connection, cells }) => {
    const db = connection.db.$client;
    db.exec(sectionsSchema);
    const rows = db.query("SELECT canvas, page, key, name, x, y, w, h FROM frames_sections").all();
    for (const one of rows.flatMap((row) => boardSection.safeParse(row).data ?? [])) cells.set(one);
  },
});

const load = operation({
  label: "frames.load",
  depends: {
    connection: bunSqlite.connection,
    canvasCells: canvases.atScope.controller,
    frameCells: frames.atScope.controller,
    keptCells: kept.atScope.controller,
    removedCells: removed.atScope.controller,
    pageCells: pages.atScope.controller,
    out: stdout,
    loadSections,
    boardFrame,
    boardKept,
    addColumns,
    mountOldJs,
    putOnFirstPages,
    kitStart,
    showKit,
  },
  run: async (deps) => {
    const { connection, canvasCells, frameCells, keptCells, removedCells, pageCells, out } = deps;
    const { loadSections } = deps;
    const { boardFrame, boardKept, addColumns, mountOldJs, putOnFirstPages } = deps;
    const { kitStart, showKit } = deps;
    const db = connection.db.$client;
    db.exec("PRAGMA synchronous = FULL");
    db.exec(schema);
    db.exec(casesSchema);
    await addColumns.run();
    await mountOldJs.run();
    await putOnFirstPages.run();
    await kitStart.run();

    const canvasRows = db.query("SELECT key, name, created FROM frames_canvases").all();
    const frameRows = db
      .query(
        `SELECT f.canvas, f.id, f.name, f.page, f.x, f.y, f.w, f.h, f.version, f.status,
           f.source, f.case_name, f.case_values, COALESCE(g.gen, 0) AS gen
         FROM frames_frames f LEFT JOIN frames_keygen g ON g.canvas = f.canvas
         ORDER BY f.made, f.rowid`,
      )
      .all();
    const keptRows = db.query(keptOf).all();
    const removedRows = db
      .query("SELECT canvas, id, name, page, x, y, w, h, removed FROM frames_removed")
      .all();
    const goodCanvases = canvasRows.flatMap((row) => canvasRow.safeParse(row).data ?? []);
    const goodFrames = frameRows.flatMap((row) => keyedRow.safeParse(row).data ?? []);
    const goodKept = keptRows.flatMap((row) => keptRow.safeParse(row).data ?? []);
    const goodRemoved = removedRows.flatMap((row) => removedRow.safeParse(row).data ?? []);
    const all = canvasRows.length + frameRows.length + keptRows.length + removedRows.length;
    const good = goodCanvases.length + goodFrames.length + goodKept.length + goodRemoved.length;
    if (all > good) out?.write(`frames: skipped ${all - good} rows that do not parse\n`);

    for (const row of goodCanvases) canvasCells.set({ ...row, shared: false });
    await showKit.run({ input: goodCanvases.map((row) => row.key) });
    for (const row of goodFrames) frameCells.set(boardFrame.run({ input: row }));
    for (const row of goodKept) keptCells.set(boardKept.run({ input: row }));
    for (const row of goodRemoved) removedCells.set(row);
    const pageRows = db.query(`${pagesOf} ORDER BY p.ord, p.rowid`).all();
    for (const page of pageRows.flatMap((row) => pageRow.safeParse(row).data ?? [])) {
      pageCells.set(page);
    }
    await loadSections.run();
  },
});

export const framesServer = capsule({
  label: "framesServer",
  config: {
    stdout,
    runtime: kitRuntime,
    passwordCost,
    frameGap,
    sectionSpace,
    clearance,
    touchSpace,
  },
  hooks: {
    async start({ run, next }) {
      await run(load, {}, { role: "setup", explain: "Reads canvases and frames" });
      await next();
    },
  },
});
