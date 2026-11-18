import { capsule } from "@tinkered/core";

import { framesApi, framesBoard } from "./contract";
import { shareApi } from "./share";

/**
 * frames' capsule: canvases and their frames (SPEC-frames.md). Others import a file of the
 * feature by its own path; the server's side is in `./*.server.ts`.
 * - `api`: a user's calls (`canvas.create`, `canvas.list`, `canvas.share`, `canvas.unshare`,
 *   `frame.put`, `frame.list`, `frame.get`, `frame.delete`).
 * - `viewer`: a viewer's call, `share.open`. No guard runs before it.
 * - `board`: `easel.board`, the cells `frames` and `docs`, keyed by canvas, that a live tab reads.
 */
export const frames = capsule({
  label: "frames",
  exports: { api: framesApi, board: framesBoard, viewer: shareApi },
});
