import { capsule } from "@tinkered/core";

import { framesApi, framesBoard } from "./contract";

/**
 * frames' capsule: canvases and their frames (SPEC-frames.md). Others import a file of the
 * feature by its own path; the server's side is in `./*.server.ts`.
 * - `api`: a user's calls (`canvas.create`, `canvas.list`, `frame.put`, `frame.list`,
 *   `frame.get`, `frame.delete`).
 * - `board`: `easel.board`, the cells `frames` and `docs`, keyed by canvas, that a live tab reads.
 */
export const frames = capsule({
  label: "frames",
  exports: { api: framesApi, board: framesBoard },
});
