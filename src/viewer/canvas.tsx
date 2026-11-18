import { resource, tag } from "@tinkered/core";
import { useData, useResource } from "@tinkered/react";
import { memo } from "react";
import { z } from "zod";

import { frames } from "@/frames";
import { maxPicturePixels, picturePrefix } from "@/frames/contract";
import type { FrameInfo } from "@/frames/contract";

import "./canvas.css";
import { liveSet, painted, paintScript, stage, zoomShown } from "./stage";

// The canvas behind `/s/<link>` (SPEC-viewer.md § See the frames, § Pan and zoom, § Watch an
// agent work, § Lose the socket; the viewer-canvas chart). React draws a shell per frame when the
// board changes; the stage moves the camera, culls the shells and picks the live set without a
// render. A live frame's document comes from the board's `docs`, read by `of({ canvas, id })`
// only (fact rule 5), and runs sandboxed with scripts and no same origin (judged rule 4).

type Stage = ReturnType<typeof stage.factory>;

/** A refusal that says the link has ended: `mayRead` turned the pass away. */
const ended = z.object({ ended: z.literal(true) });

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
  return <output aria-label="Zoom">{pct}%</output>;
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

/** A picture that failed (a busy server answers 503) is asked again after 1, 2 and 4 s, no more. */
export const picRetryMs = [1_000, 2_000, 4_000] as const;

/**
 * The tries of each picture: an img that failed sets its address again after its wait, which
 * asks the server again with no React render. A new address starts its tries over.
 */
const picRetry = resource({
  label: "viewer.picRetry",
  target: "scope",
  factory: (_, ctx) => {
    const tries = new WeakMap<HTMLImageElement, { src: string; n: number }>();

    return {
      failed: (img: HTMLImageElement) => {
        const src = img.getAttribute("src") ?? "";
        const before = tries.get(img);
        const n = before?.src === src ? before.n : 0;
        const wait = picRetryMs[n];
        if (wait === undefined) return;

        tries.set(img, { src, n: n + 1 });
        ctx.clock.sleep(wait, ctx.signal).then(
          () => img.getAttribute("src") === src && img.setAttribute("src", src),
          () => undefined,
        );
      },
    };
  },
});

/** A frame's picture. */
function Picture({ src, alt }: { src: string; alt: string }) {
  const retry = useResource(picRetry);

  return (
    <img
      className="e-pic"
      src={src}
      alt={alt}
      decoding="async"
      draggable={false}
      onError={(event) => retry.failed(event.currentTarget)}
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
  const area = frame.w * frame.h;
  const scale = area / 4 <= maxPicturePixels ? 0.5 : area / 16 <= maxPicturePixels ? 0.25 : null;

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
        {frame.k === undefined || scale === null ? null : (
          <Picture
            src={`${picturePrefix}${canvas}/${frame.id}/${frame.version}?s=${scale}&k=${frame.k}`}
            alt={frame.name}
          />
        )}
      </div>
    </div>
  );
});

/** The connection: `Reconnecting` while the tab may be behind, or an alert on a fault. */
function Status({ lost, fault }: { lost: boolean; fault: boolean }) {
  if (lost) return <p role="status">Reconnecting</p>;
  if (fault) return <p role="alert">Something broke. Load the page again.</p>;

  return null;
}

/**
 * The canvas. A read refused `{ ended: true }` says Opening: the gate's `refusals` opens the link
 * once more, or shows the ended page. A dropped socket keeps the frames read so far.
 */
export function Canvas({ canvas, opening }: { canvas: string; opening: React.ReactNode }) {
  const part = frames.board.frames.where({ canvas });
  const list = useData(part);
  const state = useData(frames.board.status(part));
  const lost = useData(frames.board.faults, (f) => f.frames?.fault === "link");
  const at = useResource(stage);
  if (state?.status === "fault" && ended.safeParse(state.fault.payload).success) return opening;

  return (
    <main className="e-canvas">
      <section ref={at.viewport} className="e-viewport" aria-label="Frames">
        <div ref={at.world} className="e-world">
          {list.map((f) => (
            <Shell key={f.id} canvas={canvas} frame={f} at={at} />
          ))}
        </div>
      </section>
      {list.length === 0 ? (
        <Empty canvas={canvas} ready={state?.status === "ready"} lost={lost} />
      ) : null}
      <div className="e-toolbar" role="toolbar" aria-label="Canvas">
        <button type="button" onClick={() => at.zoomOut()}>
          Zoom out
        </button>
        <Zoom />
        <button type="button" onClick={() => at.zoomIn()}>
          Zoom in
        </button>
        <button type="button" onClick={() => at.fit()}>
          Fit
        </button>
        <Status lost={lost} fault={state?.status === "fault"} />
      </div>
    </main>
  );
}
