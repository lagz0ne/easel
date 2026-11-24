import { data, operation, resource } from "@tinkered/core";
import { z } from "zod";

import {
  controlsPost,
  panePlace,
  panesPost,
  linkPost,
  ranPost,
  sizePost,
  valuesPost,
} from "@/kit/controls";
import type { ControlShown, PanePlace } from "@/kit/controls";
import { kitFixtures } from "@/kit/fixtures";
import { teamTexts } from "@/kit/texts";

export const liveCap = 12;
export const readZoom = 0.3;
export const goLiveMargin = 0.1;
export const stayLiveMargin = 0.5;
export const showMargin = 0.5;
export const hideAtRestMargin = 0.75;
export const hideMovingMargin = 1.5;
export const restMs = 120;
export const paintCapMs = 1_500;
export const zoomFactor = 1.25;
export const pinchRate = 0.01;
export const minZoom = 0.001;
export const maxZoom = 4;
export const fitEdge = 40;
export const labelDrift = 0.1;
export const clickSlop = 4;
export const popGap = 8;
export const dockBand = 64;
const pinSize = 24;

const rect = z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() });

type Rect = z.infer<typeof rect>;

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

export const ownPointer = "[data-own-pointer]";

export const liveSet = data<readonly string[]>({ label: "viewer.liveSet", initial: [] });

export const holding = data<readonly string[]>({ label: "viewer.holding", initial: [] });

export const closeDone = data<Readonly<Record<string, true>>>({
  label: "viewer.closeDone",
  initial: {},
});

export const shownControls = data<
  Readonly<
    Record<
      string,
      {
        controls: readonly ControlShown[];
        values: Readonly<Record<string, unknown>>;
        failed: Readonly<Record<string, string>>;
      }
    >
  >
>({ label: "viewer.shownControls", initial: {} });

export const shownPanes = data<Readonly<Record<string, readonly PanePlace[]>>>({
  label: "viewer.shownPanes",
  initial: {},
});

const paneMax = { w: 480, h: 720 };

export const closeWaitMs = 200;

export const painted = data<Readonly<Record<string, number>>>({
  label: "viewer.painted",
  initial: {},
});

export const axesPost = z.object({
  easel: z.literal("axes"),
  locales: z.array(z.string()),
  config: z.record(
    z.string(),
    z.object({
      values: z.array(z.string()),
      default: z.string().optional(),
      name: z.string().optional(),
    }),
  ),
  fixtures: z.array(z.string()).optional(),
});

export const offeredAxes = data<
  Readonly<Record<string, z.infer<typeof axesPost> & { version: number }>>
>({ label: "viewer.offeredAxes", initial: {} });

export const themedFrames = data<Readonly<Record<string, number>>>({
  label: "viewer.themedFrames",
  initial: {},
});

export const schemeText = /prefers-color-scheme|light-dark\(/i;

export const zoomShown = data({ label: "viewer.zoomShown", initial: 100 });

export const foundFrame = data<string | null>({ label: "viewer.foundFrame", initial: null });

export const paintScript = `<script>(()=>{const v=__V__;const post=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>parent.postMessage({easel:"painted",v},"*")));const settle=()=>Promise.race([document.fonts?document.fonts.ready:null,new Promise(r=>setTimeout(r,1500))]).then(post,post);if(document.readyState==="complete")settle();else addEventListener("load",settle,{once:true});addEventListener("message",(e)=>{const d=e.data;if(e.source!==parent||!d||d.easel!=="part")return;const el=document.elementFromPoint(d.x,d.y);const r=el&&el!==document.body&&el!==document.documentElement?el.getBoundingClientRect():null;parent.postMessage({easel:"part",x:d.x,y:d.y,box:r&&{x:r.left,y:r.top,w:r.width,h:r.height}},"*")});})()</script>`;

const paintPost = z.object({ easel: z.literal("painted"), v: z.number() });

const helloPost = z.object({ easel: z.literal("hello") });

const closedPost = z.object({ easel: z.literal("closed") });

const closePost = { easel: "close" } as const;

export const kitMessage = z.object({
  easel: z.literal("kit"),
  kit: z.number(),
  look: z.string(),
  css: z.string(),
  texts: teamTexts,
  fixtures: kitFixtures.optional(),
});

export type KitMessage = z.infer<typeof kitMessage>;

const partArea = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

const partPost = z.object({
  easel: z.literal("part"),
  x: z.number(),
  y: z.number(),
  box: partArea.nullable(),
});

type PartAt = { id: string; x: number; y: number; box: z.infer<typeof partArea> | null };

export const partBox = data<PartAt | null>({ label: "viewer.partBox", initial: null });

export const hoverPart = data<PartAt | null>({ label: "viewer.hoverPart", initial: null });

const box = z.object({
  id: z.string(),
  x: z.coerce.number(),
  y: z.coerce.number(),
  w: z.coerce.number(),
  h: z.coerce.number(),
});

type Box = z.infer<typeof box>;

type Shell = { el: HTMLElement; label: HTMLElement | null; box: Box; hidden: boolean };

export const goal = z.discriminatedUnion("to", [
  z.object({ to: z.literal("frame"), page: z.string(), id: z.string() }),
  z.object({
    to: z.literal("spot"),
    page: z.string(),
    id: z.string(),
    x: z.number(),
    y: z.number(),
  }),
  z.object({ to: z.literal("point"), page: z.string(), x: z.number(), y: z.number() }),
]);

export type Goal = z.infer<typeof goal>;

export const stage = resource({
  label: "viewer.stage",
  target: "scope",
  depends: {
    live: liveSet.controller,
    hold: holding.controller,
    done: closeDone.controller,
    paints: painted.controller,
    zoom: zoomShown.controller,
    part: partBox.controller,
    hover: hoverPart.controller,
    offered: offeredAxes.controller,
    themed: themedFrames.controller,
    shown: shownControls.controller,
    panes: shownPanes.controller,
    mark: foundFrame.controller,
    popPlace,
  },
  factory: (
    { live, hold, done, paints, zoom, part, hover, offered, themed, shown, panes, mark, popPlace },
    ctx,
  ) => {
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
    const ports = new Map<HTMLIFrameElement, MessagePort>();
    const paneDocs = new Map<HTMLIFrameElement, { id: string; place: PanePlace }>();
    const panePorts = new Map<HTMLIFrameElement, MessagePort>();
    const links = new Map<string, MessagePort>();
    const closing = new Map<HTMLIFrameElement, () => void>();
    let kitNow: KitMessage | null = null;
    const pops = new Set<HTMLElement>();
    let aimAt: { x: number; y: number } | null = null;
    let held: { x: number; y: number } | null = null;
    let found: Shell | null = null;
    let sought: Goal | null = null;
    let pageNow: string | null = null;
    let hoverAt: { x: number; y: number } | null = null;
    let hoverFrame = 0;
    let lastPointer: { x: number; y: number } | null = null;
    const pointers = new Map<number, { x: number; y: number }>();
    const showedAt = new Map<string, number>();
    const pinned = new Set<string>();
    let opened = false;

    const at = {
      away: (b: Box) => {
        const vw = Math.max(view.w / cam.z, 1e-9);
        const vh = Math.max(view.h / cam.z, 1e-9);
        const x0 = -cam.x / cam.z;
        const y0 = -cam.y / cam.z;
        const dx = Math.max(x0 - (b.x + b.w), b.x - (x0 + vw), 0) / vw;
        const dy = Math.max(y0 - (b.y + b.h), b.y - (y0 + vh), 0) / vh;

        return Math.max(dx, dy);
      },

      fromCentre: (b: Box) => {
        const cx = (view.w / 2 - cam.x) / cam.z;
        const cy = (view.h / 2 - cam.y) / cam.z;
        return Math.hypot(
          Math.max(b.x - cx, 0, cx - (b.x + b.w)),
          Math.max(b.y - cy, 0, cy - (b.y + b.h)),
        );
      },

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

      writeLabel: (shell: Shell) => {
        if (!shell.label || !labelZoom) return;
        shell.label.style.transform = `scale(${1 / labelZoom})`;
        shell.label.style.width = `${shell.box.w * labelZoom}px`;
      },

      writeLabels: () => {
        labelZoom = cam.z;
        world?.style.setProperty("--e-unzoom", String(1 / cam.z));
        for (const shell of shells.values()) if (!shell.hidden) at.writeLabel(shell);
      },

      worldAt: (clientX: number, clientY: number) => {
        at.measure();
        return {
          x: (clientX - view.left - cam.x) / cam.z,
          y: (clientY - view.top - cam.y) / cam.z,
        };
      },

      pointerAt: (clientX: number, clientY: number) => {
        lastPointer = { x: clientX, y: clientY };
      },

      pointerOff: () => {
        lastPointer = null;
      },

      pasteSpot: () => {
        at.measure();
        const middle = { x: view.left + view.w / 2, y: view.top + view.h / 2 };
        const spot = lastPointer ?? middle;
        return at.worldAt(spot.x, spot.y);
      },

      showZoom: () => {
        const pct = cam.z * 100;
        const step = pct >= 10 ? 10 : pct >= 1 ? 1 : 0.1;
        const shown = Math.round(Math.floor(pct / step + 1e-9) * step * 10) / 10;
        if (zoom.get() !== shown) zoom.set(shown);
      },

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

      addNext: () => {
        adding = 0;
        const id = moving ? undefined : queue.shift();
        if (id === undefined) return;

        const now = live.get();
        if (shells.has(id) && !now.includes(id) && now.length < liveCap) live.set([...now, id]);
        if (queue.length) adding = requestAnimationFrame(at.addNext);
      },

      wanted: (now: readonly string[]) => {
        if (cam.z < readZoom) return [];

        return [...shells.entries()]
          .filter(([id, s]) => at.away(s.box) <= (now.includes(id) ? stayLiveMargin : goLiveMargin))
          .map(([id, s]) => ({ id, d: at.fromCentre(s.box) }))
          .sort((a, b) => a.d - b.d || a.id.localeCompare(b.id))
          .slice(0, liveCap)
          .map((c) => c.id);
      },

      dropLive: (kept: readonly string[]) => {
        const left = live
          .get()
          .filter((id) => !kept.includes(id) && docs.get(id)?.dataset.app !== undefined);
        if (left.length) hold.set([...new Set([...hold.get(), ...left])]);
        live.set(kept);
      },

      settleLive: () => {
        const now = live.get();
        const wanted = at.wanted(now);
        const kept = now.filter((id) => wanted.includes(id));
        if (kept.length !== now.length) at.dropLive(kept);

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
        at.markOpen();

        for (const el of pops) at.placePop(el);
      },

      popRoom: (): Rect | null => {
        const r = vp?.getBoundingClientRect();
        if (!r) return null;

        const card = vp?.parentElement?.querySelector(".e-requests")?.getBoundingClientRect();
        const right = Math.min(r.right, card?.left ?? r.right) - popGap;
        const bottom = r.bottom - dockBand;
        return { left: r.left + popGap, top: r.top + popGap, right, bottom };
      },

      placePop: (el: HTMLElement) => {
        const place = el.parentElement?.getBoundingClientRect();
        const b = at.popRoom();
        if (!place || !b) return;

        const { left, bottom } = place;
        const pin = { left, top: bottom - pinSize, right: left + pinSize, bottom };
        const now = el.getBoundingClientRect();
        const spot = popPlace.run({ input: { pin, w: now.width, h: now.height, room: b } });
        el.style.left = `${el.offsetLeft + spot.left - now.left}px`;
        el.style.top = `${el.offsetTop + spot.top - now.top}px`;
        el.dataset.side = spot.side;
      },

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
        at.endMark();
        cam = { ...cam, x: cam.x + dx, y: cam.y + dy };
        at.move();
      },

      zoomAt: (px: number, py: number, by: number) => {
        held = null;
        at.endMark();
        const z = Math.min(maxZoom, Math.max(minZoom, cam.z * by));
        cam = { x: px - ((px - cam.x) * z) / cam.z, y: py - ((py - cam.y) * z) / cam.z, z };
        at.move();
      },

      fit: () => {
        if (!shells.size || !view.w || !view.h) return;
        at.endMark();
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
        at.markOpen();
        if (held) at.show(held.x, held.y);
        else at.move();
        at.reachGoal();
      },

      settle: () => {
        settling = false;
        if (!vp) return;
        if (!placed) return at.fit();
        if (moving) return;

        at.cull(hideAtRestMargin);
        at.writeLabels();
        at.settleLive();
      },

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
        const own = event.target instanceof Element && event.target.closest(ownPointer);
        if (own && !event.ctrlKey) return;
        event.preventDefault();
        if (!moving) at.measure();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.h : 1;
        if (!event.ctrlKey) return at.pan(-event.deltaX * unit, -event.deltaY * unit);

        const step = Math.exp(-event.deltaY * unit * pinchRate);
        const by = Math.min(zoomFactor, Math.max(1 / zoomFactor, step));
        at.zoomAt(event.clientX - view.left, event.clientY - view.top, by);
      },

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
        try {
          vp?.setPointerCapture(event.pointerId);
        } catch {}
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

      showed: (id: string, version: number) => {
        if ((showedAt.get(id) ?? 0) >= version) return;
        showedAt.set(id, version);
        performance.mark(`easel:change:${id}:${version}`);
        at.markOpen();
      },

      markOpen: () => {
        if (opened || !placed) return;
        for (const [id, s] of shells) {
          if (!s.hidden && at.away(s.box) === 0 && !showedAt.has(id)) return;
        }
        opened = true;
        performance.mark("easel:open");
      },

      onPicture: (event: Event) => {
        const img = event.target;
        if (!(img instanceof HTMLImageElement) || !img.matches(".e-card > .e-pic")) return;
        const id = img.closest<HTMLElement>(".e-shell")?.dataset.id;
        if (id !== undefined) at.showed(id, Number(img.dataset.version));
      },

      pin: (id: string) => (el: HTMLElement | null) => {
        if (!el || pinned.has(id)) return;
        pinned.add(id);
        performance.mark(`easel:ask:${id}`);
      },

      markPainted: (id: string, version: number) => {
        if (paints.get()[id] !== version) paints.update((p) => ({ ...p, [id]: version }));
      },

      sendKit: (next: KitMessage) => {
        kitNow = next;
        for (const port of ports.values()) port.postMessage(next);
        for (const port of panePorts.values()) port.postMessage(next);
      },

      onHello: (event: MessageEvent) => {
        if (!kitNow) return;
        for (const [id, frame] of docs) {
          const win = frame.contentWindow;
          if (!win || win !== event.source) continue;

          ports.get(frame)?.close();
          const channel = new MessageChannel();
          ports.set(frame, channel.port1);
          channel.port1.addEventListener("message", (message) =>
            at.onPort(frame, message.data, message.ports),
          );
          channel.port1.start();
          win.postMessage(kitNow, "*", [channel.port2]);
        }
        at.onPaneHello(event);
      },

      onPort: (frame: HTMLIFrameElement, posted: unknown, ends: readonly MessagePort[] = []) => {
        if (closedPost.safeParse(posted).success) return closing.get(frame)?.();
        const id = frame.dataset.id;
        if (id !== undefined && docs.get(id) === frame) at.onControls(id, posted);
        if (id !== undefined && docs.get(id) === frame) at.onPanes(id, posted, ends);
        at.onAxes(frame, posted);
      },

      onPanes: (id: string, posted: unknown, ends: readonly MessagePort[]) => {
        const [told, link, end] = [
          panesPost.safeParse(posted),
          linkPost.safeParse(posted),
          ends[0],
        ];
        if (told.success) panes.set({ ...panes.get(), [id]: told.data.places });
        if (!link.success || !end) return;

        const key = `${id} ${link.data.place}`;
        links.get(key)?.close();
        links.set(key, end);
        for (const [el, pane] of paneDocs) {
          if (`${pane.id} ${pane.place}` === key) at.giveLink(el);
        }
      },

      giveLink: (el: HTMLIFrameElement) => {
        const [pane, port] = [paneDocs.get(el), panePorts.get(el)];
        if (!pane || !port) return;

        const key = `${pane.id} ${pane.place}`;
        const end = links.get(key);
        const frame = docs.get(pane.id);
        if (end) {
          links.delete(key);
          port.postMessage({ easel: "link", place: pane.place }, [end]);
        } else if (frame) ports.get(frame)?.postMessage({ easel: "link", place: pane.place });
      },

      onPaneHello: (event: MessageEvent) => {
        if (!kitNow) return;
        for (const [el] of paneDocs) {
          const win = el.contentWindow;
          if (!win || win !== event.source) continue;

          panePorts.get(el)?.close();
          const channel = new MessageChannel();
          panePorts.set(el, channel.port1);
          channel.port1.addEventListener("message", (message) => at.onPanePort(el, message.data));
          channel.port1.start();
          win.postMessage(kitNow, "*", [channel.port2]);
          at.giveLink(el);
        }
      },

      onPanePort: (el: HTMLIFrameElement, posted: unknown) => {
        const size = sizePost.safeParse(posted);
        if (!size.success || !paneDocs.has(el)) return;

        el.style.width = `${Math.min(size.data.w, paneMax.w)}px`;
        el.style.height = `${Math.min(size.data.h, paneMax.h)}px`;
      },

      pane: (el: HTMLIFrameElement | null) => {
        const [id, place] = [el?.dataset.id, el?.dataset.place];
        const read = panePlace.safeParse(place);
        if (!el || id === undefined || !read.success) return;

        paneDocs.set(el, { id, place: read.data });
        return () => {
          paneDocs.delete(el);
          panePorts.get(el)?.close();
          panePorts.delete(el);
        };
      },

      onControls: (id: string, posted: unknown) => {
        const [told, values, ran] = [
          controlsPost.safeParse(posted),
          valuesPost.safeParse(posted),
          ranPost.safeParse(posted),
        ];
        const now = shown.get()[id];
        if (told.success) {
          const next = { controls: told.data.controls, values: {}, failed: {} };
          shown.set({ ...shown.get(), [id]: next });
        }
        if (values.success && now) {
          shown.set({ ...shown.get(), [id]: { ...now, values: values.data.values } });
        }
        if (ran.success && now) {
          const failed = { ...now.failed, [ran.data.key]: ran.data.failed };
          shown.set({ ...shown.get(), [id]: { ...now, failed } });
        }
      },

      dropControls: (id: string) => {
        at.dropPanes(id);
        if (closed || !(id in shown.get())) return;
        shown.set(Object.fromEntries(Object.entries(shown.get()).filter(([key]) => key !== id)));
      },

      dropPanes: (id: string) => {
        for (const [key, end] of links) {
          if (!key.startsWith(`${id} `)) continue;
          end.close();
          links.delete(key);
        }
        if (closed || !(id in panes.get())) return;

        panes.set(Object.fromEntries(Object.entries(panes.get()).filter(([key]) => key !== id)));
      },

      sendControl: (id: string, key: string, value?: unknown) => {
        const frame = docs.get(id);
        const port = frame ? ports.get(frame) : undefined;
        const now = shown.get()[id];
        if (!port || !now) return;

        port.postMessage({ easel: "control", key, ...(value === undefined ? {} : { value }) });
        if (key in now.failed) {
          const failed = Object.fromEntries(Object.entries(now.failed).filter(([k]) => k !== key));
          shown.set({ ...shown.get(), [id]: { ...now, failed } });
        }
      },

      onAxes: (frame: HTMLIFrameElement, posted: unknown) => {
        const read = axesPost.safeParse(posted);
        const id = frame.dataset.id;
        if (!read.success || id === undefined || docs.get(id) !== frame) return;

        const version = Number(frame.dataset.version);
        const known = offered.get()[id];
        const same = JSON.stringify(known?.fixtures) === JSON.stringify(read.data.fixtures);
        if (known?.version === version && same) return;
        offered.set({ ...offered.get(), [id]: { ...read.data, version } });
      },

      markThemed: (id: string, version: number, follows: boolean) => {
        const now = themed.get();
        if (follows === (now[id] === version)) return;
        if (follows) return themed.set({ ...now, [id]: version });

        themed.set(Object.fromEntries(Object.entries(now).filter(([key]) => key !== id)));
      },

      dropPort: (frame: HTMLIFrameElement) => {
        ports.get(frame)?.close();
        ports.delete(frame);
      },

      onMessage: (event: MessageEvent) => {
        if (helloPost.safeParse(event.data).success) return at.onHello(event);
        if (closedPost.safeParse(event.data).success) return at.onClosed(event);
        const post = paintPost.safeParse(event.data);
        if (!post.success) return at.onPart(event);
        for (const [id, frame] of docs) {
          if (frame.contentWindow !== event.source) continue;
          if (Number(frame.dataset.version) !== post.data.v) continue;
          at.markPainted(id, post.data.v);
          at.markThemed(id, post.data.v, schemeText.test(frame.srcdoc));
          at.showed(id, post.data.v);
        }
      },

      onPart: (event: MessageEvent) => {
        const post = partPost.safeParse(event.data);
        if (!post.success) return;

        at.answerClick(event, post.data);
        at.answerHover(event, post.data);
      },

      answerClick: (event: MessageEvent, { x, y, box }: z.infer<typeof partPost>) => {
        const asked = part.get();
        if (!asked || !box || !at.answers(asked, event, x, y)) return;

        part.set({ ...asked, box: at.cutToFrame(asked.id, box) });
      },

      answerHover: (event: MessageEvent, { x, y, box }: z.infer<typeof partPost>) => {
        const over = hover.get();
        if (!over || !at.answers(over, event, x, y)) return;

        hover.set({ ...over, box: box && at.cutToFrame(over.id, box) });
      },

      answers: (asked: PartAt, event: MessageEvent, x: number, y: number) =>
        at.fromAsked(asked.id, event) && x === asked.x && y === asked.y,

      cutToFrame: (id: string, b: z.infer<typeof partArea>) => {
        const shell = shells.get(id);
        if (!shell) return null;

        const left = Math.max(b.x, 0);
        const top = Math.max(b.y, 0);
        const w = Math.min(b.x + b.w, shell.box.w) - left;
        const h = Math.min(b.y + b.h, shell.box.h) - top;
        return w > 0 && h > 0 ? { x: left, y: top, w, h } : null;
      },

      hover: (clientX: number, clientY: number) => {
        hoverAt = { x: clientX, y: clientY };
        if (!hoverFrame) hoverFrame = requestAnimationFrame(at.askHover);
      },

      askHover: () => {
        hoverFrame = 0;
        if (!hoverAt) return;
        at.measure();
        const x = (hoverAt.x - view.left - cam.x) / cam.z;
        const y = (hoverAt.y - view.top - cam.y) / cam.z;
        const under = [...shells.entries()]
          .filter(
            ([, s]) =>
              x >= s.box.x && x <= s.box.x + s.box.w && y >= s.box.y && y <= s.box.y + s.box.h,
          )
          .at(-1);
        const doc = under && docs.get(under[0]);
        if (!under || !doc) return hover.set(null);

        const [id, shell] = under;
        const was = hover.get();
        const asked = { id, x: x - shell.box.x, y: y - shell.box.y };
        hover.set({ ...asked, box: was?.id === id ? was.box : null });
        doc.contentWindow?.postMessage({ easel: "part", x: asked.x, y: asked.y }, "*");
      },

      hoverOff: () => {
        hoverAt = null;
        cancelAnimationFrame(hoverFrame);
        hoverFrame = 0;
        hover.set(null);
      },

      fromAsked: (id: string, event: MessageEvent) => {
        const frame = docs.get(id);
        return frame !== undefined && frame.contentWindow === event.source;
      },

      askPart: (id: string, x: number, y: number) => {
        part.set({ id, x, y, box: null });
        docs.get(id)?.contentWindow?.postMessage({ easel: "part", x, y }, "*");
      },

      noSelect: (event: Event) =>
        (event.target instanceof Element && event.target.closest(ownPointer)) ||
        event.preventDefault(),

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
        found = null;

        moving = false;
        labelZoom = 0;
        for (const port of ports.values()) port.close();
        ports.clear();
        closing.clear();
        if (closed) return;

        mark.set(null);
        live.set([]);
        hold.set([]);
        shown.set({});
        paints.set({});
        zoom.set(100);
      },

      viewport: (el: HTMLElement | null) => {
        if (!el) return;
        vp = el;
        pageNow = el.dataset.page ?? null;
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
          pageNow = null;
          at.reset();
        };
      },

      world: (el: HTMLElement | null) => {
        if (!el) return;
        world = el;
        at.write();
        el.addEventListener("load", at.onPicture, { capture: true });
        return () => {
          el.removeEventListener("load", at.onPicture, { capture: true });
          world = null;
        };
      },

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
        at.reachGoal();

        return () => at.dropShell(id, shell);
      },

      dropShell: (id: string, shell: Shell) => {
        if (shells.get(id) !== shell) return;

        if (found === shell) at.endMark();
        shells.delete(id);
        queue = queue.filter((other) => other !== id);
        const now = live.get();
        if (now.includes(id)) at.dropLive(now.filter((other) => other !== id));
      },

      doc: (el: HTMLIFrameElement | null) => {
        const id = el?.dataset.id;
        const version = Number(el?.dataset.version);
        if (!el || id === undefined) return;

        at.dropControls(id);
        docs.set(id, el);
        const cap = new AbortController();
        ctx.clock.sleep(paintCapMs, AbortSignal.any([cap.signal, ctx.signal])).then(
          () => docs.get(id) === el && at.markPainted(id, version),
          () => undefined,
        );

        return () => {
          cap.abort();
          if (el.dataset.app === undefined) at.dropPort(el);
          else if (!closed && !hold.get().includes(id)) hold.set([...hold.get(), id]);

          if (docs.get(id) !== el) return;
          docs.delete(id);
          at.dropControls(id);
          at.unpaint(id);
        };
      },

      onClosed: (event: MessageEvent) => {
        for (const [frame, end] of closing) if (frame.contentWindow === event.source) end();
      },

      closingDoc: (el: HTMLIFrameElement | null) => {
        const key = el?.dataset.closing;
        if (!el || key === undefined) return;
        const wait = new AbortController();
        const end = () => {
          if (closing.get(el) !== end) return;
          closing.delete(el);
          wait.abort();
          at.dropPort(el);
          if (!closed) at.settleClose(key, el.dataset.id ?? "");
        };
        closing.set(el, end);
        const port = ports.get(el);
        if (port) port.postMessage(closePost);
        else el.contentWindow?.postMessage(closePost, "*");
        ctx.clock
          .sleep(closeWaitMs, AbortSignal.any([wait.signal, ctx.signal]))
          .then(end, () => undefined);

        return () => {
          if (closing.get(el) === end) closing.delete(el);
          wait.abort();
          at.dropPort(el);
        };
      },

      settleClose: (key: string, id: string) => {
        done.update((d) => ({ ...d, [key]: true }));
        const still = [...closing.keys()].some((frame) => frame.dataset.id === id);
        if (!still) hold.set(hold.get().filter((other) => other !== id));
      },

      unpaint: (id: string) => {
        if (closed || !(id in paints.get())) return;
        paints.update((p) => Object.fromEntries(Object.entries(p).filter(([key]) => key !== id)));
      },

      showFrame: (id: string) => {
        const shell = shells.get(id);
        if (!shell) return;
        at.measure();
        at.endMark();

        const b = shell.box;
        const across = Math.max(view.w - 2 * fitEdge, 1) / b.w;
        const down = Math.max(view.h - 2 * fitEdge, 1) / b.h;
        const z = Math.max(minZoom, Math.min(across, down, 1));
        cam = { x: (view.w - b.w * z) / 2 - b.x * z, y: (view.h - b.h * z) / 2 - b.y * z, z };
        held = null;
        at.move();
        at.markFound(shell);
      },

      markFound: (shell: Shell) => {
        at.endMark();
        shell.el.dataset.found = "";
        found = shell;
        mark.set(shell.box.id);
      },

      rebox: (list: readonly Box[]) => {
        let moved = 0;
        for (const f of list) {
          const shell = shells.get(f.id);
          const next = { id: f.id, x: f.x, y: f.y, w: f.w, h: f.h };
          if (!shell || JSON.stringify(shell.box) === JSON.stringify(next)) continue;
          shell.box = next;
          moved += 1;
        }
        if (moved) at.changed();
      },

      dropGoal: () => {
        sought = null;
      },

      seek: (next: Goal) => {
        sought = next;
        at.reachGoal();
      },

      reachGoal: () => {
        const want = sought;
        if (!want || want.page !== pageNow || !placed) return;
        if (want.to === "point") {
          sought = null;
          return at.aim(want.x, want.y);
        }
        const shell = shells.get(want.id);
        if (!shell) return;

        sought = null;
        if (want.to === "frame") return at.showFrame(want.id);
        at.aim(shell.box.x + want.x, shell.box.y + want.y);
        at.markFound(shell);
      },

      endMark: () => {
        if (!found) return;
        delete found.el.dataset.found;
        found = null;
        if (!closed) mark.set(null);
      },

      show: (x: number, y: number) => {
        at.measure();
        cam = { ...cam, x: view.w * 0.4 - x * cam.z, y: view.h * 0.4 - y * cam.z };
        at.move();
      },

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
      zoomActual: () => at.zoomAt(view.w / 2, view.h / 2, 1 / cam.z),
    };

    ctx.defer(() => {
      closed = true;
      cancelAnimationFrame(hoverFrame);
      for (const port of ports.values()) port.close();
      restWait?.abort();
      at.stopAdding();
    });

    return at;
  },
});
