import { data, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";

export const findOpen = data({ label: "viewer.findOpen", initial: false });

export const findText = data({ label: "viewer.findText", initial: "" });

export const findPick = data({ label: "viewer.findPick", initial: 0 });

export const toggleFind = operation({
  label: "viewer.toggleFind",
  depends: { open: findOpen.controller, text: findText.controller, pick: findPick.controller },
  run: ({ open, text, pick }) => {
    text.set("");
    pick.set(0);
    open.set(!open.get());
  },
});

export const closeFind = operation({
  label: "viewer.closeFind",
  depends: { open: findOpen.controller },
  run: ({ open }) => open.set(false),
});

export const typeFind = operation({
  label: "viewer.typeFind",
  input: z.string(),
  depends: { text: findText.controller, pick: findPick.controller },
  run: ({ text, pick }, { input }) => {
    text.set(input);
    pick.set(0);
  },
});

export const movePick = operation({
  label: "viewer.movePick",
  input: z.object({ by: z.number(), count: z.number() }),
  depends: { pick: findPick.controller },
  run: ({ pick }, { input: { by, count } }) => {
    if (count === 0) return;

    pick.set(Math.min(count - 1, Math.max(0, pick.get() + by)));
  },
});

const findCanvas = tag<string>({ label: "viewer.findCanvas" });

export const findMatches = resource({
  label: "viewer.findMatches",
  config: { canvas: findCanvas.required },
  depends: (c) => ({ list: frames.board.frames.where({ canvas: c.canvas }), text: findText }),
  factory: ({ list, text }) => {
    const all = (list.get() ?? []).map((f) => ({ id: f.id, name: f.name, page: f.page }));
    const wanted = text.trim().toLocaleLowerCase();
    if (!wanted) return { total: all.length, names: all };

    const named = all.map((f) => ({ ...f, at: f.name.toLocaleLowerCase().indexOf(wanted) }));
    const starts = named.filter((f) => f.at === 0);
    const inside = named.filter((f) => f.at > 0);

    return {
      total: all.length,
      names: [...starts, ...inside].map(({ id, name, page }) => ({ id, name, page })),
    };
  },
});
