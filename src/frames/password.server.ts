import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { sharePassword } from "./share";

export const maxWrongTries = 5;

export const tryWindow = 60_000;

export const lockTime = 60_000;

export const hashPassword = operation({
  label: "frames.hashPassword",
  input: sharePassword,
  run: (_, { input }) => Bun.password.hash(input, { algorithm: "argon2id" }),
});

export const passwordMatches = operation({
  label: "frames.passwordMatches",
  input: z.object({ password: z.string(), hash: z.string() }),
  run: (_, { input }) => Bun.password.verify(input.password, input.hash, "argon2id"),
});

export const wrongTries = resource({
  label: "frames.wrongTries",
  target: "scope",
  factory: () => {
    const seen = new Map<string, { first: number; count: number; until: number | null }>();
    let swept = 0;

    const tries = {
      live: (key: string, now: number) => {
        if (now - swept >= tryWindow) {
          for (const [old, entry] of seen) {
            if (now >= (entry.until ?? entry.first + tryWindow)) seen.delete(old);
          }
          swept = now;
        }
        const entry = seen.get(key);
        return entry && now < (entry.until ?? entry.first + tryWindow) ? entry : undefined;
      },
      slowed: (key: string, now: number): number | null => {
        const until = tries.live(key, now)?.until ?? null;
        return until === null ? null : until - now;
      },
      wrong: (key: string, now: number): number | null => {
        const entry = tries.live(key, now);
        if (!entry) {
          seen.set(key, { first: now, until: null, count: 1 });
          return null;
        }
        if (entry.until !== null) return entry.until - now;

        entry.count += 1;
        if (entry.count >= maxWrongTries) entry.until = now + lockTime;
        return null;
      },
    };

    return tries;
  },
});
