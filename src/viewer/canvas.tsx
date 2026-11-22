import { data, operation, resource, tag } from "@tinkered/core";
import { useData, useResource, useRun } from "@tinkered/react";
import { memo } from "react";
import { z } from "zod";

import { frames } from "@/frames";
import { boardDoc } from "@/frames/contract";
import type { FrameInfo } from "@/frames/contract";
import { compose, composeApp, composeKit, frameAxes } from "@/kit/compose";

import "./canvas.css";
import { aimFromLink, openFromLink } from "./act";
import { escapeKey, openRequest, pickPlace, requestMode, resendOnBack } from "./draft";
import { clockTicker, panelOpen, requestPlaces } from "./follow";
import type { RequestView } from "./follow";
import { Panel, RequestsButton } from "./panel";
import { FramePicture } from "./picture";
import { RequestButton, Requests } from "./request";
import { axesPost, liveSet, offeredAxes, painted, paintScript, stage, zoomShown } from "./stage";
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
type Composed = { version: number; key: string; html: string };

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
 * keeps its document and does not reload (K7).
 */
const docMemo = resource({
  label: "viewer.docMemo",
  config: { canvas: docCanvas.required, id: docId.required },
  factory: (): { shown: Composed | null } => ({ shown: null }),
});

/**
 * One version of a frame, composed with a kit: `compose` of its html and made CSS, or, for an app
 * frame (`app`), `composeApp` of its JS and its runtime (SPEC-kit.md § App frames).
 */
const composeDoc = operation({
  label: "viewer.composeDoc",
  input: z.object({ doc: boardDoc, kit: composeKit, axes: frameAxes.nullable() }),
  depends: { compose, composeApp },
  run: ({ compose, composeApp }, { input: { doc, kit, axes } }) =>
    doc.app
      ? composeApp.run({
          input: {
            js: doc.app.js,
            css: doc.css ?? "",
            kit,
            runtime: doc.app.runtime,
            ...(axes ? { axes } : {}),
          },
        })
      : compose.run({ input: { html: doc.html, css: doc.css, kit } }),
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
    axesFor,
    composeDoc,
  }),
  factory: ({ doc, kit, memo, offered, picked, axesFor, composeDoc }, ctx) => {
    const at = doc.get();
    const look = kit.get() ?? null;
    const kept = memo.get();
    if (!at || (at.css !== null && look === null)) return null;

    const offer = offered[ctx.config.id];
    const axes = axesFor.run({
      input: { id: ctx.config.id, version: at.version, offer, picked },
    });
    const key = `${at.version}:${JSON.stringify(axes)}`;
    if (kept.shown?.key === key) return kept.shown;

    const shown = look ?? { look: "", css: "" };
    const html = composeDoc.run({ input: { doc: at, kit: shown, axes } });
    kept.shown = { version: at.version, key, html };
    return kept.shown;
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

/** A live frame's document: the composed version of it, with the paint script at its end. */
function LiveDoc({
  canvas,
  frame,
  attach,
}: {
  canvas: string;
  frame: FrameInfo;
  attach: Stage["doc"];
}) {
  const doc = useData(liveDoc({ canvas, id: frame.id }));
  if (!doc) return null;

  return (
    <iframe
      key={doc.key}
      ref={attach}
      className="e-doc"
      title={frame.name}
      sandbox="allow-scripts"
      data-id={frame.id}
      data-version={doc.version}
      srcDoc={doc.html + paintScript.replace("__V__", String(doc.version))}
    />
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
  frame: FrameInfo & { k?: string };
  at: Stage;
}) {
  const live = useData(liveSet, (ids) => ids.includes(frame.id));
  const shown = useData(painted, (p) => p[frame.id]);
  const kitNow = useData(frames.board.kit.of({ canvas }))?.kit ?? null;

  return (
    <div
      ref={at.shell}
      className="e-shell"
      role="group"
      aria-label={frame.name}
      data-id={frame.id}
      data-x={frame.x}
      data-y={frame.y}
      data-w={frame.w}
      data-h={frame.h}
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
    >
      <div className="e-label" data-label>
        {frame.name}
        <FrameAxes frame={frame} />
      </div>
      {live ? <LiveDoc canvas={canvas} frame={frame} attach={at.doc} /> : null}
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
  useResource(resendOnBack);
  useResource(escapeKey);
  const pick = useRun(pickPlace);
  const asking = useData(requestMode);
  const panel = useData(panelOpen);
  useData(clockTicker({ canvas }));
  const kitNow = useData(kitFeed({ canvas }));
  useData(openFromLink({ canvas }));
  useData(aimFromLink({ canvas }));
  if (state?.status === "fault" && ended.safeParse(state.fault.payload).success) return opening;

  return (
    <main className="e-canvas" data-panel={panel ? "open" : "closed"}>
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
          {list.map((f) => (
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
    </main>
  );
}
