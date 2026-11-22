import { type Capsule, createScope, type Resource } from "@tinkered/core";
import { ScopeProvider } from "@tinkered/react";
import { type ClassValue, clsx } from "clsx";
import { type ComponentType, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { twMerge } from "tailwind-merge";
import { z } from "zod";

import { copy, locales } from "./capsules/copy";
import { look } from "./capsules/look";
import { ui } from "./capsules/ui";

// `@easel/frame`: easel's helper for an app frame (SPEC-kit.md § App frames; frame-apps decision
// 10). It is in the runtime of each kit version (`runtime.server.ts`), and runs only in a frame's
// sandboxed iframe; no page or server module imports it. It is small on purpose: `frameLogic` (the
// shape of `logic`), `cn` (the `cn` of shadcn/ui) and `mount` (what the composed document runs).
// `mount` draws the two forms of a frame: a View component with its `logic`, or a capsule frame
// (SPEC-kit.md § The capsules, "A capsule frame"): a View resource, with its own capsule `frame`
// if it has one, drawn in a scope of the kit's capsules (`@easel/kit`, the same chunk).

/**
 * The `logic` of a frame: its Tinker cells and operations. The View reads `logic.cells.<name>`
 * (`useData`) and runs `logic.ops.<name>` (`useRun`). In the frame's own scope (build order items
 * 2 to 6) it is the cells and operations as given; the board worker (item 7) will give the same
 * names over its port.
 */
export const frameLogic = <
  const L extends { cells: Record<string, unknown>; ops: Record<string, unknown> },
>(
  logic: L,
): L => logic;

/** The class names of its arguments, as clsx joins them; a later utility wins over an earlier one. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** The locale and the config of a capsule frame's own capsule (its data state): its axes. */
const axesShape = z.object({
  locale: z.enum(locales).default("en"),
  config: z.record(z.string(), z.unknown()).default({}),
});

/** The kind and the payload of a refused start (`raise` of Tinker). */
const refusal = z.object({ kind: z.string(), payload: z.unknown() });

/** A frame's own capsule: installed as it is, or with the config of its axes. */
type FrameCapsule = Capsule.Installable &
  ((values: Record<string, unknown>) => Capsule.Installable);

/**
 * What the composed document mounts: a View component (with its `logic`, which the View imports
 * in the file), or a capsule frame: a View resource, the frame's own capsule, and the axes.
 */
export type MountApp =
  | { View: ComponentType; frame?: undefined; axes?: unknown }
  | { View: Resource.Handle<ComponentType>; frame?: FrameCapsule; axes?: unknown };

type Root = ReturnType<typeof createScope>;

/** What a capsule frame shows when its start is refused: the kind and the payload. */
const refused = (error: unknown) => {
  const known = refusal.safeParse(error);
  const { kind, payload } = known.success ? known.data : { kind: "Error", payload: String(error) };
  return createElement(
    "div",
    { role: "alert", "data-easel-refused": kind },
    createElement("p", null, `This frame does not start: ${kind}.`),
    createElement("pre", null, JSON.stringify(payload, null, 2)),
  );
};

/**
 * Mounts the app of a frame (SPEC-kit.md § App frames, "The runtime", "The hello and the port",
 * "Close before the iframe goes"; § The capsules, "A capsule frame"). It renders into
 * `document.body`, so the first render is in the document before its `load` event: a View
 * component in a scope with no capsules (it starts at once), in one synchronous step; a capsule
 * frame after the start of its scope, which runs no timer. It says hello to its parent at once and
 * each 50 ms until its parent gives it a port. A kit message replaces the text of the styles
 * `easel-look` and `easel-kit`; a capsule frame then draws in a new scope with that look. On
 * `close` it unmounts the View, closes the scope (each deferred end runs), then posts `closed`. It
 * answers only its parent, and sends only the hello and `closed`.
 */
export const mount = (app: MountApp) => {
  let port: MessagePort | null = null;
  let closing = false;
  const root = createRoot(document.body);
  // The scope on screen. Each step (a draw, the close) waits for the one before it.
  let scope: Root = createScope();
  let steps = Promise.resolve();

  const closed = () => {
    if (port) port.postMessage({ easel: "closed" });
    else parent.postMessage({ easel: "closed" }, "*");
  };

  // The look values of the frame's `easel-look` sheet, so the scope has the look that it shows.
  const values = () => {
    const style = document.getElementById("easel-look");
    const sheet = style instanceof HTMLStyleElement ? style.sheet : null;
    const found: Record<string, string> = {};
    for (const rule of sheet ? Array.from(sheet.cssRules) : []) {
      if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ":root") continue;
      for (const name of Array.from(rule.style).filter((one) => one.startsWith("--"))) {
        found[name] = rule.style.getPropertyValue(name).trim();
      }
    }
    return found;
  };

  // A capsule frame in a new scope of its install list: the View, or the refusal of its start.
  const draw = async () => {
    const View = app.View;
    if (typeof View === "function" || closing) return;

    const made: { scope: Root | null } = { scope: null };
    // A refusal draws outside the provider: the provider of a scope that did not start throws.
    const shown = await Promise.resolve()
      .then(async () => {
        const axes = axesShape.parse(app.axes ?? {});
        const css = document.getElementById("easel-kit")?.textContent ?? "";
        const own = app.frame ? [app.frame(axes.config)] : [];

        const next = createScope({
          capsules: [look({ values: values(), css }), copy({ locale: axes.locale }), ui(), ...own],
        });
        made.scope = next;

        const live = await next.ready;
        const children = createElement(live.resolve(View));
        return createElement(ScopeProvider, { scope: next, children });
      })
      .catch(refused);
    const next = made.scope ?? createScope();
    if (closing) {
      await next.close();
      return;
    }

    const before = scope;
    scope = next;
    flushSync(() => root.render(shown));
    await before.close();
  };

  // A message from the page: `{ easel: "kit", look, css }` (K7), or `{ easel: "close" }`.
  const take = (data: unknown) => {
    const field = (key: string): unknown =>
      typeof data === "object" && data !== null ? Reflect.get(data, key) : undefined;
    const [easel, look, css] = [field("easel"), field("look"), field("css")];
    if (easel === "kit" && typeof look === "string" && typeof css === "string") {
      const styles = [document.getElementById("easel-look"), document.getElementById("easel-kit")];
      if (styles[0]) styles[0].textContent = look;
      if (styles[1]) styles[1].textContent = css;
      steps = steps.then(draw);
    }
    if (easel !== "close" || closing) return;

    closing = true;
    steps = steps
      .then(() => {
        root.unmount();
        return scope.close();
      })
      .then(closed, closed);
  };

  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    // Two hellos can be in flight: each answer has a new port, and the page keeps the newest.
    const given = event.ports[0];
    if (given) {
      port?.close();
      port = given;
      port.addEventListener("message", (on) => take(on.data));
      port.start();
    }
    take(event.data);
  });

  const hello = () => {
    if (port || closing) return;
    parent.postMessage({ easel: "hello" }, "*");
    setTimeout(hello, 50);
  };
  hello();

  if (typeof app.View === "function") {
    const children = createElement(app.View);
    flushSync(() => root.render(createElement(ScopeProvider, { scope, children })));
  }
  steps = steps.then(draw);
};
