import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, data, operation, tag } from "@tinkered/core";
import { z } from "zod";

import { canvasInfo, frames } from "./contract";
import { boardKey } from "./keys.server";

// frames' state: canvases and frames in the app's one SQLite file (SPEC.md, tech stack), so they
// survive a restart. A frame's document lives only in SQLite (decision C12): the `frames` cell
// holds its metadata and version, and frame.get and the board's `docs` read the html from the
// row. Each write is one SQLite statement or transaction, with no `await` between its check and
// its write, and sets its cell after, from the row as stored then (judged rules 2 and 4). Only
// `saveCanvas`, `saveFrame`, `dropFrame` and `bumpKeys` write (fact rule 2). Each frame on the
// board carries its picture key for its version and its canvas's key generation (SPEC-frames §
// Pictures); `bumpKeys` raises the generation and writes the canvas's keys again.

/** The canvases, by key. A server cell: not served on the board. */
export const canvases = data({
  label: "frames.canvases",
  mode: "keyed",
  parse: canvasInfo,
  key: (c) => ({ key: c.key }),
});

/** The tables, made at start. A binary carries no migrations folder; frames owns two tables. */
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
  PRIMARY KEY (canvas, id)
);
CREATE TABLE IF NOT EXISTS frames_keygen (
  canvas TEXT PRIMARY KEY NOT NULL,
  gen INTEGER NOT NULL
);`;

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

/** Where the store says what it skipped at start: the server's log. */
const stdout = tag<{ write(chunk: string): unknown } | null>({
  label: "frames.stdout",
  default: null,
});

/** `canvas.create`'s write: one insert that does nothing when the key is taken. */
export const saveCanvas = operation({
  label: "frames.saveCanvas",
  input: z.object({ key: z.string(), name: z.string() }),
  depends: { connection: bunSqlite.connection, cells: canvases.atScope.controller },
  run: async ({ connection, cells }, { input, clock }) => {
    const created = clock.currentTimeMillis();
    const made = connection.db.$client
      .query(
        "INSERT INTO frames_canvases (key, name, created) VALUES (?, ?, ?) ON CONFLICT (key) DO NOTHING",
      )
      .run(input.key, input.name, created);
    if (!made.changes) return { kind: "taken" as const };

    cells.set({ ...input, created, shared: false });
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
  }),
  z.object({
    kind: z.literal("on"),
    canvas: z.string(),
    id: z.string(),
    base: z.number(),
    html: z.string(),
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
  depends: { connection: bunSqlite.connection, cells: frames.atScope.controller, boardFrame },
  run: async ({ connection, cells, boardFrame }, { input, clock }) => {
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
              `INSERT INTO frames_frames (canvas, id, name, x, y, w, h, version, html, made)
               VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?, ?)
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
              input.canvas,
            ),
        );
        return { kind: "created" as const, row };
      }

      // A row it wrote that does not parse throws here, inside the transaction: the write rolls
      // back and the call faults, never a saved write that answers stale.
      const saved = db
        .query(
          `UPDATE frames_frames SET html = ?, version = version + 1
           WHERE canvas = ? AND id = ? AND version = ? AND html IS NOT ?
           RETURNING canvas, id, name, x, y, w, h, version, ${genOf} AS gen`,
        )
        .get(input.html, input.canvas, input.id, input.base, input.html, input.canvas);
      if (saved !== null) return { kind: "updated" as const, row: keyedRow.parse(saved) };

      const now = db
        .query("SELECT version, html IS ? AS same FROM frames_frames WHERE canvas = ? AND id = ?")
        .get(input.html, input.canvas, input.id);
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
      case "updated":
        cells.set(boardFrame.run({ input: answer.row }));
        return { kind: answer.kind, id: answer.row.id, version: answer.row.version };
      case "unchanged":
      case "stale":
      case "gone":
        return answer;
    }
  },
});

/** `frame.delete`'s write: the row goes, then the cell (judged rule 4). */
export const dropFrame = operation({
  label: "frames.dropFrame",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { connection: bunSqlite.connection, cells: frames.atScope.controller },
  run: async ({ connection, cells }, { input }) => {
    const dropped = connection.db.$client
      .query("DELETE FROM frames_frames WHERE canvas = ? AND id = ?")
      .run(input.canvas, input.id);
    if (!dropped.changes) return { kind: "gone" as const };

    cells.delete(input);
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
  depends: { connection: bunSqlite.connection, cells: frames.atScope.controller, boardFrame },
  run: async ({ connection, cells, boardFrame }, { input }) => {
    const db = connection.db.$client;
    const rows = db.transaction(() => {
      db.query(
        "INSERT INTO frames_keygen (canvas, gen) VALUES (?, 1) ON CONFLICT (canvas) DO UPDATE SET gen = gen + 1",
      ).run(input.canvas);
      return db
        .query(
          `SELECT canvas, id, name, x, y, w, h, version, ${genOf} AS gen FROM frames_frames WHERE canvas = ?`,
        )
        .all(input.canvas, input.canvas)
        .map((row) => keyedRow.parse(row));
    })();

    for (const row of rows) cells.set(boardFrame.run({ input: row }));
    const gen = z
      .object({ gen: z.number() })
      .parse(db.query(`SELECT ${genOf} AS gen`).get(input.canvas)).gen;
    return { gen };
  },
});

/**
 * A picture's one read (judged rule 7): the frame's version, its document, its box and its
 * canvas's key generation, in one statement, so the document drawn is the version read.
 */
export const readPicture = operation({
  label: "frames.readPicture",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    z
      .object({
        version: z.number(),
        w: z.number(),
        h: z.number(),
        html: z.string(),
        gen: z.number(),
      })
      .safeParse(
        connection.db.$client
          .query(
            `SELECT version, w, h, html, ${genOf} AS gen FROM frames_frames WHERE canvas = ? AND id = ?`,
          )
          .get(input.canvas, input.canvas, input.id),
      ).data,
});

/** After a draw, the check again: whether the frame is there, and its canvas's key generation now. */
export const readStill = operation({
  label: "frames.readStill",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    z
      .object({ live: z.number(), gen: z.number() })
      .parse(
        connection.db.$client
          .query(
            `SELECT EXISTS (SELECT 1 FROM frames_frames WHERE canvas = ? AND id = ?) AS live, ${genOf} AS gen`,
          )
          .get(input.canvas, input.id, input.canvas),
      ),
});

/** One frame's document and version, read from its row: frame.get and the board's `docs`. */
export const readDoc = operation({
  label: "frames.readDoc",
  input: z.object({ canvas: z.string(), id: z.string() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    frameRow
      .extend({ html: z.string() })
      .safeParse(
        connection.db.$client
          .query(
            "SELECT canvas, id, name, x, y, w, h, version, html FROM frames_frames WHERE canvas = ? AND id = ?",
          )
          .get(input.canvas, input.id),
      ).data,
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
    out: stdout,
    boardFrame,
  },
  run: async ({ connection, canvasCells, frameCells, out, boardFrame }) => {
    const db = connection.db.$client;
    db.exec("PRAGMA synchronous = FULL");
    db.exec(schema);

    const canvasRows = db.query("SELECT key, name, created FROM frames_canvases").all();
    const frameRows = db
      .query(
        `SELECT f.canvas, f.id, f.name, f.x, f.y, f.w, f.h, f.version, COALESCE(g.gen, 0) AS gen
         FROM frames_frames f LEFT JOIN frames_keygen g ON g.canvas = f.canvas
         ORDER BY f.made, f.rowid`,
      )
      .all();
    const goodCanvases = canvasRows.flatMap((row) => canvasRow.safeParse(row).data ?? []);
    const goodFrames = frameRows.flatMap((row) => keyedRow.safeParse(row).data ?? []);
    const bad = canvasRows.length + frameRows.length - goodCanvases.length - goodFrames.length;
    if (bad) out?.write(`frames: skipped ${bad} rows that do not parse\n`);

    for (const row of goodCanvases) canvasCells.set({ ...row, shared: false });
    for (const row of goodFrames) frameCells.set(boardFrame.run({ input: row }));
  },
});

/** The server side of frames, filled by the cmd. Install it after `bunSqlite`. */
export const framesServer = capsule({
  label: "framesServer",
  config: { stdout },
  hooks: {
    async start({ run, next }) {
      await run(load, {}, { role: "setup", explain: "Reads canvases and frames" });
      await next();
    },
  },
});
