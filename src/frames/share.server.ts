import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, operation, tag, transport } from "@tinkered/core";
import { z } from "zod";

import { clientAddress, digestOf } from "@/access/guards.server";
import { addressKey, limiter } from "@/access/login.server";
import { secretBytes } from "@/access/store.server";

import { framesApi, framesBoard } from "./contract";
import { hashPassword, passwordMatches, wrongTries } from "./password.server";
import {
  endedRefusal,
  lockedRefusal,
  passApi,
  passMeta,
  shareApi,
  sharePassword,
  sharePrefix,
  typedPassword,
} from "./share";
import { bumpKeys, canvases } from "./store.server";

// Share links and passwords (SPEC-frames.md § Share a canvas, § Open a share link; the
// frames-share and viewer-gate charts). A link is 128 random bits, kept readable so `easel share`
// prints it again (judged rule 11). A pass is 128 other random bits, kept only as its SHA-256
// digest, with its link, the viewer's name (if the page sent one) and the link's password
// generation it was given under, in SQLite: it survives a restart (decision C8). A password is
// kept only as its argon2id hash (judged rule 10). None of them reaches a log (judged rule 15): no
// operation here takes one as a label or writes one out.
//
// A link's `pw_gen` goes up when its password is set or changed, and only then: a pass given
// under an older one has ended, and is refused `{ locked: true }` (the page asks the password
// again). Removing the password, or setting the same one again, keeps it, so no pass ends.
// Unshare ends the link and drops its passes: each is refused `{ ended: true }`. Either one bumps
// the canvas's picture key generation and makes each live read of the canvas ask again before it
// answers, so the guard turns away each tab that held an ended pass at once (judged rule 13).
//
// Two bounds keep anyone who has a link from filling the disk (SPEC-frames § Inputs, judged rule
// 14): opens are counted per client address, and a link keeps at most its 1000 newest passes.
// Wrong passwords count per address and link, apart (`wrongTries`).

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
  ended INTEGER,
  hash TEXT,
  pw_gen INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS frames_links_live ON frames_links (canvas) WHERE ended IS NULL;
CREATE TABLE IF NOT EXISTS frames_passes (
  digest TEXT PRIMARY KEY NOT NULL,
  link TEXT NOT NULL,
  name TEXT,
  made INTEGER NOT NULL,
  pw_gen INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS frames_passes_link ON frames_passes (link, made);`;

/**
 * A file made while `share.open` took a name has `frames_passes.name NOT NULL`. SQLite cannot drop
 * a NOT NULL, so the table is made again with its rows and its index, in one transaction (the
 * SQLite manual's "Making Other Kinds Of Table Schema Changes").
 */
const nameOptional = `
CREATE TABLE frames_passes_new (
  digest TEXT PRIMARY KEY NOT NULL,
  link TEXT NOT NULL,
  name TEXT,
  made INTEGER NOT NULL,
  pw_gen INTEGER NOT NULL DEFAULT 0
);
INSERT INTO frames_passes_new (digest, link, name, made, pw_gen)
  SELECT digest, link, name, made, pw_gen FROM frames_passes;
DROP TABLE frames_passes;
ALTER TABLE frames_passes_new RENAME TO frames_passes;
CREATE INDEX frames_passes_link ON frames_passes (link, made);`;

/** A column of `PRAGMA table_info` that must take NULL and does not. */
const notNullName = z.object({ name: z.literal("name"), notnull: z.literal(1) });

/** The columns passwords added, for a file made before them: table, column, its definition. */
const addedColumns = [
  ["frames_links", "hash", "TEXT"],
  ["frames_links", "pw_gen", "INTEGER NOT NULL DEFAULT 0"],
  ["frames_passes", "pw_gen", "INTEGER NOT NULL DEFAULT 0"],
] as const;

/** 128 random bits from the system's secure source, as 32 hex digits: a link, or a pass. */
const newSecret = operation({
  label: "frames.newSecret",
  depends: { bytes: secretBytes },
  run: ({ bytes }) => Buffer.from(bytes.run({ input: 16 })).toString("hex"),
});

const canvasRow = z.object({ canvas: z.string() }).nullable();

/** A canvas's live link, its password's hash (none: no password) and its password generation. */
const liveLinkRow = z
  .object({ link: z.string(), hash: z.string().nullable(), pw_gen: z.number() })
  .nullable();

/** A link, as `share.open` reads it: its canvas, while it is live. */
const openRow = z
  .object({ canvas: z.string(), hash: z.string().nullable(), pw_gen: z.number() })
  .nullable();

/**
 * Ends what a link change ended: bumps the canvas's picture key generation, and makes each live
 * read of the canvas ask again, so `mayRead` sends each ended pass's refusal before the call
 * answers (judged rule 13).
 */
const endPasses = operation({
  label: "frames.endPasses",
  input: z.object({ canvas: z.string() }),
  depends: { bumpKeys, invalidate: framesBoard.invalidate },
  run: async ({ bumpKeys, invalidate }, { input }) => {
    await bumpKeys.run({ input });
    const canvas = { canvas: input.canvas };
    await invalidate.run({
      input: {
        frames: canvas,
        docs: canvas,
        requests: canvas,
        messages: canvas,
        serverClock: canvas,
      },
    });
  },
});

/** The query for a canvas's live link: its link, its password's hash and generation. */
const liveLinkQuery =
  "SELECT link, hash, pw_gen FROM frames_links WHERE canvas = ? AND ended IS NULL";

/** A canvas's live link, its password's hash and generation; none when it is not shared. */
const liveLink = operation({
  label: "frames.liveLink",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    liveLinkRow.parse(connection.db.$client.query(liveLinkQuery).get(input)),
});

/**
 * What a share's `password` makes of the link's hash, and whether that ends its passes: none
 * keeps it; `null` removes it and ends none; the same one again is no change; a new or different
 * one is hashed, and ends every pass.
 */
const plannedPassword = operation({
  label: "frames.plannedPassword",
  input: z.object({
    password: sharePassword.nullable().optional(),
    kept: z.string().nullable(),
  }),
  depends: { hashPassword, passwordMatches },
  run: async ({ hashPassword, passwordMatches }, { input }) => {
    const { password, kept } = input;
    if (password === undefined) return { hash: kept, ends: false };
    if (password === null) return { hash: null, ends: false };
    if (kept !== null && (await passwordMatches.run({ input: { password, hash: kept } }))) {
      return { hash: kept, ends: false };
    }

    return { hash: await hashPassword.run({ input: password }), ends: true };
  },
});

/**
 * The share's write, in one transaction: `gone` when the canvas is not there; null when the
 * live link is not the one the plan read (a share in between), so it plans again; else the live
 * link with the planned hash, its generation up by one when that ends the passes, or a new link.
 */
const writeShare = operation({
  label: "frames.writeShare",
  input: z.object({
    canvas: z.string(),
    before: liveLinkRow,
    next: z.object({ hash: z.string().nullable(), ends: z.boolean() }),
    fresh: z.string(),
    now: z.number(),
  }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) => {
    const db = connection.db.$client;
    const { canvas, before, next, fresh, now } = input;

    return db.transaction(() => {
      if (!db.query("SELECT 1 FROM frames_canvases WHERE key = ?").get(canvas)) {
        return { kind: "gone" as const };
      }
      const live = liveLinkRow.parse(db.query(liveLinkQuery).get(canvas));
      if (JSON.stringify(live) !== JSON.stringify(before)) return null;

      if (live) {
        db.query("UPDATE frames_links SET hash = ?, pw_gen = pw_gen + ? WHERE link = ?").run(
          next.hash,
          next.ends ? 1 : 0,
          live.link,
        );
        return { kind: "shared" as const, link: live.link };
      }

      db.query("INSERT INTO frames_links (link, canvas, made, hash) VALUES (?, ?, ?, ?)").run(
        fresh,
        canvas,
        now,
        next.hash,
      );
      return { kind: "shared" as const, link: fresh };
    })();
  },
});

/**
 * `canvas.share`: the canvas's live link, or a new one when it has none (judged rule 12: sharing
 * a shared canvas keeps its link). `password` sets or changes the password, `null` removes it,
 * none keeps it. A new or different password ends every pass on the link; the same one again, or
 * none, ends none. The hash is made, and the old one checked, before the write; the write's
 * transaction reads the link again, and plans again if a share in between changed it. The unique
 * index on a canvas's live link holds two shares at once to one link.
 */
export const shareCanvas = operation({
  label: "canvas.share.do",
  input: framesApi["canvas.share"].input,
  depends: {
    cells: canvases.atScope.controller,
    newSecret,
    liveLink,
    plannedPassword,
    writeShare,
    endPasses,
  },
  run: async (
    { cells, newSecret, liveLink, plannedPassword, writeShare, endPasses },
    { input, clock },
  ) => {
    const { canvas, password } = input;

    for (;;) {
      const before = await liveLink.run({ input: canvas });
      const next = await plannedPassword.run({
        input: { password, kept: before?.hash ?? null },
      });
      const done = await writeShare.run({
        input: { canvas, before, next, fresh: newSecret.run(), now: clock.currentTimeMillis() },
      });
      if (done === null) continue;
      if (done.kind === "gone") return done;

      const info = cells.of({ key: canvas }).get();
      if (info) cells.set({ ...info, shared: true });
      if (next.ends) await endPasses.run({ input: { canvas } });
      return { kind: "shared" as const, path: `${sharePrefix}${done.link}` };
    }
  },
});

/**
 * `canvas.unshare`: the live link ends, and its passes with it; each live read of the canvas is
 * refused `{ ended: true }` before this answers (judged rule 13). An ended link stays ended:
 * sharing again makes a new one (judged rule 12). On a canvas that is not shared it answers
 * `unshared` too, and ends nothing.
 */
export const unshareCanvas = operation({
  label: "canvas.unshare.do",
  input: framesApi["canvas.unshare"].input,
  depends: { connection: bunSqlite.connection, cells: canvases.atScope.controller, endPasses },
  run: async ({ connection, cells, endPasses }, { input, clock }) => {
    const db = connection.db.$client;
    const ended = db.transaction(() => {
      if (!db.query("SELECT 1 FROM frames_canvases WHERE key = ?").get(input.canvas)) return null;

      const live = liveLinkRow.parse(db.query(liveLinkQuery).get(input.canvas));
      if (!live) return false;

      db.query("UPDATE frames_links SET ended = ? WHERE link = ?").run(
        clock.currentTimeMillis(),
        live.link,
      );
      db.query("DELETE FROM frames_passes WHERE link = ?").run(live.link);
      return true;
    })();
    if (ended === null) return { kind: "gone" as const };

    if (ended) {
      const info = cells.of({ key: input.canvas }).get();
      if (info) cells.set({ ...info, shared: false });
      await endPasses.run({ input: { canvas: input.canvas } });
    }
    return { kind: "unshared" as const };
  },
});

/** The query for a link, as `share.open` reads it, while it is live. */
const openLinkQuery =
  "SELECT canvas, hash, pw_gen FROM frames_links WHERE link = ? AND ended IS NULL";

/** A link, as `share.open` reads it, while it is live: its canvas, hash and generation. */
const openLinkRow = operation({
  label: "frames.openLinkRow",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    openRow.parse(connection.db.$client.query(openLinkQuery).get(input)),
});

/**
 * The password half of `share.open`: null when the open may go on (the link has no password, or
 * this is the right one, and no wait is on); else its answer. No password on a password link
 * answers `locked`: it is no try, and is never slowed. A wrong one answers `wrong`. The 5th wrong
 * try in the minute from this address on this link starts a lock of a minute from the 5th: in it,
 * any try answers `slow` with the time left, even the right one.
 */
const passwordGate = operation({
  label: "frames.passwordGate",
  input: z.object({
    key: z.string(),
    password: typedPassword.optional(),
    hash: z.string().nullable(),
    now: z.number(),
  }),
  depends: { passwordMatches, tries: wrongTries },
  run: async ({ passwordMatches, tries }, { input }) => {
    const { key, password, hash, now } = input;
    if (hash === null) return null;
    if (password === undefined) return { kind: "locked" as const };

    const slowed = tries.slowed(key, now);
    if (slowed !== null) return { kind: "slow" as const, retryIn: slowed };

    if (!(await passwordMatches.run({ input: { password, hash } }))) {
      const wait = tries.wrong(key, now);
      return wait === null ? { kind: "wrong" as const } : { kind: "slow" as const, retryIn: wait };
    }
    // Wrong tries made while this one was checked count too: once they start a lock, even this
    // one waits.
    const since = tries.slowed(key, now);
    return since === null ? null : { kind: "slow" as const, retryIn: since };
  },
});

/**
 * Gives a pass on the live link, in one transaction: `gone` when it has ended, `changed` when
 * its password changed since the gate read it, else `given`. The pass is kept as its digest,
 * with the name (if the page sent one) and the link's password generation; the link's oldest
 * pass ends past 1000.
 */
const givePass = operation({
  label: "frames.givePass",
  input: z.object({
    link: z.string(),
    name: z.string().optional(),
    digest: z.string(),
    hash: z.string().nullable(),
    gen: z.number(),
    now: z.number(),
  }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) => {
    const db = connection.db.$client;
    const { link, name, digest, hash, gen, now } = input;

    return db.transaction(() => {
      const still = openRow.parse(db.query(openLinkQuery).get(link));
      if (!still) return "gone" as const;
      if (still.hash !== hash || still.pw_gen !== gen) return "changed" as const;

      db.query(
        "INSERT INTO frames_passes (digest, link, name, made, pw_gen) VALUES (?, ?, ?, ?, ?)",
      ).run(digest, link, name ?? null, now, still.pw_gen);
      db.query(
        "DELETE FROM frames_passes WHERE link = ?1 AND rowid NOT IN (SELECT rowid FROM frames_passes WHERE link = ?1 ORDER BY made DESC, rowid DESC LIMIT ?2)",
      ).run(link, passesPerLink);
      return "given" as const;
    })();
  },
});

/**
 * `share.open`: past the flood limit, `slow`; then the password gate; then a pass on the live
 * link. The gate runs before the write; the write's transaction reads the link again, and the
 * open goes through the gate again if its password changed between.
 */
export const openShare = operation({
  label: "share.open.do",
  input: shareApi["share.open"].input,
  depends: {
    newSecret,
    digestOf,
    limiter,
    clientAddress,
    addressKey,
    openLinkRow,
    passwordGate,
    givePass,
  },
  run: async (
    {
      newSecret,
      digestOf,
      limiter,
      clientAddress,
      addressKey,
      openLinkRow,
      passwordGate,
      givePass,
    },
    { input, clock },
  ) => {
    const now = clock.currentTimeMillis();
    const address = addressKey.run({ input: clientAddress.run() });
    const retryIn = limiter.hit(`share.open ${address}`, opensPerMinute, now);
    if (retryIn !== null) return { kind: "slow" as const, retryIn };

    // Tries count per address and link; the link goes in as its digest.
    const key = `${address} ${digestOf.run({ input: input.link })}`;

    for (;;) {
      const live = await openLinkRow.run({ input: input.link });
      if (!live) return { kind: "gone" as const };

      const stop = await passwordGate.run({
        input: { key, password: input.password, hash: live.hash, now },
      });
      if (stop) return stop;

      const pass = newSecret.run();
      const given = await givePass.run({
        input: {
          link: input.link,
          name: input.name,
          digest: digestOf.run({ input: pass }),
          hash: live.hash,
          gen: live.pw_gen,
          now,
        },
      });
      switch (given) {
        case "gone":
          return { kind: "gone" as const };
        case "changed":
          continue;
        case "given":
          return { kind: "open" as const, canvas: live.canvas, pass };
      }
    }
  },
});

/** A pass's state as a read finds it: its link is live and its pass under the current password. */
const passRow = z
  .object({
    canvas: z.string(),
    name: z.string().nullable(),
    pass_gen: z.number(),
    link_gen: z.number(),
  })
  .nullable();

/**
 * What a pass may read: its canvas, `live`, or `locked` once a password set or changed after it
 * was given ended it, and the viewer's name it was given with (null: none). Null for any other
 * pass: its link ended, or it was never given, or it was the link's oldest past 1000.
 */
export const passCanvas = operation({
  label: "frames.passCanvas",
  input: z.string(),
  depends: { connection: bunSqlite.connection, digestOf },
  run: async (
    { connection, digestOf },
    { input: pass },
  ): Promise<{ canvas: string; name: string | null; state: "live" | "locked" } | null> => {
    const row = passRow.parse(
      connection.db.$client
        .query(
          "SELECT l.canvas, p.name, p.pw_gen AS pass_gen, l.pw_gen AS link_gen FROM frames_passes p JOIN frames_links l ON l.link = p.link WHERE p.digest = ? AND l.ended IS NULL",
        )
        .get(digestOf.run({ input: pass })),
    );
    if (!row) return null;

    const state = row.pass_gen < row.link_gen ? "locked" : "live";
    return { canvas: row.canvas, name: row.name, state };
  },
});

/** The pass a call carries, as `mayName` found it live: its digest. */
export const heldPass = tag<{ readonly digest: string }>({ label: "frames.heldPass" });

/** The canvas that a call names, if its input has one. */
const namedCanvas = z.object({ canvas: z.string() });

/**
 * Every call of a tab that holds a pass: the pass alone judges it, as `mayRead` judges a read. No
 * pass (a user has none to name), or one that is not live for the canvas that the call names, is
 * refused `{ ended: true }`; one that a password set or changed ended is refused `{ locked: true }`.
 * A live one binds its digest.
 */
export const mayName = operation({
  label: "frames.mayName",
  input: transport.hook.start,
  depends: { passCanvas, digestOf },
  run: async ({ passCanvas, digestOf }, { input }) => {
    const sent = passMeta.safeParse(input.meta);
    if (!sent.success) return input.refuse(endedRefusal);

    const held = await passCanvas.run({ input: sent.data.pass });
    if (held === null || namedCanvas.safeParse(input.input).data?.canvas !== held.canvas) {
      return input.refuse(endedRefusal);
    }
    switch (held.state) {
      case "locked":
        return input.refuse(lockedRefusal);
      case "live":
        return { tags: [heldPass({ digest: digestOf.run({ input: sent.data.pass }) })] };
    }
  },
});

const nameRow = z.object({ name: z.string() }).nullable();

/**
 * `share.name`: the pass takes the name, trimmed, if it has none, in one statement; the answer is
 * the name the pass holds. A pass that ended between the guard and the write keeps nothing: the
 * answer is the name sent, and the next call with the pass is refused.
 */
export const namePass = operation({
  label: "share.name.do",
  input: passApi["share.name"].input,
  depends: { connection: bunSqlite.connection, held: heldPass.required },
  run: async ({ connection, held }, { input }) => {
    const row = nameRow.parse(
      connection.db.$client
        .query("UPDATE frames_passes SET name = COALESCE(name, ?) WHERE digest = ? RETURNING name")
        .get(input.name, held.digest),
    );

    return { kind: "named" as const, name: row?.name ?? input.name };
  },
});

/** At start: make the tables, and mark each canvas with a live link `shared`. */
const loadShares = operation({
  label: "frames.loadShares",
  depends: { connection: bunSqlite.connection, cells: canvases.atScope.controller },
  run: async ({ connection, cells }) => {
    const db = connection.db.$client;
    db.exec(schema);
    for (const [table, column, definition] of addedColumns) {
      const columns = db.query(`PRAGMA table_info(${table})`).all();
      if (!columns.some((c) => z.object({ name: z.literal(column) }).safeParse(c).success)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
    const passColumns = db.query("PRAGMA table_info(frames_passes)").all();
    if (passColumns.some((c) => notNullName.safeParse(c).success)) {
      db.transaction(() => db.exec(nameOptional))();
    }

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

/** A pass's side of the server: `frames.pass({ implement: passOps, onStart: [mayName] })`. */
export const passOps = { "share.name": namePass } as const;
