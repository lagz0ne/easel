import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { message, messages, request, requests } from "./cells";
import { maxOpen } from "./contract";

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
