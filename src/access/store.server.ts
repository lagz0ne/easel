import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, data, operation, resource, tag } from "@tinkered/core";
import { and, inArray, lt } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { codeLetters, digest, roles } from "./contract";

const userRow = z.object({
  name: z.string(),
  role: z.enum(roles),
  since: z.number(),
  digest,
});

export type UserRow = z.infer<typeof userRow>;

const loginRow = z.object({
  request: z.string(),
  code: z.string(),
  name: z.string(),
  digest,
  address: z.string(),
  since: z.number(),
  expiresAt: z.number(),
  state: z.enum(["pending", "approved", "denied"]),
});

export type LoginRow = z.infer<typeof loginRow>;

export const users = data({
  label: "access.users",
  mode: "keyed",
  parse: userRow,
  key: (u) => ({ name: u.name }),
});

export const logins = data({
  label: "access.logins",
  mode: "keyed",
  parse: loginRow,
  key: (l) => ({ request: l.request }),
});

export const setupCode = data<string | null>({ label: "access.setupCode", initial: null });

const userTable = sqliteTable("access_users", {
  name: text("name").primaryKey(),
  role: text("role", { enum: roles }).notNull(),
  since: integer("since").notNull(),
  digest: text("digest").notNull(),
});

const loginTable = sqliteTable("access_logins", {
  request: text("request").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  digest: text("digest").notNull(),
  address: text("address").notNull(),
  since: integer("since").notNull(),
  expiresAt: integer("expires_at").notNull(),
  state: text("state", { enum: ["pending", "approved", "denied"] }).notNull(),
});

const schema = `
CREATE TABLE IF NOT EXISTS access_users (
  name TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL,
  since INTEGER NOT NULL,
  digest TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS access_logins (
  request TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  digest TEXT NOT NULL,
  address TEXT NOT NULL,
  since INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL
);`;

export const mode = tag<"approve" | "open">({ label: "access.mode", default: "approve" });

const origin = tag<string | null>({ label: "access.origin", default: null });

export const trusted = tag<readonly string[]>({ label: "access.trusted", default: [] });

const durable = tag<boolean>({ label: "access.durable", default: false });

const stdout = tag<{ write(chunk: string): unknown } | null>({
  label: "access.stdout",
  default: null,
});

type Change = {
  readonly users?: readonly UserRow[];
  readonly drop?: readonly string[];
  readonly logins?: readonly LoginRow[];
  readonly setupUsed?: true;
};

export const store = resource({
  label: "access.store",
  target: "scope",
  depends: {
    connection: bunSqlite.connection,
    users: users.atScope.controller,
    logins: logins.atScope.controller,
    setup: setupCode.atScope.controller,
  },
  factory: async ({ connection, users, logins, setup }) => ({
    write: (change: Change) => {
      connection.db.transaction((tx) => {
        for (const row of change.users ?? []) {
          tx.insert(userTable)
            .values(row)
            .onConflictDoUpdate({ target: userTable.name, set: row })
            .run();
        }
        const drop = [...(change.drop ?? [])];
        if (drop.length) tx.delete(userTable).where(inArray(userTable.name, drop)).run();
        for (const row of change.logins ?? []) {
          tx.insert(loginTable)
            .values(row)
            .onConflictDoUpdate({ target: loginTable.request, set: row })
            .run();
        }
      });

      for (const row of change.users ?? []) users.set(row);
      for (const name of change.drop ?? []) users.delete({ name });
      for (const row of change.logins ?? []) logins.set(row);
      if (change.setupUsed) setup.set(null);
    },
  }),
});

export const secretBytes = operation({
  label: "access.secretBytes",
  input: z.number().int().positive(),
  run: (_, { input }) => crypto.getRandomValues(new Uint8Array(input)),
});

export const newRequest = operation({
  label: "access.newRequest",
  depends: { bytes: secretBytes },
  run: ({ bytes }) => Buffer.from(bytes.run({ input: 16 })).toString("hex"),
});

export const newCode = operation({
  label: "access.newCode",
  depends: { bytes: secretBytes },
  run: ({ bytes }) => {
    let letters = "";
    while (letters.length < 8) {
      for (const byte of bytes.run({ input: 16 })) {
        if (byte < 240 && letters.length < 8) letters += codeLetters[byte % 20];
      }
    }

    return `${letters.slice(0, 4)}-${letters.slice(4)}`;
  },
});

const keepEnded = 24 * 60 * 60 * 1000;

const readTables = operation({
  label: "access.readTables",
  depends: { connection: bunSqlite.connection, out: stdout },
  run: async ({ connection, out }) => {
    const userRows = connection.db.select().from(userTable).all();
    const loginRows = connection.db.select().from(loginTable).all();
    const goodUsers = userRows.flatMap((row) => userRow.safeParse(row).data ?? []);
    const goodLogins = loginRows.flatMap((row) => loginRow.safeParse(row).data ?? []);
    const bad = userRows.length + loginRows.length - goodUsers.length - goodLogins.length;
    if (bad) out?.write(`access: skipped ${bad} rows that do not parse\n`);
    const kept = connection.db.$client.filename !== ":memory:";
    if (!kept) out?.write("access: no EASEL_DB, users are lost at exit\n");

    return { users: goodUsers, logins: goodLogins };
  },
});

const load = operation({
  label: "access.load",
  depends: {
    connection: bunSqlite.connection,
    users: users.atScope.controller,
    logins: logins.atScope.controller,
    setup: setupCode.atScope.controller,
    mode,
    out: stdout,
    newCode,
    readTables,
  },
  run: async (deps, { clock }) => {
    const { connection, users, logins, setup, mode, out, newCode, readTables } = deps;
    connection.db.$client.exec("PRAGMA synchronous = FULL");
    connection.db.$client.exec(schema);

    const now = clock.currentTimeMillis();
    connection.db
      .delete(loginTable)
      .where(
        and(
          inArray(loginTable.state, ["pending", "denied"]),
          lt(loginTable.expiresAt, now - keepEnded),
        ),
      )
      .run();

    const rows = await readTables.run();
    for (const row of rows.users) users.set(row);
    for (const row of rows.logins) logins.set(row);

    if (mode !== "approve" || users.get().length) return setup.set(null);

    const code = newCode.run();
    setup.set(code);
    out?.write(`setup code: ${code}\n`);
  },
});

export const isLoopback = operation({
  label: "access.isLoopback",
  input: z.string(),
  run: (_, { input }) => /^(localhost|127(\.\d{1,3}){3}|\[::1\]|::1)$/i.test(input),
});

const checkMode = operation({
  label: "access.checkMode",
  depends: { mode, origin, isLoopback },
  run: ({ mode, origin, isLoopback }) => {
    const host = origin === null ? null : URL.parse(origin)?.hostname;

    return mode === "approve" || (!!host && isLoopback.run({ input: host }));
  },
});

const checkFile = operation({
  label: "access.checkFile",
  depends: { connection: bunSqlite.connection, mode, durable, out: stdout },
  run: async ({ connection, mode, durable, out }) => {
    const lost = durable && mode === "approve" && connection.db.$client.filename === ":memory:";
    if (lost) out?.write("access: an approve server in production needs EASEL_DB, a SQLite file\n");

    return !lost;
  },
});

export const accessServer = capsule({
  label: "accessServer",
  config: { mode, origin, stdout, trusted, durable },
  exports: { mode },
  hooks: {
    async start({ run, next, raise }) {
      const ok = await run(checkMode, {}, { role: "setup", explain: "An open server is local" });
      if (!ok) raise("MissingConfig", { label: "accessServer", key: "origin" });
      const kept = await run(checkFile, {}, { role: "setup", explain: "Production keeps users" });
      if (!kept) raise("MissingConfig", { label: "accessServer", key: "EASEL_DB" });

      await run(load, {}, { role: "setup", explain: "Reads users and logins" });
      await next();
    },
  },
});
