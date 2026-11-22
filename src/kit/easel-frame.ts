import {
  type Capsule,
  createScope,
  type Data,
  type Operation,
  type Resource,
} from "@tinkered/core";
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
import { controlPost, controlShown } from "./controls";

// `@easel/frame`: easel's helper for an app frame (SPEC-kit.md § App frames; frame-apps decision
// 10). It is in the runtime of each kit version (`runtime.server.ts`), and runs only in a frame's
// sandboxed iframe; no page or server module imports it. It is small on purpose: `frameLogic` (the
// shape of `logic`), `cn` (the `cn` of shadcn/ui), `frameControls` (the controls of the viewer's
// panel) and `mount` (what the composed document runs).
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

/**
 * A control of the viewer's panel (SPEC-kit.md § The capsules, "The controls in the viewer"; the
 * chart kit-frame-controls): its label, the operation that it runs in the frame's live scope, and,
 * for a value, the cell whose value it shows. The input schema of `run` gives the control: none
 * is a button, `z.boolean()` a switch, `z.enum()` a select, `z.number()` a number field, and
 * `z.string()` a text field.
 */
export type FrameControl = {
  readonly label: string;
  readonly run: Operation.Handle<unknown, unknown>;
  readonly value?: Data.Cell<unknown>;
};

/**
 * The controls of a frame, by key, in the order of the panel. The entry file exports them as
 * `controls`: a person changes the frame's state with them in place of a snapshot.
 */
export const frameControls = <const C extends Readonly<Record<string, FrameControl>>>(
  controls: C,
): C => controls;

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
 * What the JS of a frame mounts: a View component (with its `logic`, which the View imports in
 * the file), or a capsule frame: a View resource and the frame's own capsule. The axes of a
 * capsule frame are in the document (`easel-axes`, from `composeApp`).
 */
export type MountApp = (
  | { View: ComponentType; frame?: undefined }
  | { View: Resource.Handle<ComponentType>; frame?: FrameCapsule }
) & { controls?: Readonly<Record<string, FrameControl>> };

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

/** A field of a unit of Tinker (a tag, an edge of a config key), or undefined. */
const fieldOf = (unit: unknown, key: string): unknown =>
  (typeof unit === "object" || typeof unit === "function") && unit !== null
    ? Reflect.get(unit, key)
    : undefined;

/**
 * The axes that a capsule frame can show (SPEC-kit.md § The capsules, "The axes in the viewer"):
 * the locales of the kit, and each config key of its own capsule whose schema lists its values
 * (an enum), with its default. The page offers only these values.
 */
const offerOf = (frame: FrameCapsule | undefined) => {
  const config: Record<string, { values: unknown[]; default?: unknown }> = {};
  const keys = z.record(z.string(), z.unknown()).catch({}).parse(fieldOf(frame, "config"));
  for (const [key, entry] of Object.entries(keys)) {
    // A required key is an edge ({ kind: "required", target: tag }); a key with a default, the tag.
    const tag = fieldOf(entry, "kind") === undefined ? entry : fieldOf(entry, "target");
    const parse = fieldOf(tag, "parse");
    const values = fieldOf(parse instanceof z.ZodType ? z.toJSONSchema(parse) : null, "enum");
    if (!Array.isArray(values)) continue;
    config[key] = fieldOf(tag, "hasDefault")
      ? { values, default: fieldOf(tag, "def") }
      : { values };
  }
  return { easel: "axes", locales: [...locales], config };
};

/** The control of a value, by the JSON Schema type of its operation's input. */
const kindOfType = new Map([
  ["boolean", "switch"],
  ["number", "number"],
  ["integer", "number"],
  ["string", "text"],
]);

/**
 * The controls that the panel can draw, in order. A control whose input the panel cannot draw (an
 * object, a union) is left out.
 */
const controlsOf = (controls: Readonly<Record<string, FrameControl>>) =>
  Object.entries(controls).flatMap(([key, control]) => {
    const input = control.run.input;
    const json = input instanceof z.ZodType ? z.toJSONSchema(input, { io: "input" }) : null;
    const [type, values] = [fieldOf(json, "type"), fieldOf(json, "enum")];

    const kind =
      input === undefined
        ? "action"
        : Array.isArray(values)
          ? "select"
          : kindOfType.get(String(type));
    const shown = controlShown.safeParse({
      key,
      label: control.label,
      kind,
      values,
      min: fieldOf(json, "minimum"),
      max: fieldOf(json, "maximum"),
    });
    return shown.success ? [shown.data] : [];
  });

/**
 * Mounts the app of a frame (SPEC-kit.md § App frames, "The runtime", "The hello and the port",
 * "Close before the iframe goes"; § The capsules, "A capsule frame"). It renders into
 * `document.body`, so the first render is in the document before its `load` event: a View
 * component in a scope with no capsules (it starts at once), in one synchronous step; a capsule
 * frame after the start of its scope, which runs no timer. It says hello to its parent at once and
 * each 50 ms until its parent gives it a port. A kit message replaces the text of the styles
 * `easel-look` and `easel-kit`; a capsule frame then draws in a new scope with that look. On
 * `close` it unmounts the View, closes the scope (each deferred end runs), then posts `closed`. It
 * answers only its parent, and sends only the hello, the axes of a capsule frame and its controls
 * (on each new port), its values (after each draw, run and change of a value cell) and `closed`.
 * A `control` message runs its operation in the scope on screen, after the draws before it.
 */
export const mount = (app: MountApp) => {
  let port: MessagePort | null = null;
  let closing = false;
  const root = createRoot(document.body);
  // The scope on screen. Each step (a draw, the close) waits for the one before it.
  let scope: Root = createScope();
  let steps = Promise.resolve();
  const controls = app.controls ?? {};
  const shownControls = controlsOf(controls);
  // The ends of the watches on the value cells of the scope on screen, and whether it started: a
  // refused start leaves a scope with no cells.
  let watching: Array<() => void> = [];
  let started = false;

  const closed = () => {
    if (port) port.postMessage({ easel: "closed" });
    else parent.postMessage({ easel: "closed" }, "*");
  };

  // The value of each value control in the scope on screen, on the port (chart kit-frame-controls).
  const told = () => {
    if (!started) return;

    const values: Record<string, unknown> = {};
    for (const [key, control] of Object.entries(controls)) {
      if (control.value) values[key] = scope.controller(control.value).get();
    }
    port?.postMessage({ easel: "values", values });
  };

  // The scope on screen is new: the watches move to its value cells, and the page gets its values.
  const watch = (live: boolean) => {
    for (const end of watching) end();
    started = live;
    const cells = live ? Object.values(controls).flatMap((c) => (c.value ? [c.value] : [])) : [];
    watching = cells.map((cell) => scope.controller(cell).watch(told));
    if (live && shownControls.length) told();
  };

  // A control's operation runs in the scope on screen; a refused run tells the page its kind.
  const runControl = async (posted: unknown) => {
    const asked = controlPost.safeParse(posted);
    if (!asked.success || closing || !started) return;

    const { key, value } = asked.data;
    const control = controls[key];
    const live = await scope.ready;
    if (!control || !live) return;

    const result = await live.settle(control.run, { rawInput: value });
    if (result.status === "failed") {
      const { kind } = refusal.catch({ kind: "Error", payload: null }).parse(result.error);
      port?.postMessage({ easel: "ran", key, failed: kind });
    }
    told();
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

    const made: { scope: Root | null; live: boolean } = { scope: null, live: false };
    // A refusal draws outside the provider: the provider of a scope that did not start throws.
    const shown = await Promise.resolve()
      .then(async () => {
        const told = document.getElementById("easel-axes")?.textContent;
        const axes = axesShape.parse(JSON.parse(told || "{}"));
        const css = document.getElementById("easel-kit")?.textContent ?? "";
        const own = app.frame ? [app.frame(axes.config)] : [];

        const next = createScope({
          capsules: [look({ values: values(), css }), copy({ locale: axes.locale }), ui(), ...own],
        });
        made.scope = next;

        const live = await next.ready;
        made.live = true;
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
    watch(made.live);
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
        watch(false);
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
      port.addEventListener("message", (on) => {
        take(on.data);
        // A control comes only on the port, and runs after the steps before it.
        steps = steps.then(() => runControl(on.data));
      });
      port.start();

      // A capsule frame tells the page what it can show, on each new port (chart kit-frame-axes).
      if (typeof app.View !== "function") port.postMessage(offerOf(app.frame));
      // A frame with controls tells the page what they are (chart kit-frame-controls).
      if (shownControls.length) port.postMessage({ easel: "controls", controls: shownControls });
      if (shownControls.length) told();
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
    watch(true);
  }
  steps = steps.then(draw);
};
