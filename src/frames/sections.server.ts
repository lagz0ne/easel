import type { Database } from "bun:sqlite";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import { layoutAnswer, pageState, readLayout, revOf } from "./arrange.server";
import { keyOfName } from "./contract";
import {
  arrangeAfter,
  canvases,
  firstPageOf,
  hasPage,
  layoutOf,
  showArranged,
} from "./store.server";

export const sectionChange = z.object({
  canvas: z.string(),
  page: z.string().optional(),
  section: z.string(),
  at: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
  after: z.string().nullable().optional(),
  wrap: z.number().nullable().optional(),
  gap: z.number().optional(),
  rev: z.number().optional(),
});

const pageOf = operation({
  label: "frames.pageOf",
  input: z.object({ canvas: z.string(), page: z.string().optional(), db: z.custom<Database>() }),
  depends: { firstPageOf, hasPage },
  run: ({ firstPageOf, hasPage }, { input: { canvas, page, db } }) => {
    const on = page ?? firstPageOf.run({ input: { canvas, db } });
    return on !== null && hasPage.run({ input: { canvas, page: on, db } }) ? on : null;
  },
});

const orderAfter = operation({
  label: "frames.orderAfter",
  input: z.object({
    canvas: z.string(),
    page: z.string(),
    key: z.string(),
    after: z.string().nullable(),
    db: z.custom<Database>(),
  }),
  run: (_, { input: { canvas, page, key, after, db } }) => {
    const keys = db
      .query("SELECT key FROM frames_sections WHERE canvas = ? AND page = ? ORDER BY ord, key")
      .all(canvas, page)
      .map((row) => z.object({ key: z.string() }).parse(row).key)
      .filter((one) => one !== key);
    const at = after === null ? 0 : keys.indexOf(after) + 1;
    keys.splice(at, 0, key);
    const write = db.query(
      "UPDATE frames_sections SET ord = ? WHERE canvas = ? AND page = ? AND key = ?",
    );
    keys.forEach((one, ord) => write.run(ord, canvas, page, one));
  },
});

const sectionTarget = operation({
  label: "frames.sectionTarget",
  input: sectionChange.extend({ db: z.custom<Database>() }),
  depends: { revOf, pageOf },
  run: ({ revOf, pageOf }, { input: { db, ...input } }) => {
    const { canvas } = input;
    const rev = revOf.run({ input: { canvas, db } });
    if (input.rev !== undefined && input.rev !== rev) return { kind: "changed" as const, rev };

    const page = pageOf.run({ input: { canvas, page: input.page, db } });
    const has = db.query("SELECT 1 FROM frames_sections WHERE canvas = ? AND page = ? AND key = ?");
    const key = keyOfName.parse(input.section);
    if (page === null || has.get(canvas, page, key) === null) return { kind: "gone" as const };

    const after = typeof input.after === "string" ? keyOfName.parse(input.after) : input.after;
    if (after && has.get(canvas, page, after) === null) return { kind: "gone" as const };
    return { kind: "found" as const, page, key, after };
  },
});

const changeSection = operation({
  label: "frames.changeSection",
  input: sectionChange.extend({
    page: z.string(),
    key: z.string(),
    after: z.string().nullable().optional(),
    db: z.custom<Database>(),
  }),
  depends: { orderAfter },
  run: ({ orderAfter }, { input: { canvas, page, key, at, wrap, gap, after, db } }) => {
    const where = "WHERE canvas = ? AND page = ? AND key = ?";
    if (at !== undefined) {
      const spot = at ?? { x: null, y: null };
      db.query(`UPDATE frames_sections SET at_x = ?, at_y = ? ${where}`).run(
        spot.x,
        spot.y,
        canvas,
        page,
        key,
      );
    }
    if (wrap !== undefined) {
      db.query(`UPDATE frames_sections SET wrap = ? ${where}`).run(wrap, canvas, page, key);
    }
    if (gap !== undefined) {
      db.query(`UPDATE frames_sections SET gap = ? ${where}`).run(gap, canvas, page, key);
    }
    if (after !== undefined) orderAfter.run({ input: { canvas, page, key, after, db } });
  },
});

export const setSection = operation({
  label: "section.set.do",
  input: sectionChange,
  depends: {
    connection: bunSqlite.connection,
    sectionTarget,
    changeSection,
    pageState,
    arrangeAfter,
    showArranged,
    layoutOf,
  },
  run: async (deps, { input }) => {
    const { connection, sectionTarget, changeSection, pageState, arrangeAfter } = deps;
    const db = connection.db.$client;
    const { canvas } = input;
    const answer = db.transaction(() => {
      const target = sectionTarget.run({ input: { ...input, db } });
      if (target.kind !== "found") return target;

      const { page, key, after } = target;
      const before = pageState.run({ input: { canvas, pages: [page], db } });
      changeSection.run({ input: { ...input, page, key, after, db } });
      const changed = pageState.run({ input: { canvas, pages: [page], db } }) !== before;
      const done = arrangeAfter.run({ input: { canvas, pages: [page], changed, db } });
      return { kind: changed ? ("set" as const) : ("unchanged" as const), page, done };
    })();
    if (answer.kind === "changed" || answer.kind === "gone") return answer;

    const { kind, page, done } = answer;
    deps.showArranged.run({ input: { canvas, done, also: [], db } });
    return { kind, layout: deps.layoutOf.run({ input: { page, done } }) };
  },
});

export const layoutInput = z.object({ canvas: z.string(), page: z.string().optional() });

export const pageLayout = operation({
  label: "page.layout.do",
  input: layoutInput,
  depends: {
    connection: bunSqlite.connection,
    all: canvases.atScope.controller,
    pageOf,
    readLayout,
    revOf,
    layoutAnswer,
  },
  run: async ({ connection, all, pageOf, readLayout, revOf, layoutAnswer }, { input }) => {
    const db = connection.db.$client;
    const { canvas } = input;
    if (!all.of({ key: canvas }).get()) return { kind: "gone" as const };
    const page = pageOf.run({ input: { canvas, page: input.page, db } });
    if (page === null) return { kind: "gone" as const };

    const laid = readLayout.run({ input: { canvas, page, db } });
    const rev = revOf.run({ input: { canvas, db } });
    const layout = layoutAnswer.run({ input: { page, rev, findings: laid.findings } });
    return { kind: "found" as const, layout, sections: laid.sections };
  },
});

export const readSeats = operation({
  label: "frames.readSeats",
  input: z.object({ canvas: z.string() }),
  depends: { connection: bunSqlite.connection, revOf },
  run: async ({ connection, revOf }, { input: { canvas } }) => {
    const db = connection.db.$client;
    const rows = db
      .query(
        `SELECT f.id, s.name FROM frames_frames f
         JOIN frames_sections s ON s.canvas = f.canvas AND s.page = f.page AND s.key = f.section
         WHERE f.canvas = ?`,
      )
      .all(canvas)
      .map((row) => z.object({ id: z.string(), name: z.string() }).parse(row));
    const rev = revOf.run({ input: { canvas, db } });
    return { rev, seats: new Map(rows.map((row) => [row.id, row.name])) };
  },
});
