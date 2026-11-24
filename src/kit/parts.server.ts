import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { fillCopies, type MainFound, type PartBody } from "./copies.server";
import { kitColumns, showNewest } from "./store.server";

const schema = `
CREATE TABLE IF NOT EXISTS kit_parts (
  id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  name TEXT NOT NULL,
  canvas TEXT NOT NULL,
  frame TEXT NOT NULL,
  version INTEGER NOT NULL,
  html TEXT NOT NULL,
  css TEXT NOT NULL,
  made INTEGER NOT NULL,
  PRIMARY KEY (id, rev)
);
CREATE TABLE IF NOT EXISTS kit_design (
  version INTEGER PRIMARY KEY NOT NULL,
  rev INTEGER NOT NULL,
  parts TEXT NOT NULL
);`;

const carried = kitColumns.replace(/^version, /, "");

const partRow = z.object({
  id: z.string(),
  rev: z.number(),
  name: z.string(),
  canvas: z.string(),
  frame: z.string(),
  version: z.number(),
  html: z.string(),
  css: z.string(),
});

export type PartRow = z.infer<typeof partRow>;

const revsOf = z
  .string()
  .transform((text, ctx): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      ctx.addIssue({ code: "custom", message: "kit_design.parts is not JSON" });
      return z.NEVER;
    }
  })
  .pipe(z.record(z.string(), z.number()));

const designRow = z.object({ version: z.number(), rev: z.number(), parts: revsOf });

export type Design = {
  kit: number;
  rev: number;
  now: ReadonlyMap<string, PartRow>;
  revisions: ReadonlyMap<string, readonly PartBody[]>;
};

export const partsTables = resource({
  label: "kit.partsTables",
  target: "scope",
  depends: { connection: bunSqlite.connection },
  factory: async ({ connection }) => {
    connection.db.$client.exec(schema);
    return { kits: new Map<number, Design>() };
  },
});

const partRevisions = operation({
  label: "kit.partRevisions",
  input: z.array(z.string()),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: ids }): Promise<PartRow[]> => {
    if (ids.length === 0) return [];

    return connection.db.$client
      .query(
        `SELECT id, rev, name, canvas, frame, version, html, css FROM kit_parts
         WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY id, rev`,
      )
      .all(...ids)
      .flatMap((one) => partRow.safeParse(one).data ?? []);
  },
});

export const designAt = operation({
  label: "kit.designAt",
  input: z.number(),
  depends: { connection: bunSqlite.connection, tables: partsTables, partRevisions },
  run: async ({ connection, tables, partRevisions }, { input: kit }): Promise<Design> => {
    const kept = tables.kits.get(kit);
    if (kept) return kept;

    const row = designRow.safeParse(
      connection.db.$client
        .query(
          "SELECT version, rev, parts FROM kit_design WHERE version <= ? ORDER BY version DESC LIMIT 1",
        )
        .get(kit),
    ).data;
    const revs = row?.parts ?? {};
    const all = await partRevisions.run({ input: Object.keys(revs) });

    const revisions = new Map<string, PartBody[]>();
    for (const one of all) revisions.set(one.id, [...(revisions.get(one.id) ?? []), one]);
    const now = new Map(all.filter((one) => revs[one.id] === one.rev).map((one) => [one.id, one]));

    const design = { kit, rev: row?.rev ?? 0, now, revisions };
    tables.kits.set(kit, design);
    return design;
  },
});

const newestKit = z.object({ version: z.number() });

export const designNow = operation({
  label: "kit.designNow",
  depends: { connection: bunSqlite.connection, designAt },
  run: async ({ connection, designAt }) => {
    const top = newestKit.parse(
      connection.db.$client.query("SELECT MAX(version) AS version FROM kit_versions").get(),
    );
    return designAt.run({ input: top.version });
  },
});

export const fillAt = operation({
  label: "kit.fillAt",
  input: z.object({ html: z.string(), kit: z.number() }),
  depends: { designAt, fillCopies },
  run: async ({ designAt, fillCopies }, { input }) => {
    const design = await designAt.run({ input: input.kit });
    const noCopy = design.now.size === 0 || !input.html.includes("data-doop-instance=");
    if (noCopy) return { html: input.html, kit: design.kit, copies: [], linked: [] };

    const filled = fillCopies.run({
      input: { html: input.html, revisions: design.revisions, now: design.now },
    });
    return { ...filled, kit: design.kit };
  },
});

export const fillNow = operation({
  label: "kit.fillNow",
  input: z.string(),
  depends: { designNow, fillAt },
  run: async ({ designNow, fillAt }, { input }) => {
    const design = await designNow.run();
    return fillAt.run({ input: { html: input, kit: design.kit } });
  },
});

export const sourceShape = z.object({
  canvas: z.string(),
  frame: z.string(),
  version: z.number(),
  name: z.string(),
  mains: z.array(z.custom<MainFound>()),
});

export type Source = z.infer<typeof sourceShape>;

const changeOf = operation({
  label: "kit.partChange",
  input: z.object({
    source: sourceShape,
    main: z.custom<MainFound>(),
    was: z.custom<PartRow>().optional(),
    again: z.boolean(),
    floor: z.number().optional(),
  }),
  run: (_, { input: { source, main, was, again, floor } }): PartRow | null => {
    if (was && was.html === main.html && was.css === main.css) return null;

    const rev = was ? was.rev + (again ? 0 : 1) : (floor ?? 1);
    const { canvas, frame, version, name } = source;
    return { ...main, rev: Math.max(rev, 1), name, canvas, frame, version };
  },
});

const changesOf = operation({
  label: "kit.partChanges",
  input: z.object({
    sources: z.array(sourceShape),
    floors: z.record(z.string(), z.number()),
    now: z.custom<ReadonlyMap<string, PartRow>>((v) => v instanceof Map),
  }),
  depends: { changeOf },
  run: ({ changeOf }, { input }) => {
    const changes = new Map<string, PartRow>();
    for (const source of input.sources) {
      for (const main of source.mains) {
        const was = changes.get(main.id) ?? input.now.get(main.id);
        const again = changes.has(main.id);
        const floor = input.floors[main.id];
        const change = changeOf.run({ input: { source, main, was, again, floor } });
        if (change) changes.set(main.id, change);
      }
    }
    return [...changes.values()];
  },
});

const wroteKit = z.object({ version: z.number() });

export const publishMains = operation({
  label: "kit.publishMains",
  input: z.object({
    sources: z.array(sourceShape),
    floors: z.record(z.string(), z.number()),
  }),
  depends: {
    connection: bunSqlite.connection,
    tables: partsTables,
    designNow,
    changesOf,
    showNewest,
  },
  run: async ({ connection, tables, designNow, changesOf, showNewest }, { input, clock }) => {
    const db = connection.db.$client;
    const before = await designNow.run();
    const changes = changesOf.run({ input: { ...input, now: before.now } });
    const mains = new Set(input.sources.flatMap((s) => s.mains.map((m) => m.id)));
    const kept = [...before.now.values()].filter((p) => mains.has(p.id));
    if (changes.length === 0) {
      return {
        kind: "unchanged" as const,
        kit: before.kit,
        rev: before.rev,
        parts: kept.map(({ id, name, rev }) => ({ id, name, rev })),
        changed: [],
      };
    }

    const made = clock.currentTimeMillis();
    const revs = Object.fromEntries([...before.now].map(([id, p]) => [id, p.rev]));
    for (const change of changes) revs[change.id] = change.rev;
    const kit = db.transaction(() => {
      const wrote = wroteKit.parse(
        db
          .query(
            `INSERT INTO kit_versions (${kitColumns}, made, runtime)
             SELECT version + 1, ${carried}, ?, runtime FROM kit_versions
             WHERE version = (SELECT MAX(version) FROM kit_versions)
             RETURNING version`,
          )
          .get(made),
      );
      const insert = db.query(
        `INSERT OR REPLACE INTO kit_parts (id, rev, name, canvas, frame, version, html, css, made)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const c of changes) {
        insert.run(c.id, c.rev, c.name, c.canvas, c.frame, c.version, c.html, c.css, made);
      }
      db.query("INSERT INTO kit_design (version, rev, parts) VALUES (?, ?, ?)").run(
        wrote.version,
        before.rev + 1,
        JSON.stringify(revs),
      );
      return wrote.version;
    })();
    tables.kits.clear();

    await showNewest.run();
    const after = await designNow.run();
    return {
      kind: "updated" as const,
      kit,
      rev: after.rev,
      parts: [...after.now.values()]
        .filter((p) => mains.has(p.id))
        .map(({ id, name, rev }) => ({ id, name, rev })),
      changed: changes.map((c) => c.id).sort(),
    };
  },
});

export const partSources = operation({
  label: "kit.partSources",
  depends: { designNow },
  run: async ({ designNow }) =>
    [...(await designNow.run()).now.values()].map(({ id, name, rev, canvas, frame, version }) => ({
      id,
      name,
      rev,
      canvas,
      frame,
      version,
    })),
});
