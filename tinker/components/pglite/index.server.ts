import { PGlite } from "@electric-sql/pglite";
import { capsule, resource, tag } from "@tinkered/core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { PgConnection } from "~/components/drizzle-pg/index.server";

const dataDir = tag<string | undefined>({ label: "pglite.dataDir", default: undefined });

const connection = resource({
  label: "pglite.connection",
  depends: { dataDir },
  factory: async ({ dataDir }, { defer }): Promise<PgConnection> => {
    const client = new PGlite(dataDir);
    defer(() => client.close());
    const db = drizzle({ client });

    return {
      db,
      migrate: async (folder) => void (await migrate(db, { migrationsFolder: folder })),
    };
  },
});

export const pglite = capsule({ label: "pglite", config: { dataDir }, exports: { connection } });
