import { operation } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import { z } from "zod";

import { frames } from "@/frames";
import type { FrameInfo } from "@/frames/contract";
import { viewerName } from "@/frames/share";
import type { Request } from "@/queue/cells";
import type { State } from "@/queue/contract";

import {
  drafts,
  escape,
  openedRequest,
  openRequest,
  requestMode,
  requestState,
  sendDraft,
  shownName,
  toggleRequest,
  typeText,
} from "./draft";
import type { Draft, Place } from "./draft";
import { partBox } from "./stage";

// The page side of a request (SPEC-viewer.md § Ask for a change; the E4.1 and E3.2 designs): the
// button `Request`, the pins, the textbox's popover, and the text a gate page keeps. The pins and
// the popover sit in the world, so they move with the canvas, and keep their screen size by the
// stage's inverse zoom (`--e-unzoom`). They take their own pointer: a press on them does not pan.

/** The button `Request` in the dock: a speech bubble. It shows pressed in request mode. */
export function RequestButton() {
  const on = useData(requestMode);
  const toggle = useRun(toggleRequest);

  return (
    <button
      type="button"
      className="e-dock-btn"
      aria-label="Request"
      aria-pressed={on}
      title="Ask for a change"
      onClick={() => toggle.run()}
    >
      <svg className="e-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      </svg>
    </button>
  );
}

/** The first letter of a name, for a pin or an avatar. */
function Initial({ name }: { name: string | null }) {
  return <>{(name?.trim().charAt(0) ?? "").toUpperCase() || "?"}</>;
}

/** Where a request is, as the popover says it. */
function Where({ frameName }: { frameName: string | null }) {
  return <>{frameName === null ? "On the whole canvas" : `On ${frameName}`}</>;
}

/** Why a textbox was not sent, after "Not sent: " (E4.1 N10, SPEC-viewer § Ask for a change 5). */
const notSent = {
  gone: "an agent removed the <frame> frame. Your text is kept. Click the canvas to put the pin again.",
  full: "this canvas has too many open requests. Your text is kept. Send again when some are done.",
  slow: "you sent many requests in a short time. Your text is kept. Send again in a minute.",
  link: "no link to easel. Your text is kept. Send again when Reconnecting goes.",
  failed: "easel had a problem. Your text is kept. Send again.",
  none: "Your text is kept.",
} as const;

/** What the textbox says when it is not known yet whether a send saved (step 6). */
const unknownText = {
  link: "Not known yet if easel saved it. Your text is kept. It goes again when Reconnecting goes.",
  failed: "Not known yet if easel saved it. Your text is kept. Send again.",
} as const;

/** The alert under the textbox, if it has one. */
function Said({ d, lost }: { d: Draft; lost: boolean }) {
  switch (d.step) {
    case "typing":
    case "naming":
    case "sending":
      return null;
    case "unknown":
      return <p role="alert">{d.why === "link" ? unknownText.link : unknownText.failed}</p>;
    case "notSent":
      return <NotSent d={d} lost={lost} />;
  }
}

/** Why nothing was sent. A Send with the socket down says so while it is down; once it is back, Send again. */
function NotSent({ d, lost }: { d: Draft; lost: boolean }) {
  if (d.why === "link" && !lost) return null;

  return (
    <p role="alert">{`Not sent: ${notSent[d.why].replace("<frame>", d.place.frameName ?? "")}`}</p>
  );
}

/** The textbox's popover: the request, its place, the name at the first Send, and Send. */
function Composer({ d, lost }: { d: Draft; lost: boolean }) {
  const type = useRun(typeText);
  const send = useRun(sendDraft);
  const name = useData(shownName);
  const busy = d.step === "sending";
  const refused = d.step === "notSent" && !(d.why === "link" && !lost);
  const naming = d.step === "naming";

  return (
    <form
      className="e-pop"
      aria-label="New request"
      onSubmit={(event) => {
        event.preventDefault();
        const typed = new FormData(event.currentTarget).get("name");
        const name = typeof typed === "string" ? viewerName.safeParse(typed).data : undefined;
        if (naming && name === undefined) return;
        send.run({ input: name === undefined ? {} : { name } });
      }}
    >
      <div className="e-row">
        <span className="e-avatar" aria-hidden="true">
          <Initial name={name} />
        </span>
        <div className="e-field">
          <div className="e-box" data-busy={busy} aria-invalid={refused || d.step === "unknown"}>
            <textarea
              aria-label="Request"
              rows={2}
              value={d.text}
              readOnly={busy || d.step === "unknown"}
              aria-invalid={refused || d.step === "unknown"}
              // The textbox opens with the focus, as a comment box does in Figma.
              autoFocus
              onChange={(event) => type.run({ input: event.target.value })}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
            />
            {naming ? null : (
              <button type="submit" className="e-send" aria-label="Send" disabled={busy}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
                </svg>
              </button>
            )}
          </div>
          <p className="e-place">
            <Where frameName={d.place.frameName} />
          </p>
          <Said d={d} lost={lost} />
        </div>
      </div>
      {naming ? (
        <div className="e-name">
          <label>
            Your name
            <input name="name" required maxLength={40} autoFocus autoComplete="name" />
          </label>
          <p className="e-hint">
            People on this canvas see it on your requests. This browser keeps it.
          </p>
          <div className="e-acts">
            <button type="submit" className="e-primary">
              Send
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

/** The word for each state of a request (SPEC-viewer § Follow the requests 6); in work, the agent's name. */
const stateWords: Record<Exclude<State, "inWork">, string> = {
  waiting: "Waiting for an agent",
  person: "Needs a person",
  question: "Question for you",
  result: "Result to check",
  accepted: "Done",
  closed: "Closed",
};

/** The word of a state; in work, the name of the agent. */
function StateWord({ state, agent }: { state: State | null; agent: string | null }) {
  if (state === null) return null;

  return <>{state === "inWork" ? (agent ?? "") : stateWords[state]}</>;
}

/** The popover of a saved request: its number and place, who asked, the text, and its state. */
function Opened({ canvas, n, list }: { canvas: string; n: number; list: readonly FrameInfo[] }) {
  const request = useData(frames.board.requests.where({ canvas })).find((r) => r.n === n);
  const asked = useData(frames.board.messages.where({ canvas })).find(
    (m) => m.request === request?.id && m.kind === "ask",
  );
  const state = useData(requestState({ canvas, n }));
  const close = useRun(escape);
  if (!request) return null;

  const frame = list.find((f) => f.id === request.frameId);

  return (
    <section className="e-pop" role="dialog" aria-label={`Request #${n}`}>
      <header className="e-head">
        <span>
          {`#${n} · `}
          <Where frameName={request.frameId === null ? null : (frame?.name ?? "")} />
        </span>
        <button type="button" className="e-close" aria-label="Close" onClick={() => close.run()}>
          ×
        </button>
      </header>
      <div className="e-row">
        <span className="e-avatar" aria-hidden="true">
          <Initial name={request.author} />
        </span>
        <div className="e-field">
          <p className="e-who">{request.author}</p>
          <p>{asked?.text ?? ""}</p>
          <p className="e-state">
            <StateWord state={state} agent={request.claimedBy} />
          </p>
        </div>
      </div>
    </section>
  );
}

/** Something at a place on the canvas, at its screen size. */
function At({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    // The stage leaves a press here alone (`ownPointer`): no pan, and text can be selected.
    <div className="e-at" style={{ left: x, top: y }} data-own-pointer="">
      {children}
    </div>
  );
}

/**
 * Something at a saved request's place: on its frame, or on the canvas. Nothing when its frame
 * is not on the board.
 */
function AtRequest({
  r,
  list,
  children,
}: {
  r: Request;
  list: readonly FrameInfo[];
  children: React.ReactNode;
}) {
  const frame = list.find((f) => f.id === r.frameId);
  if (r.frameId === null) return <At {...r}>{children}</At>;
  if (!frame) return null;

  return (
    <At x={frame.x + r.x} y={frame.y + r.y}>
      {children}
    </At>
  );
}

/**
 * The pins of the canvas's requests, the draft's pin and its popover, or the popover of a saved
 * request. A request whose frame is gone has no pin (the viewer-pin-link chart's PinMeansSaved).
 */
export function Requests({
  canvas,
  list,
  lost,
}: {
  canvas: string;
  list: readonly FrameInfo[];
  lost: boolean;
}) {
  const d = useData(drafts);
  const opened = useData(openedRequest);
  const here = d?.canvas === canvas ? d : null;

  return (
    <div className="e-pins">
      <Pins canvas={canvas} list={list} />
      {here ? <DraftAt d={here} lost={lost} /> : null}
      {opened?.canvas === canvas && !here ? (
        <OpenedAt canvas={canvas} n={opened.n} list={list} />
      ) : null}
    </div>
  );
}

/** The pin of each saved request of the canvas, to open its popover. */
function Pins({ canvas, list }: { canvas: string; list: readonly FrameInfo[] }) {
  const pins = useData(frames.board.requests.where({ canvas }));
  const opened = useData(openedRequest);
  const open = useRun(openRequest);

  return (
    <>
      {pins.map((r) => (
        <AtRequest key={r.n} r={r} list={list}>
          <button
            type="button"
            className="e-pin"
            aria-label={`Request #${r.n}`}
            aria-pressed={opened?.canvas === canvas && opened.n === r.n}
            onClick={() => open.run({ input: { canvas, n: r.n } })}
          >
            <Initial name={r.author} />
          </button>
        </AtRequest>
      ))}
    </>
  );
}

/**
 * The draft's pin and its popover, at its place. When an agent removed its frame, the frame
 * shows as a dashed area where it was.
 */
function DraftAt({ d, lost }: { d: Draft; lost: boolean }) {
  const box = d.place.box;
  const gone = d.step === "notSent" && d.why === "gone";

  return (
    <>
      <FrameArea gone={gone} place={d.place} />
      <At x={(box?.x ?? 0) + d.place.x} y={(box?.y ?? 0) + d.place.y}>
        <span className="e-pin" data-draft aria-hidden="true">
          ?
        </span>
        <Composer d={d} lost={lost} />
      </At>
    </>
  );
}

/** Where the draft's frame is: a dashed area once an agent removed it, else the part's outline. */
function FrameArea({ gone, place }: { gone: boolean; place: Place }) {
  const box = place.box;
  if (!box) return null;
  if (!gone) return <Outline place={place} at={box} />;

  return (
    <div className="e-gone" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
  );
}

/**
 * The outline of the part a draft is on: the box that the frame's document gave for the place
 * clicked (`partBox`), on the frame at `at`. None until it answers, or for no part.
 */
function Outline({ place, at }: { place: Place; at: { x: number; y: number } }) {
  const part = useData(partBox);
  const box =
    part?.id === place.frameId && part.x === place.x && part.y === place.y ? part.box : null;
  if (!box) return null;

  return (
    <div
      className="e-outline"
      aria-hidden="true"
      style={{ left: at.x + box.x, top: at.y + box.y, width: box.w, height: box.h }}
    />
  );
}

/** The popover of a saved request, at its pin. */
function OpenedAt({ canvas, n, list }: { canvas: string; n: number; list: readonly FrameInfo[] }) {
  const r = useData(frames.board.requests.where({ canvas })).find((row) => row.n === n);
  if (!r) return null;

  return (
    <AtRequest r={r} list={list}>
      <Opened canvas={canvas} n={n} list={list} />
    </AtRequest>
  );
}

/** Copies the kept text to the clipboard. */
const copyText = operation({
  label: "viewer.copyText",
  input: z.string(),
  run: (_, { input }) => navigator.clipboard.writeText(input),
});

/**
 * The text of a request being typed when the tab left the canvas (the ended page, the password
 * page): it stays to copy. It says "not sent" only of a request that no send may have saved
 * (judged rule 7, the viewer-pin-link chart's EndedPageKeepsText).
 */
export function KeptText() {
  const d = useData(drafts);
  const copy = useRun(copyText);
  if (!d || !d.text.trim()) return null;

  const maybe = d.maybeSaved || d.step === "sending" || d.step === "unknown";
  return (
    <section className="e-kept" aria-label="Your request">
      <h2>{maybe ? "Not known if your request was saved" : "Your request was not sent"}</h2>
      <p className="e-kept-text">{d.text}</p>
      <p>Copy it before you leave this page.</p>
      <button type="button" onClick={() => copy.run({ input: d.text })}>
        Copy text
      </button>
    </section>
  );
}
