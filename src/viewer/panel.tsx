import { useData, useRun } from "@tinkered/react";

import { frames } from "@/frames";
import type { FrameInfo } from "@/frames/contract";

import { openedRequest } from "./draft";
import {
  doneStates,
  forAViewer,
  listMenu,
  panelList,
  panelOpen,
  pickList,
  requestViews,
  serverTime,
  toggleListMenu,
  togglePanel,
} from "./follow";
import type { Outdated, RequestView, Shown } from "./follow";

// The panel `Requests` and the button that opens it (SPEC-viewer.md § Follow the requests 1 to
// 9, 17; the E4.4 design: the library's Sidebar, RequestRow, StateBadge and Count). The panel
// reads each request as `requestViews` gives it, so the list, the count, the pins and the popover
// say one state.

/** The word of each state (step 6): its mark's accessible name and tooltip. In work: the agent. */
export const stateWords: Record<Exclude<Shown, "inWork">, string> = {
  waiting: "Waiting for an agent",
  question: "Question for you",
  result: "Result to check",
  person: "Needs a person",
  accepted: "Done",
  doneNoAnswer: "Done, no answer",
  closed: "Closed",
  takenBack: "Taken back",
};

/** The mark of a state, named by its word. In work, the half circle and the agent's name. */
export function StateMark({ shown, agent }: { shown: Shown; agent: string | null }) {
  const word = shown === "inWork" ? (agent ?? "") : stateWords[shown];

  return (
    <span className="e-sb" data-state={shown} role="img" aria-label={word} title={word}>
      <i className="e-sb-mark" />
      {shown === "inWork" ? <span className="e-sb-label">{word}</span> : null}
    </span>
  );
}

/** The word of each cause of "may be outdated" (step 6). */
const outdatedWords: Record<Outdated["cause"], string> = {
  changed: "May be outdated: the frame changed",
  removed: "May be outdated: the frame was removed",
  old: "May be outdated: a long wait",
};

/** The mark of a request that may be outdated: a dotted circle, named by its cause (step 6). */
export function OutdatedMark({ cause }: { cause: Outdated["cause"] }) {
  const word = outdatedWords[cause];

  return (
    <span className="e-sb" data-state="outdated" role="img" aria-label={word} title={word}>
      <i className="e-sb-mark" />
    </span>
  );
}

/** The first letter of a name, for a pin or an avatar. */
export function Initial({ name }: { name: string | null }) {
  return <>{(name?.trim().charAt(0) ?? "").toUpperCase() || "?"}</>;
}

/** How long ago, at the server's time as the clock capsule says it (fact rule 9). */
export function Age({ from }: { from: number }) {
  const now = useData(serverTime) ?? from;
  const minutes = Math.floor(Math.max(now - from, 0) / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (minutes < 1) return <>just now</>;
  if (minutes < 60) return <>{`${minutes}\u00a0min`}</>;
  if (hours < 24) return <>{`${hours}\u00a0h`}</>;

  return <>{days < 2 ? "Yesterday" : `${days}\u00a0days`}</>;
}

/** Where a request is: "On <frame>", also of a removed frame, or "On the whole canvas". */
export function Place({ r, list }: { r: RequestView["r"]; list: readonly FrameInfo[] }) {
  const gone = useData(frames.board.removed.of({ canvas: r.canvas, id: r.frameId ?? "" }));
  if (r.frameId === null) return <>On the whole canvas</>;
  const name = list.find((f) => f.id === r.frameId)?.name ?? gone?.name;

  return <>{name ? `On ${name}` : ""}</>;
}

/** A count, as the library's Count: an accent pill. Its parent says it in words. */
function Count({ n }: { n: number }) {
  return (
    <span className="e-count" aria-hidden="true">
      {n}
    </span>
  );
}

/**
 * The button `Requests` in the dock (step 1): it shows the count of requests that wait for a
 * viewer, and its name says it. It shows pressed while the panel is open.
 */
export function RequestsButton({ canvas }: { canvas: string }) {
  const waiting = useData(requestViews({ canvas })).filter((v) =>
    forAViewer.includes(v.shown),
  ).length;
  const open = useData(panelOpen);
  const toggle = useRun(togglePanel);

  return (
    <button
      type="button"
      className="e-dock-btn"
      aria-label={waiting ? `Requests, ${waiting} wait for you` : "Requests"}
      aria-pressed={open}
      title="Requests on this canvas"
      onClick={() => toggle.run()}
    >
      <svg className="e-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      </svg>
      {waiting ? <Count n={waiting} /> : null}
    </button>
  );
}

/** One request in the list (step 5; the library's RequestRow). A press opens it. */
function Row({
  v,
  list,
  open,
  onOpen,
}: {
  v: RequestView;
  list: readonly FrameInfo[];
  open: boolean;
  onOpen: (v: RequestView) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="e-rr"
        aria-current={open}
        data-selected={open}
        onClick={() => onOpen(v)}
      >
        <span className="e-rr-av" aria-hidden="true">
          <Initial name={v.r.author} />
        </span>
        {v.changed ? (
          <span
            className="e-rr-changed"
            role="img"
            aria-label="Changed since your last visit"
            title="Changed since your last visit"
          />
        ) : null}
        <span className="e-rr-main">
          <span className="e-rr-head">
            <strong>{v.r.author}</strong>
            <span className="e-rr-when">
              <Age from={v.r.created} />
            </span>
            <span className="e-rr-sep" aria-hidden="true" />
            <StateMark shown={v.shown} agent={v.r.claimedBy} />
            {v.outdated ? <OutdatedMark cause={v.outdated.cause} /> : null}
            <span className="e-rr-ref">{`#${v.r.n}`}</span>
          </span>
          <span className="e-rr-text">{v.text}</span>
          <span className="e-rr-place">
            <Place r={v.r} list={list} />
          </span>
        </span>
      </button>
    </li>
  );
}

/** A group of rows with its heading, or nothing when it has no row. */
function Group({
  title,
  views,
  list,
  canvas,
  onOpen,
}: {
  title: string | null;
  views: readonly RequestView[];
  list: readonly FrameInfo[];
  canvas: string;
  onOpen: (v: RequestView) => void;
}) {
  const opened = useData(openedRequest);
  if (!views.length) return null;

  return (
    <section className="e-group" aria-label={title ?? undefined}>
      {title ? <h3>{title}</h3> : null}
      <ul>
        {views.map((v) => (
          <Row
            key={v.r.id}
            v={v}
            list={list}
            open={opened?.canvas === canvas && opened.n === v.r.n}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
}

/** The menu of the panel's head: the lists `Open` and `Done`, each with its count of rows. */
function ListMenu({ open, done }: { open: number; done: number }) {
  const shown = useData(panelList);
  const menu = useData(listMenu);
  const toggle = useRun(toggleListMenu);
  const pick = useRun(pickList);

  return (
    <div className="e-menu-at">
      <button
        type="button"
        className="e-ghost"
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => toggle.run()}
      >
        {shown === "open" ? "Open" : "Done"}
        <svg className="e-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {menu ? (
        <div className="e-menu" role="menu" aria-label="Lists">
          {(["open", "done"] as const).map((list) => (
            <button
              key={list}
              type="button"
              role="menuitemradio"
              aria-checked={shown === list}
              onClick={() => pick.run({ input: list })}
            >
              <span>{list === "open" ? "Open" : "Done"}</span>
              <span className="e-menu-n">{list === "open" ? open : done}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** What the list `Open` says on a canvas with no request at all. */
function NoRequests() {
  return (
    <div className="e-none">
      <strong>No requests yet</strong>
      <p>
        Click the speech bubble in the dock (Ask for a change), then a part of a frame. To ask about
        the whole canvas, click a place out of all frames.
      </p>
    </div>
  );
}

/** The list on show: `Open` in its two groups, or `Done`; or what an empty list says. */
function Lists({
  views,
  canvas,
  list,
  onOpen,
}: {
  views: readonly RequestView[];
  canvas: string;
  list: readonly FrameInfo[];
  onOpen: (v: RequestView) => void;
}) {
  const shown = useData(panelList);
  const group = { list, canvas, onOpen };
  if (views.length === 0) return <NoRequests />;

  const done = views.filter((v) => doneStates.includes(v.shown));
  if (shown === "done") {
    return done.length ? (
      <Group title={null} views={done} {...group} />
    ) : (
      <p className="e-none">No done requests yet.</p>
    );
  }
  const waits = views.filter((v) => forAViewer.includes(v.shown));
  const other = views.filter((v) => !waits.includes(v) && !done.includes(v));

  return (
    <>
      <Group title="Waits for you" views={waits} {...group} />
      <Group title="Other requests" views={other} {...group} />
    </>
  );
}

/**
 * The panel `Requests` at the right edge (steps 2 to 5): its head with the count and the menu
 * of lists, then the list `Open` in two groups, `Waits for you` and `Other requests`, or the list
 * `Done`, newest first.
 */
export function Panel({
  canvas,
  list,
  onOpen,
}: {
  canvas: string;
  list: readonly FrameInfo[];
  onOpen: (v: RequestView) => void;
}) {
  const views = useData(requestViews({ canvas }));
  const waits = views.filter((v) => forAViewer.includes(v.shown)).length;
  const done = views.filter((v) => doneStates.includes(v.shown)).length;

  return (
    <aside className="e-panel" aria-label="Requests">
      <header className="e-panel-head">
        <h2>Requests</h2>
        {waits ? <Count n={waits} /> : null}
        <ListMenu open={views.length - done} done={done} />
      </header>
      <div className="e-panel-body">
        <Lists views={views} canvas={canvas} list={list} onOpen={onOpen} />
      </div>
    </aside>
  );
}
