import { resource, tag } from "@tinkered/core";
import { useData, useResource, useRun } from "@tinkered/react";

import { frames } from "@/frames";
import type { BoardFrame } from "@/frames/contract";
import type { MapJson } from "@/map/text";
import { walkDataOf, walkFrameName, walkNameOf, walkPageName, walkPicks } from "@/map/walk";
import type { Waiting } from "@/map/walk";

import { drafts, requestMode, pickPlace, toggleRequest } from "./draft";
import type { Place } from "./draft";
import { pageList } from "./pages";
import { Composer } from "./request";
import { frameValue, picksNow, themeSwitch } from "./switches";
import { askForIt, leaveWalk, startWalk, walkPort } from "./walk";
import { walkFit, walking } from "./walking";
import type { Walk } from "./walking";

const walkCanvas = tag<string>({ label: "viewer.walkCanvas" });

const walkId = tag<string>({ label: "viewer.walkId" });

const walkMap = tag<string>({ label: "viewer.walkMap" });

const walkFrom = tag<string>({ label: "viewer.walkFrom" });

const walkCall = tag<string>({ label: "viewer.walkCall" });

const walkPage = tag<string>({ label: "viewer.walkPage" });

const walkState = tag<string>({ label: "viewer.walkState" });

const walkHeld = resource({
  label: "viewer.walkHeld",
  config: {},
  depends: { drafts, mode: requestMode },
  factory: ({ drafts, mode }) => mode || drafts !== null,
});

const walkDoc = resource({
  label: "viewer.walkDoc",
  config: { canvas: walkCanvas.required, id: walkId.required },
  depends: (c) => ({
    doc: frames.board.docs.of({ canvas: c.canvas, id: c.id }),
    picks: picksNow({}),
    frameValue,
    dataOf: walkDataOf,
  }),
  factory: ({ doc, picks, frameValue, dataOf }, { config: { id } }) => {
    const at = doc.get();
    if (!at) return null;

    const read = dataOf.run({ input: at.html });
    const theme = frameValue.run({ input: { id, offer: themeSwitch, picks: picks.get() } });
    const map = read.kind === "found" ? read.data.map : null;
    return { html: at.html, version: at.version, map, theme };
  },
});

const walkNames = resource({
  label: "viewer.walkNames",
  config: { map: walkMap.required },
  depends: { walkFrameName, walkPageName },
  factory: ({ walkFrameName, walkPageName }, { config: { map } }) => ({
    frame: walkFrameName.run({ input: map }),
    page: walkPageName.run({ input: map }),
  }),
});

const walkMarkName = resource({
  label: "viewer.walkMarkName",
  config: { map: walkMap.required },
  depends: { walkNameOf },
  factory: ({ walkNameOf }, { config: { map } }) => walkNameOf.run({ input: map }),
});

const answerPicks = resource({
  label: "viewer.answerPicks",
  config: {
    canvas: walkCanvas.required,
    id: walkId.required,
    from: walkFrom.required,
    call: walkCall.required,
  },
  depends: (c) => ({ doc: walkDoc({ canvas: c.canvas, id: c.id }), walkPicks }),
  factory: ({ doc, walkPicks }, { config: { from, call } }) => {
    const map = doc.get()?.map;
    return map ? walkPicks.run({ input: { map, from, call } }) : [];
  },
});

export function WalkMark({ name }: { name: string }) {
  const map = useData(walkMarkName({ map: name }));
  const start = useRun(startWalk);
  if (map === null) return null;

  return (
    <button
      type="button"
      className="e-axis e-walk-mark"
      aria-label={`Walk ${map}`}
      data-own-pointer=""
      onClick={() => start.run({ input: { map } })}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M5 3.5v9l7-4.5Z" />
      </svg>
      Walk
    </button>
  );
}

export function WalkLayer({ canvas }: { canvas: string }) {
  const walk = useData(walking);
  if (!walk) return null;

  return <WalkPage canvas={canvas} walk={walk} />;
}

function WalkPage({ canvas, walk }: { canvas: string; walk: Walk }) {
  const names = useData(walkNames({ map: walk.map }));
  const page = useData(pageList({ canvas })).find((each) => each.name === names.page);
  if (!page) return <WalkMissing walk={walk} why={`No page ${names.page} on this canvas.`} />;

  return <WalkFrames canvas={canvas} page={page.key} walk={walk} frameName={names.frame} />;
}

type FramesProps = { canvas: string; page: string; walk: Walk; frameName: string };

function WalkFrames({ canvas, page, walk, frameName }: FramesProps) {
  const list = useData(frames.board.frames.where({ canvas, page }));
  const frame = list.find((each) => each.name === frameName);
  if (!frame) return <WalkMissing walk={walk} why={`No frame ${frameName} on its page.`} />;

  return <WalkScreen canvas={canvas} page={page} walk={walk} frame={frame} />;
}

function WalkMissing({ walk, why }: { walk: Walk; why: string }) {
  return (
    <section className="e-walk" aria-label={`Walk ${walk.map}`}>
      <WalkBar walk={walk} canvas="" id="" doc={null} place={null} size={{ w: 1, h: 1 }} />
      <p className="e-walk-note" role="status">
        {why}
      </p>
    </section>
  );
}

type ScreenProps = { canvas: string; page: string; walk: Walk; frame: BoardFrame };

const statePlace = resource({
  label: "viewer.statePlace",
  config: { canvas: walkCanvas.required, page: walkPage.required, name: walkState.required },
  depends: (c) => ({
    list: frames.board.frames.where({ canvas: c.canvas, page: c.page }),
    kit: frames.board.kit.of({ canvas: c.canvas }),
  }),
  factory: ({ list, kit }, { config: { page, name } }) => {
    const frame = list.get()?.find((each) => each.name === name);
    if (!frame) return null;

    const box = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
    const at = { page, frameId: frame.id, frameName: frame.name, version: frame.version, box };
    return { ...at, kit: kit.get()?.kit ?? null };
  },
});

function WalkScreen({ canvas, page, walk, frame }: ScreenProps) {
  const doc = useData(walkDoc({ canvas, id: frame.id }));
  const port = useResource(walkPort);
  const fit = useData(walkFit);
  const shown = walk.path.at(-1)?.state ?? "";
  const place = useData(statePlace({ canvas, page, name: `${walk.map} · ${shown}` }));
  const size = { w: frame.w, h: frame.h };
  const mode = useData(requestMode, (on) => (on ? "request" : "walk"));

  return (
    <section className="e-walk" aria-label={`Walk ${walk.map}`} data-mode={mode}>
      <WalkBar walk={walk} canvas={canvas} id={frame.id} doc={doc} place={place} size={size} />
      <div className="e-walk-stage" ref={(el) => port.measure(el, size)}>
        <div className="e-walk-screen" style={{ width: size.w * fit, height: size.h * fit }}>
          {doc ? <WalkDoc walk={walk} doc={doc} size={size} fit={fit} /> : null}
          <WalkAsk canvas={canvas} place={place} fit={fit} />
          <WalkDraft canvas={canvas} place={place} fit={fit} />
        </div>
      </div>
    </section>
  );
}

type Doc = { html: string; version: number; map: MapJson | null; theme: string };

type DocProps = { walk: Walk; doc: Doc; size: { w: number; h: number }; fit: number };

function WalkDoc({ walk, doc, size, fit }: DocProps) {
  const port = useResource(walkPort);
  const scheme = doc.theme === themeSwitch.default ? {} : { colorScheme: doc.theme };

  return (
    <iframe
      key={doc.version}
      className="e-walk-doc"
      sandbox="allow-scripts allow-forms"
      title={`${walk.map} · ${walk.path.at(-1)?.state ?? "starting"}`}
      srcDoc={doc.html}
      ref={(el) => port.attach(el, doc.map)}
      style={{ width: size.w, height: size.h, transform: `scale(${fit})`, ...scheme }}
    />
  );
}

type StatePlace = Omit<Place, "x" | "y">;

function WalkAsk({
  canvas,
  place,
  fit,
}: {
  canvas: string;
  place: StatePlace | null;
  fit: number;
}) {
  const asking = useData(requestMode);
  const draft = useData(drafts);
  const pick = useRun(pickPlace);
  if (!asking || draft || !place) return null;

  return (
    <div
      className="e-walk-ask"
      aria-label="Press the screen to ask for a change here"
      onClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const x = Math.round((event.clientX - box.left) / fit);
        const y = Math.round((event.clientY - box.top) / fit);
        pick.run({ input: { canvas, place: { ...place, x, y } } });
      }}
    />
  );
}

type DraftProps = { canvas: string; place: StatePlace | null; fit: number };

function WalkDraft({ canvas, place, fit }: DraftProps) {
  const draft = useData(drafts);
  if (!draft || draft.canvas !== canvas || draft.place.frameId !== place?.frameId) return null;

  return (
    <div className="e-walk-draft" style={{ left: draft.place.x * fit, top: draft.place.y * fit }}>
      <span className="e-pin" data-draft aria-hidden="true">
        ?
      </span>
      <Composer d={draft} lost={false} />
    </div>
  );
}

type BarProps = {
  walk: Walk;
  canvas: string;
  id: string;
  doc: Doc | null;
  place: StatePlace | null;
  size: { w: number; h: number };
};

function WalkBar({ walk, canvas, id, doc, place, size }: BarProps) {
  const shown = walk.path.at(-1)?.state ?? null;
  const middle = { x: Math.round(size.w / 2), y: Math.round(size.h / 3) };
  const asked = place ? { ...place, ...middle } : null;

  return (
    <header className="e-walk-bar" role="toolbar" aria-label="Walk">
      <p className="e-walk-where">
        <span className="e-walk-title">Walk {walk.map}</span>
        <span className="e-walk-state" aria-label="State">
          {shown ?? "starting"}
        </span>
        <span className="e-walk-steps" aria-label="Steps">
          {walk.path.map((step) => step.state).join(" → ")}
        </span>
      </p>
      <WalkActs walk={walk} />
      <OffMap walk={walk} canvas={canvas} asked={asked} />
      {doc?.map && shown
        ? walk.waits.map((wait) => (
            <WaitRow key={wait.id} canvas={canvas} id={id} from={shown} wait={wait} />
          ))
        : null}
    </header>
  );
}

function WalkActs({ walk }: { walk: Walk }) {
  const port = useResource(walkPort);
  const leave = useRun(leaveWalk);
  const comment = useRun(toggleRequest);
  const asking = useData(requestMode);
  const open = useData(drafts, (d) => d !== null);
  const stuck = walk.path.length < 2 || asking || open;

  return (
    <div className="e-walk-acts">
      <button type="button" disabled={stuck} onClick={() => port.step("back")}>
        Back
      </button>
      <button type="button" disabled={stuck} onClick={() => port.step("restart")}>
        Restart
      </button>
      <button type="button" aria-pressed={asking} disabled={open} onClick={() => comment.run()}>
        Comment
      </button>
      <button type="button" disabled={open} onClick={() => leave.run()}>
        Leave
      </button>
    </div>
  );
}

function OffMap({ walk, canvas, asked }: { walk: Walk; canvas: string; asked: Place | null }) {
  const ask = useRun(askForIt);
  const { told } = walk;
  if (told.kind !== "offMap") return null;

  const text = `The code goes from ${told.from} to ${told.to}, and the map has no such move. Add the state ${told.to} to the map, with its screen.`;
  return (
    <p className="e-walk-told" role="status">
      The map has no move from {told.from} to {told.to}.
      {asked ? (
        <button type="button" onClick={() => ask.run({ input: { canvas, place: asked, text } })}>
          Ask for it
        </button>
      ) : null}
    </p>
  );
}

type WaitProps = { canvas: string; id: string; from: string; wait: Waiting };

function WaitRow({ canvas, id, from, wait }: WaitProps) {
  const port = useResource(walkPort);
  const held = useData(walkHeld({}));
  const picks = useData(answerPicks({ canvas, id, from, call: wait.call }));

  return (
    <p className="e-walk-wait" role="group" aria-label={`${wait.call} waits for its answer`}>
      <span>{wait.call} waits. Pick its answer:</span>
      {picks.map((one) => (
        <button
          key={one.answer}
          type="button"
          disabled={held}
          onClick={() => port.pick(wait.id, one.answer)}
        >
          {one.to ? `${one.answer} → ${one.to}` : one.answer}
        </button>
      ))}
    </p>
  );
}
