import { useData, useRun } from "@tinkered/react";

import type { FrameInfo } from "@/frames/contract";

import {
  actOn,
  boxCalls,
  boxFits,
  cancelBox,
  copyLink,
  copyText,
  myName,
  openBox,
  toggleMore,
  typeBox,
  typedName,
  typeName,
} from "./act";
import type { Act } from "./act";
import { Compare } from "./compare";
import { acting, escape, moreMenu } from "./draft";
import type { ActBox as Box, Acting as Acts } from "./draft";
import { seenWhileOpen } from "./follow";
import type { Line, RequestView, Shown } from "./follow";
import { Age, Initial, OutdatedMark, Place, StateMark } from "./panel";

// The popover of a saved request (SPEC-viewer.md § Follow the requests 10 to 16; the E4.1, E4.2
// and E4.3 designs): its head with `More` and `Close`, its thread, and the controls of its state.
// Any viewer of the link can use them; each use is a message with the viewer's name.

/** A textbox: its name, and the hint in it while it is empty. */
const boxTexts = {
  correct: { name: "Request", hint: "" },
  answer: { name: "Answer", hint: "Or write an answer…" },
  note: { name: "Note", hint: "Why open it again?" },
  clear: { name: "Make it clear, then send it back", hint: "Make it clear, then send it back…" },
} as const;

/** The states in which `Take back` (or `Close request`) shows in `More` (step 11). */
const takeable: readonly Shown[] = ["waiting", "inWork", "question", "person"];

/** Why nothing was saved, after "Not sent: ", and what to do then. */
const missed = {
  gone: { why: "this request is not on the canvas any more.", next: "" },
  full: { why: "this canvas has too many open requests.", next: " Send again when some are done." },
  slow: { why: "you sent many changes in a short time.", next: " Send again in a minute." },
  link: { why: "no link to easel.", next: " Send again when Reconnecting goes." },
  failed: { why: "easel had a problem.", next: " Send again." },
} as const;

/** One step of the thread: the name, what was done, and the time. */
function Step({ line }: { line: Extract<Line, { kind: "step" }> }) {
  return (
    <li className="e-step">
      <i className="e-step-dot" aria-hidden="true" />
      <span>
        {line.who === null ? null : <strong>{line.who}</strong>}
        {` ${line.what}`}
        {line.at === null ? null : (
          <>
            {" · "}
            <Age from={line.at} />
          </>
        )}
      </span>
    </li>
  );
}

/** The options of a question: buttons while it waits for its answer, else the picked one shows. */
function Options({ line, v }: { line: Extract<Line, { kind: "message" }>; v: RequestView }) {
  const run = useRun(actOn);
  const at = { canvas: v.r.canvas, n: v.r.n, now: v.shown };

  return (
    <div className="e-opts">
      {(line.options ?? []).map((option, i) =>
        line.live ? (
          <button
            key={option}
            type="button"
            className="e-opt"
            onClick={() =>
              run.run({ input: { ...at, act: { call: "answer", text: option, option: i } } })
            }
          >
            {option}
          </button>
        ) : (
          <span key={option} className="e-opt" data-picked={line.picked === i}>
            {option}
          </span>
        ),
      )}
    </div>
  );
}

/**
 * A message's pictures, with the switch on their top edge: `Before` | `After` on a result (step
 * 13), `When asked` | `Now` on the ask of a request that may be outdated (step 14). It opens while
 * no textbox is open; else only the switch shows. A change of the request, or a textbox, folds it
 * again.
 */
function Proof({ v, line, box }: { v: RequestView; line: Message; box: Box | null }) {
  const { proof } = line;
  if (proof === null) return null;

  return (
    <Compare
      canvas={v.r.canvas}
      id={proof.id}
      left={proof.left}
      right={proof.right}
      show={proof.show}
      open={proof.opens && box === null}
      pickKey={`${line.key}@${v.r.updated}@${box ?? ""}`}
    />
  );
}

type Message = Extract<Line, { kind: "message" }>;

/** One message of the thread: the avatar (square for an agent), the name, the time, the text. */
function Said({ line, v, box }: { line: Message; v: RequestView; box: Box | null }) {
  return (
    <li className="e-msg">
      <span className="e-avatar" data-agent={line.agent} aria-hidden="true">
        <Initial name={line.from} />
      </span>
      <div className="e-field">
        <p className="e-who">
          <strong>{line.from}</strong>
          <span className="e-when">
            <Age from={line.at} />
          </span>
        </p>
        {line.text ? <p className="e-text">{line.text}</p> : null}
        {line.html ? (
          // An HTML part runs as a live document does: scripts, and no origin of its own.
          <iframe
            className="e-part"
            title={`HTML part from ${line.from}`}
            sandbox="allow-scripts"
            srcDoc={line.html}
          />
        ) : null}
        <Proof v={v} line={line} box={box} />
        {line.options ? <Options line={line} v={v} /> : null}
      </div>
    </li>
  );
}

/** The thread, oldest first (step 12). `box` is the textbox open on the request, if one is. */
function Thread({ v, box }: { v: RequestView; box: Box | null }) {
  return (
    <ol className="e-thread">
      {v.lines.map((line) =>
        line.kind === "step" ? (
          <Step key={line.key} line={line} />
        ) : (
          <Said key={line.key} line={line} v={v} box={box} />
        ),
      )}
    </ol>
  );
}

/**
 * A request's close, for a button: the act `close`, at the state the popover shows. Its name is
 * `Take back` for the author, else `Close request`; `always` names it `Close request` (step 15).
 */
function CloseButton({ v, menu, always }: { v: RequestView; menu: boolean; always?: boolean }) {
  const run = useRun(actOn);
  const at = { canvas: v.r.canvas, n: v.r.n, now: v.shown };

  return (
    <button
      type="button"
      role={menu ? "menuitem" : undefined}
      className={menu ? "e-danger" : "e-ghost e-danger"}
      onClick={() => run.run({ input: { ...at, act: { call: "close" } } })}
    >
      {always ? "Close request" : <CloseName author={v.r.author} />}
    </button>
  );
}

/** Another viewer, or an agent, acted first: who, and what the text can do now (step 16). */
function FirstNotice({ v, here }: { v: RequestView; here: Acts }) {
  const kept = here.box ? " Your text is kept." : "";
  const reopens = here.box === "note" && v.shown === "accepted";
  const again = reopens ? " Send it to open the request again." : "";

  return <p role="alert">{`Not sent: ${v.lastAct} first.${kept}${again}`}</p>;
}

/** Why the last act saved nothing, if it did not. */
function Notice({ v, here }: { v: RequestView; here: Acts }) {
  if (here.step !== "notSent" || here.why === "none") return null;
  if (here.why === "first") return <FirstNotice v={v} here={here} />;
  if (here.why === "started") {
    return <p role="alert">{`Not saved: ${v.lastAct} first. Your text is kept.`}</p>;
  }
  const kept = here.box ? " Your text is kept." : "";
  const { why, next } = missed[here.why];

  return <p role="alert">{`Not sent: ${why}${kept}${next}`}</p>;
}

/** The name, when this browser kept none: the act asks it once (E4.2 M16). */
function NameField() {
  const name = useData(typedName);
  const type = useRun(typeName);

  return (
    <div className="e-name">
      <label>
        Your name
        <input
          name="name"
          required
          maxLength={40}
          autoFocus
          autoComplete="name"
          value={name}
          onChange={(event) => type.run({ input: event.target.value })}
        />
      </label>
      <p className="e-hint">
        People on this canvas see it on your requests. This browser keeps it.
      </p>
    </div>
  );
}

/** `Take back` for the author, else `Close request`: the name of the close of the request. */
function CloseName({ author }: { author: string }) {
  const me = useData(myName({}));

  return <>{author === me ? "Take back" : "Close request"}</>;
}

/** The buttons under a correction an agent started first: Cancel, Copy text, Take back. */
function StartedActs({ v, here }: { v: RequestView; here: Acts }) {
  const cancel = useRun(cancelBox);
  const copy = useRun(copyText);

  return (
    <div className="e-acts">
      <button type="button" className="e-ghost" onClick={() => cancel.run()}>
        Cancel
      </button>
      <button type="button" className="e-ghost" onClick={() => copy.run({ input: here.text })}>
        Copy text
      </button>
      <CloseButton v={v} menu={false} />
    </div>
  );
}

/**
 * The buttons under a textbox: Cancel and Save for a correction, Cancel for a note, `Close
 * request` for a request that needs a person.
 */
function BoxActs({ v, box, here }: { v: RequestView; box: Box; here: Acts }) {
  const cancel = useRun(cancelBox);
  if (here.why === "started") return <StartedActs v={v} here={here} />;
  if (box === "clear") {
    return (
      <div className="e-acts">
        <CloseButton v={v} menu={false} always />
      </div>
    );
  }
  if (box === "answer") return null;

  return (
    <div className="e-acts">
      <button type="button" className="e-ghost" onClick={() => cancel.run()}>
        Cancel
      </button>
      {box === "correct" ? (
        <button type="submit" className="e-primary" disabled={here.step === "sending"}>
          Save
        </button>
      ) : null}
    </div>
  );
}

/** The textbox itself, and its Send. Enter sends; Shift+Enter is a new line. */
function BoxField({
  v,
  box,
  here,
  stuck,
}: {
  v: RequestView;
  box: Box;
  here: Acts;
  stuck: boolean;
}) {
  const type = useRun(typeBox);
  const busy = here.step === "sending";
  const asks = box === "answer" && !v.lines.some((l) => l.kind === "message" && l.live);
  const sends = box !== "correct" && here.why !== "started";
  const at = { canvas: v.r.canvas, n: v.r.n, box, saw: here.saw };

  return (
    <div className="e-box" data-busy={busy} aria-invalid={here.step === "notSent"}>
      <textarea
        aria-label={boxTexts[box].name}
        placeholder={asks ? "Write an answer…" : boxTexts[box].hint}
        rows={2}
        value={here.text}
        readOnly={busy}
        autoFocus={box === "correct" || box === "note"}
        // A correction opens with the text of the request: the caret goes after it.
        onFocus={(event) =>
          event.currentTarget.setSelectionRange(here.text.length, here.text.length)
        }
        onChange={(event) => type.run({ input: { ...at, text: event.target.value } })}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
      />
      {sends ? (
        <button type="submit" className="e-send" aria-label="Send" disabled={busy || stuck}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/**
 * A textbox of the request (step 15): its text goes in the call of its kind. A text for a state
 * the request left waits for a second Send.
 */
function BoxForm({ v, box, here }: { v: RequestView; box: Box; here: Acts }) {
  const run = useRun(actOn);
  // After "Not sent", a text that no call of the new state takes waits: Send is off.
  const stuck = here.why === "first" && !boxFits[box].includes(v.shown);
  const ready = !stuck && here.step !== "sending";
  const act: Act = { call: boxCalls[box], text: here.text };

  return (
    <form
      className="e-reply"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || !here.text.trim()) return;
        run.run({ input: { canvas: v.r.canvas, n: v.r.n, now: v.shown, act } });
      }}
    >
      <BoxField v={v} box={box} here={here} stuck={stuck} />
      <Notice v={v} here={here} />
      <BoxActs v={v} box={box} here={here} />
    </form>
  );
}

/** The buttons of a result, or of a done request: Accept, and Open again (step 15). */
function Decide({ v, here }: { v: RequestView; here: Acts }) {
  const run = useRun(actOn);
  const open = useRun(openBox);
  const at = { canvas: v.r.canvas, n: v.r.n };
  const result = v.shown === "result";

  return (
    <>
      <Notice v={v} here={here} />
      <div className="e-acts">
        <button
          type="button"
          className="e-ghost"
          onClick={() => open.run({ input: { ...at, box: "note", text: "", saw: v.shown } })}
        >
          Open again
        </button>
        {result ? (
          <button
            type="button"
            className="e-primary"
            disabled={here.step === "sending"}
            onClick={() => run.run({ input: { ...at, now: v.shown, act: { call: "accept" } } })}
          >
            Accept
          </button>
        ) : null}
      </div>
    </>
  );
}

/** The states whose controls are `Open again`, and `Accept` for a result (step 15). */
const decided: readonly Shown[] = ["result", "accepted", "doneNoAnswer"];

/** The controls of the request's state (step 15), or the textbox the viewer opened. */
function Controls({ v, here }: { v: RequestView; here: Acts }) {
  if (here.box) return <BoxForm v={v} box={here.box} here={here} />;
  if (v.shown === "question") return <BoxForm v={v} box="answer" here={here} />;
  if (v.shown === "person") return <BoxForm v={v} box="clear" here={here} />;
  if (decided.includes(v.shown)) return <Decide v={v} here={here} />;
  if (v.outdated) return <OutdatedActs v={v} here={here} />;

  return <Notice v={v} here={here} />;
}

/** A request that may be outdated has `Close request` (step 15): a viewer may keep it, or close it. */
function OutdatedActs({ v, here }: { v: RequestView; here: Acts }) {
  return (
    <>
      <Notice v={v} here={here} />
      <div className="e-acts">
        <CloseButton v={v} menu={false} always />
      </div>
    </>
  );
}

/** The menu `More` (step 11): Correct the request, Copy link, and Take back or Close request. */
function MoreMenu({ v }: { v: RequestView }) {
  const open = useRun(openBox);
  const copy = useRun(copyLink);
  const { r } = v;
  const working = v.shown === "inWork";
  const correct = { canvas: r.canvas, n: r.n, box: "correct" as const, text: v.text, saw: v.shown };

  return (
    <div className="e-menu" role="menu" aria-label="More">
      {v.shown === "waiting" || working ? (
        <button
          type="button"
          role="menuitem"
          aria-disabled={working}
          onClick={() => (working ? undefined : open.run({ input: correct }))}
        >
          Correct the request
          {working ? <span className="e-menu-hint">Agent works</span> : null}
        </button>
      ) : null}
      <button type="button" role="menuitem" onClick={() => copy.run({ input: r.n })}>
        Copy link
      </button>
      {takeable.includes(v.shown) ? <CloseButton v={v} menu /> : null}
    </div>
  );
}

/** The button `More`, and its menu while it is open. */
function More({ v }: { v: RequestView }) {
  const open = useData(moreMenu);
  const toggle = useRun(toggleMore);

  return (
    <div className="e-menu-at">
      <button
        type="button"
        className="e-close"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => toggle.run()}
      >
        ⋯
      </button>
      {open ? <MoreMenu v={v} /> : null}
    </div>
  );
}

/**
 * The popover of a saved request (steps 10 to 16): a dialog by its pin, with its state mark,
 * number and place, `More` and `Close`; the thread; and the controls of its state. While it is
 * open, its changed mark goes (step 17).
 */
export function Opened({ v, list }: { v: RequestView; list: readonly FrameInfo[] }) {
  const close = useRun(escape);
  const acts = useData(acting);
  const { r } = v;
  const mine = acts !== null && acts.canvas === r.canvas && acts.n === r.n;
  const blank: Acts = {
    canvas: r.canvas,
    n: r.n,
    box: null,
    text: "",
    saw: v.shown,
    step: "typing",
    why: "none",
  };
  const here = mine ? acts : blank;
  useData(seenWhileOpen({ canvas: r.canvas, id: r.id, updated: r.updated }));

  return (
    <section className="e-pop e-req" role="dialog" aria-label={`Request #${r.n}`}>
      <header className="e-head">
        <StateMark shown={v.shown} agent={r.claimedBy} />
        {v.outdated ? <OutdatedMark cause={v.outdated.cause} /> : null}
        <span className="e-head-ref">
          {`#${r.n} · `}
          <Place r={r} list={list} />
        </span>
        <More v={v} />
        <button type="button" className="e-close" aria-label="Close" onClick={() => close.run()}>
          ×
        </button>
      </header>
      <Thread v={v} box={here.box} />
      {here.step === "naming" ? <NameField /> : null}
      <Controls v={v} here={here} />
    </section>
  );
}
