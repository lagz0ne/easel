import { data, operation, resource } from "@tinkered/core";
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
/** A press that moves less than this, in screen pixels, is a click, not a drag. */
export const clickSlop = 4;
/** A popover keeps this far from its pin and from the view's edges, in screen pixels. */
export const popGap = 8;
/** The dock's band at the bottom of the view: no popover covers it. */
export const dockBand = 64;
/** A pin's size on the screen (`--e-5`): its bottom left is the place. */
const pinSize = 24;

/** A box on the screen. */
const rect = z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() });

type Rect = z.infer<typeof rect>;

/**
 * Where a popover of size `w` x `h` goes by pin `pin`, in `room` (screen pixels): the first side
 * where it fits all in `room`, as Floating UI's flip; below when it fits on no side. On each side
 * it moves along the side into `room`, as Floating UI's shift.
 */
export const popPlace = operation({
  label: "viewer.popPlace",
  input: z.object({ pin: rect, w: z.number(), h: z.number(), room: rect }),
  run: (_, { input: { pin: p, w, h, room: b } }) => {
    const across = Math.min(Math.max(p.left + 2 * popGap, b.left), b.right - w);
    const down = Math.min(Math.max(p.top, b.top), b.bottom - h);
    const below = { side: "below" as const, left: across, top: p.bottom + popGap };
    const spots = [
      below,
      { side: "above" as const, left: across, top: p.top - popGap - h },
      { side: "right" as const, left: p.right + popGap, top: down },
      { side: "left" as const, left: p.left - popGap - w, top: down },
    ];
    const fits = (s: { left: number; top: number }) =>
      s.left >= b.left && s.top >= b.top && s.left + w <= b.right && s.top + h <= b.bottom;

    return spots.find(fits) ?? below;
  },
});

/**
 * An element that takes its own pointer: a pin, or the popover of a request. A press on it does
 * not pan the canvas, and text in it can be selected.
 */
export const ownPointer = "[data-own-pointer]";

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
 * It also answers the viewer's `{ easel: "part", x, y }` (a click at that place of the frame, in
 * request mode) with the box of the element there, `{ easel: "part", x, y, box }`, or `box: null`
 * on the page's own body. The viewer draws the outline from that box. The frame gets a place and
 * gives a box: the sandbox stays as it is (judged rule 4), as the comment overlays of Figma and
 * Vercel get an element's box from a script in the frame.
 */
export const paintScript = `<script>(()=>{const v=__V__;const post=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>parent.postMessage({easel:"painted",v},"*")));const settle=()=>Promise.race([document.fonts?document.fonts.ready:null,new Promise(r=>setTimeout(r,1500))]).then(post,post);if(document.readyState==="complete")settle();else addEventListener("load",settle,{once:true});addEventListener("message",(e)=>{const d=e.data;if(e.source!==parent||!d||d.easel!=="part")return;const el=document.elementFromPoint(d.x,d.y);const r=el&&el!==document.body&&el!==document.documentElement?el.getBoundingClientRect():null;parent.postMessage({easel:"part",x:d.x,y:d.y,box:r&&{x:r.left,y:r.top,w:r.width,h:r.height}},"*")});})()</script>`;

/** What a document's paint script posts. */
const paintPost = z.object({ easel: z.literal("painted"), v: z.number() });

/** What a document's piece script posts until it has a port ([kit](SPEC-kit.md) § compose). */
const helloPost = z.object({ easel: z.literal("hello") });

/**
 * A kit message ([kit](SPEC-kit.md) § compose): the kit version, the look as a `:root` block and
 * the kit's made CSS. The piece script replaces the text of `easel-look` and `easel-kit` with it.
 */
export const kitMessage = z.object({
  easel: z.literal("kit"),
  kit: z.number(),
  look: z.string(),
  css: z.string(),
});

export type KitMessage = z.infer<typeof kitMessage>;

/** A box on a frame, from its top left. */
const partArea = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

/** What a document's script answers to a click at `x`, `y`: the box of the part there. */
const partPost = z.object({
  easel: z.literal("part"),
  x: z.number(),
  y: z.number(),
  box: partArea.nullable(),
});

/**
 * The part of a frame that the last click in request mode is on: the place asked, and the box of
 * the element there (null until the frame's document answers, or when it has no element there,
 * or no live document). The draft draws its outline from it.
 */
export const partBox = data<{
  id: string;
  x: number;
  y: number;
  box: z.infer<typeof partArea> | null;
} | null>({ label: "viewer.partBox", initial: null });

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
  depends: {
    live: liveSet.controller,
    paints: painted.controller,
    zoom: zoomShown.controller,
    part: partBox.controller,
    popPlace,
  },
  factory: ({ live, paints, zoom, part, popPlace }, ctx) => {
    let cam = { x: 0, y: 0, z: 1 };
    let view = { w: 0, h: 0, left: 0, top: 0 };
    let vp: HTMLElement | null = null;
    let world: HTMLElement | null = null;
    let placed = false;
    let moving = false;
    let labelZoom = 0;
    let restWait: AbortController | null = null;
    let travel = 0;
    let queue: string[] = [];
    let adding = 0;
    let settling = false;
    let closed = false;
    const shells = new Map<string, Shell>();
    const docs = new Map<string, HTMLIFrameElement>();
    /** The port that the page gave each live document, by frame id; only the page holds port1. */
    const ports = new Map<string, MessagePort>();
    /** The canvas's kit as the board gave it last: a hello gets it at once. */
    let kitNow: KitMessage | null = null;
    const pops = new Set<HTMLElement>();
    /** A place that `aim` asked for before the first Fit: it comes into view after it. */
    let aimAt: { x: number; y: number } | null = null;
    /** The place that `aim` showed, until the viewer pans or zooms: a new size shows it again. */
    let held: { x: number; y: number } | null = null;
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

      /**
       * Every shown label, at the camera's zoom: after a 10% drift, and at rest. The pins and the
       * popover of a request read the same inverse zoom from the world, to keep their screen size.
       */
      writeLabels: () => {
        labelZoom = cam.z;
        world?.style.setProperty("--e-unzoom", String(1 / cam.z));
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

        for (const el of pops) at.placePop(el);
      },

      /** The view less its edge and the dock's band, on the screen; null with no canvas. */
      popRoom: (): Rect | null => {
        const r = vp?.getBoundingClientRect();
        if (!r) return null;

        const bottom = r.bottom - dockBand;
        return { left: r.left + popGap, top: r.top + popGap, right: r.right - popGap, bottom };
      },

      /**
       * A popover goes below its pin; with no room there, above it; then to its right, then to its
       * left, as Floating UI's flip, shifted along its side into the view (its shift). It keeps out
       * of the dock's band and off its pin. With room on no side, it goes below.
       */
      placePop: (el: HTMLElement) => {
        // The popover's parent is the place: the pin there has its bottom left on it.
        const place = el.parentElement?.getBoundingClientRect();
        const b = at.popRoom();
        if (!place || !b) return;

        const { left, bottom } = place;
        const pin = { left, top: bottom - pinSize, right: left + pinSize, bottom };
        const now = el.getBoundingClientRect();
        const spot = popPlace.run({ input: { pin, w: now.width, h: now.height, room: b } });
        // The pin's place undoes the zoom, so a CSS pixel of the popover is a screen pixel.
        el.style.left = `${el.offsetLeft + spot.left - now.left}px`;
        el.style.top = `${el.offsetTop + spot.top - now.top}px`;
        el.dataset.side = spot.side;
      },

      /** A popover at a pin: placed now, again when its size changes, and when the camera rests. */
      pop: (el: HTMLElement | null) => {
        if (!el) return;
        pops.add(el);
        const sizes = new ResizeObserver(() => at.placePop(el));
        sizes.observe(el);
        at.placePop(el);

        return () => {
          sizes.disconnect();
          pops.delete(el);
        };
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
        held = null;
        cam = { ...cam, x: cam.x + dx, y: cam.y + dy };
        at.move();
      },

      /** Zoom by `by` around a point of the viewport: the canvas point under it stays under it. */
      zoomAt: (px: number, py: number, by: number) => {
        held = null;
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
        held = aimAt;
        aimAt = null;
        if (held) return at.show(held.x, held.y);

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
        const own = event.target instanceof Element && event.target.closest(ownPointer);
        if (event.button !== 0 || own) return;

        at.measure();
        if (!pointers.size) travel = 0;
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
        travel += Math.hypot(event.clientX - old.x, event.clientY - old.y);
        at.pan(event.clientX - old.x, event.clientY - old.y);
      },

      onUp: (event: PointerEvent) => void pointers.delete(event.pointerId),

      markPainted: (id: string, version: number) => {
        if (paints.get()[id] !== version) paints.update((p) => ({ ...p, [id]: version }));
      },

      /**
       * The canvas's kit came or changed (SPEC-viewer § Watch an agent work, step 4): each live
       * document that has a port gets it on that port, and its piece script replaces the two
       * style texts, with no reload. A document with no port yet gets it with its port.
       */
      sendKit: (next: KitMessage) => {
        kitNow = next;
        for (const port of ports.values()) port.postMessage(next);
      },

      /**
       * A hello counts only from the window of one of the page's own live iframes (SPEC-viewer
       * judged rule 12). That document gets a new port and the current kit at once; a port that
       * it had before (its document loaded again) is closed. With no kit yet, the hello waits:
       * the piece script says it again 50 ms later.
       */
      onHello: (event: MessageEvent) => {
        if (!kitNow) return;
        for (const [id, frame] of docs) {
          const win = frame.contentWindow;
          if (!win || win !== event.source) continue;

          ports.get(id)?.close();
          const channel = new MessageChannel();
          ports.set(id, channel.port1);
          win.postMessage(kitNow, "*", [channel.port2]);
        }
      },

      /** A frame's live document left: its port is closed. */
      dropPort: (id: string) => {
        ports.get(id)?.close();
        ports.delete(id);
      },

      /** A paint post counts only from the iframe it names, for the version that iframe holds. */
      onMessage: (event: MessageEvent) => {
        if (helloPost.safeParse(event.data).success) return at.onHello(event);
        const post = paintPost.safeParse(event.data);
        if (!post.success) return at.onPart(event);
        for (const [id, frame] of docs) {
          if (frame.contentWindow !== event.source) continue;
          if (Number(frame.dataset.version) === post.data.v) at.markPainted(id, post.data.v);
        }
      },

      /**
       * A part's box counts only from the iframe of the frame asked, for the place asked. It is
       * cut to the frame's box: a document cannot draw the outline out of its frame.
       */
      onPart: (event: MessageEvent) => {
        const post = partPost.safeParse(event.data);
        const asked = part.get();
        if (!post.success || !asked || !at.fromAsked(asked.id, event)) return;

        const { x, y, box } = post.data;
        if (x === asked.x && y === asked.y && box) at.showPart(asked, box);
      },

      /** The part's box, cut to its frame: a document cannot draw the outline out of its frame. */
      showPart: (asked: { id: string; x: number; y: number }, b: z.infer<typeof partArea>) => {
        const shell = shells.get(asked.id);
        if (!shell) return;

        const left = Math.max(b.x, 0);
        const top = Math.max(b.y, 0);
        const w = Math.min(b.x + b.w, shell.box.w) - left;
        const h = Math.min(b.y + b.h, shell.box.h) - top;
        if (w > 0 && h > 0) part.set({ ...asked, box: { x: left, y: top, w, h } });
      },

      /** Whether a post came from the live document of frame `id`. */
      fromAsked: (id: string, event: MessageEvent) => {
        const frame = docs.get(id);
        return frame !== undefined && frame.contentWindow === event.source;
      },

      /**
       * A click in request mode at `x`, `y` on frame `id`: the frame's live document is asked for
       * the box of the part there. A frame with no live document draws no outline.
       */
      askPart: (id: string, x: number, y: number) => {
        part.set({ id, x, y, box: null });
        docs.get(id)?.contentWindow?.postMessage({ easel: "part", x, y }, "*");
      },

      /** Text in an element that takes its own pointer can be selected; no other. */
      noSelect: (event: Event) =>
        (event.target instanceof Element && event.target.closest(ownPointer)) ||
        event.preventDefault(),

      /**
       * Where a click on the canvas is: the frame under it (the top one), and the place on that
       * frame; or, out of all frames, the place on the canvas. Null for the end of a drag or a
       * pinch, which is no click, and for a click on an element that takes its own pointer.
       */
      pick: (event: MouseEvent) => {
        const own = event.target instanceof Element && event.target.closest(ownPointer);
        if (travel >= clickSlop || pointers.size || own) return null;
        at.measure();
        const x = (event.clientX - view.left - cam.x) / cam.z;
        const y = (event.clientY - view.top - cam.y) / cam.z;
        const under = [...shells.values()]
          .filter(
            (s) => x >= s.box.x && x <= s.box.x + s.box.w && y >= s.box.y && y <= s.box.y + s.box.h,
          )
          .at(-1);

        return { x, y, frame: under ? { ...under.box } : null };
      },

      onResize: ([entry]: ResizeObserverEntry[]) => {
        if (!entry) return;
        view = { ...view, w: entry.contentRect.width, h: entry.contentRect.height };
        at.measure();
        if (!placed) return at.fit();
        if (held) return at.show(held.x, held.y);

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
        aimAt = null;
        held = null;

        moving = false;
        labelZoom = 0;
        for (const port of ports.values()) port.close();
        ports.clear();
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
          at.dropPort(id);
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

      /**
       * A place on the canvas comes into view, at the zoom as it is: at 40% of the view's width
       * and height, so its popover, to the right and below, has room.
       */
      show: (x: number, y: number) => {
        at.measure();
        cam = { ...cam, x: view.w * 0.4 - x * cam.z, y: view.h * 0.4 - y * cam.z };
        at.move();
      },

      /**
       * A place comes into view as `show` brings it, once the first Fit placed the camera: a link
       * to a request opens before its frames are drawn.
       */
      aim: (x: number, y: number) => {
        if (!placed) {
          aimAt = { x, y };
          return;
        }
        held = { x, y };
        at.show(x, y);
      },

      zoomIn: () => at.zoomAt(view.w / 2, view.h / 2, zoomFactor),
      zoomOut: () => at.zoomAt(view.w / 2, view.h / 2, 1 / zoomFactor),
    };

    ctx.defer(() => {
      closed = true;
      for (const port of ports.values()) port.close();
      restWait?.abort();
      at.stopAdding();
    });

    return at;
  },
});
