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

export const opensPerMinute = 30;

export const passesPerLink = 1000;

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

const notNullName = z.object({ name: z.literal("name"), notnull: z.literal(1) });

const addedColumns = [
  ["frames_links", "hash", "TEXT"],
  ["frames_links", "pw_gen", "INTEGER NOT NULL DEFAULT 0"],
  ["frames_passes", "pw_gen", "INTEGER NOT NULL DEFAULT 0"],
] as const;

const newSecret = operation({
  label: "frames.newSecret",
  depends: { bytes: secretBytes },
  run: ({ bytes }) => Buffer.from(bytes.run({ input: 16 })).toString("hex"),
});

const canvasRow = z.object({ canvas: z.string() }).nullable();

const liveLinkRow = z
  .object({ link: z.string(), hash: z.string().nullable(), pw_gen: z.number() })
  .nullable();

const openRow = z
  .object({ canvas: z.string(), hash: z.string().nullable(), pw_gen: z.number() })
  .nullable();

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

const liveLinkQuery =
  "SELECT link, hash, pw_gen FROM frames_links WHERE canvas = ? AND ended IS NULL";

const liveLink = operation({
  label: "frames.liveLink",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    liveLinkRow.parse(connection.db.$client.query(liveLinkQuery).get(input)),
});

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

const openLinkQuery =
  "SELECT canvas, hash, pw_gen FROM frames_links WHERE link = ? AND ended IS NULL";

const openLinkRow = operation({
  label: "frames.openLinkRow",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    openRow.parse(connection.db.$client.query(openLinkQuery).get(input)),
});

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
    const since = tries.slowed(key, now);
    return since === null ? null : { kind: "slow" as const, retryIn: since };
  },
});

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

const passRow = z
  .object({
    canvas: z.string(),
    name: z.string().nullable(),
    pass_gen: z.number(),
    link_gen: z.number(),
  })
  .nullable();

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

export const heldPass = tag<{ readonly digest: string }>({ label: "frames.heldPass" });

const namedCanvas = z.object({ canvas: z.string() });

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

export const shareServer = capsule({
  label: "shareServer",
  hooks: {
    async start({ run, next }) {
      await run(loadShares, {}, { role: "setup", explain: "Reads the share links" });
      await next();
    },
  },
});

export const shareOps = { "share.open": openShare } as const;

export const passOps = { "share.name": namePass } as const;
