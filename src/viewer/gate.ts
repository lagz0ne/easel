import { data, operation, resource } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { endedRefusal, lockedRefusal, shareLink, typedPassword, viewerName } from "@/frames/share";
import { whoMeta } from "@/issues/sign-in";

// The share link's gate (SPEC-viewer.md § Open the link; SPEC-frames.md § Open a share link; the
// viewer-gate-password chart). The page asks for the viewer's name once per browser, then trades
// the link and the name for a pass with `share.open`. The name is kept in this browser; the pass
// only in this tab's memory, so a reload opens the link again. A link with a password answers
// `locked`, and the page asks it: a wrong one says so, and after 5 wrong ones in a minute the
// page says to wait, and takes no password until that minute has passed. A password set or
// changed ends this tab's pass: its read is refused `{ locked: true }`, and the page asks the
// password again. A link keeps its 1000 newest passes, so a live link can end this tab's pass:
// its read is then refused `{ ended: true }`, and the tab opens the link once more before it says
// the link ended.

/** What the tab shows for one link: the chart's Page. */
const gate = z.discriminatedUnion("page", [
  z.object({ link: z.string(), page: z.literal("name") }),
  /** `again`: the tab opened the link once more after its pass was turned away. */
  z.object({
    link: z.string(),
    page: z.literal("canvas"),
    canvas: z.string(),
    again: z.boolean(),
  }),
  z.object({ link: z.string(), page: z.literal("ended") }),
  /** The password page. `alert`: a wrong password, or the wait after 5 wrong ones in a minute. */
  z.object({
    link: z.string(),
    page: z.literal("password"),
    alert: z.enum(["none", "wrong", "wait"]),
  }),
]);

export type Gate = z.infer<typeof gate>;

/** Each link's page in this tab. No member: the link is still opening. */
export const gates = data({
  label: "viewer.gates",
  mode: "keyed",
  parse: gate,
  key: (g) => ({ link: g.link }),
});

/**
 * The pass `share.open` gave this tab, by link. Keyed, so a late answer for a link the tab left
 * cannot take the place of the shown link's pass.
 */
export const heldPasses = data({
  label: "viewer.passes",
  mode: "keyed",
  parse: z.object({ link: z.string(), pass: z.string() }),
  key: (p) => ({ link: p.link }),
});

/** The link this tab shows: its pass rides each board read's meta. */
export const shownLink = data({ label: "viewer.shownLink", initial: "" });

/** A `slow` is retried after `retryIn` and up to 1 s more, so tabs slowed together spread out. */
export const retryJitter = 1_000;

/**
 * Waits out a `slow`: `retryIn` and up to 1 s more. Answers whether the page left the link
 * meanwhile (its `stop`, or the scope closing).
 */
const waitOut = operation({
  label: "viewer.waitOut",
  input: z.object({ retryIn: z.number(), stop: z.instanceof(AbortSignal).optional() }),
  run: (_, { input, clock, signal }) => {
    const wait = input.retryIn + Math.floor(Math.random() * retryJitter);
    const until = input.stop ? AbortSignal.any([signal, input.stop]) : signal;

    return clock.sleep(wait, until).then(
      () => false,
      () => true,
    );
  },
});

/** Where this browser keeps the viewer's name. */
export const nameKey = "easel.viewerName";

/** The name this browser kept, if it kept a good one. */
const keptName = operation({
  label: "viewer.keptName",
  run: () => viewerName.safeParse(localStorage.getItem(nameKey)).data ?? null,
});

/** A `share.open` answer that is not `slow`: what the page shows for it. */
const settled = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open"), canvas: z.string(), pass: z.string() }),
  z.object({ kind: z.literal("locked") }),
  z.object({ kind: z.literal("wrong") }),
  z.object({ kind: z.literal("gone") }),
]);

/**
 * Shows a `share.open` answer that is not `slow`: `open` keeps the pass and shows the canvas;
 * `locked` asks the password; `wrong` asks it again and says it was wrong; `gone` says the link
 * has ended. `again`: the canvas came from opening the link once more after a pass ended.
 */
const showAnswer = operation({
  label: "viewer.showAnswer",
  input: z.object({ link: z.string(), again: z.boolean(), answer: settled }),
  depends: { pages: gates.controller, passes: heldPasses.controller },
  run: ({ pages, passes }, { input }) => {
    const { link, again, answer } = input;
    switch (answer.kind) {
      case "open":
        passes.set({ link, pass: answer.pass });
        return pages.set({ link, page: "canvas", canvas: answer.canvas, again });
      case "locked":
        return pages.set({ link, page: "password", alert: "none" });
      case "wrong":
        return pages.set({ link, page: "password", alert: "wrong" });
      case "gone":
        return pages.set({ link, page: "ended" });
    }
  },
});

/**
 * You open the link: with no name kept, the page asks for it; with one, `share.open` answers
 * `open` (the canvas, and the pass this tab keeps), `locked` (the link asks a password: the
 * password page) or `gone` (the page says the link has ended).
 * A path that is not a link's shape is gone too: no link has it. Past the flood limit it answers
 * `slow`: the page stays on Opening and calls again after `retryIn`. It never shows a wait page.
 */
export const openLink = operation({
  label: "viewer.openLink",
  input: z.object({
    link: z.string(),
    again: z.boolean().optional(),
    /** Aborted when the page leaves the link: the route loader's signal. */
    stop: z.instanceof(AbortSignal).optional(),
  }),
  depends: {
    pages: gates.controller,
    shown: shownLink.controller,
    keptName,
    waitOut,
    showAnswer,
    open: frames.viewer["share.open"],
  },
  run: async ({ pages, shown, keptName, waitOut, showAnswer, open }, { input }) => {
    const { link } = input;
    shown.set(link);
    const name = keptName.run();
    if (name === null) return pages.set({ link, page: "name" });
    if (!shareLink.safeParse(link).success) return pages.set({ link, page: "ended" });

    for (;;) {
      // A late answer after the page left this link writes only this link's entries (pass and
      // page are keyed by link), and the loop ends: open and gone return, and a slow's sleep
      // sees the aborted stop.
      const answer = await open.run({ input: { link, name } });
      if (answer.kind !== "slow") {
        return showAnswer.run({ input: { link, again: input.again === true, answer } });
      }

      pages.delete({ link });
      if (await waitOut.run({ input: { retryIn: answer.retryIn, stop: input.stop } })) return;
    }
  },
});

/**
 * The password page after a `slow`: it says to wait until `retryIn` has passed, then asks again
 * with no alert, unless the page moved on meanwhile.
 */
const waitThenAsk = operation({
  label: "viewer.waitThenAsk",
  input: z.object({ link: z.string(), retryIn: z.number() }),
  depends: { pages: gates.controller, waitOut },
  run: async ({ pages, waitOut }, { input }) => {
    const { link, retryIn } = input;
    pages.set({ link, page: "password", alert: "wait" });
    if (await waitOut.run({ input: { retryIn } })) return;

    const shown = pages.of({ link }).get();
    if (shown?.page === "password" && shown.alert === "wait") {
      pages.set({ ...shown, alert: "none" });
    }
  },
});

/**
 * You press Open on the password page: `share.open` with the password. `open` shows the canvas;
 * `wrong` says so; `slow` says to wait, until `retryIn` has passed, then asks again with no alert
 * (Open still calls, and the server answers `slow` until then, even to the right password);
 * `gone` says the link has ended.
 */
export const enterPassword = operation({
  label: "viewer.enterPassword",
  input: z.object({ link: z.string(), password: typedPassword }),
  depends: {
    pages: gates.controller,
    keptName,
    showAnswer,
    waitThenAsk,
    open: frames.viewer["share.open"],
  },
  run: async ({ pages, keptName, showAnswer, waitThenAsk, open }, { input }) => {
    const { link, password } = input;
    const name = keptName.run();
    if (name === null) return pages.set({ link, page: "name" });

    const answer = await open.run({ input: { link, name, password } });
    if (answer.kind !== "slow") return showAnswer.run({ input: { link, again: false, answer } });

    return waitThenAsk.run({ input: { link, retryIn: answer.retryIn } });
  },
});

/** A refusal that says the link has ended: `mayRead` turned the pass away. */
const endedFault = z.object({ payload: z.object({ ended: z.literal(endedRefusal.ended) }) });

/** A refusal that says a password set or changed ended the pass. */
const lockedFault = z.object({ payload: z.object({ locked: z.literal(lockedRefusal.locked) }) });

/**
 * The tab's canvas read, watched. A read refused `{ locked: true }` while the tab shows the
 * canvas: a password set or changed ended the pass, so the tab forgets it and asks the password.
 * A read refused `{ ended: true }` while the tab shows the
 * canvas: the link may be live and only this pass ended (the link's oldest, past 1000). The page
 * says Opening and opens the link once more: `gone` shows the ended page; `open` the canvas. A
 * refusal of that new pass before it reads shows the ended page, with no third try. Once it
 * reads, a later refusal (trimmed once more, met on a reconnect) opens the link once more again.
 */
const refusals = resource({
  label: "viewer.refusals",
  target: "scope",
  depends: {
    faults: frames.board.faults,
    pages: gates.controller,
    shown: shownLink.controller,
    passes: heldPasses.controller,
    openLink,
  },
  factory: ({ faults, pages, shown, passes, openLink }, ctx) => {
    const unwatch = faults.watch((next) => {
      const link = shown.get();
      const gate = pages.of({ link }).get();
      if (gate?.page !== "canvas") return;

      // The read is back: a later refusal opens the link once more again.
      if (next.frames === undefined) return gate.again && pages.set({ ...gate, again: false });

      if (lockedFault.safeParse(next.frames).success) {
        passes.delete({ link });
        return pages.set({ link, page: "password", alert: "none" });
      }
      if (!endedFault.safeParse(next.frames).success) return;
      if (gate.again) return pages.set({ link, page: "ended" });

      pages.delete({ link });
      void openLink.run({ input: { link, again: true } });
    });
    ctx.defer(() => unwatch());

    return { watching: true };
  },
});

/** The route's loader: you open the link, and the tab watches its canvas read for refusals. */
export const openPage = operation({
  label: "viewer.openPage",
  input: z.object({ link: z.string(), stop: z.instanceof(AbortSignal) }),
  depends: { refusals, openLink },
  run: ({ openLink }, { input }) => openLink.run({ input }),
});

/** You give your name (Continue): this browser keeps it, and the link opens with it. */
export const giveName = operation({
  label: "viewer.giveName",
  input: z.object({ link: z.string(), name: viewerName }),
  depends: { openLink },
  run: async ({ openLink }, { input }) => {
    localStorage.setItem(nameKey, input.name.trim());
    await openLink.run({ input: { link: input.link } });
  },
});

/**
 * The tab's meta, on each message: the issue board's `who`, and the pass once the tab holds one
 * (the board's `mayRead` takes it). The page's socket sends it (`ws.client({ meta: tabMeta })`).
 */
export const tabMeta = operation({
  label: "viewer.tabMeta",
  depends: { who: whoMeta, passes: heldPasses.controller, shown: shownLink },
  run: async ({ who, passes, shown }): Promise<Record<string, string>> => {
    const pass = passes.of({ link: shown }).get()?.pass;

    return { ...(await who.run()), ...(pass ? { pass } : {}) };
  },
});
