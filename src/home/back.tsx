import { Link } from "@tanstack/react-router";
import { useData } from "@tinkered/react";

import { homeBoard } from "./contract";

import "./home.css";

function Back({ canvas }: { canvas: string }) {
  const row = useData(homeBoard.rows.of({ canvas }));
  const name = row?.name ?? canvas;

  return (
    <nav className="e-back" aria-label="Canvas">
      <Link to="/" className="e-back-btn" aria-label="Back to the canvases">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </Link>
      <h1 className="e-back-name">{name}</h1>
    </nav>
  );
}

export function BackBar({ canvas, shown }: { canvas: string; shown: boolean }) {
  return shown ? <Back canvas={canvas} /> : null;
}
