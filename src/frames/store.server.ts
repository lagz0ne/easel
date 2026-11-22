import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, data, operation, tag } from "@tinkered/core";
import { z } from "zod";

import { kitRuntime } from "@/kit/runtime.server";
import { kitStart, showKit } from "@/kit/store.server";

import { canvasInfo, frames, kept, removed } from "./contract";
import { boardKey } from "./keys.server";

// frames' state: canvases and frames in the app's one SQLite file (SPEC.md, tech stack), so they
// survive a restart. A frame's document lives only in SQLite (decision C12): the `frames` cell
// holds its metadata and version, and frame.get and the board's `docs` read the html from the
// row. Each write is one SQLite statement or transaction, with no `await` between its check and
// its write, and sets its cell after, from the row as stored then (judged rules 2 and 4). Only
// `saveCanvas`, `saveFrame`, `dropFrame` and `bumpKeys` write (fact rule 2). Each frame on the
// board carries its picture key for its version and its canvas's key generation (SPEC-frames §
// Pictures), and so does each kept version (the cell `kept`); `bumpKeys` raises the generation
// and writes the canvas's keys again. A removed frame leaves its name and box in
// `frames_removed` (the cell `removed`): the page shows its requests where it was, and its kept
// versions are drawn at that size.
//
// Each frame version keeps its made CSS (`css`) and the kit version it was made for (`kit`), from
// the make step at its put ([kit](SPEC-kit.md)); both are null when the frame turns the kit off,
// or was stored before the kit. A show reads only this stored CSS (K11). An app frame keeps its
// TSX as written in `html`, and its JS in `js` (null for an HTML frame): a frame is one kind for
// each version. frames' start runs the kit's start first, and sets the board's cell `kit` of each
// canvas, and of each new one.

/** The canvases, by key. A server cell: not served on the board. */
export const canvases = data({
  label: "frames.canvases",
  mode: "keyed",
  parse: canvasInfo,
  key: (c) => ({ key: c.key }),
});

/**
 * The tables, made at start. A binary carries no migrations folder. `frames_kept` holds the old
 * versions that a request or a message refers to (judged rule 16): the queue's store fills it, in
 * the statement of the put or the delete that replaces one.
 */
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

/**
 * The columns that a store made before them gets, null in each row: the made CSS of the kit, and
 * the JS of an app frame.
 */
const addedColumns = [
  ["frames_frames", "css", "TEXT"],
  ["frames_frames", "kit", "INTEGER"],
  ["frames_kept", "css", "TEXT"],
  ["frames_kept", "kit", "INTEGER"],
  ["frames_frames", "js", "TEXT"],
  ["frames_kept", "js", "TEXT"],
] as const;

/** A canvas's picture key generation, in the statement it is part of: 0 until its first bump. */
const genOf = "COALESCE((SELECT gen FROM frames_keygen WHERE canvas = ?), 0)";

/** The gap between a new frame and the rightmost one (decision C2). */
export const frameGap = 80;

/** A frame's row without its document: what the cell holds. */
const frameRow = z.object({
  canvas: z.string(),
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  version: z.number(),
});

const canvasRow = z.object({ key: z.string(), name: z.string(), created: z.number() });

/** A frame's row with its canvas's key generation, read in the same statement. */
const keyedRow = frameRow.extend({ gen: z.number() });

/** The board's member for a frame's row: the row, with its picture key (none while pictures are off). */
const boardFrame = operation({
  label: "frames.boardFrame",
  input: keyedRow,
  depends: { boardKey },
  run: ({ boardKey }, { input: { gen, ...row } }) => ({
    ...row,
    k: boardKey.run({ input: { canvas: row.canvas, id: row.id, version: row.version, gen } }),
  }),
});

/** A kept version's row, with its canvas's key generation. */
const keptRow = z.object({
  canvas: z.string(),
  id: z.string(),
  version: z.number(),
  gen: z.number(),
});

/** The board's member for a kept version: its picture key (none while pictures are off). */
const boardKept = operation({
  label: "frames.boardKept",
  input: keptRow,
  depends: { boardKey },
  run: ({ boardKey }, { input: { gen, ...at } }) => ({
    ...at,
    k: boardKey.run({ input: { ...at, gen } }),
  }),
});

/** A removed frame's row: its name, its box, and when it was removed. */
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

/** The kept versions of a canvas, with its key generation, in the statement it is part of. */
const keptOf = `SELECT k.canvas, k.id, k.version, COALESCE(g.gen, 0) AS gen
  FROM frames_kept k LEFT JOIN frames_keygen g ON g.canvas = k.canvas`;

/** Whether a version is kept: in a statement, after the write that may have kept it. */
const isKept = "SELECT 1 FROM frames_kept WHERE canvas = ? AND id = ? AND version = ?";

/** Where the store says what it skipped at start: the server's log. */
const stdout = tag<{ write(chunk: string): unknown } | null>({
  label: "frames.stdout",
  default: null,
});

/** `canvas.create`'s write: one insert that does nothing when the key is taken. */
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

/** A write of a frame's document: a new frame, or a write on an id at the version it read. */
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
  }),
]);

/**
 * `frame.put`'s write. A new frame is one transaction: the canvas must be there, and the frame
 * goes right of the rightmost one at y 0, or at 0,0 (decision C2). A write on an id is one
 * conditional statement (judged rule 2, F1): it checks the base, compares the document and raises
 * the version, so of two puts on one version the first wins. When it changes no row, the same
 * transaction reads the row to answer `stale`, `unchanged` or `gone`, and writes nothing (judged
 * rule 1). A row that does not parse throws inside the transaction, so nothing is kept and the
 * call faults. The cell is set after the commit, from the row as stored (judged rule 4).
 */
export const saveFrame = operation({
  label: "frames.saveFrame",
  input: frameWrite,
  depends: {
    connection: bunSqlite.connection,
    cells: frames.atScope.controller,
    keptCells: kept.atScope.controller,
    boardFrame,
    boardKept,
  },
  run: async ({ connection, cells, keptCells, boardFrame, boardKept }, { input, clock }) => {
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
              `INSERT INTO frames_frames (canvas, id, name, x, y, w, h, version, html, made, css, kit, js)
               VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?, ?, ?, ?, ?)
               RETURNING canvas, id, name, x, y, w, h, version, ${genOf} AS gen`,
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
              input.canvas,
            ),
        );
        return { kind: "created" as const, row, keptBase: false };
      }

      // A row it wrote that does not parse throws here, inside the transaction: the write rolls
      // back and the call faults, never a saved write that answers stale. The same document is
      // the same text of the same kind (an HTML frame, or an app frame).
      const app = Number(input.js !== null);
      const saved = db
        .query(
          `UPDATE frames_frames SET html = ?, css = ?, kit = ?, js = ?, version = version + 1
           WHERE canvas = ? AND id = ? AND version = ? AND (html IS NOT ? OR (js IS NOT NULL) <> ?)
           RETURNING canvas, id, name, x, y, w, h, version, ${genOf} AS gen`,
        )
        .get(
          input.html,
          input.css,
          input.kit,
          input.js,
          input.canvas,
          input.id,
          input.base,
          input.html,
          app,
          input.canvas,
        );
      if (saved !== null) {
        // The queue's trigger kept the version this write replaced, if a request refers to it.
        const keptBase = db.query(isKept).get(input.canvas, input.id, input.base) !== null;
        return { kind: "updated" as const, row: keyedRow.parse(saved), keptBase };
      }

      const now = db
        .query(
          "SELECT version, html IS ? AND (js IS NOT NULL) = ? AS same FROM frames_frames WHERE canvas = ? AND id = ?",
        )
        .get(input.html, app, input.canvas, input.id);
      if (now === null) return { kind: "gone" as const };
      const { version, same } = z.object({ version: z.number(), same: z.number() }).parse(now);
      // The same document at the version it read: nothing to write (F2).
      if (version === input.base && same) {
        return { kind: "unchanged" as const, id: input.id, version };
      }
      return { kind: "stale" as const, id: input.id, version };
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
      case "unchanged":
      case "stale":
      case "gone":
        return answer;
    }
  },
});

/**
 * `frame.delete`'s write, one transaction: the frame's name and box go to `frames_removed`, then
 * the row goes (the queue's trigger keeps its version first, if a request refers to it). The
 * cells follow (judged rule 4): the frame goes, the removed frame comes, and its version, if
 * kept.
 */
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
          `SELECT canvas, id, name, x, y, w, h, version, ${genOf} AS gen
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

/**
 * The bump (SPEC-frames § Pictures, the frames-pictures chart's "the link ends"): the canvas's key
 * generation goes up by one, and each of its frames on the board gets its key again, so every key
 * handed out before stops working. One transaction raises it and reads the frames; the cells are
 * set after, from those rows. Unshare and a password set or changed call it; a canvas with no
 * frames bumps too. Answers the new generation.
 */
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
            `SELECT canvas, id, name, x, y, w, h, version, ${genOf} AS gen FROM frames_frames WHERE canvas = ?`,
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

/**
 * A picture's one read (judged rule 7), in one statement, so the document drawn is the version
 * read: the frame's current version (`null`: removed), the canvas's key generation, and `doc`:
 * the document of the version asked (the current one, or a kept one), its made CSS, and the box
 * to draw it in (the frame's, or the removed frame's last one), or `null` when either is not
 * there.
 */
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
        gen: z.number(),
      })
      .transform(({ current, w, h, html, css, gen }) => ({
        current,
        gen,
        doc: html !== null && w !== null && h !== null ? { html, css, w, h } : null,
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
               COALESCE((SELECT gen FROM frames_keygen WHERE canvas = $canvas), 0) AS gen
             FROM (SELECT 1)
               LEFT JOIN frames_frames f ON f.canvas = $canvas AND f.id = $id
               LEFT JOIN frames_removed r ON r.canvas = $canvas AND r.id = $id`,
          )
          .get({ $canvas: input.canvas, $id: input.id, $version: input.version }),
      ),
});

/**
 * After a draw, the check again: whether the version is still there (the frame, or that version
 * kept), and its canvas's key generation now.
 */
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

/**
 * One frame's document, its made CSS and its version, read from its row: frame.get and the
 * board's `docs`. An app frame has its JS too, and the kit version it was made for.
 */
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
            "SELECT canvas, id, name, x, y, w, h, version, html, css, js, kit FROM frames_frames WHERE canvas = ? AND id = ?",
          )
          .get(input.canvas, input.id),
      ).data,
});

/** At start, after the tables: each column that a store made before it does not have, null in each row. */
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

/**
 * At start: make the tables, set `synchronous = FULL` (decision C6: each write is on disk before
 * it answers), and set the cells from the rows it read, and only from them (fact rule 5). A row
 * that does not parse is left out; the log says only how many there were.
 */
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
    kitStart,
    showKit,
  },
  run: async (deps) => {
    const { connection, canvasCells, frameCells, keptCells, removedCells, out } = deps;
    const { boardFrame, boardKept, addColumns, kitStart, showKit } = deps;
    const db = connection.db.$client;
    db.exec("PRAGMA synchronous = FULL");
    db.exec(schema);
    await addColumns.run();
    await kitStart.run();

    const canvasRows = db.query("SELECT key, name, created FROM frames_canvases").all();
    const frameRows = db
      .query(
        `SELECT f.canvas, f.id, f.name, f.x, f.y, f.w, f.h, f.version, COALESCE(g.gen, 0) AS gen
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

/**
 * The server side of frames, filled by the cmd. Install it after `bunSqlite`. `runtime`: the
 * runtime of app frames that the build of the binary made (none: the scope builds it).
 */
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
