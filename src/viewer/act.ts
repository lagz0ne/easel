import { data, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { viewerName } from "@/frames/share";
import { queue } from "@/queue";
import { state } from "@/queue/contract";

import type { Acting } from "./draft";
import { actBox, acting, linkFault, moreMenu, nameFault, namePass, openRequest } from "./draft";
import { panelOpen, shownStates } from "./follow";
import { keptName } from "./gate";

// A viewer acts on an open request (SPEC-viewer.md § Follow the requests 11, 15, 16; SPEC-queue.md
// § A viewer answers and decides). Each act is one of a viewer's calls: `request.edit`, `answer`,
// `accept`, `reopen` or `close`. The page sends nothing when the request changed while the
// viewer typed: it shows the new state, keeps the text, and says who acted. The server answers
// `wrongState` when another viewer, or an agent, acted first: the same. `gone`, `full`, `slow` and
// a fault save nothing either; the text stays. A browser that kept no name asks it first.

/** A viewer's call on a request, with what it carries. */
export const act = z.discriminatedUnion("call", [
  z.object({ call: z.literal("edit"), text: z.string() }),
  z.object({ call: z.literal("answer"), text: z.string(), option: z.number().optional() }),
  z.object({ call: z.literal("accept") }),
  z.object({ call: z.literal("reopen"), text: z.string() }),
  z.object({ call: z.literal("close") }),
]);

export type Act = z.infer<typeof act>;

const target = z.object({ canvas: z.string(), n: z.number() });

/** The call that each textbox sends. */
export const boxCalls = {
  correct: "edit",
  answer: "answer",
  note: "reopen",
  clear: "edit",
} as const;

/** The states in which each textbox's call takes its text (§ Follow the requests 15). */
export const boxFits: Record<z.infer<typeof actBox>, readonly string[]> = {
  correct: ["waiting"],
  answer: ["question"],
  note: ["result", "accepted", "doneNoAnswer"],
  clear: ["person"],
};

/** The name the viewer types when the popover asks it. */
export const typedName = data({ label: "viewer.typedName", initial: "" });

/** The name this browser kept, read again after each act: the author sees `Take back`. */
export const myName = resource({
  label: "viewer.myName",
  config: {},
  depends: { acts: acting, keptName },
  factory: ({ keptName }) => keptName.run(),
});

/** You open a textbox of the request: a correction, or a note to open it again. */
export const openBox = operation({
  label: "viewer.openBox",
  input: z.object({
    canvas: z.string(),
    n: z.number(),
    box: actBox,
    text: z.string(),
    saw: z.enum(shownStates),
  }),
  depends: { acts: acting.controller, more: moreMenu.controller },
  run: ({ acts, more }, { input }) => {
    more.set(false);
    acts.set({ ...input, step: "typing", why: "none" });
  },
});

/** You type in a textbox of the request: the text is kept as it is typed. */
export const typeBox = operation({
  label: "viewer.typeBox",
  input: z.object({
    canvas: z.string(),
    n: z.number(),
    box: actBox,
    text: z.string(),
    saw: z.enum(shownStates),
  }),
  depends: { acts: acting.controller },
  run: ({ acts }, { input }) => {
    const now = acts.get();
    if (now?.step === "sending") return;
    if (now?.canvas === input.canvas && now.n === input.n && now.box === input.box) {
      return acts.set({ ...now, text: input.text });
    }
    acts.set({ ...input, step: "typing", why: "none" });
  },
});

/** You press `Cancel`: the textbox closes, and the request does not change. */
export const cancelBox = operation({
  label: "viewer.cancelBox",
  depends: { acts: acting.controller },
  run: ({ acts }) => acts.set(null),
});

/** You press `More`: its menu opens, or closes. */
export const toggleMore = operation({
  label: "viewer.toggleMore",
  depends: { more: moreMenu.controller },
  run: ({ more }) => more.set(!more.get()),
});

/** You type your name, when the popover asks it. */
export const typeName = operation({
  label: "viewer.typeName",
  input: z.string(),
  depends: { name: typedName.controller },
  run: ({ name }, { input }) => name.set(input),
});

/** Copies a text to the clipboard. */
export const copyText = operation({
  label: "viewer.copyText",
  input: z.string(),
  run: (_, { input }) => navigator.clipboard.writeText(input),
});

/** The link to a request: this page, with the request's number after `#request-`. */
export const requestHash = /^#request-(\d+)$/;

/** You press `Copy link`: the link to the request goes to the clipboard. */
export const copyLink = operation({
  label: "viewer.copyLink",
  input: z.number(),
  depends: { more: moreMenu.controller, copyText },
  run: ({ more, copyText }, { input: n }) => {
    more.set(false);
    return copyText.run({ input: `${location.href.split("#")[0]}#request-${n}` });
  },
});

const linkCanvas = tag<string>({ label: "viewer.linkCanvas" });

/**
 * A link to a request (`#request-<n>`, from `Copy link`) opens the panel and the request when
 * the canvas opens.
 */
export const openFromLink = resource({
  label: "viewer.openFromLink",
  config: { canvas: linkCanvas.required },
  depends: { openRequest, panel: panelOpen.controller },
  factory: ({ openRequest, panel }, ctx) => {
    const n = requestHash.exec(location.hash)?.[1];
    if (n === undefined) return false;

    // A build that a reader starts writes no cell: the request opens after it.
    queueMicrotask(() => {
      panel.set(true);
      openRequest.run({ input: { canvas: ctx.config.canvas, n: Number(n) } });
    });
    return true;
  },
});

/** One call for an act, by its name: its answer, or a fault thrown. */
const callOnce = operation({
  label: "viewer.callOnce",
  input: z.object({ at: target, act }),
  depends: {
    edit: queue.viewer["request.edit"],
    answer: queue.viewer["request.answer"],
    accept: queue.viewer["request.accept"],
    reopen: queue.viewer["request.reopen"],
    close: queue.viewer["request.close"],
  },
  run: ({ edit, answer, accept, reopen, close }, { input: { at, act: a } }) => {
    switch (a.call) {
      case "edit":
        return edit.run({ input: { ...at, text: a.text } });
      case "answer":
        return answer.run({ input: { ...at, text: a.text, option: a.option } });
      case "accept":
        return accept.run({ input: at });
      case "reopen":
        return reopen.run({ input: { ...at, text: a.text } });
      case "close":
        return close.run({ input: at });
    }
  },
});

/**
 * The call, after `share.name` when the viewer typed a name. A pass with no name is refused
 * `{ name: true }`: the page gives it the kept name and calls once more. A fault is thrown.
 */
const callNamed = operation({
  label: "viewer.callNamed",
  input: z.object({ at: target, act, typed: z.string().optional() }),
  depends: { keptName, namePass, callOnce },
  run: async ({ keptName, namePass, callOnce }, { input: { at, act, typed } }) => {
    if (typed !== undefined) await namePass.run({ input: { canvas: at.canvas, name: typed } });
    try {
      return await callOnce.run({ input: { at, act } });
    } catch (error) {
      const kept = keptName.run();
      if (!nameFault.safeParse(error).success || kept === null) throw error;

      await namePass.run({ input: { canvas: at.canvas, name: kept } });
      return await callOnce.run({ input: { at, act } });
    }
  },
});

/** What the viewer does on request `at` now: the textbox, its text, and the state it saw. */
const actingOn = operation({
  label: "viewer.actingOn",
  input: z.object({ at: target, now: z.enum(shownStates) }),
  depends: { acts: acting },
  run: ({ acts }, { input: { at, now } }) => {
    if (acts === null || acts.canvas !== at.canvas || acts.n !== at.n) {
      return { kept: { box: null, text: "", saw: now }, naming: false };
    }

    return {
      kept: { box: acts.box, text: acts.text, saw: acts.saw },
      naming: acts.step === "naming",
    };
  },
});

/** The name the viewer typed, when the popover asks it and it is a good one. */
const nameToGive = operation({
  label: "viewer.nameToGive",
  input: z.boolean(),
  depends: { typedName },
  run: ({ typedName }, { input: naming }) =>
    naming ? viewerName.safeParse(typedName).data : undefined,
});

/**
 * Before a call: a text that the viewer typed for a state the request left is not sent (the
 * popover says who acted first); a browser that kept no name, and typed none, is asked it.
 * Answers the name to give the pass, or null when it sends nothing.
 */
const readyToAct = operation({
  label: "viewer.readyToAct",
  input: z.object({ at: target, act, now: z.enum(shownStates) }),
  depends: { acts: acting.controller, actingOn, nameToGive, keptName },
  run: ({ acts, actingOn, nameToGive, keptName }, { input: { at, act: a, now } }) => {
    const { kept, naming } = actingOn.run({ input: { at, now } });
    if ("text" in a && kept.saw !== now) {
      const why = now === "inWork" ? "started" : "first";
      acts.set({ ...at, ...kept, saw: now, step: "notSent", why });
      return null;
    }
    const typed = nameToGive.run({ input: naming });
    if (typed === undefined && keptName.run() === null) {
      acts.set({ ...at, ...kept, step: "naming", why: "none" });
      return null;
    }

    acts.set({ ...at, ...kept, step: "sending", why: "none" });
    return { typed };
  },
});

/** A call that saved: one of the kinds of success. */
const saved = z.object({
  kind: z.enum(["edited", "answered", "accepted", "reopened", "closed"]),
});

/** A call that saved nothing: the state now, a removed request, too many, too fast, or a fault. */
const refusal = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("wrongState"), state }),
  z.object({ kind: z.literal("gone") }),
  z.object({ kind: z.literal("full") }),
  z.object({ kind: z.literal("slow"), retryIn: z.number() }),
  z.object({ kind: z.literal("fault"), error: z.unknown() }),
]);

/** Why a refusal saved nothing, as the popover says it (§ Follow the requests 16). */
const refusedWhy = operation({
  label: "viewer.refusedWhy",
  input: refusal,
  run: (_, { input: a }): Partial<Acting> => {
    if (a.kind === "wrongState") {
      const why = a.state === "inWork" ? "started" : "first";
      return { saw: a.state, step: "notSent" as const, why };
    }
    if (a.kind === "fault") {
      return {
        step: "notSent" as const,
        why: linkFault.safeParse(a.error).success ? "link" : "failed",
      };
    }

    return { step: "notSent" as const, why: a.kind };
  },
});

/**
 * Shows an act's answer: a saved act closes its textbox (the board brings the change); a refusal
 * keeps the text and says why (§ Follow the requests 16). Answers the kind.
 */
const showActAnswer = operation({
  label: "viewer.showActAnswer",
  input: z.object({ at: target, answer: z.union([saved, refusal]) }),
  depends: { acts: acting.controller, more: moreMenu.controller, refusedWhy },
  run: ({ acts, more, refusedWhy }, { input: { at, answer: a } }) => {
    const here = acts.get();
    if (here === null || here.canvas !== at.canvas || here.n !== at.n) return a.kind;
    const refused = refusal.safeParse(a);
    if (refused.success) {
      acts.set({ ...here, ...refusedWhy.run({ input: refused.data }) });
      return a.kind;
    }

    more.set(false);
    acts.set(null);
    return a.kind;
  },
});

/**
 * You act on the open request: `readyToAct`, then the call (after `share.name`), then its answer
 * on the page. `now` is the state the popover shows.
 */
export const actOn = operation({
  label: "viewer.actOn",
  input: z.object({ canvas: z.string(), n: z.number(), act, now: z.enum(shownStates) }),
  depends: { readyToAct, callNamed, showActAnswer },
  run: async ({ readyToAct, callNamed, showActAnswer }, { input }) => {
    const at = { canvas: input.canvas, n: input.n };
    const ready = readyToAct.run({ input: { at, act: input.act, now: input.now } });
    if (ready === null) return "notSent" as const;

    const sent = await callNamed
      .run({ input: { at, act: input.act, typed: ready.typed } })
      .catch((error: unknown) => ({ kind: "fault" as const, error }));
    return showActAnswer.run({ input: { at, answer: sent } });
  },
});
