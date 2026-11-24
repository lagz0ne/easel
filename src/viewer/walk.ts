import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { mapJson } from "@/map/text";
import type { MapJson } from "@/map/text";
import { walkMark, walkPost } from "@/map/walk";

import { drafts, openedRequest, pickPlace, requestMode, typeText } from "./draft";
import type { Place } from "./draft";
import { findOpen } from "./find";
import { panelOpen } from "./follow";
import { walkFit, walking } from "./walking";
import type { Walk } from "./walking";

const none = { kind: "none" } as const;

const walkNow = z.custom<Walk>((value) => typeof value === "object" && value !== null);

export const startWalk = operation({
  label: "viewer.startWalk",
  input: z.object({ map: z.string() }),
  depends: {
    walk: walking.controller,
    drafts: drafts.controller,
    mode: requestMode.controller,
    find: findOpen.controller,
    opened: openedRequest.controller,
    panel: panelOpen.controller,
  },
  run: ({ walk, drafts, mode, find, opened, panel }, { input }) => {
    drafts.set(null);
    mode.set(false);
    find.set(false);
    opened.set(null);
    panel.set(false);

    walk.set({ map: input.map, path: [], told: none, waits: [] });
  },
});

export const leaveWalk = operation({
  label: "viewer.leaveWalk",
  depends: { walk: walking.controller, drafts: drafts.controller, mode: requestMode.controller },
  run: ({ walk, drafts, mode }) => {
    if (drafts.get()) return { kind: "stays" } as const;

    mode.set(false);
    walk.set(null);
    return { kind: "left" } as const;
  },
});

export const walkFree = operation({
  label: "viewer.walkFree",
  depends: { drafts, mode: requestMode },
  run: ({ drafts, mode }) => !mode && drafts === null,
});

export const walkMove = operation({
  label: "viewer.walkMove",
  input: z.object({
    now: walkNow,
    shown: z.object({ state: z.string(), value: z.unknown() }),
    state: z.string(),
    value: z.unknown(),
    map: mapJson,
  }),
  depends: { walk: walking.controller, walkFree },
  run: ({ walk, walkFree }, { input: { now, shown, state, value, map } }) => {
    if (!walkFree.run()) return { kind: "held", value: shown.value } as const;

    const moved = map.moves.some((move) => move.from === shown.state && move.to === state);
    if (!moved) {
      walk.set({ ...now, told: { kind: "offMap", from: shown.state, to: state } });
      return { kind: "offMap", value: shown.value } as const;
    }

    walk.set({ ...now, path: [...now.path, { state, value }], told: none });
    return { kind: "moved" } as const;
  },
});

export const walkState = operation({
  label: "viewer.walkState",
  input: z.object({ now: walkNow, state: z.string(), value: z.unknown(), map: mapJson }),
  depends: { walk: walking.controller, walkMove },
  run: ({ walk, walkMove }, { input: { now, state, value, map } }) => {
    const shown = now.path.at(-1);
    if (shown && state !== shown.state) {
      return walkMove.run({ input: { now, shown, state, value, map } });
    }
    if (shown || state === map.start) {
      walk.set({ ...now, path: [...now.path.slice(0, -1), { state, value }] });
      return { kind: shown ? "stayed" : "started" } as const;
    }

    const start = map.states.find((each) => each.state === map.start)?.sample;
    walk.set({ ...now, told: { kind: "offMap", from: map.start, to: state } });
    return { kind: "offMap", value: start } as const;
  },
});

export const walkPosted = operation({
  label: "viewer.walkPosted",
  input: z.object({ post: z.unknown(), map: mapJson }),
  depends: { walk: walking.controller, walkState },
  run: ({ walk, walkState }, { input }) => {
    const now = walk.get();
    const read = walkPost.safeParse(input.post);
    if (!now || !read.success) return { kind: "ignored" } as const;

    const post = read.data;
    switch (post.kind) {
      case "waits":
        walk.set({ ...now, waits: post.calls });
        return { kind: "waits" } as const;
      case "state":
        return walkState.run({ input: { now, ...post, map: input.map } });
    }
  },
});

export const walkStep = operation({
  label: "viewer.walkStep",
  input: z.enum(["back", "restart"]),
  depends: { walk: walking.controller, walkFree },
  run: ({ walk, walkFree }, { input }) => {
    const now = walk.get();
    if (!now || now.path.length < 2 || !walkFree.run()) return { kind: "stays" } as const;

    const path = input === "back" ? now.path.slice(0, -1) : now.path.slice(0, 1);
    walk.set({ ...now, path, told: none, waits: [] });
    return { kind: "went", value: path.at(-1)?.value } as const;
  },
});

export const walkPick = operation({
  label: "viewer.walkPick",
  input: z.object({ id: z.number(), answer: z.string() }),
  depends: { walk: walking, walkFree },
  run: ({ walk, walkFree }, { input }) => {
    const waits = walk?.waits.some((wait) => wait.id === input.id);
    if (!waits || !walkFree.run()) return { kind: "stays" } as const;

    return { kind: "picked", order: { easel: walkMark, kind: "answer", ...input } } as const;
  },
});

export const askForIt = operation({
  label: "viewer.askForIt",
  input: z.object({ canvas: z.string(), place: z.custom<Place>(), text: z.string() }),
  depends: { walk: walking.controller, mode: requestMode.controller, pickPlace, typeText },
  run: ({ walk, mode, pickPlace, typeText }, { input }) => {
    const now = walk.get();
    if (!now || now.told.kind === "none") return { kind: "stays" } as const;

    walk.set({ ...now, told: none });
    mode.set(true);
    pickPlace.run({ input: { canvas: input.canvas, place: input.place } });
    typeText.run({ input: input.text });
    return { kind: "asked" } as const;
  },
});

export const walkPort = resource({
  label: "viewer.walkPort",
  target: "scope",
  depends: { walkPosted, walkStep, walkPick, fit: walkFit.controller },
  factory: ({ walkPosted, walkStep, walkPick, fit }, ctx) => {
    const now: {
      frame: HTMLIFrameElement | null;
      map: MapJson | null;
      stage: HTMLElement | null;
      size: { w: number; h: number };
    } = { frame: null, map: null, stage: null, size: { w: 1, h: 1 } };

    const port = {
      go: (value: unknown) =>
        now.frame?.contentWindow?.postMessage({ easel: walkMark, kind: "go", value }, "*"),

      hear: (event: MessageEvent) => {
        if (!now.frame || !now.map || event.source !== now.frame.contentWindow) return;
        const out = walkPosted.run({ input: { post: event.data, map: now.map } });
        if (out.kind === "offMap" || out.kind === "held") port.go(out.value);
      },

      attach: (frame: HTMLIFrameElement | null, map: MapJson | null) => {
        now.frame = frame;
        now.map = map;
      },

      step: (to: "back" | "restart") => {
        const out = walkStep.run({ input: to });
        if (out.kind === "went") port.go(out.value);
      },

      pick: (id: number, answer: string) => {
        const out = walkPick.run({ input: { id, answer } });
        if (out.kind === "picked") now.frame?.contentWindow?.postMessage(out.order, "*");
      },

      measure: (stage: HTMLElement | null, size: { w: number; h: number }) => {
        now.stage = stage;
        now.size = size;
        port.fit();
      },

      fit: () => {
        if (!now.stage) return;
        const { clientWidth, clientHeight } = now.stage;
        fit.set(Math.min(1, clientWidth / now.size.w, clientHeight / now.size.h));
      },
    };

    addEventListener("message", port.hear);
    addEventListener("resize", port.fit);
    ctx.defer(() => {
      removeEventListener("message", port.hear);
      removeEventListener("resize", port.fit);
    });
    return port;
  },
});
