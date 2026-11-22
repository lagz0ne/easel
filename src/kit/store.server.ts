import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import { kit } from "./cells";
import { contrast } from "./compose";
import { lookValues, rootBlock } from "./look.server";
import { make } from "./make.server";
import { seedKitCss, seedLook } from "./seed.server";
import { sources } from "./source.server";

// The kit's state (SPEC-kit.md): its kit versions, in the app's one SQLite file. A kit version is
// one row that never changes and is never removed (judged rule 4). It holds all that `compose`
// needs: the look (DTCG 2025.10, with its revision), the look as a `:root` block, the kit's own
// CSS, its made CSS (made one time, with `make`, before the write; judged rules 2, 5) and its
// element pieces (none yet: build order step 4). The newest row is the current kit version. Only
// `seedKit` writes in this step (fact rule 2). The board's cell `kit` is set at scope after the
// rows are stored, from the row as stored (judged rule 6).

const schema = `
CREATE TABLE IF NOT EXISTS kit_versions (
  version INTEGER PRIMARY KEY NOT NULL,
  look_rev INTEGER NOT NULL,
  look TEXT NOT NULL,
  look_values TEXT NOT NULL,
  root TEXT NOT NULL,
  source TEXT NOT NULL,
  css TEXT NOT NULL,
  pieces TEXT NOT NULL,
  made INTEGER NOT NULL
);`;

/** A JSON column: its text, read as JSON. */
const jsonText = z.string().transform((text, ctx): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    ctx.addIssue({ code: "custom", message: "a kit version's column is not JSON" });
    return z.NEVER;
  }
});

const piece = z.object({ name: z.string(), template: z.string() });

/** A kit version's row, read. */
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
  })
  .transform(({ look_rev, look_values, ...row }) => ({
    ...row,
    lookRev: look_rev,
    values: look_values,
  }));

export type KitVersion = z.infer<typeof versionRow>;

const columns = "version, look_rev, look, look_values, root, source, css, pieces";

/** The current kit version: the newest row. Null only before the seed. */
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

/**
 * The seed as kit version 1, when the store has no kit version (fact rule 7): the look, measured
 * with `contrast` (fact rule 6; a seed that fails K8 throws, and the server does not start), and
 * the kit's CSS, made once with `make` before the write. The insert writes only into an empty
 * store, so a second start, or two at once, keeps the kit version that is there (K11).
 */
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
         SELECT 1, 1, ?, ?, ?, ?, ?, '[]', ? WHERE NOT EXISTS (SELECT 1 FROM kit_versions)`,
      )
      .run(
        JSON.stringify(look),
        JSON.stringify(values),
        units.rootBlock.run({ input: values }),
        seedKitCss,
        css,
        clock.currentTimeMillis(),
      );
    return { kind: wrote.changes ? ("seeded" as const) : ("kept" as const) };
  },
});

/** At start, before frames read their rows: the table, and the seed when the store is empty. */
export const kitStart = operation({
  label: "kit.start",
  depends: { connection: bunSqlite.connection, seedKit },
  run: async ({ connection, seedKit }) => {
    connection.db.$client.exec(schema);
    return seedKit.run();
  },
});

/** The current kit version as the check and the make step read it (src/kit/schema.ts). */
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
    };
  },
});

/**
 * The board's cell `kit` of each canvas named, from the current kit version as stored (judged
 * rule 6), set at scope, so each tab and each session sees it. frames call it at start and when
 * a canvas is made.
 */
export const showKit = operation({
  label: "kit.showKit",
  input: z.array(z.string()),
  depends: { readKit, cells: kit.atScope.controller },
  run: async ({ readKit, cells }, { input: canvases }) => {
    const now = await readKit.run();
    if (now === null) throw new Error("kit: no kit version: kitStart runs first");

    for (const canvas of canvases) {
      cells.set({ canvas, kit: now.version, look: now.root, css: now.css, pieces: now.pieces });
    }
  },
});
