import { data, operation, resource } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { imageType, maxImageBytes } from "@/frames/contract";
import { queue } from "@/queue";

import { closeFind, findOpen, toggleFind } from "./find";
import type { Shown } from "./follow";
import { controlsFor, panelOpen } from "./follow";
import { keepName, keptName, nameHere, signedInAs } from "./gate";
import { openMenu, screenSize } from "./overlays";
import { walking } from "./walking";

const place = z.object({
  page: z.string(),
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

const part = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

const draftShot = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("image"), mimeType: imageType, data: z.string() }),
  part.extend({ kind: z.literal("region") }),
]);

export type DraftShot = z.infer<typeof draftShot>;

const told = z.enum(["none", "type", "big", "refused"]);

const why = z.enum(["none", "gone", "full", "slow", "link", "failed"]);

const draft = z.object({
  canvas: z.string(),
  place,
  text: z.string(),
  key: z.string(),
  step,
  why,
  maybeSaved: z.boolean(),
  shot: draftShot.nullable(),
  picking: z.boolean(),
  told,
});

export type Draft = z.infer<typeof draft>;

export const drafts = data<Draft | null>({ label: "viewer.draft", initial: null });

export const requestMode = data({ label: "viewer.requestMode", initial: false });

export const openedRequest = data<{ canvas: string; n: number } | null>({
  label: "viewer.openedRequest",
  initial: null,
});

export const actBox = z.enum(["correct", "answer", "note", "clear", "chat"]);

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

const heldDraft = z.object({ step: z.enum(["sending", "unknown"]) });

const closeRequest = operation({
  label: "viewer.closeRequest",
  depends: {
    opened: openedRequest.controller,
    acts: acting.controller,
    menu: openMenu.controller,
  },
  run: ({ opened, acts, menu }) => {
    opened.set(null);
    acts.set(null);
    menu.set(null);
  },
});

export const toggleRequest = operation({
  label: "viewer.toggleRequest",
  depends: { drafts: drafts.controller, mode: requestMode.controller },
  run: ({ drafts, mode }) => {
    if (heldDraft.safeParse(drafts.get()).success) return;
    if (mode.get()) {
      drafts.set(null);
      return mode.set(false);
    }
    mode.set(true);
  },
});

export const backToList = operation({
  label: "viewer.backToList",
  depends: { panel: panelOpen.controller, closeRequest },
  run: ({ panel, closeRequest }) => {
    closeRequest.run();
    panel.set(true);
  },
});

export const closeCard = operation({
  label: "viewer.closeCard",
  depends: { panel: panelOpen.controller, closeRequest },
  run: ({ panel, closeRequest }) => {
    closeRequest.run();
    panel.set(false);
  },
});

export const toggleCard = operation({
  label: "viewer.toggleCard",
  depends: {
    panel: panelOpen.controller,
    opened: openedRequest.controller,
    ctl: controlsFor.controller,
    menu: openMenu.controller,
    closeFind,
    closeCard,
  },
  run: ({ panel, opened, ctl, menu, closeFind, closeCard }) => {
    ctl.set(null);
    if (panel.get() || opened.get()) return closeCard.run();

    closeFind.run();
    menu.set(null);
    panel.set(true);
  },
});

export const pressFind = operation({
  label: "viewer.pressFind",
  depends: {
    find: findOpen,
    menu: openMenu.controller,
    ctl: controlsFor.controller,
    screen: screenSize,
    toggleFind,
    closeCard,
  },
  run: ({ find, menu, ctl, screen, toggleFind, closeCard }) => {
    if (find) return toggleFind.run();

    menu.set(null);
    if (screen.narrow()) {
      ctl.set(null);
      closeCard.run();
    }
    toggleFind.run();
  },
});

export const slashKey = resource({
  label: "viewer.slashKey",
  target: "scope",
  depends: { open: findOpen.controller, pressFind },
  factory: ({ open, pressFind }, ctx) => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || open.get()) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLSelectElement) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;

      event.preventDefault();
      pressFind.run();
    };
    window.addEventListener("keydown", onKey);
    ctx.defer(() => window.removeEventListener("keydown", onKey));

    return { listening: true };
  },
});

const escapeDraft = operation({
  label: "viewer.escapeDraft",
  depends: { drafts: drafts.controller, mode: requestMode.controller },
  run: ({ drafts, mode }) => {
    const draft = drafts.get();
    if (!draft) return { kind: "noDraft" } as const;

    if (heldDraft.safeParse(draft).success) return { kind: "held" } as const;
    if (draft.picking) {
      drafts.set({ ...draft, picking: false });
      return { kind: "picked" } as const;
    }

    drafts.set(null);
    mode.set(false);
    return { kind: "closed" } as const;
  },
});

export const escape = operation({
  label: "viewer.escape",
  depends: {
    mode: requestMode.controller,
    opened: openedRequest.controller,
    panel: panelOpen.controller,
    find: findOpen.controller,
    walk: walking.controller,
    backToList,
    closeFind,
    escapeDraft,
  },
  run: ({ mode, opened, panel, find, walk, backToList, closeFind, escapeDraft }) => {
    if (find.get()) return closeFind.run();
    if (escapeDraft.run().kind !== "noDraft") return;

    if (opened.get()) return backToList.run();
    if (panel.get()) return panel.set(false);
    if (walk.get() && !mode.get()) return walk.set(null);

    mode.set(false);
  },
});

export const pickPlace = operation({
  label: "viewer.pickPlace",
  input: z.object({ canvas: z.string(), place }),
  depends: { drafts: drafts.controller, mode: requestMode },
  run: ({ drafts, mode }, { input, random }) => {
    const now = drafts.get();
    if (!mode || heldDraft.safeParse(now).success) return;

    if (now && now.canvas === input.canvas) {
      const shot = now.shot?.kind === "region" ? null : now.shot;
      const at = { place: input.place, shot, picking: false };
      return drafts.set({ ...now, ...at, step: "typing", why: "none" });
    }
    drafts.set({
      canvas: input.canvas,
      place: input.place,
      text: "",
      key: random.uuid(),
      step: "typing",
      why: "none",
      maybeSaved: false,
      shot: null,
      picking: false,
      told: "none",
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
  depends: { opened: openedRequest.controller, ctl: controlsFor.controller, closeRequest },
  run: ({ opened, ctl, closeRequest }, { input }) => {
    ctl.set(null);
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

const sentShot = z.object({ shot: draftShot.nullable() }).transform(({ shot }) => {
  if (shot === null) return { image: {}, any: {} };
  if (shot.kind === "region") return { image: {}, any: { shot } };

  const image = { kind: "image" as const, image: { mimeType: shot.mimeType, data: shot.data } };
  return { image: { shot: image }, any: { shot: image } };
});

const addInputOf = operation({
  label: "viewer.addInputOf",
  input: draft,
  run: (_, { input: d }) => {
    const { canvas, place: p, text, key } = d;
    const at = { canvas, x: p.x, y: p.y, text, key, ...(p.kit === null ? {} : { kit: p.kit }) };
    const shot = sentShot.parse(d);
    if (p.frameId === null || p.version === null) {
      return { ...at, frameId: null, version: null, page: p.page, ...shot.image };
    }

    return { ...at, frameId: p.frameId, version: p.version, ...shot.any };
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

const sendable = draft.extend({
  step: step.exclude(["sending"]),
  text: z.string().trim().min(1),
  picking: z.literal(false),
});

const stepBeforeSend = operation({
  label: "viewer.stepBeforeSend",
  input: z.object({ draft, typed: z.boolean() }),
  depends: { faults: frames.board.faults, nameHere },
  run: ({ faults, nameHere }, { input: { draft: d, typed } }) => {
    if (faults.get().frames?.fault === "link") {
      return d.step === "unknown"
        ? { step: d.step, why: d.why }
        : ({ step: "notSent", why: "link" } as const);
    }
    if (!typed && nameHere.run() === null) return { step: "naming", why: "none" } as const;

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

const shotRefused = z
  .object({ kind: z.enum(["tooBig", "badImage", "offFrame"]) })
  .transform(() => ({
    kind: "shotRefused" as const,
  }));

const plainAnswers = [
  z.object({ kind: z.literal("added"), n: z.number() }),
  z.object({ kind: z.literal("gone") }),
  z.object({ kind: z.literal("full") }),
  z.object({ kind: z.literal("slow"), retryIn: z.number() }),
  z.object({ kind: z.literal("fault"), error: z.unknown() }),
] as const;

const answer = z.union([...plainAnswers, z.object({ kind: z.literal("shotRefused") })]);

const sentAnswer = z.union([shotRefused, ...plainAnswers]);

const refusedShot = {
  step: "typing",
  why: "none",
  maybeSaved: false,
  shot: null,
  told: "refused",
} as const;

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
      case "shotRefused":
        return drafts.set({ ...now, ...refusedShot });
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
    return showAnswer.run({ input: { canvas: d.canvas, answer: sentAnswer.parse(sent) } });
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
  depends: { d: drafts, me: signedInAs, keptName },
  factory: ({ d, me, keptName }) => (d ? (me?.name ?? keptName.run()) : null),
});

export const escapeKey = resource({
  label: "viewer.escapeKey",
  target: "scope",
  depends: { escape },
  factory: ({ escape }, ctx) => {
    const onKey = (event: KeyboardEvent) =>
      event.key === "Escape" && !event.defaultPrevented && escape.run();
    window.addEventListener("keydown", onKey);
    ctx.defer(() => window.removeEventListener("keydown", onKey));

    return { listening: true };
  },
});

const typingDraft = draft.extend({
  step: z.enum(["typing", "notSent"]),
  picking: z.literal(false),
});

export const readBase64 = operation({
  label: "viewer.readBase64",
  input: z.instanceof(Blob),
  run: async (_, { input: file }) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text = "";
    for (let at = 0; at < bytes.length; at += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    }

    return btoa(text);
  },
});

export const pasteShot = operation({
  label: "viewer.pasteShot",
  input: z.instanceof(Blob),
  depends: { drafts: drafts.controller, readBase64 },
  run: async ({ drafts, readBase64 }, { input: file }) => {
    const now = typingDraft.safeParse(drafts.get()).data;
    if (!now) return;

    const type = imageType.safeParse(file.type);
    if (!type.success) return drafts.set({ ...now, told: "type" });
    if (file.size > maxImageBytes) return drafts.set({ ...now, told: "big" });

    const data = await readBase64.run({ input: file });
    const later = typingDraft.safeParse(drafts.get()).data;
    if (!later || later.key !== now.key || data === "") return;
    drafts.set({ ...later, shot: { kind: "image", mimeType: type.data, data }, told: "none" });
  },
});

export const startPick = operation({
  label: "viewer.startPick",
  depends: { drafts: drafts.controller },
  run: ({ drafts }) => {
    const now = typingDraft.safeParse(drafts.get()).data;
    if (now?.place.box) drafts.set({ ...now, picking: true });
  },
});

const pickedPart = z.object({ part, box: part }).transform(({ part: p, box }) => {
  const x = Math.max(0, Math.round(p.x));
  const y = Math.max(0, Math.round(p.y));
  const w = Math.min(Math.round(p.w), Math.floor(box.w) - x);
  const h = Math.min(Math.round(p.h), Math.floor(box.h) - y);
  return w >= 1 && h >= 1 ? { kind: "region" as const, x, y, w, h } : null;
});

export const pickPart = operation({
  label: "viewer.pickPart",
  input: part,
  depends: { drafts: drafts.controller },
  run: ({ drafts }, { input }) => {
    const now = drafts.get();
    if (!now?.picking || !now.place.box) return;

    const shot = pickedPart.parse({ part: input, box: now.place.box });
    drafts.set({ ...now, picking: false, ...(shot ? { shot, told: "none" } : {}) });
  },
});

export const removeShot = operation({
  label: "viewer.removeShot",
  depends: { drafts: drafts.controller },
  run: ({ drafts }) => {
    const now = typingDraft.safeParse(drafts.get()).data;
    if (now) drafts.set({ ...now, shot: null, told: "none" });
  },
});

const point = z.object({ x: z.number(), y: z.number() });

export const pickDrag = data<{ from: z.infer<typeof point>; to: z.infer<typeof point> } | null>({
  label: "viewer.pickDrag",
  initial: null,
});

const pointer = z.object({
  clientX: z.number(),
  clientY: z.number(),
  rect: z.object({ left: z.number(), top: z.number(), width: z.number(), height: z.number() }),
  box: part,
});

const framePoint = pointer.transform(({ clientX, clientY, rect, box }) => ({
  x: ((clientX - rect.left) / rect.width) * box.w,
  y: ((clientY - rect.top) / rect.height) * box.h,
}));

export const dragPick = operation({
  label: "viewer.dragPick",
  input: z.object({ step: z.enum(["down", "move", "up"]), at: pointer }),
  depends: { drag: pickDrag.controller, pickPart },
  run: ({ drag, pickPart }, { input: { step, ...raw } }) => {
    const at = framePoint.parse(raw.at);
    const from = drag.get()?.from;
    if (step === "down") return drag.set({ from: at, to: at });
    if (!from) return;
    if (step === "move") return drag.set({ from, to: at });

    drag.set(null);
    const corner = { x: Math.min(from.x, at.x), y: Math.min(from.y, at.y) };
    pickPart.run({ input: { ...corner, w: Math.abs(at.x - from.x), h: Math.abs(at.y - from.y) } });
  },
});
