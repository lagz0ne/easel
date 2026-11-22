import { data, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { message, request } from "@/queue/cells";
import type { Message, Request } from "@/queue/cells";
import { maxTries, stateOf } from "@/queue/contract";

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
  "doneNoAnswer",
  "closed",
  "takenBack",
] as const;

export type Shown = (typeof shownStates)[number];

/** The states that wait for a viewer: the group `Waits for you`, and the count on `Requests`. */
export const forAViewer: readonly Shown[] = ["question", "result", "person"];

/** The states of the list `Done`. */
export const doneStates: readonly Shown[] = ["accepted", "doneNoAnswer", "closed", "takenBack"];

/** A result that no viewer answers for this long is done, with no answer (E4.2 M15). */
export const noAnswerMs = 3 * 24 * 60 * 60_000;

/**
 * A line of a request's thread (§ Follow the requests 12): a message, with its avatar, name, time
 * and text; or a step, one line with the name, what was done, and the time.
 */
export type Line =
  | {
      key: string;
      kind: "message";
      from: string;
      /** An agent sent it: its avatar is square. */
      agent: boolean;
      at: number;
      text: string | null;
      html: string | null;
      options: readonly string[] | null;
      /** The option that the answer to this question picked, if one did. */
      picked: number | null;
      /** This question waits for its answer: its options are buttons. */
      live: boolean;
      /** A result's pictures of its frame: the version before and after, and if it opens. */
      proof: Proof | null;
    }
  | { key: string; kind: "step"; who: string | null; what: string; at: number | null };

/**
 * One side of a switch: its word, the version of the frame (null: the frame was removed), and
 * the kit version it shows in (null: the current one; SPEC-kit K10).
 */
const pane = z.object({
  label: z.string(),
  version: z.number().nullable(),
  kit: z.number().nullable(),
});

export type Pane = z.infer<typeof pane>;

/**
 * Two pictures of a request's frame (§ Follow the requests 13, 14): `Before` | `After` on a
 * result, `When asked` | `Now` on the ask of a request that may be outdated. `show` is the side
 * it opens on, and `opens` whether it opens.
 */
const proof = z.object({
  id: z.string(),
  left: pane,
  right: pane,
  show: z.enum(["left", "right"]),
  opens: z.boolean(),
});

export type Proof = z.infer<typeof proof>;

/** Why a waiting request may be outdated (SPEC-queue.md § A request becomes outdated). */
const outdated = z.object({
  cause: z.enum(["changed", "removed", "old"]),
  /** The frame's name; null for a request on the canvas. */
  frame: z.string().nullable(),
  /** The frame's version now; null once it was removed. */
  now: z.number().nullable(),
  /** When the frame was removed. */
  removed: z.number().nullable(),
});

export type Outdated = z.infer<typeof outdated>;

/** A request made more than this long ago may be outdated. */
export const oldMs = 7 * 24 * 60 * 60_000;

/** A request as the panel, its pin and its popover show it. */
export type RequestView = {
  r: Request;
  shown: Shown;
  /** The text of the request now: its last correction, or its ask. */
  text: string;
  /** Its messages, oldest first. */
  thread: readonly Message[];
  /** Its thread as the popover shows it, oldest first. */
  lines: readonly Line[];
  /** Who acted last, and what they did: "Tom accepted this". */
  lastAct: string;
  /** It changed since the last visit, and since this browser last opened it. */
  changed: boolean;
  /** It waits, and may be outdated: why. A mark, not a state. */
  outdated: Outdated | null;
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
 * The state a viewer sees (fact rule 10): the queue's `stateOf` at the server's time; "done, no
 * answer" for a result that no viewer answered for 3 days; and "taken back" for a request closed
 * by its author. The panel, the pin, the popover and the count use it.
 */
export const shownState = operation({
  label: "viewer.shownState",
  input: z.object({ request, closer: z.string().nullable(), now: z.number() }),
  depends: { stateOf },
  run: ({ stateOf }, { input: { request, closer, now } }): Shown => {
    const state = stateOf.run({ input: { request, now } });
    if (state === "result" && now - request.updated >= noAnswerMs) return "doneNoAnswer";

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

/** The kinds of message that an agent sends. */
const agentKinds: readonly Message["kind"][] = ["question", "result", "release", "decline"];

/** The kinds of message that start the request again: tries and a decline count from here. */
const fresh: readonly Message["kind"][] = ["ask", "edit", "answer", "reopen"];

/** What the thread knows up to a message: what a later message shows depends on it. */
const sofar = z.object({
  /** The text of the request: its ask, or its last correction. */
  head: z.string(),
  /** Since the request last started again: an agent declined it, and how many released it. */
  declined: z.boolean(),
  releases: z.number(),
  /** The edits that sent the request back from "needs a person". */
  sentBack: z.array(z.string()),
  /** The last question, and the option that each question's answer picked. */
  question: z.string().nullable(),
  picked: z.record(z.string(), z.number().nullable()),
});

type Sofar = z.infer<typeof sofar>;

/** The text of the request, and the edits that sent it back, after one message more. */
const headStep = operation({
  label: "viewer.headStep",
  input: z.object({ was: sofar, m: message }),
  run: (_, { input: { was, m } }) => {
    const toPerson = m.kind === "edit" && (was.declined || was.releases >= maxTries);
    const corrects = !toPerson && (m.kind === "ask" || m.kind === "edit");

    return {
      head: corrects ? (m.text ?? was.head) : was.head,
      sentBack: toPerson ? [...was.sentBack, m.id] : was.sentBack,
    };
  },
});

/** A decline and the releases since the request last started again, after one message more. */
const triesStep = operation({
  label: "viewer.triesStep",
  input: z.object({ was: sofar, m: message }),
  run: (_, { input: { was, m } }) => {
    const again = fresh.includes(m.kind);

    return {
      declined: !again && (was.declined || m.kind === "decline"),
      releases: again ? 0 : was.releases + Number(m.kind === "release"),
    };
  },
});

/** The last question, and the option that its answer picked, after one message more. */
const questionStep = operation({
  label: "viewer.questionStep",
  input: z.object({ was: sofar, m: message }),
  run: (_, { input: { was, m } }) => {
    const asked = was.question;
    const picked = m.kind === "answer" && asked !== null ? { [asked]: m.option } : {};

    return {
      question: m.kind === "question" ? m.id : asked,
      picked: { ...was.picked, ...picked },
    };
  },
});

/** One message more for `sofar`. */
const sofarStep = operation({
  label: "viewer.sofarStep",
  input: z.object({ was: sofar, m: message }),
  depends: { headStep, triesStep, questionStep },
  run: ({ headStep, triesStep, questionStep }, { input }): Sofar => ({
    ...headStep.run({ input }),
    ...triesStep.run({ input }),
    ...questionStep.run({ input }),
  }),
});

/** The words of the steps that say only what was done. */
const doneWords: Partial<Record<Message["kind"], string>> = {
  accept: "accepted the result",
  reopen: "opened it again",
  release: "stopped with no outcome",
  decline: "gave it back",
};

/** The steps that give their reason after the words. */
const withReason: readonly Message["kind"][] = ["release", "decline"];

/** The steps that show the message's text after them: a note to open it again, or to close it. */
const noteAfter: readonly Message["kind"][] = ["reopen", "close"];

/** The words of a step for a message, after the name; null for a message with no step. */
const stepWords = operation({
  label: "viewer.stepWords",
  input: z.object({ m: message, author: z.string(), sentBack: z.boolean() }),
  run: (_, { input: { m, author, sentBack } }) => {
    if (m.kind === "close") return m.from === author ? "took it back" : "closed it";
    if (m.kind === "edit") return sentBack ? "sent it back" : "corrected it";
    const words = doneWords[m.kind];
    if (words === undefined) return null;

    return m.text && withReason.includes(m.kind) ? `${words}: ${m.text}` : words;
  },
});

/** A message as the thread shows it. The ask shows the text of the request now. */
const messageLine = operation({
  label: "viewer.messageLine",
  input: z.object({ m: message, known: sofar, live: z.boolean(), proof: proof.nullable() }),
  run: (_, { input: { m, known, live, proof } }): Extract<Line, { kind: "message" }> => ({
    key: m.id,
    kind: "message",
    from: m.from,
    agent: agentKinds.includes(m.kind),
    at: m.created,
    text: m.kind === "ask" ? known.head : m.text,
    html: m.html,
    options: m.options,
    picked: known.picked[m.id] ?? null,
    live,
    proof,
  }),
});

/** A result's pictures, for a result on a frame with both its versions; else null. */
const resultProof = operation({
  label: "viewer.resultProof",
  input: z.object({ m: message, frameId: z.string().nullable(), opens: z.boolean() }),
  run: (_, { input: { m, frameId, opens } }): Proof | null => {
    if (m.kind !== "result" || frameId === null) return null;
    if (m.before === null || m.after === null) return null;

    const left = { label: "Before", version: m.before, kit: m.beforeKit };
    const right = { label: "After", version: m.after, kit: m.afterKit };
    return { id: frameId, left, right, show: "right", opens };
  },
});

/**
 * The pictures of the ask of a request whose frame changed or was removed (step 14): what the
 * viewer saw, and the frame now. It opens on `When asked`.
 */
const askProof = operation({
  label: "viewer.askProof",
  input: z.object({ m: message, r: request, outdated: outdated.nullable() }),
  run: (_, { input: { m, r, outdated: o } }): Proof | null => {
    if (m.kind !== "ask" || o === null || o.cause === "old") return null;
    if (r.frameId === null || r.version === null) return null;

    const left = { label: "When asked", version: r.version, kit: r.kit };
    return {
      id: r.frameId,
      left,
      right: { label: "Now", version: o.now, kit: null },
      show: "left",
      opens: true,
    };
  },
});

/** The pictures of a message: a result's, or the ask's of a request that may be outdated. */
const proofOf = operation({
  label: "viewer.proofOf",
  input: z.object({ m: message, r: request, opens: z.boolean(), outdated: outdated.nullable() }),
  depends: { resultProof, askProof },
  run: ({ resultProof, askProof }, { input: { m, r, opens, outdated } }) =>
    resultProof.run({ input: { m, frameId: r.frameId, opens } }) ??
    askProof.run({ input: { m, r, outdated } }),
});

/** What an answer brings: the request is back in the queue, in its first place (E4.2 M19). */
const backInQueue = "Back in the queue, in its first place";

/** The lines of one message: the message, its step, or both, in the order the thread shows them. */
const linesOfMessage = operation({
  label: "viewer.linesOfMessage",
  input: z.object({
    m: message,
    author: z.string(),
    known: sofar,
    live: z.boolean(),
    proof: proof.nullable(),
  }),
  depends: { stepWords, messageLine },
  run: ({ stepWords, messageLine }, { input: { m, author, known, live, proof } }): Line[] => {
    const sentBack = known.sentBack.includes(m.id);
    const said = messageLine.run({ input: { m, known, live, proof } });
    const what = stepWords.run({ input: { m, author, sentBack } });
    if (m.kind === "answer") {
      return [said, { key: `${m.id}.queue`, kind: "step", who: null, what: backInQueue, at: null }];
    }
    if (what === null) return [said];

    const step: Line = { key: `${m.id}.step`, kind: "step", who: m.from, what, at: m.created };
    if (sentBack) return [said, step];
    return m.text && noteAfter.includes(m.kind) ? [step, said] : [step];
  },
});

/** The step when tries ran out: the request needs a person, and no agent said why. */
const triesLine = operation({
  label: "viewer.triesLine",
  input: z.object({ r: request, last: message.nullable() }),
  run: (_, { input: { r, last } }): Line[] => {
    if (last !== null && last.kind === "decline") return [];

    const what = `${maxTries} tries with no outcome: it needs a person`;
    return [{ key: "tries", kind: "step", who: null, what, at: r.claimedUntil ?? r.updated }];
  },
});

/** What a result done with no answer says, at the end of its 3 days (E4.2 M15). */
const noAnswer = "No viewer answered in 3 days, so it is done";

/**
 * The steps of the last claim, that no message says: "claude-1 took it" at `claimedAt`, and, for
 * a lease that ran out, that its time ran out at `claimedUntil`. Each end of a lease but its run
 * out sets `claimedBy` and `claimedUntil` to null, so a waiting request that has both had a lease
 * that ran out. The board keeps no earlier claim.
 */
const claimLines = operation({
  label: "viewer.claimLines",
  input: z.object({ r: request, shown: z.enum(shownStates) }),
  run: (_, { input: { r, shown } }): Line[] => {
    const { claimedBy: who, claimedUntil: until } = r;
    const took: Line = {
      key: "took",
      kind: "step",
      who,
      what: "took it",
      at: r.claimedAt ?? r.updated,
    };
    if (shown === "inWork") return [took];
    if (shown !== "waiting" || who === null || until === null) return [];

    const what = "ran out of time with no outcome";
    return [took, { key: "ranOut", kind: "step", who, what, at: until }];
  },
});

/**
 * The last lines, that no message says: the last claim, tries ran out to a person, or no viewer
 * answered the result.
 */
const stateLine = operation({
  label: "viewer.stateLine",
  input: z.object({ r: request, shown: z.enum(shownStates), last: message.nullable() }),
  depends: { triesLine, claimLines },
  run: ({ triesLine, claimLines }, { input: { r, shown, last } }): Line[] => {
    if (shown === "doneNoAnswer") {
      return [{ key: "done", kind: "step", who: null, what: noAnswer, at: r.updated + noAnswerMs }];
    }

    return shown === "person"
      ? triesLine.run({ input: { r, last } })
      : claimLines.run({ input: { r, shown } });
  },
});

/**
 * The step of a request that may be outdated (step 14): how many times its frame changed since
 * the author asked, or when the frame was removed. None for a long wait.
 */
const outdatedLine = operation({
  label: "viewer.outdatedLine",
  input: z.object({ r: request, outdated: outdated.nullable() }),
  run: (_, { input: { r, outdated: o } }): Line[] => {
    if (o === null || o.cause === "old") return [];
    const frame = `The ${o.frame ?? ""} frame`;
    if (o.cause === "removed") {
      return [
        { key: "outdated", kind: "step", who: null, what: `${frame} was removed`, at: o.removed },
      ];
    }
    const n = (o.now ?? 0) - (r.version ?? 0);
    const what = `${frame} changed ${n} time${n === 1 ? "" : "s"} since ${r.author} asked`;

    return [{ key: "outdated", kind: "step", who: null, what, at: null }];
  },
});

/** What a message did, after its sender's name, when it came first (§ Follow the requests 16). */
const firstWords: Record<Message["kind"], string> = {
  ask: "asked it",
  edit: "corrected it",
  question: "asked a question",
  answer: "answered",
  result: "sent a result",
  accept: "accepted this",
  reopen: "opened it again",
  release: "gave it back",
  decline: "gave it back",
  close: "closed it",
};

/**
 * Who acted last on a request, and what they did: "Tom accepted this", or "claude-1 started
 * work on it". A text sent for a state the request left says it.
 */
const lastActOf = operation({
  label: "viewer.lastActOf",
  input: z.object({ r: request, shown: z.enum(shownStates), thread: z.array(message) }),
  run: (_, { input: { r, shown, thread } }) => {
    const last = thread.at(-1);
    if (shown === "inWork") return `${r.claimedBy ?? "An agent"} started work on it`;
    if (last === undefined) return "Someone acted";
    if (shown === "takenBack") return `${last.from} took it back`;

    return `${last.from} ${firstWords[last.kind]}`;
  },
});

const start: Sofar = {
  head: "",
  declined: false,
  releases: 0,
  sentBack: [],
  question: null,
  picked: {},
};

/** A request's thread as the popover shows it (§ Follow the requests 12), oldest first. */
const linesOf = operation({
  label: "viewer.linesOf",
  input: z.object({
    r: request,
    thread: z.array(message),
    shown: z.enum(shownStates),
    outdated: outdated.nullable(),
  }),
  depends: { sofarStep, linesOfMessage, stateLine, proofOf, outdatedLine },
  run: (deps, { input: { r, thread, shown, outdated } }) => {
    const { sofarStep, linesOfMessage, stateLine, proofOf, outdatedLine } = deps;
    const known = thread.reduce((was, m) => sofarStep.run({ input: { was, m } }), start);
    const lastResult = thread.findLast((m) => m.kind === "result")?.id;
    const lines = thread.flatMap((m) => {
      const live = shown === "question" && known.question === m.id;
      const opens = shown === "result" && m.id === lastResult;
      const proof = proofOf.run({ input: { m, r, opens, outdated } });
      return linesOfMessage.run({ input: { m, author: r.author, known, live, proof } });
    });
    const last = thread.at(-1) ?? null;

    return [
      ...lines,
      ...stateLine.run({ input: { r, shown, last } }),
      ...outdatedLine.run({ input: { r, outdated } }),
    ];
  },
});

/** The frame of a request as the board has it now: its name and version, or when it was removed. */
const frameNow = z.object({
  name: z.string(),
  version: z.number().nullable(),
  removed: z.number().nullable(),
});

/** A frame's change: it has a newer version than the one the viewer saw, or it was removed. */
const frameCause = operation({
  label: "viewer.frameCause",
  input: z.object({ r: request, frame: frameNow.nullable() }),
  run: (_, { input: { r, frame } }): Outdated | null => {
    if (frame === null || r.version === null) return null;
    const base = { frame: frame.name, now: frame.version, removed: frame.removed };
    if (frame.version === null) return { ...base, cause: "removed" };

    return frame.version > r.version ? { ...base, cause: "changed" } : null;
  },
});

/**
 * Why a waiting request may be outdated, in this order: its frame was removed, its frame
 * changed, or it was made more than 7 days ago (SPEC-queue.md § A request becomes outdated).
 * Null for a request in any other state.
 */
const outdatedOf = operation({
  label: "viewer.outdatedOf",
  input: z.object({
    r: request,
    shown: z.enum(shownStates),
    now: z.number(),
    frame: frameNow.nullable(),
  }),
  depends: { frameCause },
  run: ({ frameCause }, { input: { r, shown, now, frame } }): Outdated | null => {
    if (shown !== "waiting") return null;
    const cause = frameCause.run({ input: { r, frame } });
    if (cause !== null || now - r.created <= oldMs) return cause;

    return { cause: "old", frame: frame?.name ?? null, now: frame?.version ?? null, removed: null };
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
    frame: frameNow.nullable(),
  }),
  depends: { shownState, linesOf, lastActOf, outdatedOf },
  run: (deps, { input: { r, thread, now, since, opened, frame } }): RequestView => {
    const { shownState, linesOf, lastActOf, outdatedOf } = deps;
    const at = now ?? r.updated;
    const closer = thread.findLast((m) => m.kind === "close")?.from ?? null;
    const shown = shownState.run({ input: { request: r, closer, now: at } });
    const text = thread.findLast((m) => m.kind === "ask" || m.kind === "edit")?.text ?? "";
    const seen = Math.max(since ?? Infinity, opened ?? -Infinity);
    const outdated = outdatedOf.run({ input: { r, shown, now: at, frame } });
    const lines = linesOf.run({ input: { r, thread, shown, outdated } });
    const lastAct = lastActOf.run({ input: { r, shown, thread } });

    return { r, shown, text, thread, lines, lastAct, changed: r.updated > seen, outdated };
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
    boxes: frames.board.frames.where({ canvas: c.canvas }),
    gone: frames.board.removed.where({ canvas: c.canvas }),
    time: serverTime,
    seen: visits,
    threads,
    viewOf,
  }),
  factory: (deps, ctx): RequestView[] => {
    const { rows, all, boxes, gone, time, seen, threads, viewOf } = deps;
    const by = threads.run({ input: [...all.get()] });
    const visit = seen?.canvas === ctx.config.canvas ? seen : null;
    // Each frame of the canvas now, and each removed one, by its id.
    const byId = new Map<string | null, z.infer<typeof frameNow>>([
      ...gone.get().map((f) => [f.id, { ...f, version: null }] as const),
      ...boxes.get().map((f) => [f.id, { ...f, removed: null }] as const),
    ]);

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
            frame: byId.get(r.frameId) ?? null,
          },
        }),
      );
  },
});

/**
 * Where each request of a canvas is on the canvas, by its number: on its frame, where its frame
 * was before it was removed, or on the canvas. Null while its frame is not on the board.
 */
export const requestPlaces = resource({
  label: "viewer.requestPlaces",
  config: { canvas: canvasOf.required },
  depends: (c) => ({
    rows: frames.board.requests.where({ canvas: c.canvas }),
    boxes: frames.board.frames.where({ canvas: c.canvas }),
    gone: frames.board.removed.where({ canvas: c.canvas }),
  }),
  factory: ({ rows, boxes, gone }) => {
    const all = new Map([...gone.get(), ...boxes.get()].map((f) => [f.id, f]));

    return new Map(
      rows.get().map((r) => {
        const box = r.frameId === null ? { x: 0, y: 0 } : all.get(r.frameId);
        return [r.n, box ? { x: box.x + r.x, y: box.y + r.y } : null];
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

/**
 * The frame whose panel `Controls` is open (SPEC-kit.md § The capsules, "The controls in the
 * viewer"), or null. It shares the side of the page with `Requests`: one closes the other.
 */
export const controlsFor = data<string | null>({ label: "viewer.controlsFor", initial: null });

/** The list the panel shows: `Open` or `Done`. */
export const panelList = data<"open" | "done">({ label: "viewer.panelList", initial: "open" });

/** The menu of the panel's head, that picks the list, is open. */
export const listMenu = data({ label: "viewer.listMenu", initial: false });

/** You press `Requests` in the dock: the panel opens, or closes. */
export const togglePanel = operation({
  label: "viewer.togglePanel",
  depends: { open: panelOpen.controller, menu: listMenu.controller, ctl: controlsFor.controller },
  run: ({ open, menu, ctl }) => {
    menu.set(false);
    ctl.set(null);
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
