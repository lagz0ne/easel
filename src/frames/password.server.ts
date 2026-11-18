import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { sharePassword } from "./share";

// Share passwords (SPEC-frames.md § Share a canvas, § Open a share link; judged rules 10 and 14;
// the frames-share chart). A password is kept only as an argon2id hash, made and checked by
// `Bun.password` (judged rule 10): the check is the library's, in constant time, and the hash
// carries its own salt and cost. Neither the password nor its hash is a label or a log line
// (judged rule 15): the operations below take them only as input, which no span keeps
// (tests/share-password.test.ts reads every span and log record for them).
//
// Wrong tries count per client address and link, in the minute from the first wrong one (judged
// rule 14). Tries 1 to 5 that are wrong answer `wrong`; any try after 5 wrong ones answers `slow`,
// even the right password, until that minute has passed. Kept in memory, as `login.start`'s
// limiter is: a restart clears it.

/** The wrong tries an address may make on one link in a minute (judged rule 14). */
export const maxWrongTries = 5;

/** The window of wrong tries: a minute from the first wrong one. */
export const tryWindow = 60_000;

/** A share password's argon2id hash, with its salt (judged rule 10). */
export const hashPassword = operation({
  label: "frames.hashPassword",
  input: sharePassword,
  run: (_, { input }) => Bun.password.hash(input, { algorithm: "argon2id" }),
});

/** Whether a password is the one a hash was made from: `Bun.password`'s constant-time check. */
export const passwordMatches = operation({
  label: "frames.passwordMatches",
  input: z.object({ password: z.string(), hash: z.string() }),
  run: (_, { input }) => Bun.password.verify(input.password, input.hash, "argon2id"),
});

/**
 * Wrong share passwords, per key (the client address and the link): the first wrong try's time
 * and the count since. A window ends a minute after its first wrong try; once a minute each
 * ended window is deleted, so the map holds only the last minute's.
 */
export const wrongTries = resource({
  label: "frames.wrongTries",
  target: "scope",
  factory: () => {
    const seen = new Map<string, { first: number; count: number }>();
    let swept = 0;

    const tries = {
      /** The key's live window, or none once its minute has passed. */
      live: (key: string, now: number) => {
        if (now - swept >= tryWindow) {
          for (const [old, entry] of seen) {
            if (now >= entry.first + tryWindow) seen.delete(old);
          }
          swept = now;
        }
        const entry = seen.get(key);
        return entry && now < entry.first + tryWindow ? entry : undefined;
      },
      /** After 5 wrong tries in the window: the ms until it ends. Else null: the try may go on. */
      slowed: (key: string, now: number): number | null => {
        const entry = tries.live(key, now);
        return entry && entry.count >= maxWrongTries ? entry.first + tryWindow - now : null;
      },
      /**
       * Counts one wrong try. Null when it is one of the window's first 5 (it answers `wrong`);
       * else the ms until the window ends (it answers `slow`), and it is not counted.
       */
      wrong: (key: string, now: number): number | null => {
        const entry = tries.live(key, now);
        if (!entry) {
          seen.set(key, { first: now, count: 1 });
          return null;
        }
        if (entry.count >= maxWrongTries) return entry.first + tryWindow - now;

        entry.count += 1;
        return null;
      },
    };

    return tries;
  },
});
