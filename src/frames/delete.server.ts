import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import { kit } from "@/kit/cells";
import { messages, requests } from "@/queue/cells";

import { docs, framesApi, frames, kept, pages, removed } from "./contract";
import { endPasses } from "./share.server";
import { canvases } from "./store.server";

const rowsOfCanvas = [
  [
    "frames_passes",
    "DELETE FROM frames_passes WHERE link IN (SELECT link FROM frames_links WHERE canvas = $canvas)",
  ],
  ["frames_links", "DELETE FROM frames_links WHERE canvas = $canvas"],
  [
    "queue_deliveries",
    "DELETE FROM queue_deliveries WHERE request IN (SELECT id FROM queue_requests WHERE canvas = $canvas)",
  ],
  ["queue_messages", "DELETE FROM queue_messages WHERE canvas = $canvas"],
  ["queue_shots", "DELETE FROM queue_shots WHERE canvas = $canvas"],
  ["queue_requests", "DELETE FROM queue_requests WHERE canvas = $canvas"],
  ["frames_frames", "DELETE FROM frames_frames WHERE canvas = $canvas"],
  ["frames_kept", "DELETE FROM frames_kept WHERE canvas = $canvas"],
  ["frames_removed", "DELETE FROM frames_removed WHERE canvas = $canvas"],
  ["frames_images", "DELETE FROM frames_images WHERE canvas = $canvas"],
  ["frames_pages", "DELETE FROM frames_pages WHERE canvas = $canvas"],
  ["frames_canvases", "DELETE FROM frames_canvases WHERE key = $canvas"],
] as const;

const tableName = z.object({ name: z.string() });

const deleteRows = operation({
  label: "frames.deleteRows",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: canvas }) => {
    const db = connection.db.$client;
    return db.transaction(() => {
      if (!db.query("SELECT 1 FROM frames_canvases WHERE key = ?").get(canvas)) return false;

      const tables = new Set(
        db
          .query("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .flatMap((row) => tableName.safeParse(row).data?.name ?? []),
      );
      for (const [table, sql] of rowsOfCanvas) {
        if (tables.has(table)) db.query(sql).run({ $canvas: canvas });
      }
      return true;
    })();
  },
});

const forgetCells = operation({
  label: "frames.forgetCells",
  input: z.string(),
  depends: {
    canvasCells: canvases.atScope.controller,
    frameCells: frames.atScope.controller,
    pageCells: pages.atScope.controller,
    docCells: docs.atScope.controller,
    keptCells: kept.atScope.controller,
    removedCells: removed.atScope.controller,
    requestCells: requests.atScope.controller,
    messageCells: messages.atScope.controller,
    kitCells: kit.atScope.controller,
  },
  run: (cells, { input: canvas }) => {
    const { frameCells, pageCells, docCells, keptCells, removedCells } = cells;
    for (const { page, id } of frameCells.where({ canvas }).get()) {
      frameCells.delete({ canvas, page, id });
    }
    for (const { key } of pageCells.where({ canvas }).get()) pageCells.delete({ canvas, key });
    for (const { id } of docCells.where({ canvas }).get()) docCells.delete({ canvas, id });

    for (const { id, version } of keptCells.where({ canvas }).get()) {
      keptCells.delete({ canvas, id, version });
    }
    for (const { id } of removedCells.where({ canvas }).get()) removedCells.delete({ canvas, id });

    const { requestCells, messageCells } = cells;
    for (const { id } of messageCells.where({ canvas }).get()) messageCells.delete({ canvas, id });
    for (const { id } of requestCells.where({ canvas }).get()) requestCells.delete({ canvas, id });

    cells.kitCells.delete({ canvas });
    cells.canvasCells.delete({ key: canvas });
  },
});

export const deleteCanvas = operation({
  label: "canvas.delete.do",
  input: framesApi["canvas.delete"].input,
  depends: { deleteRows, forgetCells, endPasses },
  run: async ({ deleteRows, forgetCells, endPasses }, { input }) => {
    if (!(await deleteRows.run({ input: input.canvas }))) return { kind: "gone" as const };

    forgetCells.run({ input: input.canvas });
    await endPasses.run({ input: { canvas: input.canvas } });
    return { kind: "deleted" as const };
  },
});
