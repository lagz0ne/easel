import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { message, messages, request, requests } from "./cells";
import { maxOpen, maxTries, stateOf } from "./contract";

// The queue's state: requests and their messages in the app's one SQLite file, so they survive a
// restart. Each write is one SQLite transaction with no `await` in it: its conditional write is
// one statement, and its message goes in with it (judged rules 6, 9, 10). The cells are set after
// the commit, from the rows as stored. Only `saveRequest`, `claimRequest` and `endTry` write
// (fact rule 4). Nothing stored says "in work" or "needs a person": they come from `status`,
// `claimedUntil`, `tries` and the time (judged rule 7, `stateOf`).
//
// The claim keeps the digest of its handle, and the frame version at the claim (`claim_version`,
// the `before` of a result). Two triggers keep each frame version that a request or a message
// refers to (SPEC-frames judged rule 16): a put that replaces it, or a delete of its frame, saves
// the old document in `frames_kept` first, in the same statement.

/**
 * True in SQL, in a trigger on `frames_frames`, when a request or a message refers to the version
 * of the `OLD` row: the version the viewer saw, the version at a claim, or the `before` or
 * `after` of a result.
 */
const referred = `(EXISTS (SELECT 1 FROM queue_requests r WHERE r.canvas = OLD.canvas AND r.frame_id = OLD.id
    AND OLD.version IN (r.version, r.claim_version))
  OR EXISTS (SELECT 1 FROM queue_messages m JOIN queue_requests r ON r.id = m.request
    WHERE r.canvas = OLD.canvas AND r.frame_id = OLD.id AND OLD.version IN (m.before_v, m.after_v)))`;

/** The tables, the index of the queue order, and the triggers, made at start, after frames'. */
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
  claim_digest TEXT,
  claim_version INTEGER,
  tries INTEGER NOT NULL,
  queued_at INTEGER NOT NULL,
  accepted_by TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
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
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS queue_messages_request ON queue_messages (request, created);
CREATE TRIGGER IF NOT EXISTS queue_keep_put BEFORE UPDATE OF html ON frames_frames
WHEN ${referred}
BEGIN
  INSERT OR IGNORE INTO frames_kept (canvas, id, version, html)
  VALUES (OLD.canvas, OLD.id, OLD.version, OLD.html);
END;
CREATE TRIGGER IF NOT EXISTS queue_keep_drop BEFORE DELETE ON frames_frames
WHEN ${referred}
BEGIN
  INSERT OR IGNORE INTO frames_kept (canvas, id, version, html)
  VALUES (OLD.canvas, OLD.id, OLD.version, OLD.html);
END;`;

/** A request's columns, as the board names them. */
const requestColumns = `canvas, id, n, frame_id AS frameId, version, x, y, author, key, status,
  claimed_by AS claimedBy, claimed_until AS claimedUntil, tries, queued_at AS queuedAt,
  accepted_by AS acceptedBy, created, updated`;

/** A message's columns, as the board names them. */
const messageColumns = `canvas, id, request, kind, sender AS "from", text, html, options,
  pick AS option, before_v AS before, after_v AS after, created`;

/** A message's row: its options are kept as JSON. */
const messageRow = message.extend({
  options: z
    .string()
    .nullable()
    .transform((kept) => (kept === null ? null : z.array(z.string()).parse(JSON.parse(kept)))),
});

/** A request, waiting at `$now`, in the scope `$canvas` and `$n` (each `null`: any). */
const waitingIn = `status = 'open' AND (claimed_until IS NULL OR claimed_until <= $now)
  AND tries < $max AND ($canvas IS NULL OR canvas = $canvas) AND ($n IS NULL OR n = $n)`;

/**
 * The claim, one statement (judged rule 6, SQS's visibility timeout; a job queue's
 * `UPDATE … WHERE id = (SELECT …) RETURNING`): it finds the first waiting request in queue order
 * and writes its claim. SQLite runs one statement alone, so nothing comes between the find and
 * the write. `tries` goes up by one (judged rule 11); `claim_version` is the frame's version now.
 */
export const claimSql = `UPDATE queue_requests SET claimed_by = $me, claimed_until = $until,
  claim_digest = $digest, tries = tries + 1, updated = $now,
  claim_version = (SELECT f.version FROM frames_frames f
    WHERE f.canvas = queue_requests.canvas AND f.id = queue_requests.frame_id)
WHERE id = (SELECT id FROM queue_requests WHERE ${waitingIn}
  ORDER BY queued_at, canvas, n LIMIT 1)
RETURNING ${requestColumns}, claim_version AS claimVersion`;

/** The time of the store's writes, and its log of rows it skipped at start. */
const stdout = tag<{ write(chunk: string): unknown } | null>({
  label: "queue.stdout",
  default: null,
});

/**
 * Rings when a request becomes waiting: an add, an edit, an answer, a reopen or a release. A
 * `request.next` that waits listens, and tries again when it rings (judged rule 12). It is also
 * where a dispatcher will hear of each new waiting period. A lease that runs out rings nothing:
 * the one that waits wakes at the earliest `claimedUntil` by itself.
 */
export const waitingBell = resource({
  label: "queue.waitingBell",
  target: "scope",
  factory: () => {
    const ears = new Set<AbortController>();

    return {
      /** A signal that aborts at the next ring. Call `done` when it is no longer needed. */
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

/** The state of a row now, for a `wrongState` answer. */
const rowState = operation({
  label: "queue.rowState",
  input: z.object({ row: request, now: z.number() }),
  depends: { stateOf },
  run: ({ stateOf }, { input }) => stateOf.run({ input: { request: input.row, now: input.now } }),
});

/** `request.add`'s first look (the viewer-pin-post chart): the `n` of a key seen on the canvas. */
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

/** A new request: where, what, from whom, and the ids of the request and its first message. */
const addWrite = z.object({
  canvas: z.string(),
  id: z.string(),
  frameId: z.string().nullable(),
  version: z.number().nullable(),
  x: z.number(),
  y: z.number(),
  text: z.string(),
  key: z.string(),
  author: z.string(),
  message: z.string(),
  now: z.number(),
});

/** The count of a canvas's requests that are not resolved and not closed (judged rule 14). */
const openCount =
  "SELECT COUNT(*) AS open FROM queue_requests WHERE canvas = $canvas AND status IN ('open', 'asking', 'person')";

/** A message as a viewer's call or a new request adds it: no HTML part, no versions. */
const plainMessage = `INSERT INTO queue_messages (id, canvas, request, kind, sender, text, pick, created)
  VALUES ($id, $canvas, $request, $kind, $from, $text, $option, $now)
  RETURNING ${messageColumns}`;

/**
 * `request.add`'s write, with its first message, the `ask`, in one transaction (judged rules 2,
 * 5, 13). A key seen on the canvas answers `added` with its `n`, and writes nothing; a frame or a
 * canvas that is not there answers `gone`; 200 open answers `full`. Else `n` is one more than the
 * highest of the canvas, in the insert's own statement, so two at once never share one. A new
 * request is `open`, with no claim and no tries, at the back of the queue.
 */
export const saveRequest = operation({
  label: "queue.saveRequest",
  input: addWrite,
  depends: {
    connection: bunSqlite.connection,
    requestCells: requests.atScope.controller,
    messageCells: messages.atScope.controller,
    bell: waitingBell,
  },
  run: async ({ connection, requestCells, messageCells, bell }, { input }) => {
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

      const there =
        input.frameId === null
          ? db.query("SELECT 1 FROM frames_canvases WHERE key = $canvas").get(at)
          : db
              .query("SELECT 1 FROM frames_frames WHERE canvas = $canvas AND id = $id")
              .get({ ...at, $id: input.frameId });
      if (!there) return { kind: "gone" as const };
      const open = z.object({ open: z.number() }).parse(db.query(openCount).get(at)).open;
      if (open >= maxOpen) return { kind: "full" as const };

      const row = request.parse(
        db
          .query(
            `INSERT INTO queue_requests (id, canvas, n, frame_id, version, x, y, author, key, status,
               tries, queued_at, created, updated)
             SELECT $id, $canvas, COALESCE(MAX(n), 0) + 1, $frame, $version, $x, $y, $author, $key,
               'open', 0, $now, $now, $now
             FROM queue_requests WHERE canvas = $canvas
             RETURNING ${requestColumns}`,
          )
          .get({
            ...at,
            $id: input.id,
            $frame: input.frameId,
            $version: input.version,
            $x: input.x,
            $y: input.y,
            $author: input.author,
            $key: input.key,
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
        return answer;
    }
  },
});

/** A viewer's call on a request: which, by whom, its text, and the new message's id. */
const viewerWrite = z.object({
  kind: z.enum(["edit", "answer", "accept", "reopen", "close"]),
  canvas: z.string(),
  n: z.number(),
  from: z.string(),
  text: z.string().nullable(),
  option: z.number().nullable(),
  message: z.string(),
  now: z.number(),
});

/**
 * Each viewer's call, as one conditional write on `status` and the lease (judged rule 9): where
 * it may run, and what it sets. `$now` is the time; `$from` the sender.
 */
const viewerSql = {
  // Waiting, or needs a person: open, no tries, at the back of the queue.
  edit: {
    set: `status = 'open', tries = 0, queued_at = $now, claimed_by = NULL, claimed_until = NULL,
      claim_digest = NULL`,
    where: `(status = 'open' AND (claimed_until IS NULL OR claimed_until <= $now)) OR status = 'person'`,
  },
  // A question: open, no tries, in its first place (E4.2 M19).
  answer: { set: "status = 'open', tries = 0", where: "status = 'asking'" },
  accept: { set: "accepted_by = $from", where: "status = 'resolved' AND accepted_by IS NULL" },
  // A result: open, no tries, at the back of the queue; past 200 open, `full` (judged rule 14).
  reopen: {
    set: "status = 'open', tries = 0, accepted_by = NULL, queued_at = $now",
    where: `status = 'resolved' AND (${openCount}) < ${maxOpen}`,
  },
  // Also in work: the close ends the lease, so the holder's next call answers wrongState.
  close: {
    set: "status = 'closed', claimed_by = NULL, claimed_until = NULL, claim_digest = NULL",
    where: "status IN ('open', 'asking', 'person')",
  },
} as const;

/**
 * Why a viewer's call changed no row: no request is `gone`; a reopen of a result on a canvas with
 * 200 open is `full`; else `wrongState` with the state now.
 */
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

/** An answer's option, when it is an index into the options of the question (JSON); else null. */
const pickedOption = operation({
  label: "queue.pickedOption",
  input: z.object({ write: viewerWrite, asked: z.string().nullable() }),
  run: (_, { input: { write, asked } }) => {
    const choices = asked === null ? [] : z.array(z.string()).parse(JSON.parse(asked));
    const option = write.kind === "answer" ? write.option : null;
    return option !== null && option < choices.length ? option : null;
  },
});

/**
 * A viewer's call, with its message, in one transaction: one conditional update (judged rule 9).
 * When it changes no row, the same transaction answers `gone` with no request, `full` for a
 * reopen of a result on a canvas with 200 open, else `wrongState` with the state now. A refusal
 * writes nothing (judged rule 1). An answer's option counts only as an index into the options of
 * the question it answers.
 */
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
          `UPDATE queue_requests SET ${sql.set}, updated = $now
           WHERE canvas = $canvas AND n = $n AND (${sql.where})
           RETURNING ${requestColumns}`,
        )
        .get({ ...at, $from: input.from });
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
        return { kind: "done" as const };
      case "gone":
      case "full":
      case "wrongState":
        return answer;
    }
  },
});

/** A claim's write: who, the digest of its handle, its lease, and the scope it takes from. */
const claimWrite = z.object({
  canvas: z.string().nullable(),
  n: z.number().nullable(),
  me: z.string(),
  digest: z.string(),
  until: z.number(),
  now: z.number(),
});

/** The claimed row, with the frame version at the claim. */
const claimedRow = request.extend({ claimVersion: z.number().nullable() });

/**
 * The store write of a claim: `claimSql`, one statement. Null when no request in the scope is
 * waiting. Nothing awaits inside it: a test double of it may await before it runs, to force the
 * race of two claims (the success criteria).
 */
export const claimRow = operation({
  label: "queue.claimRow",
  input: claimWrite,
  depends: { connection: bunSqlite.connection },
  run: async ({ connection }, { input }) => {
    const row = connection.db.$client.query(claimSql).get({
      $me: input.me,
      $digest: input.digest,
      $until: input.until,
      $now: input.now,
      $canvas: input.canvas,
      $n: input.n,
      $max: maxTries,
    });
    return row === null ? null : claimedRow.parse(row);
  },
});

/** `request.next`'s claim: the one-statement write, then the cell, from the row it returned. */
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

/**
 * The earliest `claimedUntil` ahead of `now` of a request in the scope that is waiting once it
 * passes (not at 3 tries): when a `request.next` that waits must look again (judged rule 12).
 */
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

/** What the holder of a claim does: one of the calls of an agent after `request.next`. */
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

/** The lease ends: no holder, no time, no handle. */
const endLease = "claimed_by = NULL, claimed_until = NULL, claim_digest = NULL";

/** What each call of the holder sets (judged rules 10, 11): `tries` stays as it is. */
const endSql = {
  extend: "claimed_until = $until",
  // Waiting again at once, at the back of the queue. The try counts.
  release: `${endLease}, queued_at = $now`,
  decline: `status = 'person', ${endLease}`,
  ask: `status = 'asking', ${endLease}`,
  resolve: `status = 'resolved', ${endLease}`,
} as const;

/**
 * Why a call of a holder changed no row, in the order of judged rule 8: no request is `gone`; a
 * `status` that is not `open` is `wrongState` with the state now; else `lost` (another handle, or
 * a lease that ran out, also when no agent took the request since).
 */
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

/** The message of a call of the holder; null for an extend, which adds none. */
const tryMessage = operation({
  label: "queue.tryMessage",
  input: z.object({
    write: endWrite,
    claimVersion: z.number().nullable(),
    current: z.number().nullable(),
  }),
  run: (_, { input: { write, claimVersion, current } }) => {
    const none = { html: null, options: null, before: null, after: null };
    switch (write.kind) {
      case "extend":
        return null;
      case "release":
      case "decline":
        return { kind: write.kind, ...none, text: write.reason };
      case "ask":
        return {
          ...none,
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
        };
    }
  },
});

/** The row of a call of the holder, with the version at the claim and the frame's version now. */
const heldRow = request.extend({
  claimVersion: z.number().nullable(),
  current: z.number().nullable(),
});

/**
 * Each call of the holder of a claim, as one conditional write with its message (judged rules 8,
 * 10): the request must be `open`, hold this handle, and have a live lease. When it changes no
 * row, the same transaction reads the row and answers `gone`, `wrongState` or `lost`
 * (`missedTry`); a refusal writes nothing. A result's `before` is the version at the claim; its
 * `after` is the frame's version now.
 */
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
               WHERE f.canvas = queue_requests.canvas AND f.id = queue_requests.frame_id) AS current`,
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

      const { claimVersion, current, ...row } = heldRow.parse(changed);
      const fields = tryMessage.run({ input: { write: input, claimVersion, current } });
      const note =
        fields &&
        messageRow.parse(
          db
            .query(
              `INSERT INTO queue_messages (id, canvas, request, kind, sender, text, html, options,
                 before_v, after_v, created)
               VALUES ($id, $canvas, $request, $kind, $from, $text, $html, $options, $before, $after, $now)
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

/** What `request.next` gives with a claim: the thread, the frame now, and what the viewer saw. */
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
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      version: z.number(),
    });

    if (row.frameId === null) {
      const frames = db
        .query(
          "SELECT id, name, x, y, w, h, version FROM frames_frames WHERE canvas = $canvas ORDER BY made, rowid",
        )
        .all({ $canvas: row.canvas })
        .map((f) => box.parse(f));
      return { messages: thread, frame: null, saw: null, frames };
    }

    const frame = box
      .extend({ html: z.string() })
      .nullable()
      .parse(
        db
          .query(
            "SELECT id, name, x, y, w, h, version, html FROM frames_frames WHERE canvas = $canvas AND id = $id",
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
    const saw = row.version !== null && doc !== null ? { version: row.version, doc } : null;
    return { messages: thread, frame, saw, frames: null };
  },
});

/** At start: the tables and triggers, then the cells from the rows it read, and only from them. */
const load = operation({
  label: "queue.load",
  depends: {
    connection: bunSqlite.connection,
    requestCells: requests.atScope.controller,
    messageCells: messages.atScope.controller,
    out: stdout,
  },
  run: async ({ connection, requestCells, messageCells, out }) => {
    const db = connection.db.$client;
    db.exec(schema);

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

/** The server side of the queue, filled by the cmd. Install it after `framesServer`. */
export const queueServer = capsule({
  label: "queueServer",
  config: { stdout },
  hooks: {
    async start({ run, next }) {
      await run(load, {}, { role: "setup", explain: "Reads the requests and their messages" });
      await next();
    },
  },
});
