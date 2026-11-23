import { capsule, data, operation, resource, tag } from "@tinkered/core";
import type { Resource } from "@tinkered/core";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { Errors } from "~/components/errors";

export type PgDb = PgAsyncDatabase<PgQueryResultHKT, any>;
export type PgTx = Parameters<Parameters<PgDb["transaction"]>[0]>[0];

export type PgConnection = {
  readonly db: PgDb;
  readonly migrate: (folder: string) => Promise<void>;
};

const driver = tag<Resource.Handle<Promise<PgConnection>>>({ label: "drizzlePg.driver" });

const migrations = tag<string | false>({
  label: "drizzlePg.migrations",
  default: "drizzle/pg",
  parse: z.union([z.string().min(1), z.literal(false)]),
});

const rootClosing = data<AbortSignal | undefined>({ initial: undefined });

const db = resource({
  label: "drizzlePg.db",
  depends: { connection: driver },
  factory: async ({ connection }) => connection.db,
});

const tx = resource({
  label: "drizzlePg.tx",
  target: "session",
  depends: { connection: driver, root: rootClosing },
  factory: async ({ connection, root }, { closing, defer, raise: coreRaise }): Promise<PgTx> => {
    const raise: Errors.Raise = coreRaise;

    if (closing === root) return raise("TransactionNeedsSession", { label: "drizzlePg" });

    const opened = Promise.withResolvers<PgTx>();
    const ended = Promise.withResolvers<boolean>();
    const done = connection.db
      .transaction(async (inner) => {
        opened.resolve(inner);
        if (!(await ended.promise)) inner.rollback();
      })
      .catch((error: unknown) => {
        if (Object(error).name !== "TransactionRollbackError") throw error;
      });
    const found = await Promise.race([opened.promise, done.then(() => undefined)]);
    if (!found) return raise("TransactionNotOpened", { label: "drizzlePg" });
    defer(async (end) => {
      ended.resolve(end.status === "success");
      await done;
    });

    return found;
  },
});

const migrate = operation({
  label: "drizzlePg.migrate",
  depends: { connection: driver, folder: migrations },
  run: async ({ connection, folder }) => {
    if (folder !== false) await connection.migrate(folder);
  },
});

export const drizzlePg = capsule({
  label: "drizzlePg",
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
