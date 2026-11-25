import { data, operation, resource } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { endedRefusal, lockedRefusal, shareLink, typedPassword, viewerName } from "@/frames/share";
import { whoMeta } from "@/issues/sign-in";

import { retryJitter } from "./settings";

const gate = z.discriminatedUnion("page", [
  z.object({
    link: z.string(),
    page: z.literal("canvas"),
    canvas: z.string(),
    again: z.boolean(),
  }),
  z.object({ link: z.string(), page: z.literal("ended") }),
  z.object({
    link: z.string(),
    page: z.literal("password"),
    alert: z.enum(["none", "wrong", "wait"]),
    changed: z.boolean(),
  }),
]);

export type Gate = z.infer<typeof gate>;

export const gates = data({
  label: "viewer.gates",
  mode: "keyed",
  parse: gate,
  key: (g) => ({ link: g.link }),
});

export const heldPasses = data({
  label: "viewer.passes",
  mode: "keyed",
  parse: z.object({ link: z.string(), pass: z.string() }),
  key: (p) => ({ link: p.link }),
});

export const shownLink = data({ label: "viewer.shownLink", initial: "" });

const waitOut = operation({
  label: "viewer.waitOut",
  input: z.object({ retryIn: z.number(), stop: z.instanceof(AbortSignal).optional() }),
  depends: { retryJitter },
  run: ({ retryJitter }, { input, clock, signal }) => {
    const wait = input.retryIn + Math.floor(Math.random() * retryJitter);
    const until = input.stop ? AbortSignal.any([signal, input.stop]) : signal;

    return clock.sleep(wait, until).then(
      () => false,
      () => true,
    );
  },
});

export const nameKey = "easel.viewerName";

export const keptName = operation({
  label: "viewer.keptName",
  run: () => viewerName.safeParse(localStorage.getItem(nameKey)).data ?? null,
});

export const signedInAs = data<{ name: string; owner: boolean } | null>({
  label: "viewer.signedInAs",
  initial: null,
});

export const nameHere = operation({
  label: "viewer.nameHere",
  depends: { me: signedInAs, keptName },
  run: ({ me, keptName }) => me?.name ?? keptName.run(),
});

export const keepName = operation({
  label: "viewer.keepName",
  input: viewerName,
  run: (_, { input }) => localStorage.setItem(nameKey, input.trim()),
});

const openInput = operation({
  label: "viewer.openInput",
  input: z.string(),
  depends: { keptName },
  run: ({ keptName }, { input }) => {
    const name = keptName.run();
    return name === null ? { link: input } : { link: input, name };
  },
});

const settled = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open"), canvas: z.string(), pass: z.string() }),
  z.object({ kind: z.literal("locked") }),
  z.object({ kind: z.literal("wrong") }),
  z.object({ kind: z.literal("gone") }),
]);

const saysChanged = operation({
  label: "viewer.saysChanged",
  input: z.string(),
  depends: { pages: gates.controller },
  run: ({ pages }, { input }) => {
    const shown = pages.of({ link: input }).get();
    return shown?.page === "password" && shown.changed;
  },
});

const showAnswer = operation({
  label: "viewer.showGateAnswer",
  input: z.object({ link: z.string(), again: z.boolean(), answer: settled }),
  depends: { pages: gates.controller, passes: heldPasses.controller, saysChanged },
  run: ({ pages, passes, saysChanged }, { input }) => {
    const { link, again, answer } = input;
    switch (answer.kind) {
      case "open":
        passes.set({ link, pass: answer.pass });
        return pages.set({ link, page: "canvas", canvas: answer.canvas, again });
      case "locked":
        return pages.set({ link, page: "password", alert: "none", changed: false });
      case "wrong":
        return pages.set({
          link,
          page: "password",
          alert: "wrong",
          changed: saysChanged.run({ input: link }),
        });
      case "gone":
        return pages.set({ link, page: "ended" });
    }
  },
});

export const openLink = operation({
  label: "viewer.openLink",
  input: z.object({
    link: z.string(),
    again: z.boolean().optional(),
    stop: z.instanceof(AbortSignal).optional(),
  }),
  depends: {
    pages: gates.controller,
    shown: shownLink.controller,
    openInput,
    waitOut,
    showAnswer,
    open: frames.viewer["share.open"],
  },
  run: async ({ pages, shown, openInput, waitOut, showAnswer, open }, { input }) => {
    const { link } = input;
    shown.set(link);
    if (!shareLink.safeParse(link).success) return pages.set({ link, page: "ended" });

    for (;;) {
      const answer = await open.run({ input: openInput.run({ input: link }) });
      if (answer.kind !== "slow") {
        return showAnswer.run({ input: { link, again: input.again === true, answer } });
      }

      pages.delete({ link });
      if (await waitOut.run({ input: { retryIn: answer.retryIn, stop: input.stop } })) return;
    }
  },
});

const waitThenAsk = operation({
  label: "viewer.waitThenAsk",
  input: z.object({ link: z.string(), retryIn: z.number() }),
  depends: { pages: gates.controller, waitOut, saysChanged },
  run: async ({ pages, waitOut, saysChanged }, { input }) => {
    const { link, retryIn } = input;
    pages.set({ link, page: "password", alert: "wait", changed: saysChanged.run({ input: link }) });
    if (await waitOut.run({ input: { retryIn } })) return;

    const shown = pages.of({ link }).get();
    if (shown?.page === "password" && shown.alert === "wait") {
      pages.set({ ...shown, alert: "none" });
    }
  },
});

export const enterPassword = operation({
  label: "viewer.enterPassword",
  input: z.object({ link: z.string(), password: typedPassword }),
  depends: {
    openInput,
    showAnswer,
    waitThenAsk,
    open: frames.viewer["share.open"],
  },
  run: async ({ openInput, showAnswer, waitThenAsk, open }, { input }) => {
    const { link, password } = input;

    const answer = await open.run({ input: { ...openInput.run({ input: link }), password } });
    if (answer.kind !== "slow") return showAnswer.run({ input: { link, again: false, answer } });

    return waitThenAsk.run({ input: { link, retryIn: answer.retryIn } });
  },
});

const endedFault = z.object({ payload: z.object({ ended: z.literal(endedRefusal.ended) }) });

const lockedFault = z.object({ payload: z.object({ locked: z.literal(lockedRefusal.locked) }) });

const showRefusal = operation({
  label: "viewer.showRefusal",
  input: z.object({ fault: z.unknown() }),
  depends: {
    pages: gates.controller,
    shown: shownLink.controller,
    passes: heldPasses.controller,
    openLink,
  },
  run: ({ pages, shown, passes, openLink }, { input: { fault } }) => {
    const link = shown.get();
    const gate = pages.of({ link }).get();
    if (gate?.page !== "canvas") return;

    if (fault === undefined) return gate.again && pages.set({ ...gate, again: false });

    if (lockedFault.safeParse(fault).success) {
      passes.delete({ link });
      return pages.set({ link, page: "password", alert: "none", changed: true });
    }
    if (!endedFault.safeParse(fault).success) return;
    if (gate.again) return pages.set({ link, page: "ended" });

    pages.delete({ link });
    void openLink.run({ input: { link, again: true } });
  },
});

const refusals = resource({
  label: "viewer.refusals",
  target: "scope",
  depends: { faults: frames.board.faults, showRefusal },
  factory: ({ faults, showRefusal }, ctx) => {
    let last = faults.get().frames;
    const unwatch = faults.watch((next) => {
      if (next.frames === last) return;

      last = next.frames;
      void showRefusal.run({ input: { fault: next.frames } });
    });
    ctx.defer(() => unwatch());

    return { watching: true };
  },
});

export const openPage = operation({
  label: "viewer.openPage",
  input: z.object({ link: z.string(), stop: z.instanceof(AbortSignal) }),
  depends: { refusals, openLink },
  run: ({ openLink }, { input }) => openLink.run({ input }),
});

export const tabMeta = operation({
  label: "viewer.tabMeta",
  depends: { who: whoMeta, passes: heldPasses.controller, shown: shownLink },
  run: async ({ who, passes, shown }): Promise<Record<string, string>> => {
    const pass = passes.of({ link: shown }).get()?.pass;

    return { ...(await who.run()), ...(pass ? { pass } : {}) };
  },
});
