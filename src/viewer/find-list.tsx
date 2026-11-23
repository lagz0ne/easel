import { operation } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import type { KeyboardEvent } from "react";
import { z } from "zod";

import type { FrameInfo } from "@/frames/contract";

import {
  closeFind,
  findMatches,
  findOpen,
  findPick,
  findText,
  movePick,
  toggleFind,
  typeFind,
} from "./find";
import { pageList, showFrameOf } from "./pages";
import { stage } from "./stage";

const takeFind = operation({
  label: "viewer.takeFind",
  input: z.object({
    canvas: z.string(),
    frame: z.object({ id: z.string(), page: z.string() }),
    shown: z.string(),
    known: z.custom<readonly FrameInfo[]>(),
  }),
  depends: { at: stage, closeFind, showFrameOf },
  run: async ({ at, closeFind, showFrameOf }, { input: { canvas, frame, shown, known } }) => {
    const { id } = frame;
    closeFind.run();
    if (frame.page === shown && known.some((one) => one.id === id)) return at.showFrame(id);

    await showFrameOf.run({ input: { canvas, id, spot: null } });
  },
});

const keyMoves: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

export function FindButton() {
  const open = useData(findOpen);
  const toggle = useRun(toggleFind);

  return (
    <button
      type="button"
      className="e-dock-btn"
      aria-label="Find"
      aria-pressed={open}
      title="Find a frame (/)"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => toggle.run()}
    >
      <svg className="e-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    </button>
  );
}

function Hint({ total, shown, typed }: { total: number; shown: number; typed: boolean }) {
  if (total === 0) return <>This canvas has no frames yet.</>;
  if (!typed) return <>{`${total} frames`}</>;
  if (shown === 0) return <>No frame name has this text.</>;

  return <>{`${shown} of ${total} frames`}</>;
}

type FindProps = { canvas: string; page: string; list: readonly FrameInfo[] };

function PageName({ name }: { name: string | null | undefined }) {
  if (!name) return null;

  return <span className="e-find-page">{name}</span>;
}

export function FindList(props: FindProps) {
  const open = useData(findOpen);
  if (!open) return null;

  return <FindBox {...props} />;
}

function FindBox({ canvas, page, list }: FindProps) {
  const text = useData(findText);
  const pick = useData(findPick);
  const { total, names } = useData(findMatches({ canvas }));
  const pages = useData(pageList({ canvas }));
  const type = useRun(typeFind);
  const move = useRun(movePick);
  const close = useRun(closeFind);
  const take = useRun(takeFind);
  const pageNames = new Map(pages.length > 1 ? pages.map((p) => [p.key, p.name]) : []);
  const to = { canvas, shown: page, known: list };

  const picked = names[Math.min(pick, names.length - 1)];
  const onKey = (event: KeyboardEvent) => {
    const by = keyMoves[event.key];
    if (by !== undefined) {
      event.preventDefault();
      move.run({ input: { by, count: names.length } });
      return;
    }
    if (event.key === "Enter" && picked) {
      event.preventDefault();
      take.run({ input: { ...to, frame: picked } });
    }
  };

  return (
    <div className="e-find">
      <label className="e-find-label" htmlFor="e-find-box">
        Find a frame
      </label>
      <input
        id="e-find-box"
        className="e-find-box"
        role="combobox"
        aria-expanded={names.length > 0}
        aria-controls="e-find-names"
        aria-autocomplete="list"
        aria-activedescendant={picked ? `e-find-${picked.id}` : undefined}
        placeholder="Find a frame"
        autoFocus
        value={text}
        onChange={(event) => type.run({ input: event.target.value })}
        onKeyDown={onKey}
        onBlur={() => close.run()}
      />
      <p className="e-find-hint" role="status">
        <Hint total={total} shown={names.length} typed={text.trim().length > 0} />
      </p>
      {names.length ? (
        <ul className="e-find-names" id="e-find-names" role="listbox" aria-label="Frames">
          {names.map((f) => (
            <li
              key={f.id}
              id={`e-find-${f.id}`}
              role="option"
              aria-selected={f.id === picked?.id}
              ref={(el) => {
                if (el && f.id === picked?.id) el.scrollIntoView({ block: "nearest" });
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => take.run({ input: { ...to, frame: f } })}
            >
              <span className="e-find-name">{f.name}</span>
              <PageName name={pageNames.get(f.page)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
