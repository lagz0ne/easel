import { data, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { message, request } from "@/queue/cells";
import type { Message, Request } from "@/queue/cells";
import { maxTries, stateOf } from "@/queue/contract";

const canvasOf = tag<string>({ label: "viewer.followCanvas" });

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

export const forAViewer: readonly Shown[] = ["question", "result", "person"];

export const doneStates: readonly Shown[] = ["accepted", "doneNoAnswer", "closed", "takenBack"];

export const noAnswerMs = 3 * 24 * 60 * 60_000;

export type Line =
  | {
      key: string;
      kind: "message";
      from: string;
      agent: boolean;
      at: number;
      text: string | null;
      html: string | null;
      options: readonly string[] | null;
      picked: number | null;
      live: boolean;
      proof: Proof | null;
    }
  | { key: string; kind: "step"; who: string | null; what: string; at: number | null };

const pane = z.object({
  label: z.string(),
  version: z.number().nullable(),
  kit: z.number().nullable(),
});

export type Pane = z.infer<typeof pane>;

const proof = z.object({
  id: z.string(),
  left: pane,
  right: pane,
  show: z.enum(["left", "right"]),
  opens: z.boolean(),
});

export type Proof = z.infer<typeof proof>;

const outdated = z.object({
  cause: z.enum(["changed", "removed", "old"]),
  frame: z.string().nullable(),
  now: z.number().nullable(),
  removed: z.number().nullable(),
});

export type Outdated = z.infer<typeof outdated>;

export const oldMs = 7 * 24 * 60 * 60_000;

export type RequestView = {
  r: Request;
  frameName: string | null;
  frameGone: boolean;
  page: string | null;
  shown: Shown;
  text: string;
  thread: readonly Message[];
  lines: readonly Line[];
  lastAct: string;
  changed: boolean;
  outdated: Outdated | null;
};

export const serverTime = data<number | null>({ label: "viewer.serverTime", initial: null });

const visitShape = z.object({
  canvas: z.string(),
  since: z.number(),
  opened: z.record(z.string(), z.number()),
});

export const visits = data<z.infer<typeof visitShape> | null>({
  label: "viewer.visits",
  initial: null,
});

export const visitKey = "easel.visit.";

export const openedKey = "easel.opened.";

const openedMap = z.record(z.string(), z.number());

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

export const tickMs = 60_000;

const nextWake = operation({
  label: "viewer.nextWake",
  input: z.object({ ends: z.array(z.number().nullable()), now: z.number() }),
  run: (_, { input: { ends, now } }) =>
    Math.min(tickMs, ...ends.flatMap((end) => (end !== null && end > now ? [end - now + 1] : []))),
});

export const tabClock = resource({
  label: "viewer.tabClock",
  target: "scope",
  factory: (_, ctx) => ({
    now: () => ctx.clock.currentTimeMillis(),
    sleep: (ms: number, stop: AbortSignal) =>
      ctx.clock.sleep(ms, AbortSignal.any([stop, ctx.signal])),
  }),
});

export const clockOffset = resource({
  label: "viewer.clockOffset",
  config: { canvas: canvasOf.required },
  depends: (c) => ({ read: frames.board.serverClock.of({ canvas: c.canvas }), clock: tabClock }),
  factory: ({ read, clock }) => {
    const at = read.get();
    return at ? at.now - clock.now() : null;
  },
});

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
    queueMicrotask(tick);

    return true;
  },
});

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

const agentKinds: readonly Message["kind"][] = ["question", "result", "release", "decline"];

const fresh: readonly Message["kind"][] = ["ask", "edit", "answer", "reopen"];

const sofar = z.object({
  head: z.string(),
  declined: z.boolean(),
  releases: z.number(),
  sentBack: z.array(z.string()),
  question: z.string().nullable(),
  picked: z.record(z.string(), z.number().nullable()),
});

type Sofar = z.infer<typeof sofar>;

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

const doneWords: Partial<Record<Message["kind"], string>> = {
  accept: "accepted the result",
  reopen: "opened it again",
  release: "stopped with no outcome",
  decline: "gave it back",
};

const withReason: readonly Message["kind"][] = ["release", "decline"];

const noteAfter: readonly Message["kind"][] = ["reopen", "close"];

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

const proofOf = operation({
  label: "viewer.proofOf",
  input: z.object({ m: message, r: request, opens: z.boolean(), outdated: outdated.nullable() }),
  depends: { resultProof, askProof },
  run: ({ resultProof, askProof }, { input: { m, r, opens, outdated } }) =>
    resultProof.run({ input: { m, frameId: r.frameId, opens } }) ??
    askProof.run({ input: { m, r, outdated } }),
});

const backInQueue = "Back in the queue, in its first place";

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

const triesLine = operation({
  label: "viewer.triesLine",
  input: z.object({ r: request, last: message.nullable() }),
  run: (_, { input: { r, last } }): Line[] => {
    if (last !== null && last.kind === "decline") return [];

    const what = `${maxTries} tries with no outcome: it needs a person`;
    return [{ key: "tries", kind: "step", who: null, what, at: r.claimedUntil ?? r.updated }];
  },
});

const noAnswer = "No viewer answered in 3 days, so it is done";

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

const frameNow = z.object({
  name: z.string(),
  page: z.string(),
  version: z.number().nullable(),
  removed: z.number().nullable(),
});

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

const whereOf = operation({
  label: "viewer.whereOf",
  input: z.object({ r: request, frame: frameNow.nullable() }),
  run: (_, { input: { r, frame } }) => {
    if (r.frameId === null) return { frameName: null, frameGone: false, page: r.page };

    const frameGone = typeof frame?.removed === "number";
    return { frameName: frame?.name ?? null, frameGone, page: frame?.page ?? null };
  },
});

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
  depends: { shownState, linesOf, lastActOf, outdatedOf, whereOf },
  run: (deps, { input: { r, thread, now, since, opened, frame } }): RequestView => {
    const { shownState, linesOf, lastActOf, outdatedOf, whereOf } = deps;
    const at = now ?? r.updated;
    const closer = thread.findLast((m) => m.kind === "close")?.from ?? null;
    const shown = shownState.run({ input: { request: r, closer, now: at } });
    const text = thread.findLast((m) => m.kind === "ask" || m.kind === "edit")?.text ?? "";
    const seen = Math.max(since ?? Infinity, opened ?? -Infinity);
    const outdated = outdatedOf.run({ input: { r, shown, now: at, frame } });
    const lines = linesOf.run({ input: { r, thread, shown, outdated } });
    const lastAct = lastActOf.run({ input: { r, shown, thread } });
    const { frameName, frameGone, page } = whereOf.run({ input: { r, frame } });

    return {
      r,
      frameName,
      frameGone,
      page,
      shown,
      text,
      thread,
      lines,
      lastAct,
      changed: r.updated > seen,
      outdated,
    };
  },
});

type FrameNow = z.infer<typeof frameNow> & { id: string };

const listViews = operation({
  label: "viewer.listViews",
  input: z.object({
    canvas: z.string(),
    rows: z.custom<readonly Request[]>(),
    all: z.custom<readonly Message[]>(),
    known: z.custom<readonly FrameNow[]>(),
    time: z.number().nullable(),
    seen: z.custom<z.infer<typeof visitShape> | null>(),
  }),
  depends: { threads, viewOf },
  run: ({ threads, viewOf }, { input: { canvas, rows, all, known, time, seen } }) => {
    const by = threads.run({ input: [...all] });
    const visit = seen?.canvas === canvas ? seen : null;
    const byId = new Map<string | null, FrameNow>(known.map((f) => [f.id, f]));

    return rows
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
    listViews,
  }),
  factory: ({ rows, all, boxes, gone, time, seen, listViews }, ctx): RequestView[] => {
    const known = [
      ...gone.get().map((f) => ({ ...f, version: null })),
      ...boxes.get().map((f) => ({ ...f, removed: null })),
    ];
    const canvas = ctx.config.canvas;
    return listViews.run({
      input: { canvas, rows: rows.get(), all: all.get(), known, time, seen },
    });
  },
});

const viewN = tag<number>({ label: "viewer.viewN" });

const viewFrame = tag<string>({ label: "viewer.viewFrame" });

export const requestView = resource({
  label: "viewer.requestView",
  config: { canvas: canvasOf.required, n: viewN.required, frame: viewFrame.required },
  depends: (c) => ({
    rows: frames.board.requests.where({ canvas: c.canvas }),
    all: frames.board.messages.where({ canvas: c.canvas }),
    boxes: frames.board.frames.where({ canvas: c.canvas, id: c.frame }),
    gone: frames.board.removed.where({ canvas: c.canvas, id: c.frame }),
    time: serverTime,
    seen: visits,
    listViews,
  }),
  factory: ({ rows, all, boxes, gone, time, seen, listViews }, ctx): RequestView | null => {
    const { canvas, n } = ctx.config;
    const known = [
      ...gone.get().map((f) => ({ ...f, version: null })),
      ...(boxes.get() ?? []).map((f) => ({ ...f, removed: null })),
    ];
    const one = rows.get().filter((r) => r.n === n);
    const input = { canvas, rows: one, all: all.get(), known, time, seen };
    return listViews.run({ input })[0] ?? null;
  },
});

export const requestStates = resource({
  label: "viewer.requestStates",
  config: { canvas: canvasOf.required },
  depends: (c) => ({
    rows: frames.board.requests.where({ canvas: c.canvas }),
    all: frames.board.messages.where({ canvas: c.canvas }),
    time: serverTime,
    seen: visits,
    listViews,
  }),
  factory: ({ rows, all, time, seen, listViews }, ctx): RequestView[] => {
    const canvas = ctx.config.canvas;
    const input = { canvas, rows: rows.get(), all: all.get(), known: [], time, seen };
    return listViews.run({ input });
  },
});

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

export const seenWhileOpen = resource({
  label: "viewer.seenWhileOpen",
  config: { canvas: canvasOf.required, id: idOf.required, updated: updatedOf.required },
  depends: { markSeen },
  factory: ({ markSeen }, ctx) => {
    const { canvas, id, updated } = ctx.config;
    queueMicrotask(() => markSeen.run({ input: { canvas, id, updated } }));

    return true;
  },
});

export const panelOpen = data({ label: "viewer.panelOpen", initial: false });

export const controlsFor = data<string | null>({ label: "viewer.controlsFor", initial: null });

export const panelList = data<"open" | "done">({ label: "viewer.panelList", initial: "open" });

export const listMenu = data({ label: "viewer.listMenu", initial: false });

export const toggleListMenu = operation({
  label: "viewer.toggleListMenu",
  depends: { menu: listMenu.controller },
  run: ({ menu }) => menu.set(!menu.get()),
});

export const pickList = operation({
  label: "viewer.pickList",
  input: z.enum(["open", "done"]),
  depends: { list: panelList.controller, menu: listMenu.controller },
  run: ({ list, menu }, { input }) => {
    list.set(input);
    menu.set(false);
  },
});
