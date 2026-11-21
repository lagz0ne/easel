import { data, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { queue } from "@/queue";
import { stateOf } from "@/queue/contract";

import { keepName, keptName } from "./gate";

// A viewer asks for a change (SPEC-viewer.md § Ask for a change, § When the link ends, § When a
// password is set; the viewer-pin-post and viewer-pin-link charts). The button `Request` puts the
// canvas in request mode; a click on a frame, or on the canvas out of all frames, opens a textbox
// there, with a client key made once for this request (judged rule 6). `Send` sends `request.add`
// with that key and the frame version the page shows. The first `Send` of a browser that kept no
// name asks the name in the same popover: `share.name` sets it on the pass this tab holds, and the
// browser keeps it. A refused send keeps the text and says why. A send that faults keeps the text
// and says it is not known yet whether it saved: no Escape, no Cancel. When the socket is back
// the tab sends it again with the same key, so the server saves it once.

/** The place of a request: on a frame (the place on it), or on the canvas (`frameId` null). */
const place = z.object({
  frameId: z.string().nullable(),
  /** The frame's name and the version the page showed; null on the canvas. */
  frameName: z.string().nullable(),
  version: z.number().nullable(),
  /** On the frame, from its top left; or on the canvas. */
  x: z.number(),
  y: z.number(),
  /** The frame's box at the click: where the dashed area shows if an agent removes the frame. */
  box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
});

export type Place = z.infer<typeof place>;

/**
 * Where the textbox is (the charts' states): `typing` (open); `naming` (the first Send asks the
 * name); `sending`; `unknown` (a send faulted: not known yet if it saved); `notSent` (refused, or
 * Send with the socket down, or a name call that failed: nothing saved).
 */
const step = z.enum(["typing", "naming", "sending", "unknown", "notSent"]);

/** Why the textbox says what it says: the answer or the fault of the last send. */
const why = z.enum(["none", "gone", "full", "slow", "link", "failed"]);

/** The request being typed: one at a time, in this tab. */
const draft = z.object({
  canvas: z.string(),
  place,
  text: z.string(),
  /** The client key: made when the textbox opens, the same on each send of this request. */
  key: z.string(),
  step,
  why,
  /** A send of this request may have reached the server, and no later answer said it did not. */
  maybeSaved: z.boolean(),
});

export type Draft = z.infer<typeof draft>;

/** The request being typed in this tab, if one is. It outlives the canvas, for the gate pages. */
export const drafts = data<Draft | null>({ label: "viewer.draft", initial: null });

/** Request mode: the button `Request` shows pressed, and a click on the canvas opens a textbox. */
export const requestMode = data({ label: "viewer.requestMode", initial: false });

/** The saved request whose popover shows, by its number on its canvas. */
export const openedRequest = data<{ canvas: string; n: number } | null>({
  label: "viewer.openedRequest",
  initial: null,
});

/** A textbox that may hold a saved request: Escape and `Request` leave it as it is. */
const heldDraft = z.object({ step: z.enum(["sending", "unknown"]) });

/**
 * You press `Request`: request mode on, or off. Off closes the textbox and sends nothing; a
 * textbox that may hold a saved request stays.
 */
export const toggleRequest = operation({
  label: "viewer.toggleRequest",
  depends: {
    drafts: drafts.controller,
    mode: requestMode.controller,
    opened: openedRequest.controller,
  },
  run: ({ drafts, mode, opened }) => {
    if (heldDraft.safeParse(drafts.get()).success) return;
    if (mode.get()) {
      drafts.set(null);
      return mode.set(false);
    }
    opened.set(null);
    mode.set(true);
  },
});

/**
 * You press Escape: it closes the popover of a saved request; else the textbox, and request mode
 * with it, and sends nothing. While it is not known whether a send saved, it does nothing.
 */
export const escape = operation({
  label: "viewer.escape",
  depends: {
    drafts: drafts.controller,
    mode: requestMode.controller,
    opened: openedRequest.controller,
  },
  run: ({ drafts, mode, opened }) => {
    if (opened.get()) return opened.set(null);
    if (heldDraft.safeParse(drafts.get()).success) return;
    drafts.set(null);
    mode.set(false);
  },
});

/**
 * You click the canvas. In request mode it opens the textbox there, with a new client key; with
 * a textbox open, it moves its place and keeps the text and the key. Out of request mode, it
 * closes the popover of a saved request.
 */
export const pickPlace = operation({
  label: "viewer.pickPlace",
  input: z.object({ canvas: z.string(), place }),
  depends: { drafts: drafts.controller, mode: requestMode, opened: openedRequest.controller },
  run: ({ drafts, mode, opened }, { input, random }) => {
    opened.set(null);
    const now = drafts.get();
    if (!mode || heldDraft.safeParse(now).success) return;

    if (now && now.canvas === input.canvas) {
      return drafts.set({ ...now, place: input.place, step: "typing", why: "none" });
    }
    drafts.set({
      canvas: input.canvas,
      place: input.place,
      text: "",
      key: random.uuid(),
      step: "typing",
      why: "none",
      maybeSaved: false,
    });
  },
});

/** You type: the text of the request, kept as it is typed. */
export const typeText = operation({
  label: "viewer.typeText",
  input: z.string(),
  depends: { drafts: drafts.controller },
  run: ({ drafts }, { input }) => {
    const now = drafts.get();
    if (now && !heldDraft.safeParse(now).success) drafts.set({ ...now, text: input });
  },
});

/** You press a pin: the popover of that request. */
export const openRequest = operation({
  label: "viewer.openRequest",
  input: z.object({ canvas: z.string(), n: z.number() }),
  depends: { opened: openedRequest.controller },
  run: ({ opened }, { input }) => opened.set(input),
});

/** A refusal that asks the name: the pass has none. */
const nameFault = z.object({
  fault: z.literal("refused"),
  payload: z.object({ name: z.literal(true) }),
});

/** A call that the socket dropped. */
const linkFault = z.object({ fault: z.literal("link") });

/** `request.add`'s input for a draft: on its frame, with the version the page showed; or on the canvas. */
const addInputOf = operation({
  label: "viewer.addInputOf",
  input: draft,
  run: (_, { input: d }) => {
    const { canvas, place: p, text, key } = d;
    if (p.frameId === null || p.version === null) {
      return { canvas, frameId: null, version: null, x: p.x, y: p.y, text, key };
    }
    return { canvas, frameId: p.frameId, version: p.version, x: p.x, y: p.y, text, key };
  },
});

/** `share.name`: the pass this tab holds takes the name, and this browser keeps what it holds. */
const namePass = operation({
  label: "viewer.namePass",
  input: z.object({ canvas: z.string(), name: z.string() }),
  depends: { keepName, nameIt: frames.pass["share.name"] },
  run: async ({ keepName, nameIt }, { input }) => {
    const answer = await nameIt.run({ input });
    keepName.run({ input: answer.name });
  },
});

/** `request.add` for the draft. From here, the send may have saved it. */
const addDraft = operation({
  label: "viewer.addDraft",
  input: draft,
  depends: { drafts: drafts.controller, addInputOf, add: queue.viewer["request.add"] },
  run: ({ drafts, addInputOf, add }, { input: d }) => {
    drafts.set({ ...d, step: "sending", why: "none", maybeSaved: true });
    return add.run({ input: addInputOf.run({ input: d }) });
  },
});

/**
 * `request.add` for the draft, after `share.name` when the viewer typed a name. A pass with no
 * name is refused `{ name: true }`, as when this browser kept the name after the tab opened the
 * link: the page gives the kept name to the pass and sends once more. A fault is thrown.
 */
const addOnce = operation({
  label: "viewer.addOnce",
  input: z.object({ draft, typed: z.string().optional() }),
  depends: { keptName, namePass, addDraft },
  run: async ({ keptName, namePass, addDraft }, { input }) => {
    const { draft: d, typed } = input;
    if (typed !== undefined) await namePass.run({ input: { canvas: d.canvas, name: typed } });
    try {
      return await addDraft.run({ input: d });
    } catch (error) {
      if (!nameFault.safeParse(error).success) throw error;
      const kept = keptName.run();
      if (kept === null) throw error;

      await namePass.run({ input: { canvas: d.canvas, name: kept } });
      return await addDraft.run({ input: d });
    }
  },
});

/** The draft that a Send may send: one with text, not in a send now. */
const sendable = draft.extend({ step: step.exclude(["sending"]), text: z.string().trim().min(1) });

/** Where a Send takes the textbox: it waits for the socket, asks the name, or sends. */
const stepBeforeSend = operation({
  label: "viewer.stepBeforeSend",
  input: z.object({ draft, typed: z.boolean() }),
  depends: { faults: frames.board.faults, keptName },
  run: ({ faults, keptName }, { input: { draft: d, typed } }) => {
    if (faults.get().frames?.fault === "link") {
      return d.step === "unknown"
        ? { step: d.step, why: d.why }
        : ({ step: "notSent", why: "link" } as const);
    }
    if (!typed && keptName.run() === null) return { step: "naming", why: "none" } as const;

    return { step: "sending", why: "none" } as const;
  },
});

/**
 * Before a send: with the socket down it sends nothing and says so (a request that it is not
 * known whether it saved waits for the socket); a browser that kept no name, and typed none, is
 * asked it. Answers the draft to send, or null.
 */
const readyToSend = operation({
  label: "viewer.readyToSend",
  input: z.object({ typed: z.boolean() }),
  depends: { drafts: drafts.controller, stepBeforeSend },
  run: ({ drafts, stepBeforeSend }, { input }) => {
    const d = drafts.get();
    if (!d || !sendable.safeParse(d).success) return null;

    const next = stepBeforeSend.run({ input: { draft: d, typed: input.typed } });
    drafts.set({ ...d, ...next });

    return next.step === "sending" ? d : null;
  },
});

/**
 * A send that faulted: if `request.add` was called, it is not known yet whether it saved; else
 * (the name call faulted) nothing was sent. `link`: the socket dropped; `failed`: any other.
 */
const showFault = operation({
  label: "viewer.showFault",
  input: z.object({ draft, error: z.unknown() }),
  depends: { drafts: drafts.controller },
  run: ({ drafts }, { input: { draft: d, error } }) => {
    const why = linkFault.safeParse(error).success ? "link" : "failed";
    drafts.set({ ...d, step: d.maybeSaved ? "unknown" : "notSent", why });
  },
});

/** A send's answer: one case for each kind, and the fault. */
const answer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("added"), n: z.number() }),
  z.object({ kind: z.literal("gone") }),
  z.object({ kind: z.literal("full") }),
  z.object({ kind: z.literal("slow"), retryIn: z.number() }),
  z.object({ kind: z.literal("fault"), error: z.unknown() }),
]);

/**
 * Shows a send's answer: `added` shows the pin and the new request, and turns `Request` off;
 * `gone`, `full` and `slow` keep the text and say why, nothing saved; a
 * fault keeps it, as `showFault` says.
 */
const showAnswer = operation({
  label: "viewer.showAnswer",
  input: z.object({ canvas: z.string(), answer }),
  depends: {
    drafts: drafts.controller,
    mode: requestMode.controller,
    opened: openedRequest.controller,
    showFault,
  },
  run: ({ drafts, mode, opened, showFault }, { input: { canvas, answer: a } }) => {
    const now = drafts.get();
    if (!now) return;
    switch (a.kind) {
      case "added":
        drafts.set(null);
        mode.set(false);
        return opened.set({ canvas, n: a.n });
      case "gone":
      case "full":
      case "slow":
        return drafts.set({ ...now, step: "notSent", why: a.kind, maybeSaved: false });
      case "fault":
        return showFault.run({ input: { draft: now, error: a.error } });
    }
  },
});

/**
 * You press `Send` (or Enter), with the name if the popover asked it: `readyToSend`, then
 * `request.add` (after `share.name`), then its answer on the page.
 */
export const sendDraft = operation({
  label: "viewer.sendDraft",
  input: z.object({ name: z.string().optional() }),
  depends: { readyToSend, addOnce, showAnswer },
  run: async ({ readyToSend, addOnce, showAnswer }, { input }) => {
    const d = readyToSend.run({ input: { typed: input.name !== undefined } });
    if (!d) return;

    const sent = await addOnce
      .run({ input: { draft: d, typed: input.name } })
      .catch((error: unknown) => ({ kind: "fault" as const, error }));
    return showAnswer.run({ input: { canvas: d.canvas, answer: sent } });
  },
});

/**
 * The resend: when the socket is back, a request that it is not known yet whether it saved goes
 * again, with the same key (the viewer-pin-post chart, s5 to s7 to s8 or s6).
 */
export const resendOnBack = resource({
  label: "viewer.resendOnBack",
  target: "scope",
  depends: { faults: frames.board.faults, drafts: drafts.controller, sendDraft },
  factory: ({ faults, drafts, sendDraft }, ctx) => {
    let lost = faults.get().frames?.fault === "link";
    const unwatch = faults.watch((next) => {
      const was = lost;
      lost = next.frames?.fault === "link";
      const d = drafts.get();
      if (!was || lost || d?.step !== "unknown" || d.why !== "link") return;
      void sendDraft.run({ input: {} });
    });
    ctx.defer(() => unwatch());

    return { watching: true };
  },
});

/** The name this browser kept, as the textbox's avatar shows it: read again when the draft changes. */
export const shownName = resource({
  label: "viewer.shownName",
  config: {},
  depends: { d: drafts, keptName },
  factory: ({ d, keptName }) => (d ? keptName.run() : null),
});

const canvasOf = tag<string>({ label: "viewer.requestCanvas" });
const numberOf = tag<number>({ label: "viewer.requestN" });

/**
 * The state of a request at the server's time, as the page last read it (fact rules 9, 10): the
 * board's `serverClock`; until it is read, the request's own `updated`. Null: no such request.
 */
export const requestState = resource({
  label: "viewer.requestState",
  config: { canvas: canvasOf.required, n: numberOf.required },
  depends: (c) => ({
    rows: frames.board.requests.where({ canvas: c.canvas }),
    clock: frames.board.serverClock.of({ canvas: c.canvas }),
    stateOf,
  }),
  factory: ({ rows, clock, stateOf }, { config }) => {
    const request = rows.get().find((r) => r.n === config.n);
    if (!request) return null;

    return stateOf.run({ input: { request, now: clock.get()?.now ?? request.updated } });
  },
});

/** Escape, wherever the focus is on the page: `escape`. */
export const escapeKey = resource({
  label: "viewer.escapeKey",
  target: "scope",
  depends: { escape },
  factory: ({ escape }, ctx) => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && escape.run();
    window.addEventListener("keydown", onKey);
    ctx.defer(() => window.removeEventListener("keydown", onKey));

    return { listening: true };
  },
});
