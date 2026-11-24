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

const sessionRow = z.object({
  id: z.string(),
  digest,
  name: z.string(),
  browser: z.string(),
  since: z.number(),
  used: z.number(),
});

export type SessionRow = z.infer<typeof sessionRow>;

const browserCodeRow = z.object({
  request: z.string(),
  code: z.string(),
  name: z.string(),
  address: z.string(),
  since: z.number(),
  expiresAt: z.number(),
  state: z.enum(["pending", "approved", "denied", "used"]),
});

export type BrowserCodeRow = z.infer<typeof browserCodeRow>;

export type LinkRow = { digest: string; name: string; expiresAt: number };

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

export const sessions = data({
  label: "access.sessions",
  mode: "keyed",
  parse: sessionRow,
  key: (row) => ({ digest: row.digest }),
});

export const browserCodes = data({
  label: "access.browserCodes",
  mode: "keyed",
  parse: browserCodeRow,
  key: (row) => ({ request: row.request }),
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

const sessionTable = sqliteTable("access_sessions", {
  id: text("id").primaryKey(),
  digest: text("digest").notNull(),
  name: text("name").notNull(),
  browser: text("browser").notNull(),
  since: integer("since").notNull(),
  used: integer("used").notNull(),
});

const browserCodeTable = sqliteTable("access_browser_codes", {
  request: text("request").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  since: integer("since").notNull(),
  expiresAt: integer("expires_at").notNull(),
  state: text("state", { enum: ["pending", "approved", "denied", "used"] }).notNull(),
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
);
CREATE TABLE IF NOT EXISTS access_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  digest TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  browser TEXT NOT NULL,
  since INTEGER NOT NULL,
  used INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_browser_codes (
  request TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  since INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS access_links (
  digest TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL
);`;

export const mode = tag<"approve" | "open">({ label: "access.mode", default: "approve" });

export const origin = tag<string | null>({ label: "access.origin", default: null });

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
  readonly sessions?: readonly SessionRow[];
  readonly endSessions?: readonly string[];
  readonly codes?: readonly BrowserCodeRow[];
  readonly links?: readonly LinkRow[];
};

type Full = Required<Omit<Change, "setupUsed">>;

const none: Full = {
  users: [],
  drop: [],
  logins: [],
  sessions: [],
  endSessions: [],
  codes: [],
  links: [],
};

type Use =
  | { readonly code: string; readonly session: Omit<SessionRow, "name"> }
  | { readonly link: string; readonly session: Omit<SessionRow, "name"> };

type Statement = { readonly sql: string; readonly params: readonly (string | number)[] };

const upsertUser = `INSERT INTO access_users (name, role, since, digest) VALUES (?, ?, ?, ?)
  ON CONFLICT (name) DO UPDATE SET role = excluded.role, since = excluded.since, digest = excluded.digest`;

const upsertLogin = `INSERT INTO access_logins (request, code, name, digest, address, since, expires_at, state)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (request) DO UPDATE SET code = excluded.code,
  name = excluded.name, digest = excluded.digest, address = excluded.address,
  since = excluded.since, expires_at = excluded.expires_at, state = excluded.state`;

const upsertSession = `INSERT INTO access_sessions (id, digest, name, browser, since, used)
  VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET used = excluded.used`;

const upsertCode = `INSERT INTO access_browser_codes (request, code, name, address, since, expires_at, state)
  VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (request) DO UPDATE SET state = excluded.state`;

const insertLink = "INSERT INTO access_links (digest, name, expires_at, used) VALUES (?, ?, ?, 0)";

const sqlOfDrop = operation({
  label: "access.sqlOfDrop",
  input: z.custom<readonly string[]>(),
  run: (_, { input: drop }): Statement[] => {
    if (!drop.length) return [];

    const names = drop.map(() => "?").join(", ");
    return [
      { sql: `DELETE FROM access_users WHERE name IN (${names})`, params: drop },
      { sql: `DELETE FROM access_sessions WHERE name IN (${names})`, params: drop },
      { sql: `DELETE FROM access_links WHERE name IN (${names})`, params: drop },
    ];
  },
});

const sqlOfChange = operation({
  label: "access.sqlOfChange",
  input: z.custom<Full>(),
  depends: { sqlOfDrop },
  run: ({ sqlOfDrop }, { input: c }): Statement[] => {
    const ended = c.endSessions.map(() => "?").join(", ");
    const endSql = `DELETE FROM access_sessions WHERE id IN (${ended})`;

    return [
      ...c.users.map((u) => ({ sql: upsertUser, params: [u.name, u.role, u.since, u.digest] })),
      ...sqlOfDrop.run({ input: c.drop }),
      ...c.logins.map((l) => ({
        sql: upsertLogin,
        params: [l.request, l.code, l.name, l.digest, l.address, l.since, l.expiresAt, l.state],
      })),
      ...c.sessions.map((s) => ({
        sql: upsertSession,
        params: [s.id, s.digest, s.name, s.browser, s.since, s.used],
      })),
      ...(c.endSessions.length ? [{ sql: endSql, params: c.endSessions }] : []),
      ...c.codes.map((b) => ({
        sql: upsertCode,
        params: [b.request, b.code, b.name, b.address, b.since, b.expiresAt, b.state],
      })),
      ...c.links.map((l) => ({ sql: insertLink, params: [l.digest, l.name, l.expiresAt] })),
    ];
  },
});

const useCode = `UPDATE access_browser_codes SET state = 'used'
  WHERE request = ? AND state = 'approved' AND expires_at > ?
    AND name IN (SELECT name FROM access_users) RETURNING name`;

const useLink = `UPDATE access_links SET used = 1
  WHERE digest = ? AND used = 0 AND expires_at > ?
    AND name IN (SELECT name FROM access_users) RETURNING name`;

const sqlOfUse = operation({
  label: "access.sqlOfUse",
  input: z.custom<Use>(),
  run: (_, { input: use }) =>
    "code" in use ? { sql: useCode, key: use.code } : { sql: useLink, key: use.link },
});

const showAccess = operation({
  label: "access.showAccess",
  input: z.object({ change: z.custom<Full>(), setupUsed: z.boolean() }),
  depends: {
    users: users.atScope.controller,
    logins: logins.atScope.controller,
    setup: setupCode.atScope.controller,
  },
  run: ({ users, logins, setup }, { input: { change, setupUsed } }) => {
    for (const row of change.users) users.set(row);
    for (const name of change.drop) users.delete({ name });
    for (const row of change.logins) logins.set(row);
    if (setupUsed) setup.set(null);
  },
});

const showBrowser = operation({
  label: "access.showBrowser",
  input: z.custom<Full>(),
  depends: { sessions: sessions.atScope.controller, codes: browserCodes.atScope.controller },
  run: ({ sessions, codes }, { input: c }) => {
    const ended = new Set(c.endSessions);
    const dropped = new Set(c.drop);
    for (const row of sessions.get()) {
      if (ended.has(row.id) || dropped.has(row.name)) sessions.delete({ digest: row.digest });
    }

    for (const row of c.sessions) sessions.set(row);
    for (const row of c.codes) codes.set(row);
  },
});

const showUse = operation({
  label: "access.showUse",
  input: z.object({ use: z.custom<Use>(), made: z.custom<SessionRow>() }),
  depends: { sessions: sessions.atScope.controller, codes: browserCodes.atScope.controller },
  run: ({ sessions, codes }, { input: { use, made } }) => {
    const held = "code" in use ? codes.of({ request: use.code }).get() : undefined;
    if (held) codes.set({ ...held, state: "used" });

    sessions.set(made);
  },
});

const codeUser = z.object({ name: z.string() }).nullable();

export const store = resource({
  label: "access.store",
  target: "scope",
  depends: {
    connection: bunSqlite.connection,
    sqlOfChange,
    sqlOfUse,
    showAccess,
    showBrowser,
    showUse,
  },
  factory: async ({ connection, sqlOfChange, sqlOfUse, showAccess, showBrowser, showUse }) => {
    const db = connection.db.$client;

    return {
      write: (change: Change) => {
        const c: Full = { ...none, ...change };
        db.transaction(() => {
          for (const step of sqlOfChange.run({ input: c })) db.query(step.sql).run(...step.params);
        })();

        showAccess.run({ input: { change: c, setupUsed: change.setupUsed === true } });
        showBrowser.run({ input: c });
      },
      use: (use: Use, now: number) => {
        const made = db.transaction(() => {
          const step = sqlOfUse.run({ input: use });
          const name = codeUser.parse(db.query(step.sql).get(step.key, now))?.name;
          if (name === undefined) return null;

          const row = { ...use.session, name };
          const keep = sqlOfChange.run({ input: { ...none, sessions: [row] } });
          for (const s of keep) db.query(s.sql).run(...s.params);
          return row;
        })();
        if (made === null) return null;

        showUse.run({ input: { use, made } });
        return made;
      },
    };
  },
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
    const sessionRows = connection.db.select().from(sessionTable).all();
    const codeRows = connection.db.select().from(browserCodeTable).all();
    const goodUsers = userRows.flatMap((row) => userRow.safeParse(row).data ?? []);
    const goodLogins = loginRows.flatMap((row) => loginRow.safeParse(row).data ?? []);
    const goodSessions = sessionRows.flatMap((row) => sessionRow.safeParse(row).data ?? []);
    const goodCodes = codeRows.flatMap((row) => browserCodeRow.safeParse(row).data ?? []);
    const read = userRows.length + loginRows.length + sessionRows.length + codeRows.length;
    const good = goodUsers.length + goodLogins.length + goodSessions.length + goodCodes.length;
    const bad = read - good;
    if (bad) out?.write(`access: skipped ${bad} rows that do not parse\n`);
    const kept = connection.db.$client.filename !== ":memory:";
    if (!kept) out?.write("access: no EASEL_DB, users are lost at exit\n");

    return { users: goodUsers, logins: goodLogins, sessions: goodSessions, codes: goodCodes };
  },
});

const load = operation({
  label: "access.load",
  depends: {
    connection: bunSqlite.connection,
    users: users.atScope.controller,
    logins: logins.atScope.controller,
    setup: setupCode.atScope.controller,
    sessions: sessions.atScope.controller,
    codes: browserCodes.atScope.controller,
    mode,
    out: stdout,
    newCode,
    readTables,
  },
  run: async (deps, { clock }) => {
    const { connection, users, logins, setup, sessions, codes, mode, out, newCode, readTables } =
      deps;
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

    connection.db
      .delete(browserCodeTable)
      .where(lt(browserCodeTable.expiresAt, now - keepEnded))
      .run();
    connection.db.$client.query("DELETE FROM access_links WHERE expires_at < ?").run(now);

    const rows = await readTables.run();
    for (const row of rows.users) users.set(row);
    for (const row of rows.logins) logins.set(row);
    for (const row of rows.sessions) sessions.set(row);
    for (const row of rows.codes) codes.set(row);

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
