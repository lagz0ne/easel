import { data, operation, resource } from "@tinkered/core";
import { z } from "zod";

const menuNames = ["pages", "locale", "states", "list", "more", "zoom"] as const;

type MenuName = (typeof menuNames)[number];

export const openMenu = data<MenuName | null>({ label: "viewer.openMenu", initial: null });

export const setMenu = operation({
  label: "viewer.setMenu",
  input: z.object({ menu: z.enum(menuNames), open: z.boolean() }),
  depends: { now: openMenu.controller },
  run: ({ now }, { input: { menu, open } }) => {
    if (open) return now.set(menu);
    if (now.get() === menu) now.set(null);
  },
});

const narrowQuery = "(max-width: 639.98px)";

export const screenSize = resource({
  label: "viewer.screenSize",
  target: "scope",
  factory: () => ({ narrow: () => matchMedia(narrowQuery).matches }),
});
