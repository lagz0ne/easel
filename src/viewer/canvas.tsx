import { data, operation, resource, tag } from "@tinkered/core";
import { useData, useResource, useRun } from "@tinkered/react";
import { Fragment, memo } from "react";
import { z } from "zod";

import { frames } from "@/frames";
import { boardDoc } from "@/frames/contract";
import type { BoardFrame, FrameInfo } from "@/frames/contract";
import { compose, composeApp, composeKit, frameAxes } from "@/kit/compose";
import { paneScript } from "@/kit/controls";
import type { ControlShown, PanePlace } from "@/kit/controls";

import "./canvas.css";
import { aimFromLink, openFromLink } from "./act";
import {
  acting,
  closeCard,
  drafts,
  escapeKey,
  openedRequest,
  openRequest,
  pickPlace,
  requestMode,
  resendOnBack,
} from "./draft";
import { slashKey } from "./find";
import { FindButton, FindList } from "./find-list";
import { clockTicker, controlsFor, panelOpen, requestPlaces, requestViews } from "./follow";
import type { RequestView } from "./follow";
import { Panel, RequestsButton } from "./panel";
import { FramePicture } from "./picture";
import { Opened } from "./popover";
import { newPage, reloadPage } from "./release";
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

type Stage = ReturnType<typeof stage.factory>;

const ended = z.union([
  z.object({ ended: z.literal(true) }),
  z.object({ locked: z.literal(true) }),
]);

const readOnce = resource({
  label: "viewer.readOnce",
  target: "scope",
  factory: () => new Set<string>(),
});

const canvasKey = tag<string>({ label: "viewer.canvas" });

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

function Empty({ canvas, ready, lost }: { canvas: string; ready: boolean; lost: boolean }) {
  const read = useData(hasRead({ canvas }));
  if (!ready && !(lost && read)) return null;

  return <p className="e-empty">This canvas has no frames yet.</p>;
}

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

type Composed = { version: number; key: string; html: string; app: boolean; serial: number };

type ShownDocs = { current: Composed | null; leaving: readonly Composed[] };

const defaultLocale = "en";

export const axesPicked = data<{
  locale: string | null;
  config: Readonly<Record<string, Readonly<Record<string, string>>>>;
}>({ label: "viewer.axesPicked", initial: { locale: null, config: {} } });

export const pickLocale = operation({
  label: "viewer.pickLocale",
  input: z.string(),
  depends: { picked: axesPicked.controller },
  run: ({ picked }, { input }) => picked.set({ ...picked.get(), locale: input }),
});

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

const kitFeed = resource({
  label: "viewer.kitFeed",
  config: { canvas: canvasKey.required },
  depends: (c) => ({ kit: frames.board.kit.of({ canvas: c.canvas }), at: stage }),
  factory: ({ kit, at }) => {
    const now = kit.get();
    if (!now) return null;

    const { kit: version, look, css, texts } = now;
    const message: KitMessage = { easel: "kit", kit: version, look, css, texts };
    at.sendKit(message);
    return now.kit;
  },
});

function LiveDoc({ canvas, frame, at }: { canvas: string; frame: FrameInfo; at: Stage }) {
  const docs = useData(liveDoc({ canvas, id: frame.id }));
  const shown = docs.current ? [docs.current, ...docs.leaving] : docs.leaving;

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

const Shell = memo(function Shell({
  canvas,
  frame,
  at,
}: {
  canvas: string;
  frame: BoardFrame & { gone?: true };
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
        {frame.status === "ready" ? <ReadyMark /> : null}
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

function ReadyMark() {
  return <span className="e-ready">Ready</span>;
}

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

const toggleControls = operation({
  label: "viewer.toggleControls",
  input: z.string(),
  depends: { ctl: controlsFor.controller, closeCard },
  run: ({ ctl, closeCard }, { input }) => {
    closeCard.run();
    ctl.set(ctl.get() === input ? null : input);
  },
});

const runControl = operation({
  label: "viewer.runControl",
  input: z.object({ id: z.string(), key: z.string(), value: z.unknown().optional() }),
  depends: { at: stage },
  run: ({ at }, { input }) => at.sendControl(input.id, input.key, input.value),
});

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
            {new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code}
          </option>
        ))}
      </select>
    </>
  );
}

export function Icon({ d }: { d: string }) {
  return (
    <svg className="e-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const icons = {
  zoomOut: "M5 12h14",
  zoomIn: "M5 12h14M12 5v14",
  fit: "M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2",
  controls: "M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4",
  close: "M18 6 6 18M6 6l12 12",
} as const;

function Dock({ at, canvas }: { at: Stage; canvas: string }) {
  return (
    <div className="e-dock" role="toolbar" aria-label="Canvas">
      <RequestButton />
      <RequestsButton canvas={canvas} />
      <FindButton />
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

function CardAt({ at, canvas, list }: { at: Stage; canvas: string; list: readonly FrameInfo[] }) {
  const listed = useData(panelOpen);
  const n = useData(openedRequest, (o) => (o?.canvas === canvas ? o.n : null));
  const shown = useData(requestViews({ canvas })).find((v) => v.r.n === n);
  const places = useData(requestPlaces({ canvas }));
  const opening = useRun(openRequest);
  if (!listed && n === null) return null;

  const onOpen = ({ r }: RequestView) => {
    const place = places.get(r.n);
    if (place) at.show(place.x, place.y);
    opening.run({ input: { canvas, n: r.n } });
  };

  return (
    <aside className="e-requests" aria-label="Requests">
      {shown ? (
        <Opened v={shown} list={list} />
      ) : (
        <Panel canvas={canvas} list={list} onOpen={onOpen} />
      )}
    </aside>
  );
}

function NewVersion({ canvas }: { canvas: string }) {
  const newer = useData(newPage({ canvas }));
  const drafted = useData(drafts, (d) => Boolean(d?.text.trim()));
  const answering = useData(acting, (a) => Boolean(a?.text.trim()));
  const reload = useRun(reloadPage);
  if (!newer) return null;

  return (
    <div className="e-update" role="status">
      <span>A new version of easel is ready.</span>
      {drafted || answering ? (
        <span className="e-update-wait">Send your text first, then reload.</span>
      ) : (
        <button type="button" className="e-update-go" onClick={() => reload.run()}>
          Reload
        </button>
      )}
    </div>
  );
}

function Status({ lost, fault }: { lost: boolean; fault: boolean }) {
  if (lost) return <p role="status">Reconnecting</p>;
  if (fault) return <p role="alert">Something broke. Load the page again.</p>;

  return null;
}

const shownMemo = resource({
  label: "viewer.shownMemo",
  config: { canvas: canvasKey.required },
  factory: () => new Map<string, BoardFrame>(),
});

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
    const shown: Array<BoardFrame & { gone?: true }> = [...now];
    for (const [at, f] of [...last.values()].entries()) {
      const keep = !ids.has(f.id) && (live.includes(f.id) || held.includes(f.id));
      if (keep) shown.splice(at, 0, { ...f, gone: true });
    }
    last.clear();
    for (const f of shown) last.set(f.id, f);

    return shown.length === now.length ? now : shown;
  },
});

export function Canvas({ canvas, opening }: { canvas: string; opening: React.ReactNode }) {
  const part = frames.board.frames.where({ canvas });
  const list = useData(part);
  const state = useData(frames.board.status(part));
  const lost = useData(frames.board.faults, (f) => f.frames?.fault === "link");
  const at = useResource(stage);
  const drawn = useData(shownFrames({ canvas }));
  useResource(resendOnBack);
  useResource(escapeKey);
  useResource(slashKey);
  const pick = useRun(pickPlace);
  const asking = useData(requestMode);
  const drafting = useData(drafts, (d) => d?.canvas === canvas);
  const hovering = asking && !drafting;
  const mode = useData(requestMode, (on) => (on ? "request" : "view"));
  useData(clockTicker({ canvas }));
  const kitNow = useData(kitFeed({ canvas }));
  useData(openFromLink({ canvas }));
  useData(aimFromLink({ canvas }));
  if (state?.status === "fault" && ended.safeParse(state.fault.payload).success) return opening;

  return (
    <main className="e-canvas" data-mode={mode}>
      <section
        ref={at.viewport}
        className="e-viewport e-light"
        aria-label="Frames"
        onPointerMove={(event) => {
          if (hovering && event.buttons === 0) at.hover(event.clientX, event.clientY);
        }}
        onPointerLeave={() => at.hoverOff()}
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
        {list.length === 0 ? (
          <Empty canvas={canvas} ready={state?.status === "ready"} lost={lost} />
        ) : null}
        <div ref={at.world} className="e-world">
          {drawn.map((f) => (
            <Shell key={f.id} canvas={canvas} frame={f} at={at} />
          ))}
          <Requests canvas={canvas} list={list} lost={lost} />
        </div>
      </section>
      <div className="e-top">
        <Status lost={lost} fault={state?.status === "fault"} />
        <NewVersion canvas={canvas} />
      </div>
      <Dock at={at} canvas={canvas} />
      <FindList canvas={canvas} />
      <CardAt at={at} canvas={canvas} list={list} />
      <ControlsPanel list={list} />
    </main>
  );
}
