import { useData, useRun } from "@tinkered/react";

import type { RequestView } from "./follow";
import { agreeTo, agreeing, holdsHere } from "./hold";

import "./hold.css";

function AgreeButton({ v }: { v: RequestView }) {
  const agree = useRun(agreeTo);
  const step = useData(agreeing, (a) => (a?.id === v.r.id ? a.step : null));

  return (
    <div className="e-acts">
      <button
        type="button"
        className="e-primary"
        disabled={step === "sending"}
        onClick={() => agree.run({ input: { canvas: v.r.canvas, n: v.r.n, id: v.r.id } })}
      >
        Agree
      </button>
      {step === "failed" ? <p role="alert">Not agreed. Try again.</p> : null}
    </div>
  );
}

export function HoldNotice({ v }: { v: RequestView }) {
  const words = useData(holdsHere({ canvas: v.r.canvas })).get(v.r.id);
  if (v.shown !== "waiting" || words === undefined) return null;

  return (
    <div className="e-hold" role="status" data-hold={words.kind}>
      <strong>{words.title}</strong>
      <p>{words.text}</p>
      {words.asks ? <AgreeButton v={v} /> : null}
    </div>
  );
}
