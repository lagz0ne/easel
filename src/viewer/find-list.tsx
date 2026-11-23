import { operation } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import type { KeyboardEvent } from "react";
import { z } from "zod";

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
import { stage } from "./stage";

const takeFind = operation({
  label: "viewer.takeFind",
  input: z.string(),
  depends: { at: stage, closeFind },
  run: ({ at, closeFind }, { input: id }) => {
    closeFind.run();
    at.showFrame(id);
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

export function FindList({ canvas }: { canvas: string }) {
  const open = useData(findOpen);
  const text = useData(findText);
  const pick = useData(findPick);
  const { total, names } = useData(findMatches({ canvas }));
  const type = useRun(typeFind);
  const move = useRun(movePick);
  const close = useRun(closeFind);
  const take = useRun(takeFind);
  if (!open) return null;

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
      take.run({ input: picked.id });
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
              onClick={() => take.run({ input: f.id })}
            >
              {f.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
