import { resource, tag } from "@tinkered/core";
import { useData, useResource, useRun } from "@tinkered/react";
import { memo } from "react";
import { z } from "zod";

import { frames } from "@/frames";
import type { FrameInfo } from "@/frames/contract";

import "./canvas.css";
import { aimFromLink, openFromLink } from "./act";
import { escapeKey, openRequest, pickPlace, requestMode, resendOnBack } from "./draft";
import { clockTicker, panelOpen, requestPlaces } from "./follow";
import type { RequestView } from "./follow";
import { Panel, RequestsButton } from "./panel";
import { FramePicture } from "./picture";
import { RequestButton, Requests } from "./request";
import { liveSet, painted, paintScript, stage, zoomShown } from "./stage";

// The canvas behind `/s/<link>` (SPEC-viewer.md § See the frames, § Pan and zoom, § Watch an
// agent work, § Lose the socket; the viewer-canvas chart). React draws a shell per frame when the
// board changes; the stage moves the camera, culls the shells and picks the live set without a
// render. A live frame's document comes from the board's `docs`, read by `of({ canvas, id })`
// only (fact rule 5), and runs sandboxed with scripts and no same origin (judged rule 4).

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

/** A live frame's document: the board's version of it, with the paint script at its end. */
function LiveDoc({
  canvas,
  frame,
  attach,
}: {
  canvas: string;
  frame: FrameInfo;
  attach: Stage["doc"];
}) {
  const doc = useData(frames.board.docs.of({ canvas, id: frame.id }));
  if (!doc) return null;

  return (
    <iframe
      key={doc.version}
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
 * thread, and the card's color shows until it has.
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
      </div>
      {live ? <LiveDoc canvas={canvas} frame={frame} attach={at.doc} /> : null}
      <div className="e-card" hidden={live && shown === frame.version}>
        <FramePicture canvas={canvas} frame={frame} version={frame.version} k={frame.k} />
      </div>
    </div>
  );
});

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
                x: spot.x - frame.x,
                y: spot.y - frame.y,
                box: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
              }
            : { frameId: null, frameName: null, version: null, x: spot.x, y: spot.y, box: null };
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
