import { Menu } from "@base-ui/react/menu";
import { useData, useRun } from "@tinkered/react";

import {
  actOn,
  boxCalls,
  boxFits,
  cancelBox,
  copyLink,
  copyText,
  myName,
  openBox,
  typeBox,
  typedName,
  typeName,
} from "./act";
import type { Act } from "./act";
import { Compare } from "./compare";
import { acting, backToList, closeCard } from "./draft";
import type { ActBox as Box, Acting as Acts } from "./draft";
import { seenWhileOpen } from "./follow";
import type { Line, RequestView, Shown } from "./follow";
import { openMenu, setMenu } from "./overlays";
import { Age, Initial, OutdatedMark, Place, StateMark } from "./panel";
import { RequestShot } from "./request";

const boxTexts = {
  correct: { name: "Request", hint: "" },
  answer: { name: "Answer", hint: "Or write an answer…" },
  note: { name: "Note", hint: "Why open it again?" },
  clear: { name: "Make it clear, then send it back", hint: "Make it clear, then send it back…" },
} as const;

const takeable: readonly Shown[] = ["waiting", "inWork", "question", "person"];

const missed = {
  gone: { why: "this request is not on the canvas any more.", next: "" },
  full: { why: "this canvas has too many open requests.", next: " Send again when some are done." },
  slow: { why: "you sent many changes in a short time.", next: " Send again in a minute." },
  link: { why: "no link to easel.", next: " Send again when Reconnecting goes." },
  failed: { why: "easel had a problem.", next: " Send again." },
} as const;

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

function CloseButton({ v, always }: { v: RequestView; always?: boolean }) {
  const run = useRun(actOn);
  const at = { canvas: v.r.canvas, n: v.r.n, now: v.shown };

  return (
    <button
      type="button"
      className="e-ghost e-danger"
      onClick={() => run.run({ input: { ...at, act: { call: "close" } } })}
    >
      {always ? "Close request" : <CloseName author={v.r.author} />}
    </button>
  );
}

function CloseItem({ v }: { v: RequestView }) {
  const run = useRun(actOn);
  const at = { canvas: v.r.canvas, n: v.r.n, now: v.shown };

  return (
    <Menu.Item
      className="e-danger"
      onClick={() => run.run({ input: { ...at, act: { call: "close" } } })}
    >
      <CloseName author={v.r.author} />
    </Menu.Item>
  );
}

function FirstNotice({ v, here }: { v: RequestView; here: Acts }) {
  const kept = here.box ? " Your text is kept." : "";
  const reopens = here.box === "note" && v.shown === "accepted";
  const again = reopens ? " Send it to open the request again." : "";

  return <p role="alert">{`Not sent: ${v.lastAct} first.${kept}${again}`}</p>;
}

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

function CloseName({ author }: { author: string }) {
  const me = useData(myName({}));

  return <>{author === me ? "Take back" : "Close request"}</>;
}

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
      <CloseButton v={v} />
    </div>
  );
}

function BoxActs({ v, box, here }: { v: RequestView; box: Box; here: Acts }) {
  const cancel = useRun(cancelBox);
  if (here.why === "started") return <StartedActs v={v} here={here} />;
  if (box === "clear") {
    return (
      <div className="e-acts">
        <CloseButton v={v} always />
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

function BoxForm({ v, box, here }: { v: RequestView; box: Box; here: Acts }) {
  const run = useRun(actOn);
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

const decided: readonly Shown[] = ["result", "accepted", "doneNoAnswer"];

const headTone: Record<Shown, "plain" | "waits" | "person"> = {
  waiting: "plain",
  inWork: "plain",
  question: "waits",
  result: "waits",
  person: "person",
  accepted: "plain",
  doneNoAnswer: "plain",
  closed: "plain",
  takenBack: "plain",
};

function Controls({ v, here }: { v: RequestView; here: Acts }) {
  if (here.box) return <BoxForm v={v} box={here.box} here={here} />;
  if (v.shown === "question") return <BoxForm v={v} box="answer" here={here} />;
  if (v.shown === "person") return <BoxForm v={v} box="clear" here={here} />;
  if (decided.includes(v.shown)) return <Decide v={v} here={here} />;
  if (v.outdated) return <OutdatedActs v={v} here={here} />;

  return <Notice v={v} here={here} />;
}

function OutdatedActs({ v, here }: { v: RequestView; here: Acts }) {
  return (
    <>
      <Notice v={v} here={here} />
      <div className="e-acts">
        <CloseButton v={v} always />
      </div>
    </>
  );
}

function MoreMenu({ v }: { v: RequestView }) {
  const open = useRun(openBox);
  const copy = useRun(copyLink);
  const { r } = v;
  const working = v.shown === "inWork";
  const correct = { canvas: r.canvas, n: r.n, box: "correct" as const, text: v.text, saw: v.shown };

  return (
    <Menu.Popup className="e-menu e-menu-more" aria-label="More">
      {v.shown === "waiting" || working ? (
        <Menu.Item disabled={working} onClick={() => open.run({ input: correct })}>
          Correct the request
          {working ? <span className="e-menu-hint">Agent works</span> : null}
        </Menu.Item>
      ) : null}
      <Menu.Item onClick={() => copy.run({ input: r.n })}>Copy link</Menu.Item>
      {takeable.includes(v.shown) ? <CloseItem v={v} /> : null}
    </Menu.Popup>
  );
}

function More({ v }: { v: RequestView }) {
  const open = useData(openMenu, (m) => m === "more");
  const set = useRun(setMenu);

  return (
    <div className="e-menu-at">
      <Menu.Root
        modal={false}
        open={open}
        onOpenChange={(next) => set.run({ input: { menu: "more", open: next } })}
      >
        <Menu.Trigger className="e-close" aria-label="More">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <circle cx="3" cy="7" r="1.2" fill="currentColor" />
            <circle cx="7" cy="7" r="1.2" fill="currentColor" />
            <circle cx="11" cy="7" r="1.2" fill="currentColor" />
          </svg>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="e-menu-pos" align="end" sideOffset={4}>
            <MoreMenu v={v} />
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

export function Opened({ v }: { v: RequestView }) {
  const close = useRun(closeCard);
  const back = useRun(backToList);
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
    <section className="e-pop e-req" aria-label={`Request #${r.n}`}>
      <button type="button" className="e-req-back" onClick={() => back.run()}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M8.5 3.5 5 7l3.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        All requests
      </button>
      <header className="e-head" data-tone={headTone[v.shown]}>
        <StateMark shown={v.shown} agent={r.claimedBy} />
        {v.outdated ? <OutdatedMark cause={v.outdated.cause} /> : null}
        <span className="e-head-ref">
          {`#${r.n} · `}
          <Place v={v} />
        </span>
        <More v={v} />
        <button type="button" className="e-close" aria-label="Close" onClick={() => close.run()}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M3.5 3.5l7 7M10.5 3.5l-7 7"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>
      <RequestShot canvas={r.canvas} id={r.id} />
      <Thread v={v} box={here.box} />
      {here.step === "naming" ? <NameField /> : null}
      <Controls v={v} here={here} />
    </section>
  );
}
