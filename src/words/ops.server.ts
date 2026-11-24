import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import { firstPage } from "@/frames/contract";
import { readKit } from "@/kit/store.server";

import { type OwnText, type TextUse, textUse, type UsedText, wordsApi } from "./contract";
import { appTexts, type FrameTexts, htmlTexts } from "./read.server";

const frameRow = z.object({
  canvas: z.string(),
  id: z.string(),
  name: z.string(),
  page: z.string().nullable(),
  html: z.string(),
  js: z.string().nullable(),
  image: z.string().nullable(),
});

export const readFrameDocs = operation({
  label: "words.readFrameDocs",
  input: z.object({ canvas: z.string().optional() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) => {
    const columns = "canvas, id, name, page, html, js, image";
    const order = "ORDER BY canvas, page, y, x, id";
    const query =
      input.canvas === undefined
        ? connection.db.$client.query(`SELECT ${columns} FROM frames_frames ${order}`).all()
        : connection.db.$client
            .query(`SELECT ${columns} FROM frames_frames WHERE canvas = ? ${order}`)
            .all(input.canvas);
    return z.array(frameRow).parse(query);
  },
});

export const frameTextsOf = operation({
  label: "words.frameTextsOf",
  input: frameRow,
  depends: { htmlTexts, appTexts },
  run: ({ htmlTexts, appTexts }, { input: row }): FrameTexts | null => {
    if (row.image !== null) return null;
    if (row.js !== null) return appTexts.run({ input: row.html });
    return htmlTexts.run({ input: row.html });
  },
});

const useOf = frameRow.transform((row): TextUse => ({
  canvas: row.canvas,
  id: row.id,
  name: row.name,
  page: row.page ?? firstPage.key,
}));

const noTexts: FrameTexts = { keys: [], own: [] };

export const addUses = operation({
  label: "words.addUses",
  input: z.object({
    into: z.custom<Map<string, TextUse[]>>(),
    names: z.array(z.string()),
    use: textUse,
  }),
  run: (_, { input: { into, names, use } }) => {
    for (const name of names) into.set(name, [...(into.get(name) ?? []), use]);
  },
});

export const collectUses = operation({
  label: "words.collectUses",
  input: z.array(frameRow),
  depends: { frameTextsOf, addUses },
  run: ({ frameTextsOf, addUses }, { input: rows }) => {
    const keyed = new Map<string, TextUse[]>();
    const own = new Map<string, TextUse[]>();

    for (const row of rows) {
      const found = frameTextsOf.run({ input: row }) ?? noTexts;
      const use = useOf.parse(row);
      addUses.run({ input: { into: keyed, names: found.keys, use } });
      addUses.run({ input: { into: own, names: found.own, use } });
    }

    const pictures = rows.filter((row) => row.image !== null).length;
    return { keyed, own, pictures };
  },
});

export const textsUses = operation({
  label: "texts.uses.do",
  input: wordsApi["texts.uses"].input,
  depends: { readKit, readFrameDocs, collectUses },
  run: async ({ readKit, readFrameDocs, collectUses }, { input }) => {
    const kit = await readKit.run();
    if (kit === null) throw new Error("words: no kit version: kitStart runs first");

    const rows = await readFrameDocs.run({ input });
    const { keyed, own, pictures } = collectUses.run({ input: rows });
    const texts = Object.entries(kit.texts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, text]): UsedText => ({ key, ...text, uses: keyed.get(key) ?? [] }));
    const unknown = [...keyed]
      .filter(([key]) => !(key in kit.texts))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, uses]) => ({ key, uses }));
    const missing = texts.flatMap((text) => (text.vi === undefined ? [text.key] : []));

    return {
      kind: "found" as const,
      kit: kit.version,
      rev: kit.textsRev,
      frames: rows.length,
      pictures,
      texts,
      unknown,
      own: [...own]
        .map(([text, uses]): OwnText => ({ text, uses }))
        .sort((a, b) => b.uses.length - a.uses.length || a.text.localeCompare(b.text)),
      missing: { vi: missing },
    };
  },
});

export const wordsOps = { "texts.uses": textsUses };
