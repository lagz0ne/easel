import { capsule, data, operation, resource, tag } from "@tinkered/core";
import type { Resource } from "@tinkered/core";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import type { Errors } from "~/components/errors";

export type SqliteDb = SQLiteAsyncDatabase<"sync" | "async", any, any>;
export type SqliteTx = Parameters<Parameters<SqliteDb["transaction"]>[0]>[0];

export type SqliteConnection = {
  readonly db: SqliteDb;
  readonly migrate: (folder: string) => Promise<void>;
  readonly begin: () => Promise<{
    readonly tx: SqliteDb | SqliteTx;
    readonly end: (commit: boolean) => Promise<void>;
  }>;
};

const driver = tag<Resource.Handle<Promise<SqliteConnection>>>({ label: "drizzleSqlite.driver" });

const migrations = tag<string | false>({
  label: "drizzleSqlite.migrations",
  default: "drizzle/sqlite",
  parse: z.union([z.string().min(1), z.literal(false)]),
});

const rootClosing = data<AbortSignal | undefined>({ initial: undefined });

const db = resource({
  label: "drizzleSqlite.db",
  depends: { connection: driver },
  factory: async ({ connection }) => connection.db,
});

const writeTurn = resource({
  label: "drizzleSqlite.writeTurn",
  factory: () => {
    let tail: Promise<void> = Promise.resolve();

    return {
      take: async (): Promise<() => void> => {
        const turn = Promise.withResolvers<void>();
        const before = tail;
        tail = tail.then(() => turn.promise);
        await before;

        return turn.resolve;
      },
    };
  },
});

const tx = resource({
  label: "drizzleSqlite.tx",
  target: "session",
  depends: { connection: driver, writeTurn, root: rootClosing },
  factory: async ({ connection, writeTurn, root }, { closing, defer, raise: coreRaise }) => {
    const raise: Errors.Raise = coreRaise;

    if (closing === root) return raise("TransactionNeedsSession", { label: "drizzleSqlite" });

    const release = await writeTurn.take();
    try {
      const { tx, end } = await connection.begin();
      defer((ended) => end(ended.status === "success").finally(release));

      return tx;
    } catch (error) {
      release();
      throw error;
    }
  },
});

const migrate = operation({
  label: "drizzleSqlite.migrate",
  depends: { connection: driver, folder: migrations },
  run: async ({ connection, folder }) => {
    if (folder !== false) await connection.migrate(folder);
  },
});

export const drizzleSqlite = capsule({
  label: "drizzleSqlite",
  config: { driver: driver.required, migrations },
  exports: { db, tx, migrate },
  hooks: {
    async start({ next, run, load, closing }) {
      load(rootClosing, { role: "state", explain: "Marks the root, for the boundary rule" }).set(
        closing,
      );
      await run(migrate, {}, { role: "setup", explain: "Brings the schema up to date" });
      await next();
    },
  },
});
