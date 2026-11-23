import { data, operation, resource, tag } from "@tinkered/core";
import { useData, useResource, useRun } from "@tinkered/react";
import { Fragment, memo } from "react";
import { z } from "zod";

import { frames } from "@/frames";
import { boardDoc } from "@/frames/contract";
import type { FrameInfo } from "@/frames/contract";
import { compose, composeApp, composeKit, frameAxes } from "@/kit/compose";
import { paneScript } from "@/kit/controls";
import type { ControlShown, PanePlace } from "@/kit/controls";

import "./canvas.css";
import { aimFromLink, openFromLink } from "./act";
import { escapeKey, openRequest, pickPlace, requestMode, resendOnBack } from "./draft";
import { clockTicker, controlsFor, panelOpen, requestPlaces } from "./follow";
import type { RequestView } from "./follow";
import { Panel, RequestsButton } from "./panel";
import { FramePicture } from "./picture";
import { RequestButton, Requests } from "./request";
import {
  axesPost,
  closeDone,
  holding,
  liveSet,
  offeredAxes,
  painted,
  paintScript,
  shownControls,
  shownPanes,
  stage,
  zoomShown,
} from "./stage";
import type { KitMessage } from "./stage";

// The canvas behind `/s/<link>` (SPEC-viewer.md § See the frames, § Pan and zoom, § Watch an
// agent work, § Lose the socket; the viewer-canvas chart). React draws a shell per frame when the
// board changes; the stage moves the camera, culls the shells and picks the live set without a
// render. A live frame's document comes from the board's `docs`, read by `of({ canvas, id })`
// only (fact rule 5), composed with the canvas's `kit` (SPEC-kit.md § compose), and runs
// sandboxed with scripts and no same origin (judged rule 4).

type Stage = ReturnType<typeof stage.factory>;

/**
 * A refusal that ended the pass: the link ended, or a password set or changed. The gate's
 * `refusals` takes the tab to the ended page, the link opened again, or the password page.
 */
const ended = z.union([
  z.object({ ended: z.literal(true) }),
  z.object({ locked: z.literal(true) }),
]);

/** The canvases whose frames this tab has read at least once. */
const readOnce = resource({
  label: "viewer.readOnce",
  target: "scope",
  factory: () => new Set<string>(),
});

const canvasKey = tag<string>({ label: "viewer.canvas" });

/**
 * Whether the tab has read this canvas's frames at least once. A board read that arrived and a
 * socket that dropped since still say the canvas is empty; a socket that never read says nothing.
 */
const hasRead = resource({
  label: "viewer.hasRead",
  config: { canvas: canvasKey.required },
  depends: (c) => ({
    state: frames.board.status(frames.board.frames.where({ canvas: c.canvas })),
    seen: readOnce,
  }),
  factory: ({ state, seen }, { config }) => {
    if (state.get()?.status === "ready") seen.add(config.canvas);

    return seen.has(config.canvas);
  },
});

/** No frames: said once a read arrived, and still while Reconnecting, never before any read. */
function Empty({ canvas, ready, lost }: { canvas: string; ready: boolean; lost: boolean }) {
  const read = useData(hasRead({ canvas }));
  if (!ready && !(lost && read)) return null;

  return <p className="e-empty">This canvas has no frames yet.</p>;
}

/** The page's status: the zoom, in steps. */
function Zoom() {
  const pct = useData(zoomShown);
  return (
    <output className="e-dock-zoom" aria-label="Zoom">
      {pct}%
    </output>
  );
}

const docCanvas = tag<string>({ label: "viewer.docCanvas" });
const docId = tag<string>({ label: "viewer.docId" });

/** A live frame's document: its version, the key of its axes, and the composed html. */
/** A composed document; `serial` names its iframe, so a later pick of the same axes is a new one. */
type Composed = { version: number; key: string; html: string; app: boolean; serial: number };

/** The documents of a frame that show: the current one, and each app document that is closing. */
type ShownDocs = { current: Composed | null; leaving: readonly Composed[] };

/** The locale that a capsule frame draws in when none is picked (`@easel/frame`'s default). */
const defaultLocale = "en";

/**
 * The picks of this tab (SPEC-kit.md § The capsules, "The axes in the viewer"; chart
 * kit-frame-axes): one locale for the canvas, and a value of each config key for each frame.
 */
export const axesPicked = data<{
  locale: string | null;
  config: Readonly<Record<string, Readonly<Record<string, string>>>>;
}>({ label: "viewer.axesPicked", initial: { locale: null, config: {} } });

/** The person picks a locale for the canvas. */
export const pickLocale = operation({
  label: "viewer.pickLocale",
  input: z.string(),
  depends: { picked: axesPicked.controller },
  run: ({ picked }, { input }) => picked.set({ ...picked.get(), locale: input }),
});

/** The person picks a value of a config key of a frame (its data state). */
export const pickConfig = operation({
  label: "viewer.pickConfig",
  input: z.object({ id: z.string(), key: z.string(), value: z.string() }),
  depends: { picked: axesPicked.controller },
  run: ({ picked }, { input: { id, key, value } }) => {
    const now = picked.get();
    const config = { ...now.config, [id]: { ...now.config[id], [key]: value } };
    picked.set({ ...now, config });
  },
});

/** The picks of a frame's config keys that its version posted, other than their defaults. */
const configPicks = operation({
  label: "viewer.configPicks",
  input: z.object({
    axes: axesPost.shape.config,
    mine: z.record(z.string(), z.string()).optional(),
  }),
  run: (_, { input: { axes, mine = {} } }) =>
    Object.fromEntries(
      Object.entries(axes).flatMap(([key, axis]) => {
        const value = mine[key];
        const good = value !== undefined && value !== axis.default && axis.values.includes(value);
        return good ? [[key, value]] : [];
      }),
    ),
});

/**
 * The axes to compose a frame version with: the picks, once that version posted its axes, and
 * only the values that it posted. A value equal to its default is left out, so a frame with no
 * pick, or with no axes, gets null and is not composed again (APlainFrameIgnoresThePicks).
 */
export const axesFor = operation({
  label: "viewer.axesFor",
  input: z.object({
    id: z.string(),
    version: z.number(),
    offer: axesPost.extend({ version: z.number() }).optional(),
    picked: z.object({
      locale: z.string().nullable(),
      config: z.record(z.string(), z.record(z.string(), z.string())),
    }),
  }),
  depends: { configPicks },
  run: ({ configPicks }, { input: { id, version, offer, picked } }) => {
    if (offer?.version !== version) return null;

    const pick = picked.locale;
    const known = pick !== null && pick !== defaultLocale && offer.locales.includes(pick);
    const config = configPicks.run({ input: { axes: offer.config, mine: picked.config[id] } });
    const some = known || Object.keys(config).length > 0;
    return some ? { ...(known ? { locale: pick } : {}), config } : null;
  },
});

/**
 * The document that a live frame was composed with, for its version, while the frame is live. A
 * change of the kit composes nothing again: it reaches the document on its port, so the iframe
 * keeps its document and does not reload (K7). An app document that stops showing (another
 * version, another pick, out of the live set) stays in `leaving` until the stage says that it is
 * done closing (chart kit-app-frame); an HTML document goes at once.
 */
const docMemo = resource({
  label: "viewer.docMemo",
  config: { canvas: docCanvas.required, id: docId.required },
  factory: (_, { config }) => {
    let shown: Composed | null = null;
    let serial = 0;
    let view: ShownDocs = { current: null, leaving: [] };
    return {
      shown: () => shown,
      serial: () => ++serial,
      /** The documents that show with `current`; the same object while nothing changed. */
      next: (current: Composed | null, done: Readonly<Record<string, true>>) => {
        const went = shown && shown !== current && shown.app ? [shown] : [];
        const leaving = [...went, ...view.leaving].filter((d) => !done[`${config.id} ${d.serial}`]);
        shown = current;
        if (current === view.current && leaving.length === view.leaving.length) return view;

        view = { current, leaving };
        return view;
      },
    };
  },
});

/**
 * One version of a frame, composed with a kit: `compose` of its html and made CSS, or, for an app
 * frame (`app`), `composeApp` of its JS and its runtime (SPEC-kit.md § App frames).
 */
const composeDoc = operation({
  label: "viewer.composeDoc",
  input: z.object({
    doc: boardDoc,
    kit: composeKit.nullable(),
    axes: frameAxes.nullable(),
    key: z.string(),
    serial: z.number(),
  }),
  depends: { compose, composeApp },
  run: ({ compose, composeApp }, { input: { doc, kit, axes, key, serial } }): Composed => {
    const look = kit ?? { look: "", css: "" };
    const html = doc.app
      ? composeApp.run({
          input: {
            js: doc.app.js,
            css: doc.css ?? "",
            kit: look,
            runtime: doc.app.runtime,
            ...(axes ? { axes } : {}),
          },
        })
      : compose.run({ input: { html: doc.html, css: doc.css, kit: look } });
    return { version: doc.version, key, html, app: Boolean(doc.app), serial };
  },
});

/**
 * A live frame's document as it shows: `composeDoc` of the board's version of it, its made CSS
 * and the canvas's kit (fact rule 8: the look, the kit and the piece script come only from
 * `compose`). Null until the document, and the kit that it needs, have come. A version is
 * composed once for each pick of its axes (`axesFor`), with the kit of that moment; a later kit
 * goes on the document's port. Another pick is another document, so another scope.
 */
const liveDoc = resource({
  label: "viewer.liveDoc",
  config: { canvas: docCanvas.required, id: docId.required },
  depends: (c) => ({
    doc: frames.board.docs.of({ canvas: c.canvas, id: c.id }),
    kit: frames.board.kit.of({ canvas: c.canvas }),
    memo: docMemo({ canvas: c.canvas, id: c.id }),
    offered: offeredAxes,
    picked: axesPicked,
    live: liveSet,
    done: closeDone,
    axesFor,
    composeDoc,
  }),
  factory: ({ doc, kit, memo, offered, picked, live, done, axesFor, composeDoc }, ctx) => {
    const { id } = ctx.config;
    const at = doc.get();
    const look = kit.get() ?? null;
    const kept = memo.get();
    if (!live.includes(id) || !at || (at.css !== null && look === null)) {
      return kept.next(null, done);
    }

    const axes = axesFor.run({ input: { id, version: at.version, offer: offered[id], picked } });
    const key = `${at.version}:${JSON.stringify(axes)}`;
    const before = kept.shown();
    if (before?.key === key) return kept.next(before, done);

    const made = composeDoc.run({
      input: { doc: at, kit: look, axes, key, serial: kept.serial() },
    });
    return kept.next(made, done);
  },
});

/**
 * The canvas's kit, given to the stage each time it comes or changes (SPEC-viewer § Watch an
 * agent work, step 4): the stage answers each hello with it, and sends it on each port.
 */
const kitFeed = resource({
  label: "viewer.kitFeed",
  config: { canvas: canvasKey.required },
  depends: (c) => ({ kit: frames.board.kit.of({ canvas: c.canvas }), at: stage }),
  factory: ({ kit, at }) => {
    const now = kit.get();
    if (!now) return null;

    const message: KitMessage = { easel: "kit", kit: now.kit, look: now.look, css: now.css };
    at.sendKit(message);
    return now.kit;
  },
});

/**
 * A live frame's documents: the composed version of it, with the paint script at its end, and each
 * app document that is closing, hidden (chart kit-app-frame). One list, so an iframe that stops
 * showing keeps its element, and its app can end its work.
 */
function LiveDoc({ canvas, frame, at }: { canvas: string; frame: FrameInfo; at: Stage }) {
  const docs = useData(liveDoc({ canvas, id: frame.id }));
  const shown = docs.current ? [docs.current, ...docs.leaving] : docs.leaving;

  // A closing one keeps its srcdoc (a new one would load it again), but it leaves the page's view.
  return (
    <>
      {shown.map((doc) => (
        <iframe
          key={doc.serial}
          className="e-doc"
          sandbox="allow-scripts"
          data-id={frame.id}
          data-version={doc.version}
          data-app={doc.app ? "" : undefined}
          srcDoc={doc.html + paintScript.replace("__V__", String(doc.version))}
          {...(doc === docs.current
            ? { ref: at.doc, title: frame.name }
            : {
                ref: at.closingDoc,
                className: "e-doc e-doc-closing",
                "aria-hidden": true,
                tabIndex: -1,
                "data-closing": `${frame.id} ${doc.serial}`,
              })}
        />
      ))}
    </>
  );
}

/**
 * A frame's shell at its box: its name, its card with the picture of its version on it, and its
 * document when it is live. The card stays on top until the document of this version painted. The
 * picture is drawn at half size, or a quarter when half is over 8 megapixels; with no key (pictures
 * are off), or a frame too big even at a quarter, the card is plain. An img decodes off the main
 * thread, and the card's color shows until it has. The picture is of the canvas's kit version: a
 * new one gives a new address, and the img shows the last picture until the new one has come.
 */
const Shell = memo(function Shell({
  canvas,
  frame,
  at,
}: {
  canvas: string;
  frame: FrameInfo & { k?: string; gone?: true };
  at: Stage;
}) {
  const live = useData(liveSet, (ids) => ids.includes(frame.id));
  const held = useData(holding, (ids) => ids.includes(frame.id));
  const shown = useData(painted, (p) => p[frame.id]);
  const kitNow = useData(frames.board.kit.of({ canvas }))?.kit ?? null;
  const pane = { canvas, frame, at, live };

  return (
    <div
      className="e-shell"
      {...(frame.gone
        ? { hidden: true }
        : { ref: at.shell, role: "group", "aria-label": frame.name })}
      data-id={frame.id}
      data-x={frame.x}
      data-y={frame.y}
      data-w={frame.w}
      data-h={frame.h}
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
    >
      <div className="e-label" data-label>
        <span className="e-label-name">{frame.name}</span>
        <FrameAxes frame={frame} />
        <DockedControls {...pane} place="top" />
        <ControlsButton frame={frame} />
      </div>
      <DockedControls {...pane} place="left" />
      <DockedControls {...pane} place="right" />
      {live || held ? <LiveDoc canvas={canvas} frame={frame} at={at} /> : null}
      <div className="e-card" hidden={live && shown === frame.version}>
        <FramePicture
          canvas={canvas}
          frame={frame}
          version={frame.version}
          k={frame.k}
          kit={kitNow}
        />
      </div>
    </div>
  );
});

/**
 * The picks of a frame's own axes, after its name: one select for each config key that the live
 * version posted (its data state). A frame that posted none shows none (chart kit-frame-axes).
 */
function FrameAxes({ frame }: { frame: FrameInfo }) {
  const offer = useData(offeredAxes, (all) => all[frame.id]);
  const mine = useData(axesPicked, (p) => p.config[frame.id]);
  const pick = useRun(pickConfig);
  if (offer?.version !== frame.version) return null;

  const keys = Object.entries(offer.config);
  return (
    <>
      {keys.map(([key, axis]) => (
        <select
          key={key}
          className="e-axis"
          data-own-pointer
          aria-label={`${key} of ${frame.name}`}
          title={key}
          value={mine?.[key] ?? axis.default ?? axis.values[0]}
          onChange={(event) =>
            pick.run({ input: { id: frame.id, key, value: event.currentTarget.value } })
          }
        >
          {axis.values.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      ))}
    </>
  );
}

/** You press `Controls` on a frame's label: its panel opens, or closes; `Requests` closes. */
const toggleControls = operation({
  label: "viewer.toggleControls",
  input: z.string(),
  depends: { ctl: controlsFor.controller, requests: panelOpen.controller },
  run: ({ ctl, requests }, { input }) => {
    requests.set(false);
    ctl.set(ctl.get() === input ? null : input);
  },
});

/** A person runs a control in the panel: it goes to the frame's current document. */
const runControl = operation({
  label: "viewer.runControl",
  input: z.object({ id: z.string(), key: z.string(), value: z.unknown().optional() }),
  depends: { at: stage },
  run: ({ at }, { input }) => at.sendControl(input.id, input.key, input.value),
});

/**
 * The button `Controls` after a frame's name, once its current document posted controls (SPEC-kit
 * § The capsules, "The controls in the viewer"). It shows pressed while their panel is open.
 */
function ControlsButton({ frame }: { frame: FrameInfo }) {
  const has = useData(shownControls, (all) =>
    Boolean(all[frame.id]?.controls.some((c) => c.place === "panel")),
  );
  const open = useData(controlsFor, (id) => id === frame.id);
  const toggle = useRun(toggleControls);
  if (!has) return null;

  return (
    <button
      type="button"
      className="e-axis e-ctl-open"
      data-own-pointer
      aria-label={`Controls of ${frame.name}`}
      aria-pressed={open}
      title="Controls"
      onClick={() => toggle.run({ input: frame.id })}
    >
      <Icon d={icons.controls} />
    </button>
  );
}

type FieldProps = { id: string; control: ControlShown; value: unknown };

/** An action: a button that runs its operation. */
function ActionField({ id, control }: FieldProps) {
  const run = useRun(runControl);
  return (
    <button
      type="button"
      className="e-ctl-action"
      onClick={() => run.run({ input: { id, key: control.key } })}
    >
      {control.label}
    </button>
  );
}

/** A boolean value: a switch. */
function SwitchField({ id, control, value }: FieldProps) {
  const run = useRun(runControl);
  return (
    <label className="e-ctl-field">
      {control.label}
      <input
        type="checkbox"
        role="switch"
        checked={value === true}
        onChange={(event) =>
          run.run({ input: { id, key: control.key, value: event.currentTarget.checked } })
        }
      />
    </label>
  );
}

/** A value of a list: a select of the values that the frame posted. */
function SelectField({ id, control, value }: FieldProps) {
  const run = useRun(runControl);
  return (
    <label className="e-ctl-field">
      {control.label}
      <select
        value={typeof value === "string" ? value : ""}
        onChange={(event) =>
          run.run({ input: { id, key: control.key, value: event.currentTarget.value } })
        }
      >
        {control.values?.map((one) => (
          <option key={one} value={one}>
            {one}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A number or a text: a field that keeps each key (`defaultValue`) and runs its operation when it
 * loses the focus (Enter takes the focus away). A new value from the frame draws it again.
 */
function TypedField({ id, control, value }: FieldProps) {
  const run = useRun(runControl);
  const number = control.kind === "number";

  return (
    <label className="e-ctl-field">
      {control.label}
      <input
        key={String(value)}
        type={number ? "number" : "text"}
        min={control.min}
        max={control.max}
        defaultValue={typeof value === "number" || typeof value === "string" ? value : ""}
        onBlur={(event) => {
          const field = event.currentTarget;
          const next = number ? field.valueAsNumber : field.value;
          if (next === value || Number.isNaN(next)) return;

          run.run({ input: { id, key: control.key, value: next } });
        }}
        onKeyDown={(event) => (event.key === "Enter" ? event.currentTarget.blur() : undefined)}
      />
    </label>
  );
}

const fields = {
  action: ActionField,
  switch: SwitchField,
  select: SelectField,
  number: TypedField,
  text: TypedField,
} as const;

type RowProps = {
  id: string;
  control: ControlShown;
  values: Readonly<Record<string, unknown>>;
  failed: Readonly<Record<string, string>>;
};

/** One control: its field, with the value posted last, and the kind of a refused run after it. */
function ControlRow({ id, control, values, failed }: RowProps) {
  const Field = fields[control.kind];
  const refused = failed[control.key];
  return (
    <>
      <Field id={id} control={control} value={values[control.key]} />
      {refused ? (
        <span className="e-ctl-failed" role="alert">
          The frame refused it: {refused}.
        </span>
      ) : null}
    </>
  );
}

const placeWords = { top: "Top", left: "Left", right: "Right" } as const;

/** The controls that a frame's current document placed at `place`; in a column, each in a row. */
function PlacedRows({ frame, place }: { frame: FrameInfo; place: PanePlace }) {
  const now = useData(shownControls, (all) => all[frame.id]);
  if (!now) return null;

  const rows = now.controls
    .filter((c) => c.place === place)
    .map((control) => {
      const row = (
        <ControlRow id={frame.id} control={control} values={now.values} failed={now.failed} />
      );
      if (place === "top") return <Fragment key={control.key}>{row}</Fragment>;
      return (
        <li key={control.key} className="e-ctl-row">
          {row}
        </li>
      );
    });
  return <>{rows}</>;
}

type Placed = { canvas: string; frame: FrameInfo; at: Stage; live: boolean; place: PanePlace };

/**
 * The pane of a frame's current document at a place (SPEC-kit.md § The capsules, "A control in
 * its own scope"; chart kit-control-link): the frame's own document with the place of the pane, in
 * an iframe sandboxed as the frame's. It has the size of its content, which the pane posts.
 */
function PaneFrame({ canvas, frame, at, place }: Placed) {
  const doc = useData(liveDoc({ canvas, id: frame.id })).current;
  if (!doc?.app) return null;

  return (
    <iframe
      key={doc.serial}
      className="e-pane"
      sandbox="allow-scripts"
      data-id={frame.id}
      data-place={place}
      title={`${placeWords[place]} pane of ${frame.name}`}
      ref={at.pane}
      srcDoc={doc.html + paneScript.replace("__PLACE__", place)}
    />
  );
}

/**
 * The controls of a frame's current document that it placed at `top` (in its label row, after
 * its name) or docked to its `left` or `right` edge (a column outside the frame, at screen size),
 * and its pane at that place. The controls read the same values as the panel. While the frame has
 * no live document, they are not shown.
 */
function DockedControls(props: Placed) {
  const { frame, place, live } = props;
  const count = useData(
    shownControls,
    (all) => all[frame.id]?.controls.filter((c) => c.place === place).length ?? 0,
  );
  const hasPane = useData(shownPanes, (all) => Boolean(all[frame.id]?.includes(place)));
  const pane = hasPane && live ? <PaneFrame {...props} /> : null;
  if (count === 0 && !pane) return null;

  const label = `${placeWords[place]} controls of ${frame.name}`;
  if (place === "top") {
    return (
      <span className="e-ctl-top" role="group" aria-label={label} data-own-pointer>
        <PlacedRows frame={frame} place={place} />
        {pane}
      </span>
    );
  }
  return (
    <div className={`e-ctl-dock e-ctl-${place}`} role="group" aria-label={label} data-own-pointer>
      {count ? (
        <ul className="e-ctl-list">
          <PlacedRows frame={frame} place={place} />
        </ul>
      ) : null}
      {pane}
    </div>
  );
}

/**
 * The panel `Controls` at the right edge, for one frame: each control of its current document,
 * with the value that the document posted last, and the kind of a refused run. While the frame
 * has no live document, it says so. `Requests` takes the place when it opens.
 */
function ControlsPanel({ list }: { list: readonly FrameInfo[] }) {
  const id = useData(controlsFor);
  const requests = useData(panelOpen);
  const now = useData(shownControls, (all) => (id === null ? undefined : all[id]));
  const toggle = useRun(toggleControls);
  if (id === null || requests) return null;

  const name = list.find((f) => f.id === id)?.name ?? "";
  return (
    <aside className="e-panel" aria-label="Controls">
      <header className="e-panel-head">
        <h2>Controls</h2>
        <span className="e-ctl-frame">{name}</span>
        <button
          type="button"
          className="e-ctl-close"
          aria-label="Close the controls"
          title="Close"
          onClick={() => toggle.run({ input: id })}
        >
          <Icon d={icons.close} />
        </button>
      </header>
      <div className="e-panel-body">
        {now ? (
          <ul className="e-ctl-list">
            {now.controls
              .filter((control) => control.place === "panel")
              .map((control) => (
                <li key={control.key} className="e-ctl-row">
                  <ControlRow id={id} control={control} values={now.values} failed={now.failed} />
                </li>
              ))}
          </ul>
        ) : (
          <p className="e-none">The frame is not live. Move it into view to use its controls.</p>
        )}
      </div>
    </aside>
  );
}

/**
 * The locale of the canvas's capsule frames, in the dock: the locales that the live frames
 * posted. With no capsule frame live yet, it is not shown.
 */
function LocalePick() {
  const locales = useData(offeredAxes, (all) =>
    [...new Set(Object.values(all).flatMap((offer) => offer.locales))].join(" "),
  );
  const locale = useData(axesPicked, (p) => p.locale) ?? defaultLocale;
  const pick = useRun(pickLocale);
  if (locales === "") return null;

  return (
    <>
      <span className="e-dock-sep" aria-hidden="true" />
      <select
        className="e-axis e-axis-dock"
        aria-label="Locale"
        title="Locale"
        value={locale}
        onChange={(event) => pick.run({ input: event.currentTarget.value })}
      >
        {locales.split(" ").map((code) => (
          <option key={code} value={code}>
            {/* The name of the locale in its own language: `vi` is "Tiếng Việt". */}
            {new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code}
          </option>
        ))}
      </select>
    </>
  );
}

/** A dock button's icon: 16 px, a line drawing in the current colour (the library's Dock). */
export function Icon({ d }: { d: string }) {
  return (
    <svg className="e-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** The icons of the dock's camera buttons, as the library's Dock draws them. */
const icons = {
  zoomOut: "M5 12h14",
  zoomIn: "M5 12h14M12 5v14",
  fit: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2",
  // Lucide's sliders-horizontal and x.
  controls: "M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4",
  close: "M18 6 6 18M6 6l12 12",
} as const;

/**
 * The dock at the bottom centre of the canvas (SPEC-viewer § The page 2; the library's Dock): the
 * buttons `Request` and `Requests`, then `Zoom out`, the zoom status, `Zoom in` and `Fit`. The buttons show
 * icons; their names are their accessible names and their tooltips.
 */
function Dock({ at, canvas }: { at: Stage; canvas: string }) {
  return (
    <div className="e-dock" role="toolbar" aria-label="Canvas">
      <RequestButton />
      <RequestsButton canvas={canvas} />
      <LocalePick />
      <span className="e-dock-sep" aria-hidden="true" />
      <button
        type="button"
        className="e-dock-btn"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => at.zoomOut()}
      >
        <Icon d={icons.zoomOut} />
      </button>
      <Zoom />
      <button
        type="button"
        className="e-dock-btn"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={() => at.zoomIn()}
      >
        <Icon d={icons.zoomIn} />
      </button>
      <button
        type="button"
        className="e-dock-btn"
        aria-label="Fit"
        title="Fit"
        onClick={() => at.fit()}
      >
        <Icon d={icons.fit} />
      </button>
    </div>
  );
}

/**
 * The panel `Requests`, while it is open. A press on a row moves the canvas to the place of the
 * request and opens it (step 9): on its frame, or where its frame was before it was removed.
 */
function PanelAt({ at, canvas, list }: { at: Stage; canvas: string; list: readonly FrameInfo[] }) {
  const open = useData(panelOpen);
  const places = useData(requestPlaces({ canvas }));
  const opening = useRun(openRequest);
  if (!open) return null;

  const onOpen = ({ r }: RequestView) => {
    const place = places.get(r.n);
    if (place) at.show(place.x, place.y);
    opening.run({ input: { canvas, n: r.n } });
  };

  return <Panel canvas={canvas} list={list} onOpen={onOpen} />;
}

/** The connection: `Reconnecting` while the tab may be behind, or an alert on a fault. */
function Status({ lost, fault }: { lost: boolean; fault: boolean }) {
  if (lost) return <p role="status">Reconnecting</p>;
  if (fault) return <p role="alert">Something broke. Load the page again.</p>;

  return null;
}

/** The last frames that the canvas showed, by id: a deleted one keeps its box while it closes. */
const shownMemo = resource({
  label: "viewer.shownMemo",
  config: { canvas: canvasKey.required },
  factory: () => new Map<string, FrameInfo & { k?: string }>(),
});

/**
 * The frames that the canvas draws: the board's, and each deleted frame whose app document was
 * live, hidden, until its app closed (chart kit-app-frame: `holding`).
 */
const shownFrames = resource({
  label: "viewer.shownFrames",
  config: { canvas: canvasKey.required },
  depends: (c) => ({
    list: frames.board.frames.where({ canvas: c.canvas }),
    memo: shownMemo({ canvas: c.canvas }),
    live: liveSet,
    held: holding,
  }),
  factory: ({ list, memo, live, held }) => {
    const now = list.get() ?? [];
    const last = memo.get();
    const ids = new Set(now.map((f) => f.id));
    const shown: Array<FrameInfo & { k?: string; gone?: true }> = [...now];
    // A deleted frame keeps its place: React moves no shell, and a moved iframe loads again.
    for (const [at, f] of [...last.values()].entries()) {
      const keep = !ids.has(f.id) && (live.includes(f.id) || held.includes(f.id));
      if (keep) shown.splice(at, 0, { ...f, gone: true });
    }
    last.clear();
    for (const f of shown) last.set(f.id, f);

    return shown.length === now.length ? now : shown;
  },
});

/**
 * The canvas. A read refused `{ ended: true }` or `{ locked: true }` says Opening: the gate's
 * `refusals` opens the link once more, shows the ended page, or asks the password. A dropped socket keeps the frames read so far.
 */
export function Canvas({ canvas, opening }: { canvas: string; opening: React.ReactNode }) {
  const part = frames.board.frames.where({ canvas });
  const list = useData(part);
  const state = useData(frames.board.status(part));
  const lost = useData(frames.board.faults, (f) => f.frames?.fault === "link");
  const at = useResource(stage);
  const drawn = useData(shownFrames({ canvas }));
  useResource(resendOnBack);
  useResource(escapeKey);
  const pick = useRun(pickPlace);
  const asking = useData(requestMode);
  // The CSS gives request mode its pointer.
  const mode = useData(requestMode, (on) => (on ? "request" : "view"));
  const panel = useData(panelOpen);
  useData(clockTicker({ canvas }));
  const kitNow = useData(kitFeed({ canvas }));
  useData(openFromLink({ canvas }));
  useData(aimFromLink({ canvas }));
  if (state?.status === "fault" && ended.safeParse(state.fault.payload).success) return opening;

  return (
    <main className="e-canvas" data-panel={panel ? "open" : "closed"} data-mode={mode}>
      <section
        ref={at.viewport}
        className="e-viewport"
        aria-label="Frames"
        onClick={(event) => {
          const spot = at.pick(event.nativeEvent);
          if (!spot) return;

          const frame = spot.frame ? list.find((f) => f.id === spot.frame?.id) : undefined;
          if (frame && asking) at.askPart(frame.id, spot.x - frame.x, spot.y - frame.y);

          const place = frame
            ? {
                frameId: frame.id,
                frameName: frame.name,
                version: frame.version,
                kit: kitNow,
                x: spot.x - frame.x,
                y: spot.y - frame.y,
                box: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
              }
            : {
                frameId: null,
                frameName: null,
                version: null,
                kit: kitNow,
                x: spot.x,
                y: spot.y,
                box: null,
              };
          pick.run({ input: { canvas, place } });
        }}
      >
        <div ref={at.world} className="e-world">
          {drawn.map((f) => (
            <Shell key={f.id} canvas={canvas} frame={f} at={at} />
          ))}
          <Requests canvas={canvas} list={list} lost={lost} />
        </div>
      </section>
      {list.length === 0 ? (
        <Empty canvas={canvas} ready={state?.status === "ready"} lost={lost} />
      ) : null}
      <div className="e-top">
        <Status lost={lost} fault={state?.status === "fault"} />
      </div>
      <Dock at={at} canvas={canvas} />
      <PanelAt at={at} canvas={canvas} list={list} />
      <ControlsPanel list={list} />
    </main>
  );
}
