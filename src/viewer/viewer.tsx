import type { PartState } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import { z } from "zod";

import { frames } from "@/frames";

import { gates, giveName } from "./gate";

// `/s/<link>`: the share link's page (SPEC-viewer.md; the viewer-gate-open chart). No state of
// its own: the gate cell says which page the tab is on, and the canvas reads the live board.
// The canvas is a placeholder until the canvas lands: its frames' names, live, and no control
// (the chart's CanvasControls is {} in this slice).

/** A refusal that says the link has ended: `mayRead` turned the pass away. */
const ended = z.object({ ended: z.literal(true) });

/** The page that says the link has ended, and nothing else (judged rule 13). */
function Ended() {
  return (
    <main>
      <h1>This link has ended</h1>
      <p>Ask whoever shared it for a new one.</p>
    </main>
  );
}

/** The name gate: asked once per browser, before the link opens. */
function NameGate({ link }: { link: string }) {
  const give = useRun(giveName);
  return (
    <main>
      <h1>Who is looking?</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const name = new FormData(event.currentTarget).get("name");
          if (typeof name === "string" && name.trim()) give.run({ input: { link, name } });
        }}
      >
        <input name="name" aria-label="Your name" maxLength={40} required />
        <button type="submit" disabled={give.isPending}>
          Continue
        </button>
      </form>
      {give.error ? <p role="alert">No answer. Try again.</p> : null}
    </main>
  );
}

/**
 * The board's state for the canvas. A dropped socket keeps the frames read so far, and its `link`
 * fault stands in `faults` until the read is back: the page says so, and heals by itself.
 */
function Status({ state, lost }: { state: PartState | undefined; lost: boolean }) {
  if (lost) return <p role="status">Reconnecting</p>;
  if (state?.status !== "fault") return null;

  return <p role="alert">Something broke. Load the page again.</p>;
}

/**
 * The canvas, for now: its frames' names from the live board. A read refused `{ ended: true }`
 * says Opening: the gate's `refusals` opens the link once more, or shows the ended page.
 */
function Canvas({ canvas }: { canvas: string }) {
  const part = frames.board.frames.where({ canvas });
  const list = useData(part);
  const state = useData(frames.board.status(part));
  const lost = useData(frames.board.faults, (f) => f.frames?.fault === "link");
  if (state?.status === "fault" && ended.safeParse(state.fault.payload).success) return <Opening />;

  return (
    <main>
      <Status state={state} lost={lost} />
      <ul aria-label="Frames">
        {list
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map((f) => (
            <li key={f.id}>{f.name}</li>
          ))}
      </ul>
    </main>
  );
}

/** The link is still opening: the first call, or a call again after a flood `slow`. */
export function Opening() {
  return <p role="status">Opening.</p>;
}

/** The link's page: opening, the name gate, the canvas, or ended. */
export function Viewer({ link }: { link: string }) {
  const gate = useData(gates.of({ link }));
  switch (gate?.page) {
    case undefined:
      return <Opening />;
    case "name":
      return <NameGate link={link} />;
    case "canvas":
      return <Canvas canvas={gate.canvas} />;
    case "ended":
      return <Ended />;
  }
}
