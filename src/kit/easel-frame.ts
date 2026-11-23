import {
  type Capsule,
  createScope,
  type Data,
  type Operation,
  type Resource,
  type transport,
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
import {
  type ControlPlace,
  controlPost,
  controlShown,
  type PanePlace,
  panePlace,
  linkPost,
} from "./controls";
import { portClient, portServer } from "./port-link";

export const frameLogic = <
  const L extends { cells: Record<string, unknown>; ops: Record<string, unknown> },
>(
  logic: L,
): L => logic;

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export type FrameControl = {
  readonly label: string;
  readonly run: Operation.Handle<unknown, unknown>;
  readonly value?: Data.Cell<unknown>;
  readonly place?: ControlPlace;
};

export const frameControls = <const C extends Readonly<Record<string, FrameControl>>>(
  controls: C,
): C => controls;

export type FrameLink = typeof portClient;

export type FramePart = {
  readonly services: readonly transport.Service[];
  readonly serve: () => readonly Capsule.Installable[];
  readonly reach: (link: FrameLink) => readonly Capsule.Installable[];
};

export const framePart = <const S extends FramePart>(part: S): S => part;

export type FramePanes = Partial<Record<PanePlace, Resource.Handle<ComponentType>>>;

export const framePanes = <const D extends FramePanes>(panes: D): D => panes;

const axesShape = z.object({
  locale: z.enum(locales).default("en"),
  config: z.record(z.string(), z.unknown()).default({}),
});

const refusal = z.object({ kind: z.string(), payload: z.unknown() });

type FrameCapsule = Capsule.Installable &
  ((values: Record<string, unknown>) => Capsule.Installable);

export type MountApp = (
  | { View: ComponentType; frame?: undefined; part?: undefined; panes?: undefined }
  | {
      View: Resource.Handle<ComponentType>;
      frame?: FrameCapsule;
      part?: FramePart;
      panes?: FramePanes;
    }
) & { controls?: Readonly<Record<string, FrameControl>> };

type Root = ReturnType<typeof createScope>;

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

const fieldOf = (unit: unknown, key: string): unknown =>
  (typeof unit === "object" || typeof unit === "function") && unit !== null
    ? Reflect.get(unit, key)
    : undefined;

const offerOf = (frame: FrameCapsule | undefined) => {
  const config: Record<string, { values: unknown[]; default?: unknown }> = {};
  const keys = z.record(z.string(), z.unknown()).catch({}).parse(fieldOf(frame, "config"));
  for (const [key, entry] of Object.entries(keys)) {
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

const kindOfType = new Map([
  ["boolean", "switch"],
  ["number", "number"],
  ["integer", "number"],
  ["string", "text"],
]);

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
      place: control.place,
      kind,
      values,
      min: fieldOf(json, "minimum"),
      max: fieldOf(json, "maximum"),
    });
    return shown.success ? [shown.data] : [];
  });

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

const paneShape = z
  .string()
  .transform((text) => JSON.parse(text))
  .pipe(z.object({ place: panePlace }));

const axesNow = () => {
  const told = document.getElementById("easel-axes")?.textContent;
  const axes = axesShape.parse(JSON.parse(told || "{}"));
  return { ...axes, css: document.getElementById("easel-kit")?.textContent ?? "" };
};

const mountPane = (app: MountApp, place: PanePlace) => {
  const [Pane, part] = [app.panes?.[place], app.part];
  const box = document.createElement("div");
  box.style.display = "inline-block";
  box.style.width = "max-content";
  document.body.style.margin = "0";
  document.body.append(box);
  const root = createRoot(box);
  let port: MessagePort | null = null;
  let link: MessagePort | null = null;
  let scope: Root = createScope();
  let steps = Promise.resolve();

  const draw = async () => {
    const on = link;
    if (!Pane || !part || !on) return;

    const made: { scope: Root | null } = { scope: null };
    const shown = await Promise.resolve()
      .then(async () => {
        const { locale, css } = axesNow();
        const next = createScope({
          capsules: [
            look({ values: values(), css }),
            copy({ locale }),
            ui(),
            portClient({ port: Promise.resolve(on) }),
            ...part.reach(portClient),
          ],
        });
        made.scope = next;

        const live = await next.ready;
        const children = createElement(live.resolve(Pane));
        return createElement(ScopeProvider, { scope: next, children });
      })
      .catch(refused);
    const before = scope;
    scope = made.scope ?? createScope();
    flushSync(() => root.render(shown));
    await before.close();
  };

  const size = () => {
    const box$ = box.getBoundingClientRect();
    port?.postMessage({ easel: "size", w: Math.ceil(box$.width), h: Math.ceil(box$.height) });
  };
  new ResizeObserver(size).observe(box);

  const take = (data: unknown, ends: readonly MessagePort[]) => {
    const field = (key: string): unknown =>
      typeof data === "object" && data !== null ? Reflect.get(data, key) : undefined;
    const [easel, look, css] = [field("easel"), field("look"), field("css")];
    if (easel === "kit" && typeof look === "string" && typeof css === "string") {
      const styles = [document.getElementById("easel-look"), document.getElementById("easel-kit")];
      if (styles[0]) styles[0].textContent = look;
      if (styles[1]) styles[1].textContent = css;
      steps = steps.then(draw);
    }
    const end = ends[0];
    if (!linkPost.safeParse(data).success || !end) return;

    link = end;
    steps = steps.then(draw);
  };

  addEventListener("message", (event) => {
    const given = event.ports[0];
    if (event.source !== parent || !given) return;

    port?.close();
    port = given;
    port.addEventListener("message", (on) => take(on.data, on.ports));
    port.start();
    size();
    take(event.data, []);
  });

  const hello = () => {
    if (port) return;
    parent.postMessage({ easel: "hello" }, "*");
    setTimeout(hello, 50);
  };
  hello();
};

export const mount = (app: MountApp) => {
  const pane = paneShape.safeParse(document.getElementById("easel-pane")?.textContent);
  if (pane.success) return mountPane(app, pane.data.place);

  let port: MessagePort | null = null;
  let closing = false;
  const root = createRoot(document.body);
  let scope: Root = createScope();
  let steps = Promise.resolve();
  const controls = app.controls ?? {};
  const shownControls = controlsOf(controls);
  let watching: Array<() => void> = [];
  let started = false;
  const places = app.part ? panePlace.options.filter((one) => app.panes?.[one]) : [];
  const links = new Map<PanePlace, AbortController>();

  const closed = () => {
    if (port) port.postMessage({ easel: "closed" });
    else parent.postMessage({ easel: "closed" }, "*");
  };

  const told = () => {
    if (!started) return;

    const values: Record<string, unknown> = {};
    for (const [key, control] of Object.entries(controls)) {
      if (control.value) values[key] = scope.controller(control.value).get();
    }
    port?.postMessage({ easel: "values", values });
  };

  const watch = (live: boolean) => {
    for (const end of watching) end();
    started = live;
    const cells = live ? Object.values(controls).flatMap((c) => (c.value ? [c.value] : [])) : [];
    watching = cells.map((cell) => scope.controller(cell).watch(told));
    if (live && shownControls.length) told();
  };

  const link = (place: PanePlace) => {
    if (!started || !port || closing || !places.includes(place)) return;

    links.get(place)?.abort();
    const stop = new AbortController();
    const channel = new MessageChannel();
    links.set(place, stop);
    const input = { port: channel.port1, stop: stop.signal };
    void scope.ready
      .then((live) => (live ? live.run(portServer.accept, { input }) : undefined))
      .catch(() => undefined);
    port.postMessage({ easel: "link", place }, [channel.port2]);
  };

  const unlink = () => {
    for (const stop of links.values()) stop.abort();
    links.clear();
  };

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

  const draw = async () => {
    const View = app.View;
    if (typeof View === "function" || closing) return;

    const made: { scope: Root | null; live: boolean } = { scope: null, live: false };
    const shown = await Promise.resolve()
      .then(async () => {
        const { css, ...axes } = axesNow();
        const own = app.frame ? [app.frame(axes.config)] : [];
        const served = app.part
          ? [...app.part.serve(), portServer({ services: app.part.services })]
          : [];

        const next = createScope({
          capsules: [
            look({ values: values(), css }),
            copy({ locale: axes.locale }),
            ui(),
            ...own,
            ...served,
          ],
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
    unlink();
    for (const place of places) link(place);
    await before.close();
  };

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
        unlink();
        root.unmount();
        return scope.close();
      })
      .then(closed, closed);
  };

  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const given = event.ports[0];
    if (given) {
      port?.close();
      port = given;
      port.addEventListener("message", (on) => {
        take(on.data);
        steps = steps.then(() => runControl(on.data));
        const ask = linkPost.safeParse(on.data);
        if (ask.success) steps = steps.then(() => link(ask.data.place));
      });
      port.start();

      if (typeof app.View !== "function") port.postMessage(offerOf(app.frame));
      if (shownControls.length) {
        port.postMessage({ easel: "controls", controls: shownControls });
        told();
      }
      if (places.length) port.postMessage({ easel: "panes", places });
      for (const place of places) link(place);
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
