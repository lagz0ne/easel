import { bunSqlite } from "@tinkered/bun/sqlite";
import { capsule, operation, resource } from "@tinkered/core";
import { z } from "zod";

import { browserCodes, logins, users } from "@/access/store.server";
import { canvasInfo, frames, pages } from "@/frames/contract";
import { canvases } from "@/frames/store.server";
import { request, requests } from "@/queue/cells";
import { forAViewer, shownState } from "@/viewer/follow";

import { homeRows, waitingCodes } from "./contract";
import type { WaitingCode } from "./contract";

const schema =
  "CREATE TABLE IF NOT EXISTS home_changed (canvas TEXT PRIMARY KEY NOT NULL, changed INTEGER NOT NULL)";

const firstChanges = `SELECT c.key AS canvas, MAX(
    c.created,
    COALESCE((SELECT MAX(made) FROM frames_frames f WHERE f.canvas = c.key), 0),
    COALESCE((SELECT MAX(removed) FROM frames_removed r WHERE r.canvas = c.key), 0),
    COALESCE((SELECT MAX(updated) FROM queue_requests q WHERE q.canvas = c.key), 0),
    COALESCE((SELECT changed FROM home_changed h WHERE h.canvas = c.key), 0)
  ) AS changed FROM frames_canvases c`;

const keepChange = `INSERT INTO home_changed (canvas, changed) VALUES (?, ?)
  ON CONFLICT (canvas) DO UPDATE SET changed = excluded.changed`;

const changedRow = z.object({ canvas: z.string(), changed: z.number() });

export const hourMs = 60 * 60_000;

export const inboxOf = operation({
  label: "home.inboxOf",
  input: z.object({ requests: z.array(request).readonly(), now: z.number() }),
  depends: { shownState },
  run: ({ shownState }, { input: { requests, now } }) =>
    requests.filter((r) =>
      forAViewer.includes(shownState.run({ input: { request: r, closer: null, now } })),
    ).length,
});

const signOf = operation({
  label: "home.signOf",
  input: z.string(),
  depends: {
    frames: frames.atScope.controller,
    pages: pages.atScope.controller,
    requests: requests.atScope.controller,
  },
  run: ({ frames, pages, requests }, { input: canvas }) =>
    [
      ...frames
        .where({ canvas })
        .get()
        .map((f) => `f ${f.id} ${f.version} ${f.name} ${f.page} ${f.x} ${f.y} ${f.w} ${f.h}`),
      ...pages
        .where({ canvas })
        .get()
        .map((p) => `p ${p.key} ${p.name} ${p.order}`),
      ...requests
        .where({ canvas })
        .get()
        .map((r) => `r ${r.id} ${r.updated}`),
    ].join("\n"),
});

const showRow = operation({
  label: "home.showRow",
  input: z.object({ canvas: canvasInfo, changed: z.number(), now: z.number() }),
  depends: {
    frames: frames.atScope.controller,
    pages: pages.atScope.controller,
    requests: requests.atScope.controller,
    rows: homeRows.atScope.controller,
    inboxOf,
  },
  run: (deps, { input: { canvas, changed, now } }) => {
    const { frames, pages, requests, rows, inboxOf } = deps;
    const row = {
      canvas: canvas.key,
      name: canvas.name,
      frames: frames.where({ canvas: canvas.key }).get().length,
      pages: pages.where({ canvas: canvas.key }).get().length,
      changed,
      inbox: inboxOf.run({
        input: { requests: requests.where({ canvas: canvas.key }).get(), now },
      }),
    };

    const held = rows.of({ canvas: canvas.key }).get();
    if (JSON.stringify(held) !== JSON.stringify(row)) rows.set(row);
  },
});

const dropGone = operation({
  label: "home.dropGone",
  depends: { canvases: canvases.atScope.controller, rows: homeRows.atScope.controller },
  run: ({ canvases, rows }) => {
    const live = new Set(canvases.get().map((c) => c.key));
    for (const row of rows.get()) {
      if (!live.has(row.canvas)) rows.delete({ canvas: row.canvas });
    }
  },
});

export const homeFeed = resource({
  label: "home.feed",
  target: "scope",
  depends: {
    connection: bunSqlite.connection,
    canvases: canvases.atScope.controller,
    frames: frames.atScope.controller,
    pages: pages.atScope.controller,
    requests: requests.atScope.controller,
    signOf,
    showRow,
    dropGone,
  },
  factory: async (deps, ctx) => {
    const { connection, canvases, signOf, showRow, dropGone } = deps;
    const db = connection.db.$client;
    db.exec(schema);
    const changed = new Map(
      db
        .query(firstChanges)
        .all()
        .flatMap((row) => changedRow.safeParse(row).data ?? [])
        .map((row) => [row.canvas, row.changed]),
    );
    const signs = new Map<string, string>();

    const queued = { now: false };
    const refresh = () => {
      queued.now = false;
      const now = ctx.clock.currentTimeMillis();
      for (const canvas of canvases.get()) {
        const sign = signOf.run({ input: canvas.key });
        const before = signs.get(canvas.key);
        signs.set(canvas.key, sign);
        if (before !== undefined && before !== sign) {
          changed.set(canvas.key, now);
          db.query(keepChange).run(canvas.key, now);
        }

        const at = changed.get(canvas.key) ?? canvas.created;
        showRow.run({ input: { canvas, changed: at, now } });
      }
      dropGone.run();
    };

    const soon = () => {
      if (queued.now) return;

      queued.now = true;
      queueMicrotask(refresh);
    };

    const hourly = () => {
      if (ctx.closing.aborted) return;

      soon();
      ctx.clock.sleep(hourMs, ctx.closing).then(hourly, () => undefined);
    };

    const ends = [deps.canvases, deps.frames, deps.pages, deps.requests].map((cell) =>
      cell.watch(soon),
    );
    ctx.defer(() => ends.forEach((end) => end()));
    queueMicrotask(hourly);

    return { watching: true };
  },
});

const codesNow = operation({
  label: "home.codesNow",
  input: z.number(),
  depends: {
    logins: logins.atScope.controller,
    codes: browserCodes.atScope.controller,
    users: users.atScope.controller,
  },
  run: ({ logins, codes, users }, { input: now }): WaitingCode[] =>
    [
      ...logins.get().map((row) => ({ ...row, browser: false })),
      ...codes.get().map((row) => ({ ...row, browser: true })),
    ]
      .filter((row) => row.state === "pending" && row.expiresAt > now)
      .map(({ code, name, since, expiresAt, browser }) => ({
        code,
        name,
        since,
        expiresAt,
        browser,
        user: users.of({ name }).get() !== undefined,
      })),
});

const showCodes = operation({
  label: "home.showCodes",
  input: z.array(z.custom<WaitingCode>()),
  depends: { shown: waitingCodes.atScope.controller },
  run: ({ shown }, { input: now }) => {
    const live = new Set(now.map((row) => row.code));
    for (const row of shown.get()) {
      if (!live.has(row.code)) shown.delete({ code: row.code });
    }

    for (const row of now) {
      if (!shown.of({ code: row.code }).get()) shown.set(row);
    }
  },
});

export const codesFeed = resource({
  label: "home.codesFeed",
  target: "scope",
  depends: {
    logins: logins.atScope.controller,
    codes: browserCodes.atScope.controller,
    codesNow,
    showCodes,
  },
  factory: ({ logins, codes, codesNow, showCodes }, ctx) => {
    const wake = { stop: new AbortController() };

    const refresh = () => {
      const now = ctx.clock.currentTimeMillis();
      const live = codesNow.run({ input: now });
      showCodes.run({ input: live });

      wake.stop.abort();
      wake.stop = new AbortController();
      const next = Math.min(...live.map((row) => row.expiresAt));
      if (!Number.isFinite(next) || ctx.closing.aborted) return;

      const signal = AbortSignal.any([wake.stop.signal, ctx.closing]);
      ctx.clock.sleep(next - now, signal).then(
        () => queueMicrotask(refresh),
        () => undefined,
      );
    };

    const ends = [
      logins.watch(() => queueMicrotask(refresh)),
      codes.watch(() => queueMicrotask(refresh)),
    ];
    ctx.defer(() => (wake.stop.abort(), ends.forEach((end) => end())));
    queueMicrotask(refresh);

    return { watching: true };
  },
});

export const homeServer = capsule({
  label: "homeServer",
  hooks: {
    async start({ load, next }) {
      await load(homeFeed, { role: "state", explain: "Lists each canvas with its inbox" });
      await load(codesFeed, { role: "state", explain: "Lists the codes that wait" });
      await next();
    },
  },
});
