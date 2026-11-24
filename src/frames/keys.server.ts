import { createHmac, timingSafeEqual } from "node:crypto";
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

export const secretName = "easel-pictures.secret";

const secretBytes = 32;

export const chromiumPath = tag<string | null | undefined>({
  label: "pictures.chromium",
  default: null,
});

export const pictureDatabase = tag<string>({ label: "pictures.database", default: ":memory:" });

export const pictureState = resource({
  label: "pictures.state",
  target: "scope",
  factory: (): {
    current: { chromium: string | null; asked: string | null; secret: Uint8Array };
  } => ({
    current: {
      chromium: null,
      asked: null,
      secret: crypto.getRandomValues(new Uint8Array(secretBytes)),
    },
  }),
});

const runnable = operation({
  label: "pictures.runnable",
  input: z.string().nullish(),
  run: (_, { input: path }) => {
    if (!path) return null;
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      return null;
    }
  },
});

export const loadPictures = operation({
  label: "pictures.load",
  depends: { state: pictureState, path: chromiumPath, database: pictureDatabase, runnable },
  run: ({ state, path, database, runnable }) => {
    let secret = state.current.secret;
    if (database !== ":memory:") {
      const file = join(dirname(database), secretName);
      mkdirSync(dirname(file), { recursive: true });
      try {
        writeFileSync(file, secret, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (Object(error).code !== "EEXIST") throw error;
        secret = new Uint8Array(readFileSync(file));
      }
      if (secret.length !== secretBytes) {
        throw new Error(`pictures: ${file} is not a ${secretBytes}-byte secret`);
      }
    }
    state.current = { chromium: runnable.run({ input: path }), asked: path || null, secret };
  },
});

export const pictureDraw = "clear-background";

const keyInput = z.object({
  canvas: z.string(),
  id: z.string(),
  version: z.number(),
  gen: z.number(),
});

export const pictureKey = operation({
  label: "pictures.key",
  input: keyInput,
  depends: { state: pictureState },
  run: ({ state }, { input }) =>
    createHmac("sha256", state.current.secret)
      .update(`${input.canvas}\n${input.id}\n${input.version}\n${input.gen}\n${pictureDraw}`)
      .digest("base64url"),
});

export const boardKey = operation({
  label: "pictures.boardKey",
  input: keyInput,
  depends: { state: pictureState, pictureKey },
  run: ({ state, pictureKey }, { input }) =>
    state.current.chromium === null ? undefined : pictureKey.run({ input }),
});

export const keyMatches = operation({
  label: "pictures.keyMatches",
  input: z.object({ sent: z.string(), want: z.string() }),
  run: (_, { input }) => {
    const sent = Buffer.from(input.sent);
    const want = Buffer.from(input.want);

    return sent.length === want.length && timingSafeEqual(sent, want);
  },
});
