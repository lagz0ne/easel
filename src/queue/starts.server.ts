import { bunSqlite } from "@tinkered/bun/sqlite";
import { operation } from "@tinkered/core";
import { z } from "zod";

import { caller } from "@/access/guards.server";

import { agreementRule } from "./agreement.server";
import { requestStatus } from "./cells";
import { maxTries, stateOf } from "./contract";
import { holds, limitKind } from "./holds";
import { silentAfterMs } from "./settings";
import { reportInput, startRef, startsApi } from "./starts";
import type { Limits } from "./starts";
import { waitingBell } from "./store.server";

const startsSchema = `
CREATE TABLE IF NOT EXISTS queue_starts (
  request TEXT NOT NULL,
  channel TEXT NOT NULL,
  period INTEGER NOT NULL,
  status TEXT NOT NULL,
  agent TEXT,
  cause TEXT,
  retry_at INTEGER,
  created INTEGER NOT NULL,
  PRIMARY KEY (request, channel, period)
);`;

const channelColumns = [
  ["max_running", "INTEGER NOT NULL DEFAULT 2"],
  ["max_per_day", "INTEGER NOT NULL DEFAULT 20"],
  ["starter_running", "INTEGER"],
  ["starter_today", "INTEGER"],
  ["starter_at", "TEXT"],
  ["starter_seen", "INTEGER"],
] as const;

const named = z.object({ name: z.string() });

const hasColumn = operation({
  label: "queue.hasColumn",
  input: z.object({ table: z.string(), column: z.string() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: { table, column } }) =>
    connection.db.$client
      .query(`PRAGMA table_info(${table})`)
      .all()
      .some((row) => named.safeParse(row).data?.name === column),
});

export const makeStartTables = operation({
  label: "queue.makeStartTables",
  depends: { connection: bunSqlite.connection, hasColumn },
  run: async ({ connection, hasColumn }) => {
    const db = connection.db.$client;
    db.exec(startsSchema);

    for (const [column, type] of channelColumns) {
      if (!(await hasColumn.run({ input: { table: "queue_channels", column } }))) {
        db.exec(`ALTER TABLE queue_channels ADD COLUMN ${column} ${type}`);
      }
    }
  },
});

const agreeRow = z.object({
  id: z.string(),
  status: requestStatus,
  claimedUntil: z.number().nullable(),
  tries: z.number(),
  acceptedBy: z.string().nullable(),
  agreedAt: z.number().nullable(),
});

export const agreeRequest = operation({
  label: "request.agree.do",
  input: startsApi["request.agree"].input,
  depends: {
    me: caller,
    connection: bunSqlite.connection,
    stateOf,
    holdCells: holds.atScope.controller,
    bell: waitingBell,
  },
  run: async ({ me, connection, stateOf, holdCells, bell }, { input, clock }) => {
    if (me.role !== "owner") return { kind: "notPerson" as const };

    const db = connection.db.$client;
    const now = clock.currentTimeMillis();
    const row = agreeRow.nullable().parse(
      db
        .query(
          `SELECT id, status, claimed_until AS claimedUntil, tries, accepted_by AS acceptedBy,
             agreed_at AS agreedAt
           FROM queue_requests WHERE canvas = $canvas AND n = $n`,
        )
        .get({ $canvas: input.canvas, $n: input.n }),
    );
    if (row === null) return { kind: "gone" as const };

    const state = stateOf.run({ input: { request: row, now } });
    if (state !== "waiting" && state !== "inWork") return { kind: "wrongState" as const, state };
    if (row.agreedAt !== null) return { kind: "agreed" as const };

    db.query("UPDATE queue_requests SET agreed_at = $now, agreed_by = $me WHERE id = $id").run({
      $now: now,
      $me: me.name,
      $id: row.id,
    });
    holdCells.delete({ canvas: input.canvas, id: row.id });
    bell.ring();

    return { kind: "agreed" as const };
  },
});

const channelLimits = z.object({
  kind: z.string(),
  running: z.number(),
  perDay: z.number(),
});

const readChannel = operation({
  label: "queue.readStarterChannel",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: name }) =>
    channelLimits.nullable().parse(
      connection.db.$client
        .query(
          `SELECT kind, max_running AS running, max_per_day AS perDay
           FROM queue_channels WHERE name = $name`,
        )
        .get({ $name: name }),
    ),
});

export const setLimits = operation({
  label: "channel.limits.do",
  input: startsApi["channel.limits"].input,
  depends: { me: caller, connection: bunSqlite.connection, readChannel },
  run: async ({ me, connection, readChannel }, { input }) => {
    if (me.role !== "owner") return { kind: "notPerson" as const };

    const channel = await readChannel.run({ input: input.name });
    if (channel === null) return { kind: "gone" as const };
    if (channel.kind !== "nats") return { kind: "notNats" as const };

    const limits: Limits = {
      running: input.running ?? channel.running,
      perDay: input.perDay ?? channel.perDay,
    };
    connection.db.$client
      .query(
        "UPDATE queue_channels SET max_running = $running, max_per_day = $perDay WHERE name = $name",
      )
      .run({ $running: limits.running, $perDay: limits.perDay, $name: input.name });

    return { kind: "saved" as const, limits };
  },
});

const requestOfRef = operation({
  label: "queue.requestOfStartRef",
  input: z.string(),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: ref }) => {
    const read = startRef.safeParse(ref);
    if (!read.success) return null;

    const found = z
      .object({ id: z.string() })
      .nullable()
      .parse(
        connection.db.$client
          .query("SELECT id FROM queue_requests WHERE canvas = $canvas AND n = $n")
          .get({ $canvas: read.data.canvas, $n: read.data.n }),
      );
    return found === null ? null : { request: found.id, period: read.data.period };
  },
});

const saveStart = `INSERT INTO queue_starts (request, channel, period, status, agent, cause, retry_at,
    created)
  VALUES ($request, $channel, $period, $status, $agent, $cause, $retryAt, $now)
  ON CONFLICT (request, channel, period) DO UPDATE SET status = excluded.status,
    agent = excluded.agent, cause = excluded.cause, retry_at = excluded.retry_at,
    created = excluded.created`;

const startOfReport = z.object({
  kind: z.enum(["started", "failed"]),
  channel: z.string(),
  ref: z.string(),
  agent: z.string().nullable(),
  cause: z.string().nullable(),
  retryMs: z.number().nullable(),
});

const noteStart = operation({
  label: "queue.noteStart",
  input: startOfReport,
  depends: { connection: bunSqlite.connection, requestOfRef },
  run: async ({ connection, requestOfRef }, { input, clock }) => {
    const found = await requestOfRef.run({ input: input.ref });
    if (found === null) return;

    const now = clock.currentTimeMillis();
    connection.db.$client.query(saveStart).run({
      $request: found.request,
      $channel: input.channel,
      $period: found.period,
      $status: input.kind,
      $agent: input.agent,
      $cause: input.cause,
      $retryAt: input.retryMs === null ? null : now + input.retryMs,
      $now: now,
    });
  },
});

const noteState = operation({
  label: "queue.noteStarterState",
  input: reportInput.options[0],
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) => {
    connection.db.$client
      .query(
        `UPDATE queue_channels SET starter_running = $running, starter_today = $today,
           starter_at = $at WHERE name = $name`,
      )
      .run({ $name: input.channel, $running: input.running, $today: input.today, $at: input.at });
  },
});

export const reportStarter = operation({
  label: "channel.report.do",
  input: startsApi["channel.report"].input,
  depends: { connection: bunSqlite.connection, readChannel, noteState, noteStart },
  run: async ({ connection, readChannel, noteState, noteStart }, { input, clock }) => {
    const channel = await readChannel.run({ input: input.channel });
    if (channel === null) return { kind: "gone" as const };
    if (channel.kind !== "nats") return { kind: "notNats" as const };

    connection.db.$client
      .query("UPDATE queue_channels SET starter_seen = $now WHERE name = $name")
      .run({ $name: input.channel, $now: clock.currentTimeMillis() });
    switch (input.kind) {
      case "state":
        await noteState.run({ input });
        break;
      case "started":
        await noteStart.run({ input: { ...input, cause: null, retryMs: null } });
        break;
      case "failed":
        await noteStart.run({ input: { ...input, agent: null } });
        break;
    }

    return { kind: "noted" as const, limits: { running: channel.running, perDay: channel.perDay } };
  },
});

const waitingRow = z.object({
  id: z.string(),
  canvas: z.string(),
  agreedAt: z.number().nullable(),
  period: z.number(),
});

const periodRow = z.object({
  channel: z.string(),
  kind: z.string(),
  status: z.string(),
  cause: z.string().nullable(),
  updated: z.number(),
  maxRunning: z.number(),
  maxPerDay: z.number(),
  running: z.number(),
  today: z.number(),
  at: limitKind.nullable(),
  since: z.number(),
  start: z.enum(["started", "failed"]).nullable(),
  retryAt: z.number().nullable(),
});

const waitingNow = `SELECT id, canvas, agreed_at AS agreedAt,
    COALESCE(claimed_until, updated) AS period
  FROM queue_requests
  WHERE status = 'open' AND (claimed_until IS NULL OR claimed_until <= $now) AND tries < $max`;

const periodNow = `SELECT d.channel, c.kind, d.status, d.cause, d.updated,
    c.max_running AS maxRunning, c.max_per_day AS maxPerDay,
    COALESCE(c.starter_running, 0) AS running, COALESCE(c.starter_today, 0) AS today,
    c.starter_at AS at, COALESCE(c.starter_seen, d.updated) AS since, s.status AS start,
    s.retry_at AS retryAt
  FROM queue_deliveries d
  JOIN queue_channels c ON c.name = d.channel
  LEFT JOIN queue_starts s ON s.request = d.request AND s.channel = d.channel
    AND s.period = d.period
  WHERE d.request = $id AND d.kind = 'waiting' AND d.period = $period`;

const starterHold = operation({
  label: "queue.starterHold",
  input: z.object({ row: periodRow, now: z.number() }),
  depends: { silentAfterMs },
  run: ({ silentAfterMs }, { input: { row, now } }) => {
    if (row.kind !== "nats" || row.status !== "sent") return null;

    if (now - row.since > silentAfterMs) return { kind: "silent" as const, since: row.since };
    switch (row.at) {
      case "running":
        return {
          kind: "limit" as const,
          which: "running" as const,
          count: row.running,
          limit: row.maxRunning,
        };
      case "day":
        return {
          kind: "limit" as const,
          which: "day" as const,
          count: row.today,
          limit: row.maxPerDay,
        };
      case null:
        return null;
    }
  },
});

const holdOfPeriod = operation({
  label: "queue.holdOfPeriod",
  input: z.object({ rows: z.array(periodRow), now: z.number() }),
  depends: { starterHold },
  run: ({ starterHold }, { input: { rows, now } }) => {
    if (rows.some((row) => row.start === "started")) return null;

    const failed = rows.find((row) => row.start === "failed");
    if (failed) return { kind: "failed" as const, retryAt: failed.retryAt ?? now };
    if (rows.some((row) => row.status === "failed" && !(row.cause ?? "").startsWith("ended"))) {
      return { kind: "refused" as const };
    }

    return rows.map((row) => starterHold.run({ input: { row, now } })).find(Boolean) ?? null;
  },
});

const holdOfRequest = operation({
  label: "queue.holdOfRequest",
  input: z.object({ row: waitingRow, now: z.number() }),
  depends: { connection: bunSqlite.connection, holdOfPeriod, agreementRule },
  run: async ({ connection, holdOfPeriod, agreementRule }, { input: { row, now } }) => {
    if (row.agreedAt === null && agreementRule) return { kind: "agreement" as const };

    const rows = connection.db.$client
      .query(periodNow)
      .all({ $id: row.id, $period: row.period })
      .map((one) => periodRow.parse(one));
    return holdOfPeriod.run({ input: { rows, now } });
  },
});

export const showHolds = operation({
  label: "queue.showHolds",
  depends: { connection: bunSqlite.connection, holdCells: holds.atScope.controller, holdOfRequest },
  run: async ({ connection, holdCells, holdOfRequest }, { clock }) => {
    const now = clock.currentTimeMillis();
    const shown = new Map(holdCells.get().map((one) => [`${one.canvas}\n${one.id}`, one]));
    const waiting = connection.db.$client
      .query(waitingNow)
      .all({ $now: now, $max: maxTries })
      .map((raw) => waitingRow.parse(raw));

    for (const row of waiting) {
      const hold = await holdOfRequest.run({ input: { row, now } });
      const at = `${row.canvas}\n${row.id}`;
      const before = shown.get(at);
      shown.delete(at);

      const key = { canvas: row.canvas, id: row.id };
      if (hold === null && before) holdCells.delete(key);
      if (hold !== null && JSON.stringify(before?.hold) !== JSON.stringify(hold)) {
        holdCells.set({ ...key, hold });
      }
    }

    for (const gone of shown.values()) holdCells.delete({ canvas: gone.canvas, id: gone.id });
  },
});

export const startsOps = {
  "request.agree": agreeRequest,
  "channel.limits": setLimits,
  "channel.report": reportStarter,
};
