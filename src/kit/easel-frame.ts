import {
  type Capsule,
  createScope,
  type Data,
  type Operation,
  parse,
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
import { teamText } from "./texts";

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
  fixture: z.string().optional(),
});

const fixturesShown = z.record(z.string(), z.record(z.string(), z.unknown()));

export type FrameFixtures = Readonly<Record<string, Data.Cell<unknown>>>;

const refusal = z.object({ kind: z.string(), payload: z.unknown() });

const teamShown = z.record(z.string(), teamText);

const kitPost = z.object({
  easel: z.literal("kit"),
  look: z.string(),
  css: z.string(),
  texts: teamShown.optional().catch(undefined),
  fixtures: fixturesShown.optional().catch(undefined),
});

type FrameCapsule = Capsule.Installable &
  ((values: Record<string, unknown>) => Capsule.Installable);

export type MountApp = (
  | {
      View: ComponentType;
      frame?: undefined;
      part?: undefined;
      panes?: undefined;
      fixtures?: undefined;
    }
  | {
      View: Resource.Handle<ComponentType>;
      frame?: FrameCapsule;
      part?: FramePart;
      panes?: FramePanes;
      fixtures?: FrameFixtures;
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

const fixtureNamesOf = (cells: FrameFixtures) => {
  const named = document.getElementById("easel-fixtures")?.textContent;
  const shown = fixturesShown.catch({}).parse(JSON.parse(named || "{}"));
  const names = Object.values(cells).flatMap((cell) => Object.keys(shown[cell.label] ?? {}));
  return [...new Set(names)];
};

const offerOf = (frame: FrameCapsule | undefined, cells: FrameFixtures) => {
  const config: Record<string, { values: unknown[]; default?: unknown; name?: string }> = {};
  const keys = z.record(z.string(), z.unknown()).catch({}).parse(fieldOf(frame, "config"));
  for (const [key, entry] of Object.entries(keys)) {
    const tag = fieldOf(entry, "kind") === undefined ? entry : fieldOf(entry, "target");
    const parse = fieldOf(tag, "parse");
    const values = fieldOf(parse instanceof z.ZodType ? z.toJSONSchema(parse) : null, "enum");
    if (!Array.isArray(values)) continue;

    const label = fieldOf(tag, "label");
    const name = typeof label === "string" ? { name: label } : {};
    config[key] = fieldOf(tag, "hasDefault")
      ? { values, default: fieldOf(tag, "def"), ...name }
      : { values, ...name };
  }
  const fixtures = fixtureNamesOf(cells);
  return { easel: "axes", locales: [...locales], config, fixtures };
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
  const [told, given, named] = ["easel-axes", "easel-texts", "easel-fixtures"].map((id) =>
    JSON.parse(document.getElementById(id)?.textContent || "{}"),
  );

  const axes = axesShape.parse(told);
  const texts = teamShown.catch({}).parse(given);
  const fixtures = fixturesShown.catch({}).parse(named);
  const css = document.getElementById("easel-kit")?.textContent ?? "";

  return { ...axes, texts, fixtures, css };
};

const showKit = ({ look, css, texts, fixtures }: z.infer<typeof kitPost>) => {
  const shown = [
    ["easel-look", look],
    ["easel-kit", css],
    ["easel-texts", texts && JSON.stringify(texts)],
    ["easel-fixtures", fixtures && JSON.stringify(fixtures)],
  ] as const;
  for (const [id, text] of shown) {
    const place = document.getElementById(id);
    if (place && text !== undefined) place.textContent = text;
  }
};

const fixtureValue = (cell: Data.Cell<unknown>, name: string, raw: unknown) => {
  try {
    return cell.parse ? parse(cell.parse, raw) : raw;
  } catch (error) {
    const issues = fieldOf(error, "issues") ?? String(error);
    throw Object.assign(new Error("FixtureInvalid"), {
      kind: "FixtureInvalid",
      payload: { cell: cell.label, fixture: name, issues },
    });
  }
};

const setFixtures = (
  live: { controller: (cell: Data.Cell<unknown>) => { set: (value: unknown) => void } },
  cells: FrameFixtures,
  shown: { fixture?: string; fixtures: z.infer<typeof fixturesShown> },
) => {
  const name = shown.fixture;
  if (name === undefined) return;

  const found = Object.values(cells).flatMap((cell) => {
    const raw = shown.fixtures[cell.label]?.[name];
    return raw === undefined ? [] : [{ cell, raw }];
  });
  for (const { cell, raw } of found) live.controller(cell).set(fixtureValue(cell, name, raw));
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
        const { locale, css, texts } = axesNow();
        const next = createScope({
          capsules: [
            look({ values: values(), css }),
            copy({ locale, team: texts }),
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
    const kit = kitPost.safeParse(data);
    if (kit.success) {
      const { look, css, texts } = kit.data;
      const [shown, made, said] = ["easel-look", "easel-kit", "easel-texts"].map((id) =>
        document.getElementById(id),
      );
      if (shown) shown.textContent = look;
      if (made) made.textContent = css;
      if (said && texts) said.textContent = JSON.stringify(texts);

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
  const fixtureCells = app.fixtures ?? {};
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
    if (closing) return;

    const made: { scope: Root | null; live: boolean } = { scope: null, live: false };
    const shown = await Promise.resolve()
      .then(async () => {
        const { css, texts, fixtures, ...axes } = axesNow();
        const own = app.frame ? [app.frame(axes.config)] : [];
        const served = app.part
          ? [...app.part.serve(), portServer({ services: app.part.services })]
          : [];

        const next = createScope({
          capsules: [
            look({ values: values(), css }),
            copy({ locale: axes.locale, team: texts }),
            ui(),
            ...own,
            ...served,
          ],
        });
        made.scope = next;

        const live = await next.ready;
        setFixtures(live, fixtureCells, { fixture: axes.fixture, fixtures });
        made.live = true;
        const children = createElement(typeof View === "function" ? View : live.resolve(View));
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
    const kit = kitPost.safeParse(data);
    if (kit.success) {
      showKit(kit.data);
      if (port && kit.data.fixtures && typeof app.View !== "function") {
        port.postMessage(offerOf(app.frame, fixtureCells));
      }

      steps = steps.then(draw);
    }
    if (field("easel") !== "close" || closing) return;

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

      if (typeof app.View !== "function") port.postMessage(offerOf(app.frame, fixtureCells));
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
  steps = steps.then(draw);
};
