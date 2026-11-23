import type { Database } from "bun:sqlite";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, data, operation, tag } from "@tinkered/core";
import { z } from "zod";

import { kitRuntime } from "@/kit/runtime.server";
import { kitStart, showKit } from "@/kit/store.server";

import { canvasInfo, frameStatus, frames, kept, removed } from "./contract";
import { boardKey } from "./keys.server";

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
  PRIMARY KEY (canvas, id)
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
] as const;

const genOf = "COALESCE((SELECT gen FROM frames_keygen WHERE canvas = ?), 0)";

const sameRuntime = `((SELECT runtime FROM kit_versions WHERE version = frames_frames.kit)
  IS (SELECT runtime FROM kit_versions WHERE version = ?))`;

export const frameGap = 80;

const frameRow = z.object({
  canvas: z.string(),
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  version: z.number(),
  status: frameStatus,
});

const canvasRow = z.object({ key: z.string(), name: z.string(), created: z.number() });

const keyedRow = frameRow.extend({ gen: z.number() });

const boardFrame = operation({
  label: "frames.boardFrame",
  input: keyedRow,
  depends: { boardKey },
  run: ({ boardKey }, { input: { gen, ...row } }) => ({
    ...row,
    k: boardKey.run({ input: { canvas: row.canvas, id: row.id, version: row.version, gen } }),
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
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  removed: z.number(),
});

const keptOf = `SELECT k.canvas, k.id, k.version, COALESCE(g.gen, 0) AS gen
  FROM frames_kept k LEFT JOIN frames_keygen g ON g.canvas = k.canvas`;

const isKept = "SELECT 1 FROM frames_kept WHERE canvas = ? AND id = ? AND version = ?";

const stdout = tag<{ write(chunk: string): unknown } | null>({
  label: "frames.stdout",
  default: null,
});

export const saveCanvas = operation({
  label: "frames.saveCanvas",
  input: z.object({ key: z.string(), name: z.string() }),
  depends: { connection: bunSqlite.connection, cells: canvases.atScope.controller, showKit },
  run: async ({ connection, cells, showKit }, { input, clock }) => {
    const created = clock.currentTimeMillis();
    const made = connection.db.$client
      .query(
        "INSERT INTO frames_canvases (key, name, created) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING",
      )
      .run(input.key, input.name, created);
    if (!made.changes) return { kind: "taken" as const };

    cells.set({ ...input, created, shared: false });
    await showKit.run({ input: [input.key] });
    return { kind: "created" as const, key: input.key };
  },
});

const writeMode = z.enum(["ready", "exploring", "html"]);

const frameWrite = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("new"),
    canvas: z.string(),
    id: z.string(),
    name: z.string(),
    w: z.number(),
    h: z.number(),
    html: z.string(),
    css: z.string().nullable(),
    kit: z.number().nullable(),
    js: z.string().nullable(),
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
    mode: writeMode,
    db: z.custom<Database>(),
  }),
  run: (_, { input }) => {
    const { db } = input;
    const now = db
      .query(
        `SELECT version, html IS ? AND (js IS NOT NULL) = ? AND (js IS NULL OR ${sameRuntime}) AS same
         FROM frames_frames WHERE canvas = ? AND id = ?`,
      )
      .get(input.html, input.app, input.kit, input.canvas, input.id);
    if (now === null) return { kind: "gone" as const };
    const { version, same } = z.object({ version: z.number(), same: z.number() }).parse(now);
    if (version !== input.base || !same) return { kind: "stale" as const, id: input.id, version };

    const marked = db
      .query(
        `UPDATE frames_frames SET status = 'ready'
         WHERE canvas = ? AND id = ? AND ? = 'ready' AND status = 'exploring'
         RETURNING canvas, id, name, x, y, w, h, version, status, ${genOf} AS gen`,
      )
      .get(input.canvas, input.id, input.mode, input.canvas);
    if (marked !== null) return { kind: "marked" as const, row: keyedRow.parse(marked) };
    return { kind: "unchanged" as const, id: input.id, version };
  },
});

export const saveFrame = operation({
  label: "frames.saveFrame",
  input: frameWrite,
  depends: {
    connection: bunSqlite.connection,
    cells: frames.atScope.controller,
    keptCells: kept.atScope.controller,
    boardFrame,
    boardKept,
    keptWrite,
  },
  run: async (units, { input, clock }) => {
    const { connection, cells, keptCells, boardFrame, boardKept, keptWrite } = units;
    const db = connection.db.$client;
    const answer = db.transaction(() => {
      if (input.kind === "new") {
        const open = db.query("SELECT 1 FROM frames_canvases WHERE key = ?").get(input.canvas);
        if (!open) return { kind: "gone" as const };

        const edge = z
          .object({ right: z.number().nullable() })
          .parse(
            db
              .query("SELECT MAX(x + w) AS right FROM frames_frames WHERE canvas = ?")
              .get(input.canvas),
          ).right;
        const row = keyedRow.parse(
          db
            .query(
              `INSERT INTO frames_frames (canvas, id, name, x, y, w, h, version, html, made, css, kit, js, status)
               VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?, ?, ?, ?, ?, ?)
               RETURNING canvas, id, name, x, y, w, h, version, status, ${genOf} AS gen`,
            )
            .get(
              input.canvas,
              input.id,
              input.name,
              edge === null ? 0 : edge + frameGap,
              input.w,
              input.h,
              input.html,
              clock.currentTimeMillis(),
              input.css,
              input.kit,
              input.js,
              statusOf.parse(input.mode),
              input.canvas,
            ),
        );
        return { kind: "created" as const, row, keptBase: false };
      }

      const app = Number(input.js !== null);
      const { mode } = input;
      const saved = db
        .query(
          `UPDATE frames_frames SET html = ?, css = ?, kit = ?, js = ?, version = version + 1,
             status = CASE ? WHEN 'ready' THEN 'ready' WHEN 'html' THEN 'exploring' ELSE status END
           WHERE canvas = ? AND id = ? AND version = ? AND (? <> 'exploring' OR status = 'exploring')
             AND (html IS NOT ? OR (js IS NOT NULL) <> ? OR (js IS NOT NULL AND ${sameRuntime} = 0))
           RETURNING canvas, id, name, x, y, w, h, version, status, ${genOf} AS gen`,
        )
        .get(
          input.html,
          input.css,
          input.kit,
          input.js,
          mode,
          input.canvas,
          input.id,
          input.base,
          mode,
          input.html,
          app,
          input.kit,
          input.canvas,
        );
      if (saved !== null) {
        const keptBase = db.query(isKept).get(input.canvas, input.id, input.base) !== null;
        return { kind: "updated" as const, row: keyedRow.parse(saved), keptBase };
      }

      return keptWrite.run({ input: { ...input, app, db } });
    })();

    switch (answer.kind) {
      case "created":
      case "updated": {
        const { row } = answer;
        cells.set(boardFrame.run({ input: row }));
        if (answer.keptBase) {
          const version = row.version - 1;
          keptCells.set(
            boardKept.run({ input: { canvas: row.canvas, id: row.id, version, gen: row.gen } }),
          );
        }
        return { kind: answer.kind, id: row.id, version: row.version };
      }
      case "marked": {
        const { row } = answer;
        cells.set(boardFrame.run({ input: row }));
        return { kind: "unchanged" as const, id: row.id, version: row.version };
      }
      case "unchanged":
      case "stale":
      case "gone":
        return answer;
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
           RETURNING canvas, id, name, x, y, w, h, version, status, ${genOf} AS gen`,
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

export const dropFrame = operation({
  label: "frames.dropFrame",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: {
    connection: bunSqlite.connection,
    cells: frames.atScope.controller,
    keptCells: kept.atScope.controller,
    removedCells: removed.atScope.controller,
    boardKept,
  },
  run: async ({ connection, cells, keptCells, removedCells, boardKept }, { input, clock }) => {
    const db = connection.db.$client;
    const answer = db.transaction(() => {
      const found = db
        .query(
          `SELECT canvas, id, name, x, y, w, h, version, status, ${genOf} AS gen
           FROM frames_frames WHERE canvas = ? AND id = ?`,
        )
        .get(input.canvas, input.canvas, input.id);
      if (found === null) return null;

      const row = keyedRow.parse(found);
      const gone = removedRow.parse(
        db
          .query(
            `INSERT OR REPLACE INTO frames_removed (canvas, id, name, x, y, w, h, removed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING canvas, id, name, x, y, w, h, removed`,
          )
          .get(row.canvas, row.id, row.name, row.x, row.y, row.w, row.h, clock.currentTimeMillis()),
      );
      db.query("DELETE FROM frames_frames WHERE canvas = ? AND id = ?").run(input.canvas, input.id);
      const keptLast = db.query(isKept).get(row.canvas, row.id, row.version) !== null;
      return { row, gone, keptLast };
    })();
    if (answer === null) return { kind: "gone" as const };

    const { row, gone, keptLast } = answer;
    cells.delete(input);
    removedCells.set(gone);
    if (keptLast) {
      keptCells.set(
        boardKept.run({
          input: { canvas: row.canvas, id: row.id, version: row.version, gen: row.gen },
        }),
      );
    }
    return { kind: "deleted" as const };
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
          .query(
            `SELECT canvas, id, name, x, y, w, h, version, status, ${genOf} AS gen FROM frames_frames WHERE canvas = ?`,
          )
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
        gen: z.number(),
      })
      .transform(({ current, w, h, html, css, js, kit, gen }) => ({
        current,
        gen,
        doc: html !== null && w !== null && h !== null ? { html, css, js, kit, w, h } : null,
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

export const readDoc = operation({
  label: "frames.readDoc",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    frameRow
      .extend({
        html: z.string(),
        css: z.string().nullable(),
        js: z.string().nullable(),
        kit: z.number().nullable(),
      })
      .safeParse(
        connection.db.$client
          .query(
            "SELECT canvas, id, name, x, y, w, h, version, status, html, css, js, kit FROM frames_frames WHERE canvas = ? AND id = ?",
          )
          .get(input.canvas, input.id),
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

const load = operation({
  label: "frames.load",
  depends: {
    connection: bunSqlite.connection,
    canvasCells: canvases.atScope.controller,
    frameCells: frames.atScope.controller,
    keptCells: kept.atScope.controller,
    removedCells: removed.atScope.controller,
    out: stdout,
    boardFrame,
    boardKept,
    addColumns,
    mountOldJs,
    kitStart,
    showKit,
  },
  run: async (deps) => {
    const { connection, canvasCells, frameCells, keptCells, removedCells, out } = deps;
    const { boardFrame, boardKept, addColumns, mountOldJs, kitStart, showKit } = deps;
    const db = connection.db.$client;
    db.exec("PRAGMA synchronous = FULL");
    db.exec(schema);
    await addColumns.run();
    await mountOldJs.run();
    await kitStart.run();

    const canvasRows = db.query("SELECT key, name, created FROM frames_canvases").all();
    const frameRows = db
      .query(
        `SELECT f.canvas, f.id, f.name, f.x, f.y, f.w, f.h, f.version, f.status, COALESCE(g.gen, 0) AS gen
         FROM frames_frames f LEFT JOIN frames_keygen g ON g.canvas = f.canvas
         ORDER BY f.made, f.rowid`,
      )
      .all();
    const keptRows = db.query(keptOf).all();
    const removedRows = db
      .query("SELECT canvas, id, name, x, y, w, h, removed FROM frames_removed")
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
  },
});

export const framesServer = capsule({
  label: "framesServer",
  config: { stdout, runtime: kitRuntime },
  hooks: {
    async start({ run, next }) {
      await run(load, {}, { role: "setup", explain: "Reads canvases and frames" });
      await next();
    },
  },
});
