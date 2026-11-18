import { data, resource } from "@tinkered/core";
import { z } from "zod";

// The canvas's stage (SPEC-viewer.md § Pan and zoom, § Numbers; the viewer-canvas chart): the
// camera, the shells' cull, the live set and the paint signal. It owns the DOM: React draws the
// shells once per change of the board, and the stage writes the world's transform, each shell's
// `hidden` and each label's inverse zoom straight to the elements, so a pan or a zoom renders no
// React (judged rule 1). The ideas are from docs/canvas-speed.md (sections 1, 3, 6 to 9 and 14).
// Its steps are methods of the one object it returns: a span per pointer move would cost more
// than the move.

/** At most this many documents are live at rest (decision C7). */
export const liveCap = 12;
/** Under this zoom no document is live: it could not be read. */
export const readZoom = 0.3;
/** A frame goes live within this share of the view, and a live one stays live within the next. */
export const goLiveMargin = 0.1;
export const stayLiveMargin = 0.5;
/** A shell shows within the first margin; it hides past the second at rest, the third moving. */
export const showMargin = 0.5;
export const hideAtRestMargin = 0.75;
export const hideMovingMargin = 1.5;
/** The camera rests once this long passes with no pan or zoom. */
export const restMs = 120;
/** The picture stays on top until the document says it painted, or this long passes. */
export const paintCapMs = 1_500;
/** A zoom button, or one wheel notch, zooms by this factor. */
export const zoomFactor = 1.25;
export const minZoom = 0.001;
export const maxZoom = 4;
/** Fit leaves this edge around the frames, in screen pixels, and never zooms past 100%. */
export const fitEdge = 40;
/** A label's inverse zoom is rewritten once the zoom drifts this much, and at rest. */
export const labelDrift = 0.1;

/** The ids of the live frames, in the order they went live. Only the stage writes it. */
export const liveSet = data<readonly string[]>({ label: "viewer.liveSet", initial: [] });

/** The version each frame's document said it painted (or the cap ran out for), by id. */
export const painted = data<Readonly<Record<string, number>>>({
  label: "viewer.painted",
  initial: {},
});

/**
 * The zoom as the status shows it, in percent, rounded down: steps of 10, under 10 steps of 1, under
 * 1 of 0.1.
 */
export const zoomShown = data({ label: "viewer.zoomShown", initial: 100 });

/**
 * The script the stage adds at the end of each document it gives an iframe (fact rule 8). Once
 * the page has loaded and its fonts settled (at most 1.5 s), and two animation frames passed, it
 * posts `{ easel: "painted", v }` to the viewer. `__V__` is the document's version.
 */
export const paintScript = `<script>(()=>{const v=__V__;const post=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>parent.postMessage({easel:"painted",v},"*")));const settle=()=>Promise.race([document.fonts?document.fonts.ready:null,new Promise(r=>setTimeout(r,1500))]).then(post,post);if(document.readyState==="complete")settle();else addEventListener("load",settle,{once:true});})()</script>`;

/** What a document's paint script posts. */
const paintPost = z.object({ easel: z.literal("painted"), v: z.number() });

/** A frame's box on the canvas, read from its shell's data attributes. */
const box = z.object({
  id: z.string(),
  x: z.coerce.number(),
  y: z.coerce.number(),
  w: z.coerce.number(),
  h: z.coerce.number(),
});

type Box = z.infer<typeof box>;

type Shell = { el: HTMLElement; label: HTMLElement | null; box: Box; hidden: boolean };

/**
 * The stage. Its ref callbacks attach it to the page's elements: `viewport` (the canvas, which
 * takes the drag, the wheel and the pinch), `world` (the one element the camera transforms),
 * `shell` (each frame's box) and `doc` (each live iframe). The buttons call `zoomIn`, `zoomOut`
 * and `fit`.
 */
export const stage = resource({
  label: "viewer.stage",
  target: "scope",
  depends: { live: liveSet.controller, paints: painted.controller, zoom: zoomShown.controller },
  factory: ({ live, paints, zoom }, ctx) => {
    let cam = { x: 0, y: 0, z: 1 };
    let view = { w: 0, h: 0, left: 0, top: 0 };
    let vp: HTMLElement | null = null;
    let world: HTMLElement | null = null;
    let placed = false;
    let moving = false;
    let labelZoom = 0;
    let restWait: AbortController | null = null;
    let queue: string[] = [];
    let adding = 0;
    let settling = false;
    let closed = false;
    const shells = new Map<string, Shell>();
    const docs = new Map<string, HTMLIFrameElement>();
    const pointers = new Map<number, { x: number; y: number }>();

    const at = {
      /** How far a box is outside the view, in views (0: it is in view). */
      away: (b: Box) => {
        const vw = Math.max(view.w / cam.z, 1e-9);
        const vh = Math.max(view.h / cam.z, 1e-9);
        const x0 = -cam.x / cam.z;
        const y0 = -cam.y / cam.z;
        const dx = Math.max(x0 - (b.x + b.w), b.x - (x0 + vw), 0) / vw;
        const dy = Math.max(y0 - (b.y + b.h), b.y - (y0 + vh), 0) / vh;

        return Math.max(dx, dy);
      },

      /** From the view's centre to the nearest point of a box, in canvas pixels. */
      fromCentre: (b: Box) => {
        const cx = (view.w / 2 - cam.x) / cam.z;
        const cy = (view.h / 2 - cam.y) / cam.z;
        return Math.hypot(
          Math.max(b.x - cx, 0, cx - (b.x + b.w)),
          Math.max(b.y - cy, 0, cy - (b.y + b.h)),
        );
      },

      /**
       * Each shell past the hide margin leaves the render tree; each within the show margin comes
       * back; in between, it stays as it is. Nothing is written for a shell that crosses nothing.
       */
      cull: (hideMargin = moving ? hideMovingMargin : hideAtRestMargin) => {
        if (!view.w) return;
        for (const shell of shells.values()) {
          const far = at.away(shell.box);
          const hide = far > hideMargin ? true : far <= showMargin ? false : shell.hidden;
          if (hide === shell.hidden) continue;
          shell.hidden = hide;
          shell.el.hidden = hide;
        }
      },

      /** A label keeps its screen size: it undoes the zoom it was last written at. */
      writeLabel: (shell: Shell) => {
        if (!shell.label || !labelZoom) return;
        shell.label.style.transform = `scale(${1 / labelZoom})`;
        shell.label.style.width = `${shell.box.w * labelZoom}px`;
      },

      /** Every shown label, at the camera's zoom: after a 10% drift, and at rest. */
      writeLabels: () => {
        labelZoom = cam.z;
        for (const shell of shells.values()) if (!shell.hidden) at.writeLabel(shell);
      },

      /** The zoom status, rounded down to its step (26% reads 20%), written only when the step changes. */
      showZoom: () => {
        const pct = cam.z * 100;
        const step = pct >= 10 ? 10 : pct >= 1 ? 1 : 0.1;
        const shown = Math.round(Math.floor(pct / step + 1e-9) * step * 10) / 10;
        if (zoom.get() !== shown) zoom.set(shown);
      },

      /** The one write a pan or a zoom makes: the world's transform. */
      write: () => {
        if (world) world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
        if (Math.abs(cam.z / labelZoom - 1) > labelDrift) at.writeLabels();
        at.showZoom();
      },

      stopAdding: () => {
        cancelAnimationFrame(adding);
        adding = 0;
        queue = [];
      },

      /** One new document per animation frame, nearest the centre first. A move stops it. */
      addNext: () => {
        adding = 0;
        const id = moving ? undefined : queue.shift();
        if (id === undefined) return;

        const now = live.get();
        if (shells.has(id) && !now.includes(id) && now.length < liveCap) live.set([...now, id]);
        if (queue.length) adding = requestAnimationFrame(at.addNext);
      },

      /** The frames that may be live now: in reach, nearest the centre first, at most 12. */
      wanted: (now: readonly string[]) => {
        if (cam.z < readZoom) return [];

        return [...shells.entries()]
          .filter(([id, s]) => at.away(s.box) <= (now.includes(id) ? stayLiveMargin : goLiveMargin))
          .map(([id, s]) => ({ id, d: at.fromCentre(s.box) }))
          .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
          .slice(0, liveCap)
          .map((c) => c.id);
      },

      /** At rest: a frame that leaves the live set goes at once; one that joins waits its turn. */
      settleLive: () => {
        const now = live.get();
        const wanted = at.wanted(now);
        const kept = now.filter((id) => wanted.includes(id));
        if (kept.length !== now.length) live.set(kept);

        at.stopAdding();
        queue = wanted.filter((id) => !kept.includes(id));
        if (queue.length) adding = requestAnimationFrame(at.addNext);
      },

      rest: () => {
        moving = false;
        restWait = null;
        at.cull(hideAtRestMargin);
        at.writeLabels();
        at.settleLive();
      },

      /** The camera moved: the live set holds until it rests, 120 ms after the last move. */
      moved: () => {
        moving = true;
        at.stopAdding();
        restWait?.abort();

        const wait = new AbortController();
        restWait = wait;
        ctx.clock.sleep(restMs, AbortSignal.any([wait.signal, ctx.signal])).then(
          () => restWait === wait && at.rest(),
          () => undefined,
        );
      },

      move: () => {
        at.write();
        at.cull(hideMovingMargin);
        at.moved();
      },

      pan: (dx: number, dy: number) => {
        cam = { ...cam, x: cam.x + dx, y: cam.y + dy };
        at.move();
      },

      /** Zoom by `by` around a point of the viewport: the canvas point under it stays under it. */
      zoomAt: (px: number, py: number, by: number) => {
        const z = Math.min(maxZoom, Math.max(minZoom, cam.z * by));
        cam = { x: px - ((px - cam.x) * z) / cam.z, y: py - ((py - cam.y) * z) / cam.z, z };
        at.move();
      },

      /** Fit: every frame in view, with an edge, and never past 100%. */
      fit: () => {
        if (!shells.size || !view.w || !view.h) return;
        const boxes = [...shells.values()].map((s) => s.box);
        const x0 = Math.min(...boxes.map((b) => b.x));
        const y0 = Math.min(...boxes.map((b) => b.y));
        const x1 = Math.max(...boxes.map((b) => b.x + b.w));
        const y1 = Math.max(...boxes.map((b) => b.y + b.h));

        const across = Math.max(view.w - 2 * fitEdge, 1) / (x1 - x0);
        const down = Math.max(view.h - 2 * fitEdge, 1) / (y1 - y0);
        const z = Math.max(minZoom, Math.min(across, down, 1));
        cam = {
          x: (view.w - (x1 - x0) * z) / 2 - x0 * z,
          y: (view.h - (y1 - y0) * z) / 2 - y0 * z,
          z,
        };
        placed = true;
        at.move();
      },

      /** After a batch React drew: the first frames place the camera with Fit; later ones, at rest, settle. */
      settle: () => {
        settling = false;
        if (!vp) return;
        if (!placed) return at.fit();
        if (moving) return;

        at.cull(hideAtRestMargin);
        at.writeLabels();
        at.settleLive();
      },

      /** A frame came or went: settle once for the whole batch. */
      changed: () => {
        if (!vp || settling || (placed && moving)) return;
        settling = true;
        queueMicrotask(at.settle);
      },

      measure: () => {
        const rect = vp?.getBoundingClientRect();
        if (rect) view = { ...view, left: rect.left, top: rect.top };
      },

      onWheel: (event: WheelEvent) => {
        event.preventDefault();
        if (!moving) at.measure();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.h : 1;
        if (!event.ctrlKey) return at.pan(-event.deltaX * unit, -event.deltaY * unit);

        const by = zoomFactor ** ((-event.deltaY * unit) / 100);
        at.zoomAt(event.clientX - view.left, event.clientY - view.top, by);
      },

      /** Two pointers: their middle point pans, and their distance zooms around it. */
      pinch: (id: number, x: number, y: number) => {
        const other = [...pointers.entries()].find(([key]) => key !== id)?.[1];
        const old = pointers.get(id);
        if (!other || !old) return;
        const before = Math.hypot(old.x - other.x, old.y - other.y) || 1;
        const after = Math.hypot(x - other.x, y - other.y) || 1;

        pointers.set(id, { x, y });
        cam = { ...cam, x: cam.x + (x - old.x) / 2, y: cam.y + (y - old.y) / 2 };
        at.zoomAt((x + other.x) / 2 - view.left, (y + other.y) / 2 - view.top, after / before);
      },

      onDown: (event: PointerEvent) => {
        if (event.button !== 0) return;
        at.measure();
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        // A pointer the browser does not know (a synthetic one) cannot be captured; it still
        // drags while it is over the canvas.
        try {
          vp?.setPointerCapture(event.pointerId);
        } catch {
          // Nothing to undo.
        }
      },

      onMove: (event: PointerEvent) => {
        const old = pointers.get(event.pointerId);
        if (!old) return;
        if (pointers.size > 1) return at.pinch(event.pointerId, event.clientX, event.clientY);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        at.pan(event.clientX - old.x, event.clientY - old.y);
      },

      onUp: (event: PointerEvent) => void pointers.delete(event.pointerId),

      markPainted: (id: string, version: number) => {
        if (paints.get()[id] !== version) paints.update((p) => ({ ...p, [id]: version }));
      },

      /** A paint post counts only from the iframe it names, for the version that iframe holds. */
      onMessage: (event: MessageEvent) => {
        const post = paintPost.safeParse(event.data);
        if (!post.success) return;
        for (const [id, frame] of docs) {
          if (frame.contentWindow !== event.source) continue;
          if (Number(frame.dataset.version) === post.data.v) at.markPainted(id, post.data.v);
        }
      },

      noSelect: (event: Event) => event.preventDefault(),

      onResize: ([entry]: ResizeObserverEntry[]) => {
        if (!entry) return;
        view = { ...view, w: entry.contentRect.width, h: entry.contentRect.height };
        at.measure();
        if (!placed) return at.fit();

        at.cull();
        if (!moving) at.settleLive();
      },

      /** The canvas leaves the page: the next one starts fresh. */
      reset: () => {
        restWait?.abort();
        restWait = null;
        at.stopAdding();
        pointers.clear();
        cam = { x: 0, y: 0, z: 1 };
        view = { w: 0, h: 0, left: 0, top: 0 };
        placed = false;

        moving = false;
        labelZoom = 0;
        // After the scope closed (a tab torn down before its page), there is no cell to clear.
        if (closed) return;

        live.set([]);
        paints.set({});
        zoom.set(100);
      },

      /** The canvas: it takes the drag, the wheel and the pinch, and its size is the view's. */
      viewport: (el: HTMLElement | null) => {
        if (!el) return;
        vp = el;
        const rect = el.getBoundingClientRect();
        view = { w: rect.width, h: rect.height, left: rect.left, top: rect.top };
        el.addEventListener("wheel", at.onWheel, { passive: false });
        el.addEventListener("pointerdown", at.onDown);
        el.addEventListener("pointermove", at.onMove);
        el.addEventListener("pointerup", at.onUp);

        el.addEventListener("pointercancel", at.onUp);
        el.addEventListener("selectstart", at.noSelect, { capture: true });
        window.addEventListener("message", at.onMessage);
        const sizes = new ResizeObserver(at.onResize);
        sizes.observe(el);
        if (shells.size) at.fit();

        return () => {
          el.removeEventListener("wheel", at.onWheel);
          el.removeEventListener("pointerdown", at.onDown);
          el.removeEventListener("pointermove", at.onMove);
          el.removeEventListener("pointerup", at.onUp);
          el.removeEventListener("pointercancel", at.onUp);
          el.removeEventListener("selectstart", at.noSelect, { capture: true });

          window.removeEventListener("message", at.onMessage);
          sizes.disconnect();
          vp = null;
          at.reset();
        };
      },

      /** The world: the one element the camera transforms. */
      world: (el: HTMLElement | null) => {
        if (!el) return;
        world = el;
        at.write();
        return () => {
          world = null;
        };
      },

      /** A frame's shell. Its box is read from its data attributes, once. */
      shell: (el: HTMLElement | null) => {
        const read = el ? box.safeParse(el.dataset) : undefined;
        if (!el || !read?.success) return;
        const id = read.data.id;
        const label = el.querySelector<HTMLElement>("[data-label]");
        const shell: Shell = { el, label, box: read.data, hidden: false };
        shells.set(id, shell);
        if (vp) at.cull();
        at.writeLabel(shell);
        at.changed();

        return () => at.dropShell(id, shell);
      },

      /** A shell leaves: an agent's delete takes it out of the live set at once, also mid-move. */
      dropShell: (id: string, shell: Shell) => {
        if (shells.get(id) !== shell) return;
        shells.delete(id);
        queue = queue.filter((other) => other !== id);
        const now = live.get();
        if (now.includes(id)) live.set(now.filter((other) => other !== id));
      },

      /** A live iframe: its picture comes off when it posts that it painted, or after 1.5 s. */
      doc: (el: HTMLIFrameElement | null) => {
        const id = el?.dataset.id;
        const version = Number(el?.dataset.version);
        if (!el || id === undefined) return;
        docs.set(id, el);
        const cap = new AbortController();
        ctx.clock.sleep(paintCapMs, AbortSignal.any([cap.signal, ctx.signal])).then(
          () => docs.get(id) === el && at.markPainted(id, version),
          () => undefined,
        );

        return () => {
          cap.abort();
          if (docs.get(id) !== el) return;
          docs.delete(id);
          at.unpaint(id);
        };
      },

      /**
       * A frame's iframe left: the next one for it has painted nothing, so its picture goes back
       * on top until that one paints (a white box otherwise, when the frame goes live again).
       */
      unpaint: (id: string) => {
        if (closed || !(id in paints.get())) return;
        paints.update((p) => Object.fromEntries(Object.entries(p).filter(([key]) => key !== id)));
      },

      zoomIn: () => at.zoomAt(view.w / 2, view.h / 2, zoomFactor),
      zoomOut: () => at.zoomAt(view.w / 2, view.h / 2, 1 / zoomFactor),
    };

    ctx.defer(() => {
      closed = true;
      restWait?.abort();
      at.stopAdding();
    });

    return at;
  },
});
