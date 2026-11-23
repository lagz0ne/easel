import type { Database } from "bun:sqlite";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import { framesApi, keyOfName, maxPages } from "./contract";
import { hasPage, readPages, showPages } from "./store.server";

const canvasIsThere = operation({
  label: "frames.canvasIsThere",
  input: z.object({ canvas: z.string(), db: z.custom<Database>() }),
  run: (_, { input: { canvas, db } }) =>
    db.query("SELECT 1 FROM frames_canvases WHERE key = ?").get(canvas) !== null,
});

const nameIsTaken = operation({
  label: "frames.nameIsTaken",
  input: z.object({
    canvas: z.string(),
    name: z.string(),
    other: z.string().nullable(),
    db: z.custom<Database>(),
  }),
  run: (_, { input: { canvas, name, other, db } }) =>
    db
      .query(
        "SELECT 1 FROM frames_pages WHERE canvas = ? AND lower(name) = lower(?) AND key IS NOT ?",
      )
      .get(canvas, name, other) !== null,
});

const pageCount = z.object({ n: z.number() });

const writeNewPage = operation({
  label: "frames.writeNewPage",
  input: z.object({ canvas: z.string(), name: z.string(), db: z.custom<Database>() }),
  depends: { canvasIsThere, nameIsTaken, hasPage },
  run: ({ canvasIsThere, nameIsTaken, hasPage }, { input: { canvas, name, db } }) => {
    if (!canvasIsThere.run({ input: { canvas, db } })) return { kind: "gone" as const };
    const count = pageCount.parse(
      db.query("SELECT COUNT(*) AS n FROM frames_pages WHERE canvas = ?").get(canvas),
    ).n;
    if (count >= maxPages) return { kind: "full" as const };
    const key = keyOfName.parse(name);
    const keyTaken = hasPage.run({ input: { canvas, page: key, db } });
    if (keyTaken || nameIsTaken.run({ input: { canvas, name, other: null, db } })) {
      return { kind: "taken" as const };
    }

    db.query(
      `INSERT INTO frames_pages (canvas, key, name, ord)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(ord), -1) + 1 FROM frames_pages WHERE canvas = ?))`,
    ).run(canvas, key, name, canvas);
    return { kind: "created" as const, key };
  },
});

export const createPage = operation({
  label: "page.create.do",
  input: framesApi["page.create"].input,
  depends: { connection: bunSqlite.connection, writeNewPage, showPages },
  run: async ({ connection, writeNewPage, showPages }, { input }) => {
    const db = connection.db.$client;
    const answer = db.transaction(() => writeNewPage.run({ input: { ...input, db } }))();
    if (answer.kind === "created") showPages.run({ input: { canvas: input.canvas, db } });
    return answer;
  },
});

const writeName = operation({
  label: "frames.writeName",
  input: z.object({
    canvas: z.string(),
    page: z.string(),
    name: z.string(),
    db: z.custom<Database>(),
  }),
  depends: { hasPage, nameIsTaken },
  run: ({ hasPage, nameIsTaken }, { input: { canvas, page, name, db } }) => {
    if (!hasPage.run({ input: { canvas, page, db } })) return { kind: "gone" as const };
    if (nameIsTaken.run({ input: { canvas, name, other: page, db } })) {
      return { kind: "taken" as const };
    }

    db.query("UPDATE frames_pages SET name = ? WHERE canvas = ? AND key = ?").run(
      name,
      canvas,
      page,
    );
    return { kind: "renamed" as const };
  },
});

export const renamePage = operation({
  label: "page.rename.do",
  input: framesApi["page.rename"].input,
  depends: { connection: bunSqlite.connection, writeName, showPages },
  run: async ({ connection, writeName, showPages }, { input }) => {
    const db = connection.db.$client;
    const answer = db.transaction(() => writeName.run({ input: { ...input, db } }))();
    if (answer.kind === "renamed") showPages.run({ input: { canvas: input.canvas, db } });
    return answer;
  },
});

const keysInOrder = z.array(z.object({ key: z.string() }));

const writeOrder = operation({
  label: "frames.writeOrder",
  input: z.object({ canvas: z.string(), pages: z.array(z.string()), db: z.custom<Database>() }),
  run: (_, { input: { canvas, pages, db } }) => {
    const now = keysInOrder
      .parse(
        db.query("SELECT key FROM frames_pages WHERE canvas = ? ORDER BY ord, rowid").all(canvas),
      )
      .map((row) => row.key);
    const unknown = pages.some((key) => !now.includes(key));
    if (now.length === 0 || unknown) return { kind: "gone" as const };

    const named = [...new Set(pages)];
    const order = [...named, ...now.filter((key) => !named.includes(key))];
    const write = db.query("UPDATE frames_pages SET ord = ? WHERE canvas = ? AND key = ?");
    for (const [ord, key] of order.entries()) write.run(ord, canvas, key);
    return { kind: "ordered" as const };
  },
});

export const orderPages = operation({
  label: "page.order.do",
  input: framesApi["page.order"].input,
  depends: { connection: bunSqlite.connection, writeOrder, showPages },
  run: async ({ connection, writeOrder, showPages }, { input }) => {
    const db = connection.db.$client;
    const answer = db.transaction(() => writeOrder.run({ input: { ...input, db } }))();
    if (answer.kind === "ordered") showPages.run({ input: { canvas: input.canvas, db } });
    return answer;
  },
});

const dropPageRow = operation({
  label: "frames.dropPageRow",
  input: z.object({ canvas: z.string(), page: z.string(), db: z.custom<Database>() }),
  depends: { hasPage },
  run: ({ hasPage }, { input: { canvas, page, db } }) => {
    if (!hasPage.run({ input: { canvas, page, db } })) return { kind: "gone" as const };
    const all = pageCount.parse(
      db.query("SELECT COUNT(*) AS n FROM frames_pages WHERE canvas = ?").get(canvas),
    ).n;
    if (all === 1) return { kind: "last" as const };
    const frames = pageCount.parse(
      db
        .query("SELECT COUNT(*) AS n FROM frames_frames WHERE canvas = ? AND page = ?")
        .get(canvas, page),
    ).n;
    if (frames > 0) return { kind: "notEmpty" as const, frames };

    db.query("DELETE FROM frames_pages WHERE canvas = ? AND key = ?").run(canvas, page);
    return { kind: "deleted" as const };
  },
});

export const deletePage = operation({
  label: "page.delete.do",
  input: framesApi["page.delete"].input,
  depends: { connection: bunSqlite.connection, dropPageRow, showPages },
  run: async ({ connection, dropPageRow, showPages }, { input }) => {
    const db = connection.db.$client;
    const answer = db.transaction(() => dropPageRow.run({ input: { ...input, db } }))();
    if (answer.kind === "deleted") showPages.run({ input: { canvas: input.canvas, db } });
    return answer;
  },
});

export const listPages = operation({
  label: "page.list.do",
  input: framesApi["page.list"].input,
  depends: { connection: bunSqlite.connection, canvasIsThere, readPages },
  run: async ({ connection, canvasIsThere, readPages }, { input }) => {
    const db = connection.db.$client;
    if (!canvasIsThere.run({ input: { canvas: input.canvas, db } })) {
      return { kind: "gone" as const };
    }

    const rows = readPages.run({ input: { canvas: input.canvas, db } });
    return {
      kind: "found" as const,
      pages: rows.map(({ key, name, frames }) => ({ key, name, frames })),
    };
  },
});
