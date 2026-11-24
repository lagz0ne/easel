import { data, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { firstPage } from "@/frames/contract";

import { openMenu } from "./overlays";
import { stage } from "./stage";

const pagesCanvas = tag<string>({ label: "viewer.pagesCanvas" });

const pagesPage = tag<string>({ label: "viewer.pagesPage" });

export const pageParam = "page";

export const pagePicked = data<{ canvas: string; page: string } | null>({
  label: "viewer.pagePicked",
  initial: null,
});

export const addressPage = resource({
  label: "viewer.addressPage",
  factory: () => new URLSearchParams(location.search).get(pageParam),
});

export const pageList = resource({
  label: "viewer.pageList",
  config: { canvas: pagesCanvas.required },
  depends: (c) => ({ all: frames.board.pages.where({ canvas: c.canvas }) }),
  factory: ({ all }) => (all.get() ?? []).toSorted((a, b) => a.order - b.order),
});

const pageToShow = operation({
  label: "viewer.pageToShow",
  input: z.object({
    wanted: z.string().nullable(),
    keys: z.array(z.string()),
    loaded: z.boolean(),
  }),
  run: (_, { input: { wanted, keys, loaded } }) => {
    if (!loaded) return wanted;
    if (wanted !== null && keys.includes(wanted)) return wanted;

    return keys[0] ?? firstPage.key;
  },
});

export const shownPage = resource({
  label: "viewer.shownPage",
  config: { canvas: pagesCanvas.required },
  depends: (c) => ({
    list: pageList({ canvas: c.canvas }),
    state: frames.board.status(frames.board.pages.where({ canvas: c.canvas })),
    picked: pagePicked,
    asked: addressPage,
    pageToShow,
  }),
  factory: ({ list, state, picked, asked, pageToShow }, ctx) => {
    const wanted = picked?.canvas === ctx.config.canvas ? picked.page : asked;
    const keys = list.get().map((p) => p.key);
    const loaded = (state.get()?.status ?? "pending") !== "pending";
    return pageToShow.run({ input: { wanted, keys, loaded } });
  },
});

export const pageInAddress = resource({
  label: "viewer.pageInAddress",
  config: { canvas: pagesCanvas.required },
  depends: (c) => ({ page: shownPage({ canvas: c.canvas }) }),
  factory: ({ page }) => {
    const now = page.get();
    const url = new URL(location.href);
    if (now === null || url.searchParams.get(pageParam) === now) return now;

    url.searchParams.set(pageParam, now);
    history.replaceState(history.state, "", url);
    return now;
  },
});

export const shellBoxes = resource({
  label: "viewer.shellBoxes",
  config: { canvas: pagesCanvas.required, page: pagesPage.required },
  depends: (c) => ({
    list: frames.board.frames.where({ canvas: c.canvas, page: c.page }),
    at: stage,
  }),
  factory: ({ list, at }) => {
    const now = list.get() ?? [];
    at.rebox(now);
    return now.length;
  },
});

export const turnTo = operation({
  label: "viewer.turnTo",
  input: z.object({ canvas: z.string(), page: z.string() }),
  depends: { picked: pagePicked.controller },
  run: ({ picked }, { input }) => picked.set(input),
});

export const pickPage = operation({
  label: "viewer.pickPage",
  input: z.object({ canvas: z.string(), page: z.string(), shown: z.string() }),
  depends: { at: stage, menu: openMenu.controller, turnTo },
  run: ({ at, menu, turnTo }, { input: { canvas, page, shown } }) => {
    menu.set(null);
    at.dropGoal();
    if (page === shown) return at.fit();

    turnTo.run({ input: { canvas, page } });
  },
});

const spot = z.object({ x: z.number(), y: z.number() });

export const showFrameOf = operation({
  label: "viewer.showFrameOf",
  input: z.object({ canvas: z.string(), id: z.string(), spot: spot.nullable() }),
  depends: { ask: frames.pass["share.frame"], at: stage, turnTo },
  run: async ({ ask, at, turnTo }, { input: { canvas, id, spot } }) => {
    const answer = await ask.run({ input: { canvas, id } });
    switch (answer.kind) {
      case "found":
        at.seek(
          spot
            ? { to: "spot", page: answer.page, id, ...spot }
            : { to: "frame", page: answer.page, id },
        );
        turnTo.run({ input: { canvas, page: answer.page } });
        return answer;
      case "gone":
        return answer;
    }
  },
});

export const showRequest = operation({
  label: "viewer.showRequest",
  input: z.object({
    canvas: z.string(),
    shown: z.string(),
    here: z.boolean(),
    r: z.object({
      frameId: z.string().nullable(),
      page: z.string().nullable(),
      x: z.number(),
      y: z.number(),
    }),
    gone: z.object({ page: z.string(), x: z.number(), y: z.number() }).nullable(),
  }),
  depends: { at: stage, turnTo, showFrameOf },
  run: async ({ at, turnTo, showFrameOf }, { input: { canvas, shown, here, r, gone } }) => {
    const { frameId: id, x, y } = r;
    if (id === null) {
      const page = r.page ?? shown;
      at.seek({ to: "point", page, x, y });
      return turnTo.run({ input: { canvas, page } });
    }
    if (here) return at.seek({ to: "spot", page: shown, id, x, y });
    if (gone === null) {
      await showFrameOf.run({ input: { canvas, id, spot: { x, y } } });
      return;
    }

    at.seek({ to: "point", ...gone });
    turnTo.run({ input: { canvas, page: gone.page } });
  },
});
