import { Menu } from "@base-ui/react/menu";
import { useData, useRun } from "@tinkered/react";

import { closeCard, openedRequest, toggleCard } from "./draft";
import {
  doneStates,
  forAViewer,
  panelList,
  panelOpen,
  pickList,
  requestStates,
  requestViews,
  serverTime,
} from "./follow";
import type { Outdated, RequestView, Shown } from "./follow";
import { holdsHere } from "./hold";
import { openMenu, setMenu } from "./overlays";
import { pageList } from "./pages";

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

export function StateMark({ shown, agent }: { shown: Shown; agent: string | null }) {
  const word = shown === "inWork" ? (agent ?? "") : stateWords[shown];

  return (
    <span className="e-sb" data-state={shown} role="img" aria-label={word} title={word}>
      <i className="e-sb-mark" />
      {shown === "inWork" ? <span className="e-sb-label">{word}</span> : null}
    </span>
  );
}

export function RequestMark({ v, short = false }: { v: RequestView; short?: boolean }) {
  const words = useData(holdsHere({ canvas: v.r.canvas })).get(v.r.id);
  if (v.shown !== "waiting" || words === undefined) {
    return <StateMark shown={v.shown} agent={v.r.claimedBy} />;
  }

  return (
    <span className="e-sb" data-state="held" data-hold={words.kind} title={words.mark}>
      <i className="e-sb-mark" />
      <span className="e-sb-label">{short ? words.short : words.mark}</span>
    </span>
  );
}

const outdatedWords: Record<Outdated["cause"], string> = {
  changed: "May be outdated: the frame changed",
  removed: "May be outdated: the frame was removed",
  old: "May be outdated: a long wait",
};

export function OutdatedMark({ cause }: { cause: Outdated["cause"] }) {
  const word = outdatedWords[cause];

  return (
    <span className="e-sb" data-state="outdated" role="img" aria-label={word} title={word}>
      <i className="e-sb-mark" />
    </span>
  );
}

export function Initial({ name }: { name: string | null }) {
  return <>{(name?.trim().charAt(0) ?? "").toUpperCase() || "?"}</>;
}

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

export function Place({ v }: { v: RequestView }) {
  const pages = useData(pageList({ canvas: v.r.canvas }));
  const page = pages.length > 1 ? pages.find((p) => p.key === v.page)?.name : undefined;
  if (v.r.frameId === null) return <>{page ? `On page ${page}` : "On the whole canvas"}</>;
  if (v.frameName === null) return null;

  return <>{page ? `On ${v.frameName}, page ${page}` : `On ${v.frameName}`}</>;
}

function Count({ n }: { n: number }) {
  return (
    <span className="e-count" aria-hidden="true">
      {n}
    </span>
  );
}

export function RequestsButton({ canvas }: { canvas: string }) {
  const waiting = useData(requestStates({ canvas })).filter((v) =>
    forAViewer.includes(v.shown),
  ).length;
  const list = useData(panelOpen);
  const opened = useData(openedRequest, (o) => o?.canvas === canvas);
  const toggle = useRun(toggleCard);

  return (
    <button
      type="button"
      className="e-dock-btn"
      aria-label={waiting ? `Requests, ${waiting} wait for you` : "Requests"}
      aria-pressed={list || opened}
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

function Row({
  v,
  open,
  onOpen,
}: {
  v: RequestView;
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
            <RequestMark v={v} short />
            {v.outdated ? <OutdatedMark cause={v.outdated.cause} /> : null}
            <span className="e-rr-ref">{`#${v.r.n}`}</span>
          </span>
          <span className="e-rr-text">{v.text}</span>
          <span className="e-rr-place">
            <Place v={v} />
          </span>
        </span>
      </button>
    </li>
  );
}

function Group({
  title,
  views,
  canvas,
  onOpen,
}: {
  title: string | null;
  views: readonly RequestView[];
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
            open={opened?.canvas === canvas && opened.n === v.r.n}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
}

function ListMenu({ open, done }: { open: number; done: number }) {
  const shown = useData(panelList);
  const menu = useData(openMenu, (m) => m === "list");
  const set = useRun(setMenu);
  const pick = useRun(pickList);

  return (
    <div className="e-menu-at">
      <Menu.Root
        modal={false}
        open={menu}
        onOpenChange={(next) => set.run({ input: { menu: "list", open: next } })}
      >
        <Menu.Trigger className="e-ghost">
          {shown === "open" ? "Open" : "Done"}
          <svg className="e-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="e-menu-pos" align="end" sideOffset={4}>
            <Menu.Popup className="e-menu" aria-label="Lists">
              <Menu.RadioGroup value={shown}>
                {(["open", "done"] as const).map((list) => (
                  <Menu.RadioItem key={list} value={list} onClick={() => pick.run({ input: list })}>
                    <span>{list === "open" ? "Open" : "Done"}</span>
                    <span className="e-menu-n">{list === "open" ? open : done}</span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

function CloseList() {
  const close = useRun(closeCard);

  return (
    <button
      type="button"
      className="e-close"
      aria-label="Close requests"
      title="Close"
      onClick={() => close.run()}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M3.5 3.5l7 7M10.5 3.5l-7 7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

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

function Lists({
  views,
  canvas,
  onOpen,
}: {
  views: readonly RequestView[];
  canvas: string;
  onOpen: (v: RequestView) => void;
}) {
  const shown = useData(panelList);
  const group = { canvas, onOpen };
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

export function Panel({ canvas, onOpen }: { canvas: string; onOpen: (v: RequestView) => void }) {
  const views = useData(requestViews({ canvas }));
  const waits = views.filter((v) => forAViewer.includes(v.shown)).length;
  const done = views.filter((v) => doneStates.includes(v.shown)).length;

  return (
    <>
      <header className="e-panel-head">
        <h2>Requests</h2>
        {waits ? <Count n={waits} /> : null}
        <ListMenu open={views.length - done} done={done} />
        <CloseList />
      </header>
      <div className="e-panel-body">
        <Lists views={views} canvas={canvas} onOpen={onOpen} />
      </div>
    </>
  );
}
