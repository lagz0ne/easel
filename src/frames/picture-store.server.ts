import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { pictureDatabase, pictureDraw } from "./keys.server";

const pictureDrawCode = 1;

export const storedDraw = `${pictureDraw}/${pictureDrawCode}`;

export const pictureStoreSuffix = ".pictures";

export const pictureTheme = z.enum(["light", "dark"]);

const schema = `
CREATE TABLE IF NOT EXISTS frames_pictures (
  canvas TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  gen INTEGER NOT NULL,
  kit INTEGER NOT NULL,
  scale REAL NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  theme TEXT NOT NULL DEFAULT 'light',
  draw TEXT NOT NULL,
  bytes BLOB NOT NULL,
  made INTEGER NOT NULL,
  PRIMARY KEY (canvas, id, version, gen, kit, scale, region, w, h, theme, draw)
) WITHOUT ROWID;`;

const tableColumns = z.array(z.object({ name: z.string() }));

export const pictureStore = resource({
  label: "pictures.store",
  target: "scope",
  depends: { database: pictureDatabase },
  factory: ({ database }, ctx): { db: Database | null } => {
    const path = database === ":memory:" ? database : `${database}${pictureStoreSuffix}`;
    try {
      if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

      const db = new Database(path, { create: true });
      ctx.defer(() => db.close());

      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");
      const columns = tableColumns.parse(
        db.query("SELECT name FROM pragma_table_info('frames_pictures')").all(),
      );
      if (columns.length > 0 && !columns.some((column) => column.name === "theme")) {
        db.exec("DROP TABLE frames_pictures");
      }
      db.exec(schema);
      return { db };
    } catch {
      return { db: null };
    }
  },
});

const region = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const storedPictureKey = z.object({
  canvas: z.string(),
  id: z.string(),
  version: z.number(),
  gen: z.number(),
  kit: z.number(),
  scale: z.number(),
  region: region.nullable(),
  w: z.number(),
  h: z.number(),
  theme: pictureTheme,
});

const keyParams = storedPictureKey.transform((key) => ({
  $canvas: key.canvas,
  $id: key.id,
  $version: key.version,
  $gen: key.gen,
  $kit: key.kit,
  $scale: key.scale,
  $region: key.region ? `${key.region.x},${key.region.y},${key.region.w},${key.region.h}` : "",
  $w: key.w,
  $h: key.h,
  $theme: key.theme,
  $draw: storedDraw,
}));

const storedRow = z.object({ bytes: z.instanceof(Uint8Array) });

export const readStoredPicture = operation({
  label: "pictures.readStored",
  input: storedPictureKey,
  depends: { store: pictureStore },
  run: ({ store }, { input }) => {
    if (store.db === null) return null;
    try {
      const row = store.db
        .query(
          `SELECT bytes FROM frames_pictures
           WHERE canvas = $canvas AND id = $id AND version = $version AND gen = $gen
             AND kit = $kit AND scale = $scale AND region = $region AND w = $w AND h = $h
             AND theme = $theme AND draw = $draw`,
        )
        .get(keyParams.parse(input));
      const found = storedRow.safeParse(row);
      return found.success ? new Uint8Array(found.data.bytes) : null;
    } catch {
      return null;
    }
  },
});

export const storePicture = operation({
  label: "pictures.storePicture",
  input: storedPictureKey.extend({ bytes: z.instanceof(Uint8Array) }),
  depends: { store: pictureStore },
  run: ({ store }, { input, clock }) => {
    if (store.db === null) return false;
    try {
      store.db
        .query(
          `INSERT OR REPLACE INTO frames_pictures
             (canvas, id, version, gen, kit, scale, region, w, h, theme, draw, bytes, made)
           VALUES ($canvas, $id, $version, $gen, $kit, $scale, $region, $w, $h, $theme, $draw, $bytes, $made)`,
        )
        .run({ ...keyParams.parse(input), $bytes: input.bytes, $made: clock.currentTimeMillis() });
      return true;
    } catch {
      return false;
    }
  },
});
