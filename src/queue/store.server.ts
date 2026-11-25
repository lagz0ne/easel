import type { Database } from "bun:sqlite";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { frameStatus } from "@/frames/contract";
import { sanitizedImage } from "@/frames/images.server";
import { firstPageOf, hasPage } from "@/frames/store.server";

import { agreementRule } from "./agreement.server";
import { message, messages, request, requests } from "./cells";
import { maxOpen, maxTries, stateOf } from "./contract";
import { perAddress, perPass } from "./settings";

const referred = `(EXISTS (SELECT 1 FROM queue_requests r WHERE r.canvas = OLD.canvas AND r.frame_id = OLD.id
    AND OLD.version IN (r.version, r.claim_version))
  OR EXISTS (SELECT 1 FROM queue_messages m JOIN queue_requests r ON r.id = m.request
    WHERE r.canvas = OLD.canvas AND r.frame_id = OLD.id AND OLD.version IN (m.before_v, m.after_v)))`;

const schema = `
CREATE TABLE IF NOT EXISTS queue_requests (
  id TEXT PRIMARY KEY NOT NULL,
  canvas TEXT NOT NULL,
  n INTEGER NOT NULL,
  frame_id TEXT,
  version INTEGER,
  x REAL NOT NULL,
  y REAL NOT NULL,
  author TEXT NOT NULL,
  key TEXT NOT NULL,
  status TEXT NOT NULL,
  claimed_by TEXT,
  claimed_until INTEGER,
  claimed_at INTEGER,
  claim_digest TEXT,
  claim_version INTEGER,
  kit INTEGER,
  claim_kit INTEGER,
  tries INTEGER NOT NULL,
  queued_at INTEGER NOT NULL,
  accepted_by TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  page TEXT,
  agreed_at INTEGER,
  agreed_by TEXT,
  UNIQUE (canvas, n),
  UNIQUE (canvas, key)
);
CREATE INDEX IF NOT EXISTS queue_requests_order ON queue_requests (status, queued_at, canvas, n);
CREATE TABLE IF NOT EXISTS queue_messages (
  id TEXT PRIMARY KEY NOT NULL,
  canvas TEXT NOT NULL,
  request TEXT NOT NULL,
  kind TEXT NOT NULL,
  sender TEXT NOT NULL,
  text TEXT,
  html TEXT,
  options TEXT,
  pick INTEGER,
  before_v INTEGER,
  after_v INTEGER,
  before_kit INTEGER,
  after_kit INTEGER,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS queue_messages_request ON queue_messages (request, created);
CREATE TABLE IF NOT EXISTS queue_shots (
  request TEXT PRIMARY KEY NOT NULL,
  canvas TEXT NOT NULL,
  kind TEXT NOT NULL,
  sha TEXT,
  type TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL
);
DROP TRIGGER IF EXISTS queue_keep_put;
CREATE TRIGGER queue_keep_put BEFORE UPDATE OF html, js, image ON frames_frames
WHEN ${referred}
BEGIN
  INSERT OR IGNORE INTO frames_kept (canvas, id, version, html, css, kit, js, image)
  VALUES (OLD.canvas, OLD.id, OLD.version, OLD.html, OLD.css, OLD.kit, OLD.js, OLD.image);
END;
DROP TRIGGER IF EXISTS queue_keep_drop;
CREATE TRIGGER queue_keep_drop BEFORE DELETE ON frames_frames
WHEN ${referred}
BEGIN
  INSERT OR IGNORE INTO frames_kept (canvas, id, version, html, css, kit, js, image)
  VALUES (OLD.canvas, OLD.id, OLD.version, OLD.html, OLD.css, OLD.kit, OLD.js, OLD.image);
END;`;

const addedColumns = [
  ["queue_requests", "claimed_at"],
  ["queue_requests", "kit"],
  ["queue_requests", "claim_kit"],
  ["queue_messages", "before_kit"],
  ["queue_messages", "after_kit"],
] as const;

const requestColumns = `canvas, id, n, frame_id AS frameId, version, COALESCE(kit, 1) AS kit, x, y,
  page, author, key, status,
  claimed_by AS claimedBy, claimed_until AS claimedUntil, claimed_at AS claimedAt, tries,
  queued_at AS queuedAt,
  accepted_by AS acceptedBy, created, updated`;

const messageColumns = `canvas, id, request, kind, sender AS "from", text, html, options,
  pick AS option, before_v AS before, after_v AS after,
  CASE WHEN kind = 'result' THEN COALESCE(before_kit, 1) END AS beforeKit,
  CASE WHEN kind = 'result' THEN COALESCE(after_kit, 1) END AS afterKit, created`;

const messageRow = message.extend({
  options: z
    .string()
    .nullable()
    .transform((kept) => (kept === null ? null : z.array(z.string()).parse(JSON.parse(kept)))),
});

const waitingIn = `status = 'open' AND (claimed_until IS NULL OR claimed_until <= $now)
  AND tries < $max AND ($canvas IS NULL OR canvas = $canvas) AND ($n IS NULL OR n = $n)
  AND (agreed_at IS NOT NULL OR $open = 1)`;

export const claimSql = `UPDATE queue_requests SET claimed_by = $me, claimed_until = $until,
  claimed_at = $now, claim_digest = $digest, tries = tries + 1, updated = $now,
  claim_version = (SELECT f.version FROM frames_frames f
    WHERE f.canvas = queue_requests.canvas AND f.id = queue_requests.frame_id),
  claim_kit = (SELECT MAX(version) FROM kit_versions)
WHERE id = (SELECT id FROM queue_requests WHERE ${waitingIn}
  ORDER BY queued_at, canvas, n LIMIT 1)
RETURNING ${requestColumns}, claim_version AS claimVersion`;

const stdout = tag<{ write(chunk: string): unknown } | null>({
  label: "queue.stdout",
  default: null,
});

export const waitingBell = resource({
  label: "queue.waitingBell",
  target: "scope",
  factory: () => {
    const ears = new Set<AbortController>();

    return {
      listen: () => {
        const ear = new AbortController();
        ears.add(ear);
        return { signal: ear.signal, done: () => void ears.delete(ear) };
      },
      ring: () => {
        for (const ear of ears) ear.abort();
        ears.clear();
      },
    };
  },
});

const rowState = operation({
  label: "queue.rowState",
  input: z.object({ row: request, now: z.number() }),
  depends: { stateOf },
  run: ({ stateOf }, { input }) => stateOf.run({ input: { request: input.row, now: input.now } }),
});

export const seenKey = operation({
  label: "queue.seenKey",
  input: z.object({ canvas: z.string(), key: z.string() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    z
      .object({ n: z.number() })
      .nullable()
      .parse(
        connection.db.$client
          .query("SELECT n FROM queue_requests WHERE canvas = $canvas AND key = $key")
          .get({ $canvas: input.canvas, $key: input.key }),
      )?.n ?? null,
});

const addWrite = z.object({
  canvas: z.string(),
  id: z.string(),
  frameId: z.string().nullable(),
  version: z.number().nullable(),
  kit: z.number().optional(),
  x: z.number(),
  y: z.number(),
  page: z.string().nullable(),
  text: z.string(),
  key: z.string(),
  author: z.string(),
  person: z.boolean(),
  message: z.string(),
  now: z.number(),
  shot: z
    .discriminatedUnion("kind", [
      sanitizedImage.extend({ kind: z.literal("image") }),
      z.object({
        kind: z.literal("region"),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      }),
    ])
    .nullish(),
});

const frameBox = z.object({ w: z.number(), h: z.number() }).nullable();

const shotOnFrame = operation({
  label: "queue.shotOnFrame",
  input: addWrite
    .pick({ canvas: true, frameId: true, shot: true })
    .extend({ db: z.custom<Database>() }),
  run: (_, { input: { db, canvas, frameId, shot } }) => {
    if (shot?.kind !== "region") return true;

    const frame = frameBox.parse(
      db
        .query("SELECT w, h FROM frames_frames WHERE canvas = $canvas AND id = $id")
        .get({ $canvas: canvas, $id: frameId }),
    );
    return frame !== null && shot.x + shot.w <= frame.w && shot.y + shot.h <= frame.h;
  },
});

const holdImage = `INSERT INTO frames_images (canvas, sha, type, w, h, bytes, held)
  VALUES ($canvas, $sha, $type, $w, $h, $bytes, 1)
  ON CONFLICT (canvas, sha) DO UPDATE SET held = 1`;

const insertShot = `INSERT INTO queue_shots (request, canvas, kind, sha, type, x, y, w, h)
  VALUES ($request, $canvas, $kind, $sha, $type, $x, $y, $w, $h)`;

const saveShot = operation({
  label: "queue.saveShot",
  input: addWrite.pick({ canvas: true, shot: true }).extend({
    request: z.string(),
    db: z.custom<Database>(),
  }),
  run: (_, { input: { db, canvas, request, shot } }) => {
    if (!shot) return;

    const at = { $canvas: canvas, $request: request, $kind: shot.kind, $w: shot.w, $h: shot.h };
    if (shot.kind === "region") {
      db.query(insertShot).run({ ...at, $sha: null, $type: "image/webp", $x: shot.x, $y: shot.y });
      return;
    }

    const blob = { $sha: shot.sha, $type: shot.type, $bytes: shot.bytes };
    db.query(holdImage).run({ $canvas: canvas, $w: shot.w, $h: shot.h, ...blob });
    db.query(insertShot).run({ ...at, $sha: shot.sha, $type: shot.type, $x: 0, $y: 0 });
  },
});

const openCount =
  "SELECT COUNT(*) AS open FROM queue_requests WHERE canvas = $canvas AND status IN ('open', 'asking', 'person')";

const plainMessage = `INSERT INTO queue_messages (id, canvas, request, kind, sender, text, pick, created)
  VALUES ($id, $canvas, $request, $kind, $from, $text, $option, $now)
  RETURNING ${messageColumns}`;

const pageOfAsk = operation({
  label: "queue.pageOfAsk",
  input: z.object({ canvas: z.string(), page: z.string().nullable(), db: z.custom<Database>() }),
  depends: { firstPageOf, hasPage },
  run: ({ firstPageOf, hasPage }, { input: { canvas, db, ...asked } }) => {
    const page = asked.page ?? firstPageOf.run({ input: { canvas, db } });
    if (page === null || !hasPage.run({ input: { canvas, page, db } })) return null;
    return page;
  },
});

export const saveRequest = operation({
  label: "queue.saveRequest",
  input: addWrite,
  depends: {
    connection: bunSqlite.connection,
    requestCells: requests.atScope.controller,
    messageCells: messages.atScope.controller,
    bell: waitingBell,
    pageOfAsk,
    shotOnFrame,
    saveShot,
  },
  run: async (deps, { input }) => {
    const { connection, requestCells, messageCells, bell, pageOfAsk } = deps;
    const { shotOnFrame, saveShot } = deps;
    const db = connection.db.$client;
    const at = { $canvas: input.canvas, $now: input.now };

    const answer = db.transaction(() => {
      const seen = z
        .object({ n: z.number() })
        .nullable()
        .parse(
          db
            .query("SELECT n FROM queue_requests WHERE canvas = $canvas AND key = $key")
            .get({ ...at, $key: input.key }),
        );
      if (seen) return { kind: "added" as const, n: seen.n, rows: null };

      const page = input.frameId === null ? pageOfAsk.run({ input: { ...input, db } }) : null;
      const there =
        input.frameId === null
          ? page !== null
          : db
              .query("SELECT 1 FROM frames_frames WHERE canvas = $canvas AND id = $id")
              .get({ ...at, $id: input.frameId }) !== null;
      if (!there) return { kind: "gone" as const };
      const open = z.object({ open: z.number() }).parse(db.query(openCount).get(at)).open;
      if (open >= maxOpen) return { kind: "full" as const };
      if (!shotOnFrame.run({ input: { ...input, db } })) return { kind: "offFrame" as const };

      const row = request.parse(
        db
          .query(
            `INSERT INTO queue_requests (id, canvas, n, frame_id, version, kit, x, y, page, author, key,
               status, tries, queued_at, created, updated, agreed_at, agreed_by)
             SELECT $id, $canvas, COALESCE(MAX(n), 0) + 1, $frame, $version,
               MIN(COALESCE($kit, $past), (SELECT MAX(version) FROM kit_versions)), $x, $y, $page,
               $author, $key,
               'open', 0, $now, $now, $now, CASE WHEN $person THEN $now END,
               CASE WHEN $person THEN $author END
             FROM queue_requests WHERE canvas = $canvas
             RETURNING ${requestColumns}`,
          )
          .get({
            ...at,
            $id: input.id,
            $frame: input.frameId,
            $version: input.version,
            $kit: input.kit ?? null,
            $past: Number.MAX_SAFE_INTEGER,
            $x: input.x,
            $y: input.y,
            $page: page,
            $author: input.author,
            $key: input.key,
            $person: Number(input.person),
          }),
      );
      const first = messageRow.parse(
        db.query(plainMessage).get({
          ...at,
          $id: input.message,
          $request: row.id,
          $kind: "ask",
          $from: input.author,
          $text: input.text,
          $option: null,
        }),
      );
      saveShot.run({ input: { db, canvas: input.canvas, request: row.id, shot: input.shot } });
      return { kind: "added" as const, n: row.n, rows: { row, first } };
    })();

    switch (answer.kind) {
      case "added":
        if (answer.rows) {
          requestCells.set(answer.rows.row);
          messageCells.set(answer.rows.first);
          bell.ring();
        }
        return { kind: "added" as const, n: answer.n };
      case "gone":
      case "full":
      case "offFrame":
        return answer;
    }
  },
});

const viewerWrite = z.object({
  kind: z.enum(["edit", "note", "answer", "accept", "reopen", "close"]),
  canvas: z.string(),
  n: z.number(),
  from: z.string(),
  person: z.boolean(),
  text: z.string().nullable(),
  option: z.number().nullable(),
  message: z.string(),
  now: z.number(),
});

const viewerSql = {
  edit: {
    set: `status = 'open', tries = 0, queued_at = $now, claimed_by = NULL, claimed_until = NULL,
      claimed_at = NULL, claim_digest = NULL`,
    where: `(status = 'open' AND (claimed_until IS NULL OR claimed_until <= $now)) OR status = 'person'`,
  },
  note: {
    set: `tries = CASE WHEN status = 'open' AND claimed_until > $now THEN tries ELSE 0 END,
      status = 'open'`,
    where: "status IN ('open', 'person')",
  },
  answer: { set: "status = 'open', tries = 0", where: "status = 'asking'" },
  accept: { set: "accepted_by = $from", where: "status = 'resolved' AND accepted_by IS NULL" },
  reopen: {
    set: "status = 'open', tries = 0, accepted_by = NULL, queued_at = $now",
    where: `status = 'resolved' AND (${openCount}) < ${maxOpen}`,
  },
  close: {
    set: `status = 'closed', claimed_by = NULL, claimed_until = NULL, claimed_at = NULL,
      claim_digest = NULL`,
    where: "status IN ('open', 'asking', 'person')",
  },
} as const;

const newTextAgreement = `, agreed_at = CASE WHEN $person THEN $now END,
  agreed_by = CASE WHEN $person THEN $from END`;

const setOfWrite = {
  edit: `${viewerSql.edit.set}${newTextAgreement}`,
  note: `${viewerSql.note.set}${newTextAgreement}`,
  answer: `${viewerSql.answer.set}${newTextAgreement}`,
  accept: viewerSql.accept.set,
  reopen: `${viewerSql.reopen.set}${newTextAgreement}`,
  close: viewerSql.close.set,
} as const;

const missedChange = operation({
  label: "queue.missedChange",
  input: z.object({ kind: viewerWrite.shape.kind, row: request.nullable(), now: z.number() }),
  depends: { rowState },
  run: ({ rowState }, { input: { kind, row, now } }) => {
    if (row === null) return { kind: "gone" as const };
    if (kind === "reopen" && row.status === "resolved") return { kind: "full" as const };
    return { kind: "wrongState" as const, state: rowState.run({ input: { row, now } }) };
  },
});

const pickedOption = operation({
  label: "queue.pickedOption",
  input: z.object({ write: viewerWrite, asked: z.string().nullable() }),
  run: (_, { input: { write, asked } }) => {
    const choices = asked === null ? [] : z.array(z.string()).parse(JSON.parse(asked));
    const option = write.kind === "answer" ? write.option : null;
    return option !== null && option < choices.length ? option : null;
  },
});

export const changeRequest = operation({
  label: "queue.changeRequest",
  input: viewerWrite,
  depends: {
    connection: bunSqlite.connection,
    requestCells: requests.atScope.controller,
    messageCells: messages.atScope.controller,
    missedChange,
    pickedOption,
    bell: waitingBell,
  },
  run: async (deps, { input }) => {
    const { connection, requestCells, messageCells, missedChange, pickedOption, bell } = deps;
    const db = connection.db.$client;
    const at = { $canvas: input.canvas, $now: input.now, $n: input.n };

    const answer = db.transaction(() => {
      const sql = viewerSql[input.kind];
      const changed = db
        .query(
          `UPDATE queue_requests SET ${setOfWrite[input.kind]}, updated = $now
           WHERE canvas = $canvas AND n = $n AND (${sql.where})
           RETURNING ${requestColumns}`,
        )
        .get({
          ...at,
          $from: input.from,
          $person: Number(input.person),
        });
      if (changed === null) {
        const now = db
          .query(`SELECT ${requestColumns} FROM queue_requests WHERE canvas = $canvas AND n = $n`)
          .get(at);
        const row = request.nullable().parse(now);
        return missedChange.run({ input: { kind: input.kind, row, now: input.now } });
      }

      const row = request.parse(changed);
      const asked = z
        .object({ options: z.string().nullable() })
        .nullable()
        .parse(
          db
            .query(
              "SELECT options FROM queue_messages WHERE request = $request AND kind = 'question' ORDER BY created DESC, rowid DESC LIMIT 1",
            )
            .get({ $request: row.id }),
        );
      const option = pickedOption.run({ input: { write: input, asked: asked?.options ?? null } });
      const note = messageRow.parse(
        db.query(plainMessage).get({
          ...at,
          $id: input.message,
          $request: row.id,
          $kind: input.kind,
          $from: input.from,
          $text: input.text,
          $option: option,
        }),
      );
      return { kind: "done" as const, row, note };
    })();

    switch (answer.kind) {
      case "done":
        requestCells.set(answer.row);
        messageCells.set(answer.note);
        if (answer.row.status === "open") bell.ring();
        return { kind: "done" as const, row: answer.row };
      case "gone":
      case "full":
      case "wrongState":
        return answer;
    }
  },
});

const claimWrite = z.object({
  canvas: z.string().nullable(),
  n: z.number().nullable(),
  me: z.string(),
  digest: z.string(),
  until: z.number(),
  now: z.number(),
});

const claimedRow = request.extend({ claimVersion: z.number().nullable() });

export const claimRow = operation({
  label: "queue.claimRow",
  input: claimWrite,
  depends: { connection: bunSqlite.connection, agreementRule },
  run: async ({ connection, agreementRule }, { input }) => {
    const row = connection.db.$client.query(claimSql).get({
      $me: input.me,
      $digest: input.digest,
      $until: input.until,
      $now: input.now,
      $canvas: input.canvas,
      $n: input.n,
      $max: maxTries,
      $open: agreementRule ? 0 : 1,
    });
    return row === null ? null : claimedRow.parse(row);
  },
});

export const claimRequest = operation({
  label: "queue.claimRequest",
  input: claimWrite,
  depends: { claimRow, cells: requests.atScope.controller },
  run: async ({ claimRow, cells }, { input }) => {
    const claimed = await claimRow.run({ input });
    if (!claimed) return null;

    const { claimVersion, ...row } = claimed;
    cells.set(row);
    return { row, claimVersion };
  },
});

export const soonestEnd = operation({
  label: "queue.soonestEnd",
  input: z.object({ canvas: z.string().nullable(), n: z.number().nullable(), now: z.number() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    z.object({ until: z.number().nullable() }).parse(
      connection.db.$client
        .query(
          `SELECT MIN(claimed_until) AS until FROM queue_requests
             WHERE status = 'open' AND claimed_until > $now AND tries < $max
               AND ($canvas IS NULL OR canvas = $canvas) AND ($n IS NULL OR n = $n)`,
        )
        .get({ $now: input.now, $max: maxTries, $canvas: input.canvas, $n: input.n }),
    ).until,
});

const tryWrite = z.object({
  id: z.string(),
  digest: z.string(),
  from: z.string(),
  message: z.string(),
  now: z.number(),
});

const endWrite = z.discriminatedUnion("kind", [
  tryWrite.extend({ kind: z.literal("extend"), until: z.number() }),
  tryWrite.extend({ kind: z.literal("release"), reason: z.string() }),
  tryWrite.extend({ kind: z.literal("decline"), reason: z.string() }),
  tryWrite.extend({
    kind: z.literal("ask"),
    text: z.string(),
    html: z.string().nullable(),
    options: z.array(z.string()).nullable(),
  }),
  tryWrite.extend({ kind: z.literal("resolve"), text: z.string(), html: z.string().nullable() }),
]);

const endLease = "claimed_by = NULL, claimed_until = NULL, claimed_at = NULL, claim_digest = NULL";

const endSql = {
  extend: "claimed_until = $until",
  release: `${endLease}, queued_at = $now`,
  decline: `status = 'person', ${endLease}`,
  ask: `status = 'asking', ${endLease}`,
  resolve: `status = 'resolved', ${endLease}`,
} as const;

const missedTry = operation({
  label: "queue.missedTry",
  input: z.object({ row: request.nullable(), now: z.number() }),
  depends: { rowState },
  run: ({ rowState }, { input: { row, now } }) => {
    if (row === null) return { kind: "gone" as const };
    if (row.status === "open") return { kind: "lost" as const };
    return { kind: "wrongState" as const, state: rowState.run({ input: { row, now } }) };
  },
});

const tryMessage = operation({
  label: "queue.tryMessage",
  input: z.object({
    write: endWrite,
    claimVersion: z.number().nullable(),
    current: z.number().nullable(),
    claimKit: z.number().nullable(),
    kitNow: z.number().nullable(),
  }),
  run: (_, { input: { write, claimVersion, current, claimKit, kitNow } }) => {
    const none = { html: null, options: null, before: null, after: null };
    const noKits = { beforeKit: null, afterKit: null };
    switch (write.kind) {
      case "extend":
        return null;
      case "release":
      case "decline":
        return { kind: write.kind, ...none, ...noKits, text: write.reason };
      case "ask":
        return {
          ...none,
          ...noKits,
          kind: "question" as const,
          text: write.text,
          html: write.html,
          options: write.options,
        };
      case "resolve":
        return {
          ...none,
          kind: "result" as const,
          text: write.text,
          html: write.html,
          before: claimVersion,
          after: current,
          beforeKit: claimKit,
          afterKit: kitNow,
        };
    }
  },
});

const heldRow = request.extend({
  claimVersion: z.number().nullable(),
  current: z.number().nullable(),
  claimKit: z.number().nullable(),
  kitNow: z.number().nullable(),
});

export const endTry = operation({
  label: "queue.endTry",
  input: endWrite,
  depends: {
    connection: bunSqlite.connection,
    requestCells: requests.atScope.controller,
    messageCells: messages.atScope.controller,
    missedTry,
    tryMessage,
    bell: waitingBell,
  },
  run: async (
    { connection, requestCells, messageCells, missedTry, tryMessage, bell },
    { input },
  ) => {
    const db = connection.db.$client;

    const answer = db.transaction(() => {
      const changed = db
        .query(
          `UPDATE queue_requests SET ${endSql[input.kind]}, updated = $now
           WHERE id = $id AND status = 'open' AND claim_digest = $digest AND claimed_until > $now
           RETURNING ${requestColumns}, claim_version AS claimVersion,
             (SELECT f.version FROM frames_frames f
               WHERE f.canvas = queue_requests.canvas AND f.id = queue_requests.frame_id) AS current,
             COALESCE(claim_kit, 1) AS claimKit, (SELECT MAX(version) FROM kit_versions) AS kitNow`,
        )
        .get({
          $id: input.id,
          $digest: input.digest,
          $now: input.now,
          $until: input.kind === "extend" ? input.until : null,
        });
      if (changed === null) {
        const now = db
          .query(`SELECT ${requestColumns} FROM queue_requests WHERE id = $id`)
          .get({ $id: input.id });
        return missedTry.run({ input: { row: request.nullable().parse(now), now: input.now } });
      }

      const { claimVersion, current, claimKit, kitNow, ...row } = heldRow.parse(changed);
      const fields = tryMessage.run({
        input: { write: input, claimVersion, current, claimKit, kitNow },
      });
      const note =
        fields &&
        messageRow.parse(
          db
            .query(
              `INSERT INTO queue_messages (id, canvas, request, kind, sender, text, html, options,
                 before_v, after_v, before_kit, after_kit, created)
               VALUES ($id, $canvas, $request, $kind, $from, $text, $html, $options, $before, $after,
                 $beforeKit, $afterKit, $now)
               RETURNING ${messageColumns}`,
            )
            .get({
              $id: input.message,
              $canvas: row.canvas,
              $request: row.id,
              $kind: fields.kind,
              $from: input.from,
              $text: fields.text,
              $html: fields.html,
              $options: fields.options && JSON.stringify(fields.options),
              $before: fields.before,
              $after: fields.after,
              $beforeKit: fields.beforeKit,
              $afterKit: fields.afterKit,
              $now: input.now,
            }),
        );
      return { kind: "done" as const, row, note };
    })();
    if (answer.kind !== "done") return answer;

    requestCells.set(answer.row);
    if (answer.note) messageCells.set(answer.note);
    if (input.kind === "release") bell.ring();
    return { kind: "done" as const, row: answer.row };
  },
});

export const readClaimed = operation({
  label: "queue.readClaimed",
  input: z.object({ row: request, claimVersion: z.number().nullable() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input: { row } }) => {
    const db = connection.db.$client;
    const thread = db
      .query(
        `SELECT ${messageColumns} FROM queue_messages WHERE request = $id ORDER BY created, rowid`,
      )
      .all({ $id: row.id })
      .map((m) => messageRow.parse(m));
    const box = z.object({
      id: z.string(),
      name: z.string(),
      page: z.string(),
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      version: z.number(),
    });

    if (row.frameId === null) {
      const frames = db
        .query(
          "SELECT id, name, page, x, y, w, h, version FROM frames_frames WHERE canvas = $canvas AND page = $page ORDER BY made, rowid",
        )
        .all({ $canvas: row.canvas, $page: row.page })
        .map((f) => box.parse(f));
      return { messages: thread, frame: null, saw: null, frames };
    }

    const frame = box
      .extend({ html: z.string(), status: frameStatus })
      .nullable()
      .parse(
        db
          .query(
            "SELECT id, name, page, x, y, w, h, version, status, html FROM frames_frames WHERE canvas = $canvas AND id = $id",
          )
          .get({ $canvas: row.canvas, $id: row.frameId }),
      );
    const kept = z
      .object({ html: z.string() })
      .nullable()
      .parse(
        db
          .query(
            "SELECT html FROM frames_kept WHERE canvas = $canvas AND id = $id AND version = $version",
          )
          .get({ $canvas: row.canvas, $id: row.frameId, $version: row.version }),
      );
    const doc = frame && frame.version === row.version ? frame.html : (kept?.html ?? null);
    const saw =
      row.version !== null && doc !== null ? { version: row.version, kit: row.kit, doc } : null;
    return { messages: thread, frame, saw, frames: null };
  },
});

export const notesSinceClaim = operation({
  label: "queue.notesSinceClaim",
  input: z.object({ request: z.string(), since: z.number() }),
  depends: { connection: bunSqlite.connection, agreementRule },
  run: async ({ connection, agreementRule }, { input }) =>
    connection.db.$client
      .query(
        `SELECT ${messageColumns} FROM queue_messages
         WHERE request = $request AND kind = 'note' AND created >= $since
           AND ($open = 1 OR created <= (SELECT COALESCE(agreed_at, -1) FROM queue_requests
             WHERE id = $request))
         ORDER BY created, rowid`,
      )
      .all({ $request: input.request, $since: input.since, $open: agreementRule ? 0 : 1 })
      .map((m) => messageRow.parse(m)),
});

export const seenView = operation({
  label: "queue.seenView",
  input: z.object({ canvas: z.string(), id: z.string(), version: z.number(), kit: z.number() }),
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) =>
    z.object({ seen: z.number() }).parse(
      connection.db.$client
        .query(
          `SELECT EXISTS (SELECT 1 FROM queue_requests r
               WHERE r.canvas = $canvas AND r.frame_id = $id
                 AND ((r.version = $version AND COALESCE(r.kit, 1) = $kit)
                   OR (r.claim_version = $version AND COALESCE(r.claim_kit, 1) = $kit)))
             OR EXISTS (SELECT 1 FROM queue_messages m JOIN queue_requests r ON r.id = m.request
               WHERE r.canvas = $canvas AND r.frame_id = $id AND m.kind = 'result'
                 AND ((m.before_v = $version AND COALESCE(m.before_kit, 1) = $kit)
                   OR (m.after_v = $version AND COALESCE(m.after_kit, 1) = $kit))) AS seen`,
        )
        .get({ $canvas: input.canvas, $id: input.id, $version: input.version, $kit: input.kit }),
    ).seen === 1,
});

const firstPageOfOldAsks = `UPDATE queue_requests SET page = (SELECT p.key FROM frames_pages p
  WHERE p.canvas = queue_requests.canvas ORDER BY p.ord, p.rowid LIMIT 1)
  WHERE frame_id IS NULL AND page IS NULL`;

const agreeOldRequests = operation({
  label: "queue.agreeOldRequests",
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }) => {
    const db = connection.db.$client;
    const columns = db.query("PRAGMA table_info(queue_requests)").all();
    if (columns.some((c) => z.object({ name: z.literal("agreed_at") }).safeParse(c).success)) {
      return;
    }

    db.transaction(() => {
      db.exec("ALTER TABLE queue_requests ADD COLUMN agreed_at INTEGER");
      db.exec("ALTER TABLE queue_requests ADD COLUMN agreed_by TEXT");
      db.exec("UPDATE queue_requests SET agreed_at = created, agreed_by = author");
    })();
  },
});

const load = operation({
  label: "queue.load",
  depends: {
    agreeOldRequests,
    connection: bunSqlite.connection,
    requestCells: requests.atScope.controller,
    messageCells: messages.atScope.controller,
    out: stdout,
  },
  run: async ({ agreeOldRequests, connection, requestCells, messageCells, out }) => {
    const db = connection.db.$client;
    db.exec(schema);
    for (const [table, column] of addedColumns) {
      const columns = db.query(`PRAGMA table_info(${table})`).all();
      if (!columns.some((c) => z.object({ name: z.literal(column) }).safeParse(c).success)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER`);
      }
    }
    const requestColumnsNow = db.query("PRAGMA table_info(queue_requests)").all();
    if (
      !requestColumnsNow.some((c) => z.object({ name: z.literal("page") }).safeParse(c).success)
    ) {
      db.exec("ALTER TABLE queue_requests ADD COLUMN page TEXT");
    }
    db.exec(firstPageOfOldAsks);
    await agreeOldRequests.run();

    const requestRows = db.query(`SELECT ${requestColumns} FROM queue_requests`).all();
    const messageRows = db
      .query(`SELECT ${messageColumns} FROM queue_messages ORDER BY created, rowid`)
      .all();
    const good = requestRows.flatMap((row) => request.safeParse(row).data ?? []);
    const goodMessages = messageRows.flatMap((row) => messageRow.safeParse(row).data ?? []);
    const bad = requestRows.length + messageRows.length - good.length - goodMessages.length;
    if (bad) out?.write(`queue: skipped ${bad} rows that do not parse\n`);

    for (const row of good) requestCells.set(row);
    for (const row of goodMessages) messageCells.set(row);
  },
});

export const queueServer = capsule({
  label: "queueServer",
  config: { stdout, perPass, perAddress },
  hooks: {
    async start({ run, next }) {
      await run(load, {}, { role: "setup", explain: "Reads the requests and their messages" });
      await next();
    },
  },
});
