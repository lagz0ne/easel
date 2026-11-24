import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { walkBackend, walkBackends } from "@/map/walk";

import { pickBoard, picksNow, switchValue } from "./switches";
import type { SwitchOffer } from "./switches";
import { walkFree } from "./walk";
import { liveServer, liveServers, walking } from "./walking";
import type { LiveServer } from "./walking";

const none = { kind: "none" } as const;

export const backendSwitch: SwitchOffer = {
  name: walkBackend.label,
  values: walkBackends.options,
  default: walkBackends.enum.examples,
};

export const backendNow = resource({
  label: "viewer.backendNow",
  config: {},
  depends: { picks: picksNow({}), switchValue },
  factory: ({ picks, switchValue }) => {
    const board = picks.get().board[backendSwitch.name];
    const value = switchValue.run({ input: { offer: backendSwitch, board } });
    return walkBackends.catch(walkBackends.enum.examples).parse(value);
  },
});

const heldWhy: Readonly<Record<Exclude<LiveServer, "ready">, string>> = {
  none: "No live server is set up for this easel.",
  starting: "The live server of this build starts.",
  failed: "The live server did not start.",
  gone: "The live server stopped. The walk starts again when it is ready.",
};

export const walkHold = operation({
  label: "viewer.walkHold",
  input: z.object({ backend: walkBackends, server: liveServers }),
  run: (_, { input: { backend, server } }) => {
    if (backend === "examples" || server === "ready") return { kind: "runs" } as const;

    return { kind: "held", why: heldWhy[server] } as const;
  },
});

export const backendHold = resource({
  label: "viewer.backendHold",
  config: {},
  depends: { backend: backendNow({}), server: liveServer, walkHold },
  factory: ({ backend, server, walkHold }) =>
    walkHold.run({ input: { backend: backend.get(), server } }),
});

export const pickBackend = operation({
  label: "viewer.pickBackend",
  input: walkBackends,
  depends: { walk: walking.controller, walkFree, pickBoard, backend: backendNow({}) },
  run: ({ walk, walkFree, pickBoard, backend }, { input }) => {
    const now = walk.get();
    if (!now || !walkFree.run()) return { kind: "stays" } as const;
    if (backend.get() === input) return { kind: "same" } as const;

    pickBoard.run({ input: { name: backendSwitch.name, value: input } });
    walk.set({ ...now, path: [], told: none, waits: [] });
    return { kind: "restarted" } as const;
  },
});
