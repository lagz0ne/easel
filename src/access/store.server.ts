import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, data, operation, resource, tag } from "@tinkered/core";
import { and, inArray, lt } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { codeLetters, digest, roles } from "./contract";

// access's state: users and logins, in the app's one SQLite file (SPEC.md, tech stack), so they
// survive a restart; and in two server cells, which every op reads and `store` writes. A cell
// here is never served: it holds digests. Each change is one SQLite transaction and the cells'
// write after it, with no `await` between the check and the write (judged rules 6-8).

const userRow = z.object({
  name: z.string(),
  role: z.enum(roles),
  since: z.number(),
  /** The digest of the user's token: one token per user, while the user is. */
  digest,
});

export type UserRow = z.infer<typeof userRow>;

const loginRow = z.object({
  request: z.string(),
  code: z.string(),
  name: z.string(),
  digest,
  /** The client address that started it: at most 3 wait from one address (judged rule 11). */
  address: z.string(),
  since: z.number(),
  expiresAt: z.number(),
  /** `pending` past `expiresAt` reads as expired; a revoke turns `approved` into `denied`. */
  state: z.enum(["pending", "approved", "denied"]),
});

export type LoginRow = z.infer<typeof loginRow>;

/** The users, by name. */
export const users = data({
  label: "access.users",
  mode: "keyed",
  parse: userRow,
  key: (u) => ({ name: u.name }),
});

/** The logins, by request. */
export const logins = data({
  label: "access.logins",
  mode: "keyed",
  parse: loginRow,
  key: (l) => ({ request: l.request }),
});

/** The live setup code: set at a start while there is no user; null otherwise. */
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

/** The schema, made at start. A binary carries no migrations folder; access owns two tables. */
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

/** How a server lets users in: `approve` (the default) or `open` (SPEC-access.md). */
export const mode = tag<"approve" | "open">({ label: "access.mode", default: "approve" });

/** The public origin: an `open` server starts only on a loopback one. */
const origin = tag<string | null>({ label: "access.origin", default: null });

/**
 * The proxies whose `X-Forwarded-For` is believed, as CIDRs the cmd has checked (`accessEnv`):
 * Traefik's network and Cloudflare's edges in production.
 */
export const trusted = tag<readonly string[]>({ label: "access.trusted", default: [] });

/** True in production: an `approve` server there must keep its users in a file (`EASEL_DB`). */
const durable = tag<boolean>({ label: "access.durable", default: false });

/** Where the setup code is shown: the server's log. */
const stdout = tag<{ write(chunk: string): unknown } | null>({
  label: "access.stdout",
  default: null,
});

/** One change: rows to put, users to drop, and the used setup code to end, in one write. */
type Change = {
  readonly users?: readonly UserRow[];
  readonly drop?: readonly string[];
  readonly logins?: readonly LoginRow[];
  readonly setupUsed?: true;
};

/** The only writer of the tables and the cells: one transaction, then the cells. */
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

/** `n` bytes from the system's secure source: tokens, codes and requests are secrets. */
export const secretBytes = operation({
  label: "access.secretBytes",
  input: z.number().int().positive(),
  run: (_, { input }) => crypto.getRandomValues(new Uint8Array(input)),
});

/** 128 random bits as 32 hex digits: a login's `request`. */
export const newRequest = operation({
  label: "access.newRequest",
  depends: { bytes: secretBytes },
  run: ({ bytes }) => Buffer.from(bytes.run({ input: 16 })).toString("hex"),
});

/** 8 letters of RFC 8628's alphabet, as `XXXX-XXXX`. A byte past 239 is drawn again, so each
 * letter is as likely as the next. */
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

/** Ended logins are kept a day, so a CLI that resumes late is still told what happened. */
const keepEnded = 24 * 60 * 60 * 1000;

/**
 * Each row of both tables, parsed. A row that does not parse is left out, so it cannot fault each
 * call; the log says only how many there were, never what they held. It also says when the
 * tables are in memory, and gone at exit.
 */
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

/**
 * At start: make the tables, read them into the cells, drop logins that ended over a day ago,
 * and while an `approve` server has no user, print a new setup code. The one before it is gone
 * with the last process, so it answers `wrong` (judged rule 4).
 */
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
    // FULL: each write is on disk before it answers, so a revoke is never lost to a power cut.
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

/** True for a loopback host: `localhost`, 127.0.0.0/8 or `::1`. */
export const isLoopback = operation({
  label: "access.isLoopback",
  input: z.string(),
  run: (_, { input }) => /^(localhost|127(\.\d{1,3}){3}|\[::1\]|::1)$/i.test(input),
});

/** Refuses an `open` server whose public origin is not on this machine (judged rule 12). */
const checkMode = operation({
  label: "access.checkMode",
  depends: { mode, origin, isLoopback },
  run: ({ mode, origin, isLoopback }) => {
    const host = origin === null ? null : URL.parse(origin)?.hostname;

    return mode === "approve" || (!!host && isLoopback.run({ input: host }));
  },
});

/**
 * Refuses an `approve` server in production with no SQLite file: each restart would drop every
 * user and print a new setup code. It says so in the log, by name, before the start fails.
 */
const checkFile = operation({
  label: "access.checkFile",
  depends: { connection: bunSqlite.connection, mode, durable, out: stdout },
  run: async ({ connection, mode, durable, out }) => {
    const lost = durable && mode === "approve" && connection.db.$client.filename === ":memory:";
    if (lost) out?.write("access: an approve server in production needs EASEL_DB, a SQLite file\n");

    return !lost;
  },
});

/**
 * The server side of access, filled by the cmd. Install it after `bunSqlite`. `mode` is the
 * cmd's reading of `EASEL_AUTH`; `origin` its `PUBLIC_ORIGIN`; `stdout` the log; `trusted` the
 * proxies whose `X-Forwarded-For` counts; `durable` true in production, where `approve` needs a
 * file.
 */
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
