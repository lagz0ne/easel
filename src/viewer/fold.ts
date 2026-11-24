import { data, resource, tag } from "@tinkered/core";

import { foundFrame } from "./stage";

export const foldDelayMs = 300;

export type Side = "left" | "right";

type FocusAt = { key: string; on: "tab" | "column" };

export type FoldNow = {
  pointer: string | null;
  lingering: readonly string[];
  focus: FocusAt | null;
  pressed: readonly string[];
};

export const foldNow = data<FoldNow>({
  label: "viewer.foldNow",
  initial: { pointer: null, lingering: [], focus: null, pressed: [] },
});

const foldFrame = tag<string>({ label: "viewer.foldFrame" });

const foldSide = tag<Side>({ label: "viewer.foldSide" });

export const columnOpen = resource({
  label: "viewer.columnOpen",
  config: { id: foldFrame.required, side: foldSide.required },
  depends: { now: foldNow, marked: foundFrame },
  factory: ({ now, marked }, { config: { id, side } }) =>
    marked === id ||
    now.pointer === id ||
    now.lingering.includes(id) ||
    now.pressed.includes(`${side} ${id}`) ||
    (now.focus?.key === `${side} ${id}` && now.focus.on === "column"),
});

export const fold = resource({
  label: "viewer.fold",
  target: "scope",
  depends: { now: foldNow.controller },
  factory: ({ now }, ctx) => {
    const delays = new Map<string, AbortController>();
    let closed = false;

    const at = {
      stopDelay: (id: string) => {
        delays.get(id)?.abort();
        delays.delete(id);
      },

      pointerOn: (id: string, pointerType: string) => {
        if (pointerType === "touch") return;
        at.stopDelay(id);
        const was = now.get();
        now.set({ ...was, pointer: id, lingering: was.lingering.filter((one) => one !== id) });
      },

      pointerOff: (id: string, pointerType: string) => {
        if (pointerType === "touch") return;
        at.stopDelay(id);
        const was = now.get();
        now.set({
          ...was,
          pointer: was.pointer === id ? null : was.pointer,
          lingering: [...was.lingering.filter((one) => one !== id), id],
        });

        const wait = new AbortController();
        delays.set(id, wait);
        ctx.clock.sleep(foldDelayMs, AbortSignal.any([wait.signal, ctx.signal])).then(
          () => delays.get(id) === wait && at.delayEnds(id),
          () => undefined,
        );
      },

      delayEnds: (id: string) => {
        delays.delete(id);
        if (closed) return;
        const was = now.get();
        const kept = was.focus?.key ?? null;
        now.set({
          ...was,
          lingering: was.lingering.filter((one) => one !== id),
          pressed: was.pressed.filter((key) => key === kept || !key.endsWith(` ${id}`)),
        });
      },

      press: (id: string, side: Side) => {
        const was = now.get();
        const key = `${side} ${id}`;
        const pressed = was.pressed.includes(key)
          ? was.pressed.filter((one) => one !== key)
          : [...was.pressed, key];
        now.set({ ...was, pressed });
      },

      focusOn: (id: string, side: Side, target: Element) => {
        const shown = target.matches(":focus-visible");
        const on = target.matches("[data-fold-tab]") ? "tab" : "column";
        now.set({ ...now.get(), focus: shown ? { key: `${side} ${id}`, on } : null });
      },

      focusOff: (id: string, side: Side, next: EventTarget | null) => {
        const key = `${side} ${id}`;
        const into = next instanceof Element ? next.closest("[data-fold]") : null;
        if (into?.getAttribute("data-fold") === key) return;

        const was = now.get();
        const stays = was.pointer === id || was.lingering.includes(id);
        now.set({
          ...was,
          focus: was.focus?.key === key ? null : was.focus,
          pressed: stays ? was.pressed : was.pressed.filter((one) => one !== key),
        });
      },

      pressOutside: (event: PointerEvent) => {
        const into = event.target instanceof Element ? event.target.closest("[data-fold]") : null;
        const inside = into?.getAttribute("data-fold") ?? null;
        const was = now.get();
        const pressed = was.pressed.filter((key) => key === inside);
        if (pressed.length !== was.pressed.length) now.set({ ...was, pressed });
      },
    };

    document.addEventListener("pointerdown", at.pressOutside, { capture: true });
    ctx.defer(() => {
      closed = true;
      document.removeEventListener("pointerdown", at.pressOutside, { capture: true });
      for (const wait of delays.values()) wait.abort();
      delays.clear();
    });

    return at;
  },
});
