import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, operation } from "@tinkered/core";
import { z } from "zod";

import { clientAddress, digestOf } from "@/access/guards.server";
import { addressKey, limiter } from "@/access/login.server";
import { secretBytes } from "@/access/store.server";

import { framesApi } from "./contract";
import { shareApi, sharePrefix } from "./share";
import { canvases } from "./store.server";

// Share without a password (SPEC-frames.md § Share a canvas, § Open a share link; the
// frames-share-open and viewer-gate-open charts). A link is 128 random bits, kept readable so
// `easel share` prints it again (judged rule 11). A pass is 128 other random bits, kept only as
// its SHA-256 digest, with its link and the viewer's name, in SQLite: it survives a restart
// (decision C8). Neither reaches a log (judged rule 15): no operation here takes one as a label
// or writes one out. Unshare and passwords are not built, so a live link never ends yet.
//
// Two bounds keep anyone who has a link from filling the disk (SPEC-frames § Inputs, judged rule
// 14): opens are counted per client address, and a link keeps at most its 1000 newest passes.

/**
 * The flood limit: `share.open` calls per client address per minute, any link, password or not.
 * The same limiter, sliding minute and address key as `login.start` (judged rule 10; decisions D7
 * and A8: the address Traefik adds to X-Forwarded-For, an IPv6 one by its /64). 30, not
 * `login.start`'s 5: a team behind one NAT opens a link at once, and each tab's open counts.
 */
export const opensPerMinute = 30;

/** A link keeps its newest 1000 passes; a new one past that ends the oldest. */
export const passesPerLink = 1000;

/** The tables, made at start, after frames' own. */
const schema = `
CREATE TABLE IF NOT EXISTS frames_links (
  link TEXT PRIMARY KEY NOT NULL,
  canvas TEXT NOT NULL,
  made INTEGER NOT NULL,
  ended INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS frames_links_live ON frames_links (canvas) WHERE ended IS NULL;
CREATE TABLE IF NOT EXISTS frames_passes (
  digest TEXT PRIMARY KEY NOT NULL,
  link TEXT NOT NULL,
  name TEXT NOT NULL,
  made INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS frames_passes_link ON frames_passes (link, made);`;

/** 128 random bits from the system's secure source, as 32 hex digits: a link, or a pass. */
const newSecret = operation({
  label: "frames.newSecret",
  depends: { bytes: secretBytes },
  run: ({ bytes }) => Buffer.from(bytes.run({ input: 16 })).toString("hex"),
});

const linkRow = z.object({ link: z.string() }).nullable();
const canvasRow = z.object({ canvas: z.string() }).nullable();

/**
 * `canvas.share`: the canvas's live link, or a new one when it has none (judged rule 12: sharing
 * a shared canvas keeps its link). One transaction reads and writes, so two shares at once make
 * one link; the unique index on a canvas's live link holds it too. The cell says `shared` after.
 */
export const shareCanvas = operation({
  label: "canvas.share.do",
  input: framesApi["canvas.share"].input,
  depends: { connection: bunSqlite.connection, cells: canvases.atScope.controller, newSecret },
  run: async ({ connection, cells, newSecret }, { input, clock }) => {
    const db = connection.db.$client;
    const fresh = newSecret.run();
    const link = db.transaction(() => {
      if (!db.query("SELECT 1 FROM frames_canvases WHERE key = ?").get(input.canvas)) return null;

      const live = linkRow.parse(
        db
          .query("SELECT link FROM frames_links WHERE canvas = ? AND ended IS NULL")
          .get(input.canvas),
      );
      if (live) return live.link;

      db.query("INSERT INTO frames_links (link, canvas, made) VALUES (?, ?, ?)").run(
        fresh,
        input.canvas,
        clock.currentTimeMillis(),
      );
      return fresh;
    })();
    if (link === null) return { kind: "gone" as const };

    const canvas = cells.of({ key: input.canvas }).get();
    if (canvas) cells.set({ ...canvas, shared: true });
    return { kind: "shared" as const, path: `${sharePrefix}${link}` };
  },
});

/**
 * `share.open` with no password: past the flood limit, `slow`; else a pass on a live link, kept
 * as its digest with the name, and the link's oldest pass ended once it holds more than 1000.
 */
export const openShare = operation({
  label: "share.open.do",
  input: shareApi["share.open"].input,
  depends: {
    connection: bunSqlite.connection,
    newSecret,
    digestOf,
    limiter,
    clientAddress,
    addressKey,
  },
  run: async (
    { connection, newSecret, digestOf, limiter, clientAddress, addressKey },
    { input, clock },
  ) => {
    const now = clock.currentTimeMillis();
    const address = addressKey.run({ input: clientAddress.run() });
    const retryIn = limiter.hit(`share.open ${address}`, opensPerMinute, now);
    if (retryIn !== null) return { kind: "slow" as const, retryIn };

    const db = connection.db.$client;
    const live = canvasRow.parse(
      db.query("SELECT canvas FROM frames_links WHERE link = ? AND ended IS NULL").get(input.link),
    );
    if (!live) return { kind: "gone" as const };

    const pass = newSecret.run();
    db.transaction(() => {
      db.query("INSERT INTO frames_passes (digest, link, name, made) VALUES (?, ?, ?, ?)").run(
        digestOf.run({ input: pass }),
        input.link,
        input.name,
        now,
      );
      db.query(
        "DELETE FROM frames_passes WHERE link = ?1 AND rowid NOT IN (SELECT rowid FROM frames_passes WHERE link = ?1 ORDER BY made DESC, rowid DESC LIMIT ?2)",
      ).run(input.link, passesPerLink);
    })();
    return { kind: "open" as const, canvas: live.canvas, pass };
  },
});

/** The canvas a pass reads, while its link is live; null for any other pass. */
export const passCanvas = operation({
  label: "frames.passCanvas",
  input: z.string(),
  depends: { connection: bunSqlite.connection, digestOf },
  run: async ({ connection, digestOf }, { input: pass }): Promise<string | null> => {
    const row = canvasRow.parse(
      connection.db.$client
        .query(
          "SELECT l.canvas FROM frames_passes p JOIN frames_links l ON l.link = p.link WHERE p.digest = ? AND l.ended IS NULL",
        )
        .get(digestOf.run({ input: pass })),
    );

    return row ? row.canvas : null;
  },
});

/** At start: make the tables, and mark each canvas with a live link `shared`. */
const loadShares = operation({
  label: "frames.loadShares",
  depends: { connection: bunSqlite.connection, cells: canvases.atScope.controller },
  run: async ({ connection, cells }) => {
    const db = connection.db.$client;
    db.exec(schema);

    const rows = db.query("SELECT canvas FROM frames_links WHERE ended IS NULL").all();
    for (const row of rows) {
      const key = canvasRow.parse(row)?.canvas ?? "";
      const canvas = cells.of({ key }).get();
      if (canvas) cells.set({ ...canvas, shared: true });
    }
  },
});

/** Share's side of the server. Install it after `framesServer`, which fills `canvases`. */
export const shareServer = capsule({
  label: "shareServer",
  hooks: {
    async start({ run, next }) {
      await run(loadShares, {}, { role: "setup", explain: "Reads the share links" });
      await next();
    },
  },
});

/** The viewer's side of the server: `frames.viewer({ implement: shareOps })`, with no guard. */
export const shareOps = { "share.open": openShare } as const;
