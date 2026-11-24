import { Menu } from "@base-ui/react/menu";
import { data, operation, resource, tag } from "@tinkered/core";
import { useData, useResource, useRun } from "@tinkered/react";
import { Fragment, memo, useId } from "react";
import { z } from "zod";

import { frames } from "@/frames";
import { sectionHead } from "@/frames/arrange";
import { boardDoc } from "@/frames/contract";
import type { BoardFrame, FrameInfo } from "@/frames/contract";
import { BackBar } from "@/home/back";
import { compose, composeApp, composeKit, frameAxes } from "@/kit/compose";
import { paneScript } from "@/kit/controls";
import type { ControlShown, PanePlace } from "@/kit/controls";
import { fixtureSwitch } from "@/kit/fixtures";
import { teamTexts } from "@/kit/texts";
import { firstLocale, frameWords, wordsFor } from "@/words/frame-words";

import "./canvas.css";
import "./arrange.css";
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
  slashKey,
} from "./draft";
import { dropImages, imageDrop, pasteImages } from "./drop";
import { FindButton, FindList } from "./find-list";
import { columnOpen, fold } from "./fold";
import type { Side } from "./fold";
import {
  clockTicker,
  controlsFor,
  panelOpen,
  requestPlaces,
  requestStates,
  requestView,
} from "./follow";
import type { RequestView } from "./follow";
import { frameFromLink } from "./frame-link";
import { personOfPage } from "./hold";
import { openMenu, setMenu } from "./overlays";
import { pageInAddress, pageList, shellBoxes, showRequest } from "./pages";
import { PagesButton } from "./pages-list";
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
import { FrameStates, pickSwitch, StatesPick } from "./switch-pick";
import {
  appOffers,
  docTakesTheme,
  frameValue,
  localeSwitch,
  picksInAddress,
  picksNow,
  switchPicksShape,
  teamLocales,
  themeSwitch,
} from "./switches";
import { zoomItems, zoomKeys, zoomStep } from "./zoom";

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

const pageKey = tag<string>({ label: "viewer.page" });

const hasRead = resource({
  label: "viewer.hasRead",
  config: { canvas: canvasKey.required, page: pageKey.required },
  depends: (c) => ({
    state: frames.board.status(frames.board.frames.where({ canvas: c.canvas, page: c.page })),
    seen: readOnce,
  }),
  factory: ({ state, seen }, { config }) => {
    const key = `${config.canvas} ${config.page}`;
    if (state.get()?.status === "ready") seen.add(key);

    return seen.has(key);
  },
});

type EmptyProps = { canvas: string; page: string; ready: boolean; lost: boolean };

function Empty({ canvas, page, ready, lost }: EmptyProps) {
  const read = useData(hasRead({ canvas, page }));
  const many = useData(pageList({ canvas })).length > 1;
  if (!ready && !(lost && read)) return null;

  return <p className="e-empty">{`This ${many ? "page" : "canvas"} has no frames yet.`}</p>;
}

function ZoomPick() {
  const pct = useData(zoomShown);
  const open = useData(openMenu, (m) => m === "zoom");
  const set = useRun(setMenu);
  const step = useRun(zoomStep);

  return (
    <Menu.Root
      modal={false}
      open={open}
      onOpenChange={(next) => set.run({ input: { menu: "zoom", open: next } })}
    >
      <Menu.Trigger
        className="e-dock-btn e-dock-zoom"
        aria-label={`Zoom ${pct}%`}
        title="Pinch to zoom. Click for the zoom steps."
      >
        <output aria-label="Zoom">{pct}%</output>
        <svg className="e-icon e-dock-zoom-arrow" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m18 15-6-6-6 6" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="e-menu-pos" side="top" align="end" sideOffset={8}>
          <Menu.Popup className="e-menu" aria-label="Zoom">
            {zoomItems.map((item) => (
              <Menu.Item key={item.step} onClick={() => step.run({ input: item.step })}>
                <span className="e-pages-name">{item.name}</span>
                <kbd className="e-menu-hint">{item.keys}</kbd>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const docCanvas = tag<string>({ label: "viewer.docCanvas" });
const docId = tag<string>({ label: "viewer.docId" });

type Composed = { version: number; key: string; html: string; app: boolean; serial: number };

type ShownDocs = { current: Composed | null; leaving: readonly Composed[] };

const htmlLocale = operation({
  label: "viewer.htmlLocale",
  input: z.object({ id: z.string(), picks: switchPicksShape }),
  run: (_, { input: { id, picks } }) => {
    const [own, board] = [picks.frames[id]?.[localeSwitch], picks.board[localeSwitch]];
    if (own !== undefined && teamLocales.includes(own)) return own;
    if (board !== undefined && teamLocales.includes(board)) return board;

    return null;
  },
});

export const axesFor = operation({
  label: "viewer.axesFor",
  input: z.object({
    id: z.string(),
    version: z.number(),
    offer: axesPost.extend({ version: z.number() }).optional(),
    picks: switchPicksShape,
  }),
  depends: { appOffers, frameValue },
  run: ({ appOffers, frameValue }, { input: { id, version, offer, picks } }) => {
    if (offer?.version !== version) return null;

    const picked = appOffers.run({ input: offer }).flatMap((one) => {
      const value = frameValue.run({ input: { id, offer: one, picks } });
      return value === one.default ? [] : [{ name: one.name, key: one.key, value }];
    });
    if (picked.length === 0) return null;

    const [locale, fixture] = [localeSwitch, fixtureSwitch].map(
      (name) => picked.find((one) => one.name === name)?.value,
    );
    const config = Object.fromEntries(
      picked.flatMap((one) => (one.key ? [[one.key, one.value]] : [])),
    );
    return {
      ...(locale === undefined ? {} : { locale }),
      ...(fixture === undefined ? {} : { fixture }),
      config,
    };
  },
});

const frameScheme = resource({
  label: "viewer.frameScheme",
  config: { canvas: docCanvas.required, id: docId.required },
  depends: (c) => ({
    doc: frames.board.docs.of({ canvas: c.canvas, id: c.id }),
    kit: frames.board.kit.of({ canvas: c.canvas }),
    picks: picksNow({}),
    offered: offeredAxes,
    docTakesTheme,
    frameValue,
  }),
  factory: ({ doc, kit, picks, offered, docTakesTheme, frameValue }, { config: { id } }) => {
    const at = doc.get();
    if (!at) return null;

    const offer = offered[id]?.version === at.version ? offered[id] : undefined;
    const names = Object.values(offer?.config ?? {}).flatMap((axis) => axis.name ?? []);
    const input = { doc: at, kit: kit.get() ?? null, names };
    if (!docTakesTheme.run({ input })) return null;

    return frameValue.run({ input: { id, offer: themeSwitch, picks: picks.get() } });
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
    words: z.object({ locale: z.string(), texts: teamTexts.nullable() }),
  }),
  depends: { compose, composeApp, frameWords },
  run: ({ compose, composeApp, frameWords }, { input }): Composed => {
    const { doc, kit, axes, key, serial, words } = input;
    const look = kit ?? { look: "", css: "" };
    const made = doc.app
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
    const app = Boolean(doc.app);

    const html = frameWords.run({ input: { ...words, html: made, app } });
    return { version: doc.version, key, html, app, serial };
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
    picks: picksNow({}),
    live: liveSet,
    done: closeDone,
    axesFor,
    htmlLocale,
    composeDoc,
    wordsFor,
  }),
  factory: (deps, ctx) => {
    const { doc, kit, memo, offered, live, done, axesFor, composeDoc, wordsFor } = deps;
    const picks = deps.picks.get();
    const { id } = ctx.config;
    const at = doc.get();
    const look = kit.get() ?? null;
    const kept = memo.get();
    if (!live.includes(id) || !at || (at.css !== null && look === null)) {
      return kept.next(null, done);
    }

    const axes = axesFor.run({ input: { id, version: at.version, offer: offered[id], picks } });
    const key = `${at.version}:${String(at.parts)}:${JSON.stringify(axes)}`;
    const picked = deps.htmlLocale.run({ input: { id, picks } });
    const words = wordsFor.run({
      input: { html: at.html, app: Boolean(at.app), axes, picked, kit: look },
    });
    const shownWith = `${key}:${words.key}`;
    const before = kept.shown();
    if (before?.key === shownWith) return kept.next(before, done);

    const made = composeDoc.run({
      input: { doc: at, kit: look, axes, key: shownWith, serial: kept.serial(), words },
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

    const { kit: version, look, css, texts, fixtures } = now;
    const message: KitMessage = { easel: "kit", kit: version, look, css, texts, fixtures };
    at.sendKit(message);
    return now.kit;
  },
});

function LiveDoc({ canvas, frame, at }: { canvas: string; frame: FrameInfo; at: Stage }) {
  const docs = useData(liveDoc({ canvas, id: frame.id }));
  const scheme = useData(frameScheme({ canvas, id: frame.id }));
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
          data-theme={scheme ?? undefined}
          style={scheme ? { colorScheme: scheme } : undefined}
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
  const folds = useResource(fold);
  const pane = { canvas, frame, at, live };

  return (
    <div
      className="e-shell"
      {...(frame.gone
        ? { hidden: true }
        : { ref: at.shell, role: "group", "aria-label": frame.name })}
      onPointerEnter={(event) => folds.pointerOn(frame.id, event.pointerType)}
      onPointerLeave={(event) => folds.pointerOff(frame.id, event.pointerType)}
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
        <FrameStates canvas={canvas} id={frame.id} name={frame.name} />
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

  if (place === "top") {
    return (
      <span
        className="e-ctl-top"
        role="group"
        aria-label={`${placeWords[place]} controls of ${frame.name}`}
        data-own-pointer
      >
        <PlacedRows frame={frame} place={place} />
        {pane}
      </span>
    );
  }
  return (
    <SideColumn frame={frame} side={place} count={count}>
      {pane}
    </SideColumn>
  );
}

type SideProps = { frame: FrameInfo; side: Side; count: number; children: React.ReactNode };

function SideColumn({ frame, side, count, children }: SideProps) {
  const folds = useResource(fold);
  const open = useData(columnOpen({ id: frame.id, side }));
  const column = useId();
  const label = `${placeWords[side]} controls of ${frame.name}`;

  return (
    <div
      className={`e-ctl-dock e-ctl-${side}`}
      data-open={open ? "" : undefined}
      data-fold={`${side} ${frame.id}`}
      data-own-pointer
      onFocus={(event) => folds.focusOn(frame.id, side, event.target)}
      onBlur={(event) => folds.focusOff(frame.id, side, event.relatedTarget)}
    >
      <button
        type="button"
        className="e-ctl-tab"
        data-fold-tab
        aria-label={label}
        aria-expanded={open}
        aria-controls={column}
        title={label}
        onClick={() => folds.press(frame.id, side)}
      >
        <Icon d={icons.controls} />
        {count ? <span className="e-ctl-count">{count}</span> : null}
      </button>
      <div id={column} className="e-ctl-col" role="group" aria-label={label}>
        {count ? (
          <ul className="e-ctl-list">
            <PlacedRows frame={frame} place={side} />
          </ul>
        ) : null}
        {children}
      </div>
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

function LocalePick({ canvas }: { canvas: string }) {
  const offered = useData(offeredAxes, (all) =>
    Object.values(all)
      .flatMap((offer) => offer.locales)
      .join(" "),
  );
  const texts = useData(frames.board.kit.of({ canvas }))?.texts ?? {};
  const translated = Object.values(texts).some((text) => text.vi !== undefined);
  const given = [...(translated ? teamLocales : []), ...offered.split(" ")];
  const locales = [...new Set(given.filter((code) => code !== ""))].join(" ");
  const locale = useData(picksNow({})).board[localeSwitch] ?? firstLocale;
  const open = useData(openMenu, (m) => m === "locale");
  const set = useRun(setMenu);
  if (locales === "") return null;

  const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;

  return (
    <Menu.Root
      modal={false}
      open={open}
      onOpenChange={(next) => set.run({ input: { menu: "locale", open: next } })}
    >
      <Menu.Trigger
        className="e-dock-btn e-dock-page e-dock-locale"
        aria-label="Locale"
        title={`Locale: ${name}`}
      >
        <Icon d={icons.locale} />
        <span className="e-dock-page-name">{locale.split("-")[0]?.toUpperCase()}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="e-menu-pos" side="top" sideOffset={8}>
          <LocaleMenu codes={locales.split(" ")} locale={locale} />
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function LocaleMenu({ codes, locale }: { codes: readonly string[]; locale: string }) {
  const pick = useRun(pickSwitch);
  const items = codes.map((code) => ({
    code,
    name: new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code,
    short: code.split("-")[0]?.toUpperCase(),
  }));

  return (
    <Menu.Popup className="e-menu e-locales" aria-label="Locale">
      <Menu.RadioGroup value={locale}>
        {items.map(({ code, name, short }) => (
          <Menu.RadioItem
            key={code}
            value={code}
            lang={code}
            aria-label={name}
            onClick={() => pick.run({ input: { name: localeSwitch, value: code } })}
          >
            <span className="e-pages-name">{name}</span>
            <span className="e-menu-n">{short}</span>
          </Menu.RadioItem>
        ))}
      </Menu.RadioGroup>
    </Menu.Popup>
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
  controls: "M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4",
  close: "M18 6 6 18M6 6l12 12",
  locale:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
} as const;

function Dock({ canvas, page }: { canvas: string; page: string }) {
  return (
    <div className="e-dock" role="toolbar" aria-label="Canvas">
      <RequestButton />
      <RequestsButton canvas={canvas} />
      <FindButton />
      <PagesButton canvas={canvas} page={page} />
      <LocalePick canvas={canvas} />
      <StatesPick />
      <span className="e-dock-sep" aria-hidden="true" />
      <ZoomPick />
    </div>
  );
}

type CardProps = { canvas: string; page: string; list: readonly FrameInfo[] };

function CardAt(props: CardProps) {
  const { canvas } = props;
  const listed = useData(panelOpen);
  const n = useData(openedRequest, (o) => (o?.canvas === canvas ? o.n : null));
  const frame = useData(requestStates({ canvas })).find((v) => v.r.n === n)?.r.frameId;
  if (!listed && n === null) return null;

  const all = <RequestList {...props} />;
  return (
    <aside className="e-requests" aria-label="Requests">
      {n === null || frame === undefined ? (
        all
      ) : (
        <OpenedOne canvas={canvas} n={n} frame={frame ?? ""} all={all} />
      )}
    </aside>
  );
}

type OneProps = { canvas: string; n: number; frame: string; all: React.ReactNode };

function OpenedOne({ canvas, n, frame, all }: OneProps) {
  const v = useData(requestView({ canvas, n, frame }));
  return v ? <Opened v={v} /> : all;
}

function RequestList({ canvas, page, list }: CardProps) {
  const places = useData(requestPlaces({ canvas }));
  const opening = useRun(openRequest);
  const show = useRun(showRequest);

  const onOpen = ({ r, page: was, frameGone }: RequestView) => {
    const place = places.get(r.n);
    const here = list.some((f) => f.id === r.frameId);
    const gone = frameGone && place && was !== null ? { page: was, ...place } : null;
    opening.run({ input: { canvas, n: r.n } });
    show.run({ input: { canvas, shown: page, here, r, gone } });
  };

  return <Panel canvas={canvas} onOpen={onOpen} />;
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

function SectionNames({ canvas, page }: { canvas: string; page: string }) {
  const list = useData(frames.board.sections.where({ canvas, page })) ?? [];
  return (
    <>
      {list.map((s) => (
        <div
          key={s.key}
          className="e-section"
          data-section={s.key}
          style={{ left: s.x, top: s.y + sectionHead }}
        >
          <p className="e-section-name">{s.name}</p>
        </div>
      ))}
    </>
  );
}

function DropStatus({ canvas, page, shown }: { canvas: string; page: string; shown: boolean }) {
  return shown ? <DropWatch canvas={canvas} page={page} /> : null;
}

function DropWatch({ canvas, page }: { canvas: string; page: string }) {
  useData(pasteImages({ canvas, page }));
  useData(dropImages({ canvas, page }));
  const drop = useData(imageDrop);
  if (drop.over) {
    return (
      <p role="status" className="e-drop-over">
        Drop the image to put it on this page
      </p>
    );
  }
  switch (drop.told.kind) {
    case "none":
      return drop.going ? <p role="status">The image goes on this page</p> : null;
    case "refused":
      return <p role="alert">{drop.told.why}</p>;
    case "wait":
      return <p role="status">Wait for the image that goes now.</p>;
    case "lost":
      return <p role="alert">The image did not go. Drop it again.</p>;
  }
}

const shownMemo = resource({
  label: "viewer.shownMemo",
  config: { canvas: canvasKey.required, page: pageKey.required },
  factory: () => new Map<string, BoardFrame>(),
});

const shownFrames = resource({
  label: "viewer.shownFrames",
  config: { canvas: canvasKey.required, page: pageKey.required },
  depends: (c) => ({
    list: frames.board.frames.where({ canvas: c.canvas, page: c.page }),
    memo: shownMemo({ canvas: c.canvas, page: c.page }),
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

type SignedIn = { name: string; owner: boolean };

type CanvasProps = { canvas: string; opening: React.ReactNode; me?: SignedIn; aim?: string };

type PageProps = {
  canvas: string;
  page: string;
  opening: React.ReactNode;
  signedIn: { name: string; owner: string };
  aim: string;
};

export function Canvas({ canvas, opening, me, aim = "" }: CanvasProps) {
  const page = useData(pageInAddress({ canvas }));
  useData(picksInAddress({}));
  if (page === null) return opening;

  const signedIn = { name: me?.name ?? "", owner: `${me?.owner === true}` };
  return <CanvasPage canvas={canvas} page={page} opening={opening} signedIn={signedIn} aim={aim} />;
}

function CanvasPage({ canvas, page, opening, signedIn, aim }: PageProps) {
  const part = frames.board.frames.where({ canvas, page });
  const list = useData(part);
  const state = useData(frames.board.status(part));
  const lost = useData(frames.board.faults, (f) => f.frames?.fault === "link");
  const at = useResource(stage);
  const drawn = useData(shownFrames({ canvas, page }));
  useData(shellBoxes({ canvas, page }));
  useResource(resendOnBack);
  useResource(escapeKey);
  useResource(slashKey);
  useResource(zoomKeys);
  const pick = useRun(pickPlace);
  const asking = useData(requestMode);
  const drafting = useData(drafts, (d) => d?.canvas === canvas);
  const hovering = asking && !drafting;
  const mode = useData(requestMode, (on) => (on ? "request" : "view"));
  useData(clockTicker({ canvas }));
  useData(personOfPage(signedIn));
  const kitNow = useData(kitFeed({ canvas }));
  useData(openFromLink({ canvas }));
  useData(aimFromLink({ canvas, page }));
  useData(frameFromLink({ canvas, hash: aim }));
  if (state?.status === "fault" && ended.safeParse(state.fault.payload).success) return opening;

  return (
    <main className="e-canvas" data-mode={mode}>
      <section
        key={page}
        ref={at.viewport}
        data-page={page}
        className="e-viewport e-light"
        aria-label="Frames"
        onPointerMove={(event) => {
          at.pointerAt(event.clientX, event.clientY);
          if (hovering && event.buttons === 0) at.hover(event.clientX, event.clientY);
        }}
        onPointerLeave={() => {
          at.pointerOff();
          at.hoverOff();
        }}
        onClick={(event) => {
          const spot = at.pick(event.nativeEvent);
          if (!spot) return;

          const frame = spot.frame ? list.find((f) => f.id === spot.frame?.id) : undefined;
          if (frame && asking) at.askPart(frame.id, spot.x - frame.x, spot.y - frame.y);

          const place = frame
            ? {
                page,
                frameId: frame.id,
                frameName: frame.name,
                version: frame.version,
                kit: kitNow,
                x: spot.x - frame.x,
                y: spot.y - frame.y,
                box: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
              }
            : {
                page,
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
          <Empty canvas={canvas} page={page} ready={state?.status === "ready"} lost={lost} />
        ) : null}
        <div ref={at.world} className="e-world">
          {drawn.map((f) => (
            <Shell key={f.id} canvas={canvas} frame={f} at={at} />
          ))}
          <SectionNames canvas={canvas} page={page} />
          <Requests canvas={canvas} page={page} list={list} lost={lost} />
        </div>
      </section>
      <div className="e-top">
        <BackBar canvas={canvas} shown={signedIn.name !== ""} />
        <Status lost={lost} fault={state?.status === "fault"} />
        <NewVersion canvas={canvas} />
        <DropStatus canvas={canvas} page={page} shown={signedIn.name !== ""} />
      </div>
      <Dock canvas={canvas} page={page} />
      <FindList canvas={canvas} page={page} list={list} />
      <CardAt canvas={canvas} page={page} list={list} />
      <ControlsPanel list={list} />
    </main>
  );
}
