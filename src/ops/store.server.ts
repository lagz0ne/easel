import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation, resource, tag } from "@tinkered/core";
import { eq, inArray } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { quiet } from "~/components/telemetry/records";

import { errorGroup, sample } from "./contract";

export const storedGroup = errorGroup.extend({ samples: z.array(sample) });

export type StoredGroup = z.infer<typeof storedGroup>;

export type Retired = { readonly fixedIn: number; readonly at: number };

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

const change = z.object({
  put: z.array(storedGroup),
  drop: z.array(z.string()),
  retire: z.array(z.tuple([z.string(), z.object({ fixedIn: z.number(), at: z.number() })])),
  forget: z.array(z.string()),
  stamps: z.record(z.string(), z.number()),
});

export type State = {
  readonly groups: Map<string, StoredGroup>;
  readonly retired: Map<string, Retired>;
  fixerSeen: number | null;
  dropped: number;
  readonly startedAt: number;
  failure: string | null;
  readonly minutes: Map<number, number>;
};

export const opsStore = resource({
  label: "ops.store",
  target: "scope",
  depends: { connection: bunSqlite.connection },
  factory: async ({ connection }, ctx) => {
    const client = connection.db.$client;
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
      const { cause } = Object(error);
      store.state.failure = String(Object(cause ?? error).message).slice(0, 200);
      return false;
    }
  },
});

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
    const same = groups.get(fingerprint) === group;
    if (same && (done || !waiting)) put.delete(fingerprint);
    if (done || !same) return done;

    if (before) groups.set(fingerprint, before);
    else groups.delete(fingerprint);
    return false;
  },
});

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

export const opsFlusher = resource({
  label: "ops.flusher",
  target: "scope",
  depends: { every: flushEvery.controller },
  factory: async ({ every }, ctx) => {
    void every.run({ signal: ctx.closing, ns: quiet }).catch(() => undefined);

    return { started: true };
  },
});
