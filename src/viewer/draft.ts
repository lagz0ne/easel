import { data, operation, resource } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { queue } from "@/queue";

import type { Shown } from "./follow";
import { keepName, keptName } from "./gate";

const place = z.object({
  frameId: z.string().nullable(),
  frameName: z.string().nullable(),
  version: z.number().nullable(),
  kit: z.number().nullable(),
  x: z.number(),
  y: z.number(),
  box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
});

export type Place = z.infer<typeof place>;

const step = z.enum(["typing", "naming", "sending", "unknown", "notSent"]);

const why = z.enum(["none", "gone", "full", "slow", "link", "failed"]);

const draft = z.object({
  canvas: z.string(),
  place,
  text: z.string(),
  key: z.string(),
  step,
  why,
  maybeSaved: z.boolean(),
});

export type Draft = z.infer<typeof draft>;

export const drafts = data<Draft | null>({ label: "viewer.draft", initial: null });

export const requestMode = data({ label: "viewer.requestMode", initial: false });

export const openedRequest = data<{ canvas: string; n: number } | null>({
  label: "viewer.openedRequest",
  initial: null,
});

export const actBox = z.enum(["correct", "answer", "note", "clear"]);

export type ActBox = z.infer<typeof actBox>;

export type Acting = {
  canvas: string;
  n: number;
  box: ActBox | null;
  text: string;
  saw: Shown;
  step: "typing" | "naming" | "sending" | "notSent";
  why: "none" | "first" | "started" | "gone" | "full" | "slow" | "link" | "failed";
};

export const acting = data<Acting | null>({ label: "viewer.acting", initial: null });

export const moreMenu = data({ label: "viewer.moreMenu", initial: false });

const heldDraft = z.object({ step: z.enum(["sending", "unknown"]) });

const closeRequest = operation({
  label: "viewer.closeRequest",
  depends: {
    opened: openedRequest.controller,
    acts: acting.controller,
    more: moreMenu.controller,
  },
  run: ({ opened, acts, more }) => {
    opened.set(null);
    acts.set(null);
    more.set(false);
  },
});

export const toggleRequest = operation({
  label: "viewer.toggleRequest",
  depends: {
    drafts: drafts.controller,
    mode: requestMode.controller,
    closeRequest,
  },
  run: ({ drafts, mode, closeRequest }) => {
    if (heldDraft.safeParse(drafts.get()).success) return;
    if (mode.get()) {
      drafts.set(null);
      return mode.set(false);
    }
    closeRequest.run();
    mode.set(true);
  },
});

export const escape = operation({
  label: "viewer.escape",
  depends: {
    drafts: drafts.controller,
    mode: requestMode.controller,
    opened: openedRequest.controller,
    closeRequest,
  },
  run: ({ drafts, mode, opened, closeRequest }) => {
    if (opened.get()) return closeRequest.run();
    if (heldDraft.safeParse(drafts.get()).success) return;
    drafts.set(null);
    mode.set(false);
  },
});

export const pickPlace = operation({
  label: "viewer.pickPlace",
  input: z.object({ canvas: z.string(), place }),
  depends: { drafts: drafts.controller, mode: requestMode, closeRequest },
  run: ({ drafts, mode, closeRequest }, { input, random }) => {
    closeRequest.run();
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

export const typeText = operation({
  label: "viewer.typeText",
  input: z.string(),
  depends: { drafts: drafts.controller },
  run: ({ drafts }, { input }) => {
    const now = drafts.get();
    if (now && !heldDraft.safeParse(now).success) drafts.set({ ...now, text: input });
  },
});

export const openRequest = operation({
  label: "viewer.openRequest",
  input: z.object({ canvas: z.string(), n: z.number() }),
  depends: { opened: openedRequest.controller, closeRequest },
  run: ({ opened, closeRequest }, { input }) => {
    const now = opened.get();
    if (now?.canvas === input.canvas && now.n === input.n) return;

    closeRequest.run();
    opened.set(input);
  },
});

export const nameFault = z.object({
  fault: z.literal("refused"),
  payload: z.object({ name: z.literal(true) }),
});

export const linkFault = z.object({ fault: z.literal("link") });

const addInputOf = operation({
  label: "viewer.addInputOf",
  input: draft,
  run: (_, { input: d }) => {
    const { canvas, place: p, text, key } = d;
    const at = { canvas, x: p.x, y: p.y, text, key, ...(p.kit === null ? {} : { kit: p.kit }) };
    if (p.frameId === null || p.version === null) return { ...at, frameId: null, version: null };

    return { ...at, frameId: p.frameId, version: p.version };
  },
});

export const namePass = operation({
  label: "viewer.namePass",
  input: z.object({ canvas: z.string(), name: z.string() }),
  depends: { keepName, nameIt: frames.pass["share.name"] },
  run: async ({ keepName, nameIt }, { input }) => {
    const answer = await nameIt.run({ input });
    keepName.run({ input: answer.name });
  },
});

const addDraft = operation({
  label: "viewer.addDraft",
  input: draft,
  depends: { drafts: drafts.controller, addInputOf, add: queue.viewer["request.add"] },
  run: ({ drafts, addInputOf, add }, { input: d }) => {
    drafts.set({ ...d, step: "sending", why: "none", maybeSaved: true });
    return add.run({ input: addInputOf.run({ input: d }) });
  },
});

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

const sendable = draft.extend({ step: step.exclude(["sending"]), text: z.string().trim().min(1) });

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

const showFault = operation({
  label: "viewer.showFault",
  input: z.object({ draft, error: z.unknown() }),
  depends: { drafts: drafts.controller },
  run: ({ drafts }, { input: { draft: d, error } }) => {
    const why = linkFault.safeParse(error).success ? "link" : "failed";
    drafts.set({ ...d, step: d.maybeSaved ? "unknown" : "notSent", why });
  },
});

const answer = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("added"), n: z.number() }),
  z.object({ kind: z.literal("gone") }),
  z.object({ kind: z.literal("full") }),
  z.object({ kind: z.literal("slow"), retryIn: z.number() }),
  z.object({ kind: z.literal("fault"), error: z.unknown() }),
]);

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

export const shownName = resource({
  label: "viewer.shownName",
  config: {},
  depends: { d: drafts, keptName },
  factory: ({ d, keptName }) => (d ? keptName.run() : null),
});

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
