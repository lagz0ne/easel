import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation, resource, tag } from "@tinkered/core";
import { eq, inArray } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { quiet } from "~/components/telemetry/records";

import { errorGroup, sample } from "./contract";

// ops's state: the error groups, the retired list and two stamps, in the app's one SQLite file
// (EASEL_DB, `synchronous = FULL`, as access), and in memory, which every op reads. The sink
// marks a group dirty; one flush a second writes each dirty group once (judged rule 2). A move a
// person or the fixer makes (resolve, hand-off, tick) is written before it answers. Close
// flushes what is left: the SIGTERM drain (judged rule 8).

/** A group as kept: the contract's group, and its last samples. */
export const storedGroup = errorGroup.extend({ samples: z.array(sample) });

export type StoredGroup = z.infer<typeof storedGroup>;

/** A resolved group dropped at the cap: its fingerprint and fix are kept (judged rule 4). */
export type Retired = { readonly fixedIn: number; readonly at: number };

/**
 * At most `groups` groups are kept (judged rule 3), and `retired` retired fingerprints, oldest out
 * (judged rule 4). The cmd keeps the defaults; a test sets small ones.
 */
export const caps = tag<{ readonly groups: number; readonly retired: number }>({
  label: "ops.caps",
  default: { groups: 1000, retired: 10_000 },
});

const groupTable = sqliteTable("ops_groups", {
  fingerprint: text("fingerprint").primaryKey(),
  body: text("body").notNull(),
});

const retiredTable = sqliteTable("ops_retired", {
  fingerprint: text("fingerprint").primaryKey(),
  fixedIn: integer("fixed_in").notNull(),
  at: integer("at").notNull(),
});

const metaTable = sqliteTable("ops_meta", {
  key: text("key").primaryKey(),
  value: integer("value").notNull(),
});

/** The schema, made at start. A binary carries no migrations folder; ops owns three tables. */
const schema = `
CREATE TABLE IF NOT EXISTS ops_groups (
  fingerprint TEXT PRIMARY KEY NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ops_retired (
  fingerprint TEXT PRIMARY KEY NOT NULL,
  fixed_in INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ops_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value INTEGER NOT NULL
);`;

/** What one write carries: groups to put and to drop, fingerprints to retire and to forget. */
const change = z.object({
  put: z.array(storedGroup),
  drop: z.array(z.string()),
  retire: z.array(z.tuple([z.string(), z.object({ fixedIn: z.number(), at: z.number() })])),
  forget: z.array(z.string()),
  stamps: z.record(z.string(), z.number()),
});

/** ops's state in memory. */
export type State = {
  readonly groups: Map<string, StoredGroup>;
  readonly retired: Map<string, Retired>;
  /** The fixer's last tick, as stored; null when it never ran. */
  fixerSeen: number | null;
  /** New groups not stored because no group could go (judged rule 3). */
  dropped: number;
  readonly startedAt: number;
  /** The last write's error, or null once a write works again. */
  failure: string | null;
  /** Sightings per minute, for the hour and day counts. Kept in memory only. */
  readonly minutes: Map<number, number>;
};

/**
 * The only holder of ops's state. `groups` and `retired` keep insertion order, so the first entry
 * of `retired` is the oldest. `pending` is what the sink changed since the last flush: groups to
 * put and to drop, fingerprints to retire and to forget, and whether the `dropped` count moved.
 * `failure` is the last write's error, or null: the database check reads it.
 */
export const opsStore = resource({
  label: "ops.store",
  target: "scope",
  depends: { connection: bunSqlite.connection },
  factory: async ({ connection }, ctx) => {
    const client = connection.db.$client;
    // FULL: each write is on disk before it answers, so a resolve is never lost to a power cut.
    client.exec("PRAGMA synchronous = FULL");
    client.exec(schema);

    const groups = new Map<string, StoredGroup>();
    for (const row of connection.db.select().from(groupTable).all()) {
      const parsed = storedGroup.safeParse(JSON.parse(row.body));
      if (parsed.success) groups.set(row.fingerprint, parsed.data);
    }

    const retired = new Map<string, Retired>();
    const rows = connection.db.select().from(retiredTable).all();
    for (const row of rows.toSorted((a, b) => a.at - b.at)) {
      retired.set(row.fingerprint, { fixedIn: row.fixedIn, at: row.at });
    }

    const meta = new Map(
      connection.db
        .select()
        .from(metaTable)
        .all()
        .map((m) => [m.key, m.value]),
    );
    const state: State = {
      groups,
      retired,
      fixerSeen: meta.get("fixerSeen") ?? null,
      dropped: meta.get("dropped") ?? 0,
      startedAt: ctx.clock.currentTimeMillis(),
      failure: null,
      minutes: new Map(),
    };
    const pending = {
      put: new Set<string>(),
      drop: new Set<string>(),
      retire: new Set<string>(),
      forget: new Set<string>(),
      dropped: false,
    };

    return { state, pending };
  },
});

/** One transaction; on failure nothing is lost from memory, and `failure` says why. */
const writeChange = operation({
  label: "ops.writeChange",
  input: change,
  depends: { connection: bunSqlite.connection, store: opsStore },
  run: async ({ connection, store }, { input }) => {
    try {
      connection.db.transaction((tx) => {
        for (const group of input.put) {
          const row = { fingerprint: group.fingerprint, body: JSON.stringify(group) };
          tx.insert(groupTable)
            .values(row)
            .onConflictDoUpdate({ target: groupTable.fingerprint, set: row })
            .run();
        }

        const drop = [...input.drop, ...input.retire.map(([fingerprint]) => fingerprint)];
        if (drop.length) tx.delete(groupTable).where(inArray(groupTable.fingerprint, drop)).run();

        for (const [fingerprint, entry] of input.retire) {
          const row = { fingerprint, ...entry };
          tx.insert(retiredTable)
            .values(row)
            .onConflictDoUpdate({ target: retiredTable.fingerprint, set: row })
            .run();
        }

        for (const fingerprint of input.forget) {
          tx.delete(retiredTable).where(eq(retiredTable.fingerprint, fingerprint)).run();
        }

        for (const [key, value] of Object.entries(input.stamps)) {
          tx.insert(metaTable)
            .values({ key, value })
            .onConflictDoUpdate({ target: metaTable.key, set: { value } })
            .run();
        }
      });
      store.state.failure = null;
      return true;
    } catch (error) {
      // drizzle wraps SQLite's error with the query and its values: keep SQLite's own words.
      const { cause } = Object(error);
      store.state.failure = String(Object(cause ?? error).message).slice(0, 200);
      return false;
    }
  },
});

/** Writes what the sink changed, in one transaction; kept pending when it fails. */
export const flushStore = operation({
  label: "ops.flushStore",
  depends: { store: opsStore, writeChange },
  run: async ({ store, writeChange }) => {
    const { pending, state } = store;
    const { put, drop, retire, forget } = pending;
    if (!put.size && !drop.size && !retire.size && !forget.size && !pending.dropped) return;

    const input = {
      put: [...put].flatMap((fp) => state.groups.get(fp) ?? []),
      drop: [...drop],
      retire: [...retire].flatMap((fp): [string, Retired][] => {
        const entry = state.retired.get(fp);
        return entry ? [[fp, entry]] : [];
      }),
      forget: [...forget],
      stamps: { dropped: state.dropped },
    };
    if (!(await writeChange.run({ input }))) return;

    for (const set of [put, drop, retire, forget]) set.clear();
    pending.dropped = false;
  },
});

/**
 * A person's or the fixer's move: the group is written now. False when the store failed: then
 * memory is as it was, unless a sighting changed the group meanwhile (that one is kept).
 */
export const saveGroup = operation({
  label: "ops.saveGroup",
  input: storedGroup,
  depends: { store: opsStore, writeChange },
  run: async ({ store, writeChange }, { input: group }) => {
    const { groups } = store.state;
    const { put } = store.pending;
    const { fingerprint } = group;
    const before = groups.get(fingerprint);
    const waiting = put.has(fingerprint);
    groups.set(fingerprint, group);
    put.add(fingerprint);
    const done = await writeChange.run({
      input: { put: [group], drop: [], retire: [], forget: [], stamps: {} },
    });
    // A sighting that changed the group meanwhile is newer: it stays, and stays pending.
    const same = groups.get(fingerprint) === group;
    if (same && (done || !waiting)) put.delete(fingerprint);
    if (done || !same) return done;

    if (before) groups.set(fingerprint, before);
    else groups.delete(fingerprint);
    return false;
  },
});

/** The fixer's stamp: kept in memory, then written now. False when the store failed. */
export const stampFixer = operation({
  label: "ops.stampFixer",
  input: z.number(),
  depends: { store: opsStore, writeChange },
  run: async ({ store, writeChange }, { input: at }) => {
    store.state.fixerSeen = at;

    return writeChange.run({
      input: { put: [], drop: [], retire: [], forget: [], stamps: { fixerSeen: at } },
    });
  },
});

/** Flushes once a second until the signal stops it (judged rule 2: one write a second). */
const flushEvery = operation({
  label: "ops.flushEvery",
  depends: { flushStore },
  run: async ({ flushStore }, { clock, signal }) => {
    while (!signal.aborted) {
      const slept = await clock.sleep(1000, signal).then(
        () => true,
        () => false,
      );
      if (!slept) return;

      await flushStore.run().catch(() => undefined);
    }
  },
});

/**
 * Starts the flush loop, stopped by the scope's close; it runs quiet: a flush a second is no span.
 * The last flush, the SIGTERM drain (judged rule 8), is `opsServer`'s close hook: a call this
 * resource deferred would be refused while the scope drains.
 */
export const opsFlusher = resource({
  label: "ops.flusher",
  target: "scope",
  depends: { every: flushEvery.controller },
  factory: async ({ every }, ctx) => {
    void every.run({ signal: ctx.closing, ns: quiet }).catch(() => undefined);

    return { started: true };
  },
});
