import { data, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { message, request } from "@/queue/cells";
import type { Message, Request } from "@/queue/cells";
import { stateOf } from "@/queue/contract";

// A viewer follows the requests of a canvas (SPEC-viewer.md § Follow the requests; the
// viewer-queue chart). The board stores no "in work" and no "needs a person": the page derives
// each state from the board and its estimate of the server's time (fact rule 10). The clock
// capsule keeps that estimate: the tab's clock plus the offset that the board's `serverClock`
// gives. It wakes at the next end of a lease, so a lease that runs out shows with no write (fact
// rule 9). This browser keeps, in `localStorage` only, the time of the last visit and the
// `updated` of each request when the viewer last opened it: a request changed after both shows
// the mark `Changed since your last visit` (judged rule 11).

const canvasOf = tag<string>({ label: "viewer.followCanvas" });

/** The state a viewer sees: the queue's state, and "taken back", a close by the author. */
export const shownStates = [
  "waiting",
  "inWork",
  "question",
  "result",
  "person",
  "accepted",
  "closed",
  "takenBack",
] as const;

export type Shown = (typeof shownStates)[number];

/** The states that wait for a viewer: the group `Waits for you`, and the count on `Requests`. */
export const forAViewer: readonly Shown[] = ["question", "result", "person"];

/** The states of the list `Done`. */
export const doneStates: readonly Shown[] = ["accepted", "closed", "takenBack"];

/** A request as the panel, its pin and its popover show it. */
export type RequestView = {
  r: Request;
  shown: Shown;
  /** The text of the request now: its last correction, or its ask. */
  text: string;
  /** Its messages, oldest first. */
  thread: readonly Message[];
  /** It changed since the last visit, and since this browser last opened it. */
  changed: boolean;
};

/** The tab's estimate of the server's time, in ms; null until the board's clock is read. */
export const serverTime = data<number | null>({ label: "viewer.serverTime", initial: null });

/**
 * This browser's last visit to the shown canvas (`since`, server time) and, for each request it
 * opened, its `updated` at that time. Read from `localStorage` when the canvas opens.
 */
export const visits = data<{
  canvas: string;
  since: number;
  opened: Readonly<Record<string, number>>;
} | null>({ label: "viewer.visits", initial: null });

/** Where this browser keeps the time of the last visit to a canvas: this, then the canvas. */
export const visitKey = "easel.visit.";

/** Where this browser keeps the `updated` of each request it opened on a canvas. */
export const openedKey = "easel.opened.";

const openedMap = z.record(z.string(), z.number());

/**
 * The canvas opens: the page reads the time of the last visit, then writes the time now (step
 * 17). A first visit has none: from now on, a change shows the mark.
 */
export const startVisit = operation({
  label: "viewer.startVisit",
  input: z.object({ canvas: z.string(), now: z.number() }),
  depends: { visits: visits.controller },
  run: ({ visits }, { input: { canvas, now } }) => {
    if (visits.get()?.canvas === canvas) return;

    const last = z.coerce.number().safeParse(localStorage.getItem(visitKey + canvas) ?? "");
    const kept = openedMap.safeParse(JSON.parse(localStorage.getItem(openedKey + canvas) ?? "{}"));
    localStorage.setItem(visitKey + canvas, String(now));
    visits.set({
      canvas,
      since: last.success && last.data > 0 ? last.data : now,
      opened: kept.success ? kept.data : {},
    });
  },
});

/** The viewer saw a request at its `updated`: its changed mark goes, here and in `localStorage`. */
export const markSeen = operation({
  label: "viewer.markSeen",
  input: z.object({ canvas: z.string(), id: z.string(), updated: z.number() }),
  depends: { visits: visits.controller },
  run: ({ visits }, { input: { canvas, id, updated } }) => {
    const now = visits.get();
    if (now?.canvas !== canvas || now.opened[id] === updated) return;

    const opened = { ...now.opened, [id]: updated };
    localStorage.setItem(openedKey + canvas, JSON.stringify(opened));
    visits.set({ ...now, opened });
  },
});

/** A wake each minute at most, so the ages stay right. */
export const tickMs = 60_000;

/** How long until the next lease of the canvas ends after `now`, or a minute. */
const nextWake = operation({
  label: "viewer.nextWake",
  input: z.object({ ends: z.array(z.number().nullable()), now: z.number() }),
  run: (_, { input: { ends, now } }) =>
    Math.min(tickMs, ...ends.flatMap((end) => (end !== null && end > now ? [end - now + 1] : []))),
});

/**
 * The tab's clock, for the keyed resources below: its time, and a sleep that ends with the scope.
 * In a test it is the test clock.
 */
export const tabClock = resource({
  label: "viewer.tabClock",
  target: "scope",
  factory: (_, ctx) => ({
    now: () => ctx.clock.currentTimeMillis(),
    sleep: (ms: number, stop: AbortSignal) =>
      ctx.clock.sleep(ms, AbortSignal.any([stop, ctx.signal])),
  }),
});

/**
 * The offset of the server's time from this tab's clock, from the board's `serverClock`: each
 * read of the board loads the server's time again. Null until it is read.
 */
export const clockOffset = resource({
  label: "viewer.clockOffset",
  config: { canvas: canvasOf.required },
  depends: (c) => ({ read: frames.board.serverClock.of({ canvas: c.canvas }), clock: tabClock }),
  factory: ({ read, clock }) => {
    const at = read.get();
    return at ? at.now - clock.now() : null;
  },
});

/**
 * The clock capsule for a canvas (fact rule 9): it writes `serverTime`, the tab's clock plus the
 * offset, now, at the end of each lease, and each minute. A new offset, or a new lease, sets it
 * again. It also starts the visit, once the server's time is known.
 */
export const clockTicker = resource({
  label: "viewer.clockTicker",
  config: { canvas: canvasOf.required },
  depends: (c) => ({
    offset: clockOffset({ canvas: c.canvas }),
    rows: frames.board.requests.where({ canvas: c.canvas }),
    time: serverTime.controller,
    clock: tabClock,
    nextWake,
    startVisit,
  }),
  factory: ({ offset: read, rows, time, clock, nextWake, startVisit }, ctx) => {
    const offset = read.get();
    if (offset === null) return false;

    const stop = new AbortController();
    ctx.defer(() => stop.abort());
    const tick = () => {
      if (stop.signal.aborted) return;

      const now = clock.now() + offset;
      time.set(now);
      startVisit.run({ input: { canvas: ctx.config.canvas, now } });
      const ends = rows.get().map((r) => (r.status === "open" ? r.claimedUntil : null));
      const wait = nextWake.run({ input: { ends, now } });
      clock.sleep(wait, stop.signal).then(tick, () => undefined);
    };
    // A build that a reader starts writes no cell: the first tick runs after it.
    queueMicrotask(tick);

    return true;
  },
});

/**
 * The state a viewer sees (fact rule 10): the queue's `stateOf` at the server's time, and "taken
 * back" for a request closed by its author. The panel, the pin, the popover and the count use it.
 */
export const shownState = operation({
  label: "viewer.shownState",
  input: z.object({ request, closer: z.string().nullable(), now: z.number() }),
  depends: { stateOf },
  run: ({ stateOf }, { input: { request, closer, now } }): Shown => {
    const state = stateOf.run({ input: { request, now } });
    return state === "closed" && closer === request.author ? "takenBack" : state;
  },
});

/** The messages of each request, oldest first. */
const threads = operation({
  label: "viewer.threads",
  input: z.array(message),
  run: (_, { input }) => {
    const by = new Map<string, Message[]>();
    const sorted = input.toSorted((a, b) => a.created - b.created || a.id.localeCompare(b.id));
    for (const m of sorted) by.set(m.request, [...(by.get(m.request) ?? []), m]);

    return by;
  },
});

/** One request as a viewer sees it, from its row, its thread, the time and the visits. */
const viewOf = operation({
  label: "viewer.viewOf",
  input: z.object({
    r: request,
    thread: z.array(message),
    now: z.number().nullable(),
    since: z.number().nullable(),
    opened: z.number().nullable(),
  }),
  depends: { shownState },
  run: ({ shownState }, { input: { r, thread, now, since, opened } }): RequestView => {
    const closer = thread.findLast((m) => m.kind === "close")?.from ?? null;
    const shown = shownState.run({ input: { request: r, closer, now: now ?? r.updated } });
    const text = thread.findLast((m) => m.kind === "ask" || m.kind === "edit")?.text ?? "";
    const seen = Math.max(since ?? Infinity, opened ?? -Infinity);

    return { r, shown, text, thread, changed: r.updated > seen };
  },
});

/**
 * Each request of a canvas as a viewer sees it, newest first. Until the board's clock is read,
 * a request's own `updated` stands in for the server's time.
 */
export const requestViews = resource({
  label: "viewer.requestViews",
  config: { canvas: canvasOf.required },
  depends: (c) => ({
    rows: frames.board.requests.where({ canvas: c.canvas }),
    all: frames.board.messages.where({ canvas: c.canvas }),
    time: serverTime,
    seen: visits,
    threads,
    viewOf,
  }),
  factory: ({ rows, all, time, seen, threads, viewOf }, ctx): RequestView[] => {
    const by = threads.run({ input: [...all.get()] });
    const visit = seen?.canvas === ctx.config.canvas ? seen : null;

    return rows
      .get()
      .toSorted((a, b) => b.created - a.created || b.n - a.n)
      .map((r) =>
        viewOf.run({
          input: {
            r,
            thread: by.get(r.id) ?? [],
            now: time,
            since: visit?.since ?? null,
            opened: visit?.opened[r.id] ?? null,
          },
        }),
      );
  },
});

const idOf = tag<string>({ label: "viewer.seenId" });
const updatedOf = tag<number>({ label: "viewer.seenUpdated" });

/**
 * The popover of a request is open at its `updated`: the viewer has seen it, so its changed mark
 * goes (step 17). A change while it is open is seen at once too.
 */
export const seenWhileOpen = resource({
  label: "viewer.seenWhileOpen",
  config: { canvas: canvasOf.required, id: idOf.required, updated: updatedOf.required },
  depends: { markSeen },
  factory: ({ markSeen }, ctx) => {
    const { canvas, id, updated } = ctx.config;
    // A build that a reader starts writes no cell: the mark goes after it.
    queueMicrotask(() => markSeen.run({ input: { canvas, id, updated } }));

    return true;
  },
});

/** The panel `Requests` is open (step 2). */
export const panelOpen = data({ label: "viewer.panelOpen", initial: false });

/** The list the panel shows: `Open` or `Done`. */
export const panelList = data<"open" | "done">({ label: "viewer.panelList", initial: "open" });

/** The menu of the panel's head, that picks the list, is open. */
export const listMenu = data({ label: "viewer.listMenu", initial: false });

/** You press `Requests` in the dock: the panel opens, or closes. */
export const togglePanel = operation({
  label: "viewer.togglePanel",
  depends: { open: panelOpen.controller, menu: listMenu.controller },
  run: ({ open, menu }) => {
    menu.set(false);
    open.set(!open.get());
  },
});

/** You press the list's menu button in the panel's head: its menu opens, or closes. */
export const toggleListMenu = operation({
  label: "viewer.toggleListMenu",
  depends: { menu: listMenu.controller },
  run: ({ menu }) => menu.set(!menu.get()),
});

/** You pick a list in the menu: the panel shows it, and the menu closes. */
export const pickList = operation({
  label: "viewer.pickList",
  input: z.enum(["open", "done"]),
  depends: { list: panelList.controller, menu: listMenu.controller },
  run: ({ list, menu }, { input }) => {
    list.set(input);
    menu.set(false);
  },
});
