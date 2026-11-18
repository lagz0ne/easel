import { createHmac, timingSafeEqual } from "node:crypto";
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

// Picture keys (SPEC-frames.md § Pictures): HMAC-SHA-256 of the server's secret, the canvas, the
// id, the version and the canvas's key generation, in base64url. The secret is 256 random bits,
// made at the first start and kept in a file beside EASEL_DB under /data (mode 0600); a server
// with its database in memory keeps it in memory too. Neither the secret nor a key reaches a log
// or a span (judged rule 15 holds the same of links and passes): no operation here takes one as a
// label, and none writes one out.

/** The secret's file name, beside the database file. */
export const secretName = "easel-pictures.secret";

/** The secret: 256 bits. */
const secretBytes = 32;

/**
 * `EASEL_CHROMIUM` as the cmd read it: the Chromium that draws pictures. Null, unset or empty:
 * pictures are off.
 */
export const chromiumPath = tag<string | null | undefined>({
  label: "pictures.chromium",
  default: null,
});

/** `EASEL_DB` as the cmd read it: the secret is kept beside it, unless it is `:memory:`. */
export const pictureDatabase = tag<string>({ label: "pictures.database", default: ":memory:" });

/**
 * What the pictures' start found: the Chromium that draws (null: pictures are off), the path it
 * was given (for the readiness check), and the secret. Until the start, pictures are off, and the
 * secret is a fresh one that no key was made with.
 */
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

/** The path given, when a file there runs; else null: pictures are off. */
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

/**
 * At start: the Chromium, if there is one at the path given and it can run, and the secret, read
 * from its file, or made and written there (0600, never over one that is there) at the first start.
 */
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

const keyInput = z.object({
  canvas: z.string(),
  id: z.string(),
  version: z.number(),
  gen: z.number(),
});

/** A picture's key: HMAC-SHA-256 of the secret, the canvas, the id, the version and the generation. */
export const pictureKey = operation({
  label: "pictures.key",
  input: keyInput,
  depends: { state: pictureState },
  run: ({ state }, { input }) =>
    createHmac("sha256", state.current.secret)
      .update(`${input.canvas}\n${input.id}\n${input.version}\n${input.gen}`)
      .digest("base64url"),
});

/** The key a frame on the board carries: none while pictures are off, so the shell is a card. */
export const boardKey = operation({
  label: "pictures.boardKey",
  input: keyInput,
  depends: { state: pictureState, pictureKey },
  run: ({ state, pictureKey }, { input }) =>
    state.current.chromium === null ? undefined : pictureKey.run({ input }),
});

/** A key as sent against the one it must be, compared in constant time (judged rule 9). */
export const keyMatches = operation({
  label: "pictures.keyMatches",
  input: z.object({ sent: z.string(), want: z.string() }),
  run: (_, { input }) => {
    const sent = Buffer.from(input.sent);
    const want = Buffer.from(input.want);

    return sent.length === want.length && timingSafeEqual(sent, want);
  },
});
