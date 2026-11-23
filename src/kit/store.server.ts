import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import { uiTexts } from "./capsules/ui-texts";
import { kit } from "./cells";
import { contrast } from "./compose";
import { lookValues, rootBlock } from "./look.server";
import { make } from "./make.server";
import { easelRuntime } from "./runtime.server";
import { seedKitCss, seedLook } from "./seed.server";
import { sources } from "./source.server";
import { teamTexts, textsByKey, textsJson } from "./texts";

const sqlText = z.string().transform((text) => `'${text.replaceAll("'", "''")}'`);

const textsColumn = z
  .string()
  .transform((seed) => `texts TEXT NOT NULL DEFAULT ${sqlText.parse(seed)}`);

const textsRevColumn = "texts_rev INTEGER NOT NULL DEFAULT 1";

const schemaWith = z.string().transform(
  (texts) => `
CREATE TABLE IF NOT EXISTS kit_versions (
  version INTEGER PRIMARY KEY NOT NULL,
  look_rev INTEGER NOT NULL,
  look TEXT NOT NULL,
  look_values TEXT NOT NULL,
  root TEXT NOT NULL,
  source TEXT NOT NULL,
  css TEXT NOT NULL,
  pieces TEXT NOT NULL,
  made INTEGER NOT NULL,
  runtime TEXT,
  ${texts},
  ${textsRevColumn}
);
CREATE TABLE IF NOT EXISTS kit_runtimes (
  sha TEXT PRIMARY KEY NOT NULL,
  imports TEXT NOT NULL,
  files TEXT NOT NULL,
  made INTEGER NOT NULL
);`,
);

export const seedTexts = operation({
  label: "kit.seedTexts",
  depends: { textsByKey, textsJson },
  run: ({ textsByKey, textsJson }) => textsJson.run({ input: textsByKey.run({ input: uiTexts }) }),
});

const jsonText = z.string().transform((text, ctx): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    ctx.addIssue({ code: "custom", message: "a kit version's column is not JSON" });
    return z.NEVER;
  }
});

const piece = z.object({ name: z.string(), template: z.string() });

const versionRow = z
  .object({
    version: z.number(),
    look_rev: z.number(),
    look: jsonText.pipe(z.record(z.string(), z.unknown())),
    look_values: jsonText.pipe(z.record(z.string(), z.string())),
    root: z.string(),
    source: z.string(),
    css: z.string(),
    pieces: jsonText.pipe(z.array(piece)),
    texts: jsonText.pipe(teamTexts),
    texts_rev: z.number(),
  })
  .transform(({ look_rev, look_values, texts_rev, ...row }) => ({
    ...row,
    lookRev: look_rev,
    values: look_values,
    textsRev: texts_rev,
  }));

export type KitVersion = z.infer<typeof versionRow>;

const columns = "version, look_rev, look, look_values, root, source, css, pieces, texts, texts_rev";

export const readKit = operation({
  label: "kit.readKit",
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }) => {
    const row = connection.db.$client
      .query(`SELECT ${columns} FROM kit_versions ORDER BY version DESC LIMIT 1`)
      .get();
    return row === null ? null : versionRow.parse(row);
  },
});

export const readKitAt = operation({
  label: "kit.readKitAt",
  input: z.number(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: at }) => {
    const row = connection.db.$client
      .query(`SELECT ${columns} FROM kit_versions WHERE version = ?`)
      .get(at);
    return row === null ? null : versionRow.parse(row);
  },
});

const showNewest = operation({
  label: "kit.showNewest",
  depends: { cells: kit.atScope.controller, readKit },
  run: async ({ cells, readKit }) => {
    const row = await readKit.run();
    if (row === null) throw new Error("kit: no kit version after a write");

    for (const { canvas } of cells.get()) {
      cells.set({
        canvas,
        kit: row.version,
        look: row.root,
        css: row.css,
        pieces: row.pieces,
        texts: row.texts,
      });
    }
  },
});

const revRow = z.object({ kit: z.number(), rev: z.number() });

const newest =
  "SELECT version AS kit, look_rev AS rev FROM kit_versions ORDER BY version DESC LIMIT 1";

const newestTexts =
  "SELECT version AS kit, texts_rev AS rev FROM kit_versions ORDER BY version DESC LIMIT 1";

const top = "(SELECT MAX(version) FROM kit_versions)";

export const saveLook = operation({
  label: "kit.saveLook",
  input: z.object({
    base: z.number(),
    look: z.record(z.string(), z.unknown()),
    values: z.record(z.string(), z.string()),
    root: z.string(),
  }),
  depends: { connection: bunSqlite.connection, showNewest },
  run: async ({ connection, showNewest }, { input, clock }) => {
    const db = connection.db.$client;
    const values = JSON.stringify(input.values);
    const wrote = db
      .query(
        `INSERT INTO kit_versions (${columns}, made, runtime)
         SELECT version + 1, look_rev + 1, ?, ?, ?, source, css, pieces, texts, texts_rev, ?, runtime
         FROM kit_versions WHERE version = ${top} AND look_rev = ? AND look_values IS NOT ?
         RETURNING version AS kit, look_rev AS rev`,
      )
      .get(
        JSON.stringify(input.look),
        values,
        input.root,
        clock.currentTimeMillis(),
        input.base,
        values,
      );
    if (wrote === null) {
      const now = revRow.parse(db.query(newest).get());
      return { kind: now.rev === input.base ? ("unchanged" as const) : ("stale" as const), ...now };
    }

    await showNewest.run();
    return { kind: "updated" as const, ...revRow.parse(wrote) };
  },
});

export const undoLook = operation({
  label: "kit.undoLook",
  input: z.number(),
  depends: { connection: bunSqlite.connection, showNewest },
  run: async ({ connection, showNewest }, { input: base, clock }) => {
    const db = connection.db.$client;
    const wrote = db
      .query(
        `INSERT INTO kit_versions (${columns}, made, runtime)
         SELECT n.version + 1, n.look_rev + 1, p.look, p.look_values, p.root,
                n.source, n.css, n.pieces, n.texts, n.texts_rev, ?, n.runtime
         FROM kit_versions n JOIN kit_versions p
           ON p.version = (SELECT MAX(version) FROM kit_versions WHERE look_rev = n.look_rev - 1)
         WHERE n.version = ${top} AND n.look_rev = ?
         RETURNING version AS kit, look_rev AS rev`,
      )
      .get(clock.currentTimeMillis(), base);
    if (wrote === null) {
      const now = revRow.parse(db.query(newest).get());
      return now.rev === base ? { kind: "none" as const } : { kind: "stale" as const, ...now };
    }

    await showNewest.run();
    return { kind: "updated" as const, ...revRow.parse(wrote) };
  },
});

export const saveTexts = operation({
  label: "kit.saveTexts",
  input: z.object({ texts: teamTexts, base: z.number() }),
  depends: { connection: bunSqlite.connection, showNewest, textsJson },
  run: async ({ connection, showNewest, textsJson }, { input, clock }) => {
    const db = connection.db.$client;
    const texts = textsJson.run({ input: input.texts });
    const wrote = db
      .query(
        `INSERT INTO kit_versions (${columns}, made, runtime)
         SELECT version + 1, look_rev, look, look_values, root, source, css, pieces,
                ?, texts_rev + 1, ?, runtime
         FROM kit_versions WHERE version = ${top} AND texts_rev = ? AND texts IS NOT ?
         RETURNING version AS kit, texts_rev AS rev`,
      )
      .get(texts, clock.currentTimeMillis(), input.base, texts);
    if (wrote === null) {
      const now = revRow.parse(db.query(newestTexts).get());
      return { kind: now.rev === input.base ? ("unchanged" as const) : ("stale" as const), ...now };
    }

    await showNewest.run();
    return { kind: "updated" as const, ...revRow.parse(wrote) };
  },
});

export const acceptRuntime = operation({
  label: "kit.acceptRuntime",
  depends: { connection: bunSqlite.connection, easelRuntime, showNewest },
  run: async ({ connection, easelRuntime, showNewest }, { clock }) => {
    const db = connection.db.$client;
    const built = await easelRuntime.run();
    const made = clock.currentTimeMillis();
    const wrote = db.transaction(() => {
      db.query(
        "INSERT OR IGNORE INTO kit_runtimes (sha, imports, files, made) VALUES (?, ?, ?, ?)",
      ).run(built.sha, JSON.stringify(built.imports), JSON.stringify(built.files), made);
      return db
        .query(
          `INSERT INTO kit_versions (${columns}, made, runtime)
           SELECT version + 1, look_rev, look, look_values, root, source, css, pieces,
                  texts, texts_rev, ?, ?
           FROM kit_versions
           WHERE version = ${top} AND runtime IS NOT NULL AND runtime IS NOT ?
           RETURNING version AS kit, look_rev AS rev`,
        )
        .get(made, built.sha, built.sha);
    })();
    if (wrote === null) {
      return { kind: "unchanged" as const, ...revRow.parse(db.query(newest).get()) };
    }

    await showNewest.run();
    return { kind: "updated" as const, ...revRow.parse(wrote), runtime: built.sha };
  },
});

export const seedKit = operation({
  label: "kit.seedKit",
  depends: {
    connection: bunSqlite.connection,
    seedLook,
    lookValues,
    rootBlock,
    contrast,
    sources,
    make,
    seedTexts,
  },
  run: async (units, { clock }) => {
    const db = units.connection.db.$client;
    if (db.query("SELECT 1 FROM kit_versions LIMIT 1").get() !== null) {
      return { kind: "kept" as const };
    }

    const look = units.seedLook.run();
    const values = units.lookValues.run({ input: look });
    const fails = units.contrast
      .run({ input: { look: values, css: seedKitCss } })
      .filter((p) => p.ratio < p.min);
    if (fails.length > 0) {
      const told = fails.map((p) => `${p.text} on ${p.on}: ${p.ratio}:1, needs ${p.min}:1`);
      throw new Error(`kit: the seed fails K8: ${told.join("; ")}`);
    }

    const kitInput = { version: 1, look: values, css: seedKitCss, pieces: [] };
    const source = units.sources.run({ input: kitInput }).kit;
    const css = await units.make.run({ input: { source, classNames: [] } });
    const wrote = db
      .query(
        `INSERT INTO kit_versions (${columns}, made)
         SELECT 1, 1, ?, ?, ?, ?, ?, '[]', ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM kit_versions)`,
      )
      .run(
        JSON.stringify(look),
        JSON.stringify(values),
        units.rootBlock.run({ input: values }),
        seedKitCss,
        css,
        units.seedTexts.run(),
        clock.currentTimeMillis(),
      );
    return { kind: wrote.changes ? ("seeded" as const) : ("kept" as const) };
  },
});

const columnNames = z
  .array(z.object({ name: z.string() }))
  .transform((all) => all.map((c) => c.name));

export const kitStart = operation({
  label: "kit.start",
  depends: { connection: bunSqlite.connection, seedKit, seedTexts },
  run: async ({ connection, seedKit, seedTexts }) => {
    const db = connection.db.$client;
    const texts = textsColumn.parse(seedTexts.run());
    db.exec(schemaWith.parse(texts));

    const known = columnNames.parse(db.query("PRAGMA table_info(kit_versions)").all());
    if (!known.includes("runtime")) db.exec("ALTER TABLE kit_versions ADD COLUMN runtime TEXT");
    if (!known.includes("texts")) db.exec(`ALTER TABLE kit_versions ADD COLUMN ${texts}`);
    if (!known.includes("texts_rev")) {
      db.exec(`ALTER TABLE kit_versions ADD COLUMN ${textsRevColumn}`);
    }

    return seedKit.run();
  },
});

export const frameKit = operation({
  label: "kit.frameKit",
  depends: { readKit },
  run: async ({ readKit }) => {
    const now = await readKit.run();
    if (now === null) throw new Error("kit: no kit version: kitStart runs first");

    return {
      version: now.version,
      look: now.values,
      css: now.source,
      pieces: now.pieces.map((p) => p.name),
      texts: now.texts,
    };
  },
});

export const showKit = operation({
  label: "kit.showKit",
  input: z.array(z.string()),
  depends: { readKit, cells: kit.atScope.controller },
  run: async ({ readKit, cells }, { input: canvases }) => {
    const now = await readKit.run();
    if (now === null) throw new Error("kit: no kit version: kitStart runs first");

    for (const canvas of canvases) {
      cells.set({
        canvas,
        kit: now.version,
        look: now.root,
        css: now.css,
        pieces: now.pieces,
        texts: now.texts,
      });
    }
  },
});
