import { capsule } from "@tinkered/core";

import { framesApi, framesBoard } from "./contract";
import { passApi, shareApi } from "./share";

/**
 * frames' capsule: canvases and their frames (SPEC-frames.md). Others import a file of the
 * feature by its own path; the server's side is in `./*.server.ts`.
 * - `api`: a user's calls (`canvas.create`, `canvas.list`, `canvas.share`, `canvas.unshare`,
 *   `frame.put`, `frame.list`, `frame.get`, `frame.delete`).
 * - `viewer`: a viewer's call, `share.open`. No guard runs before it.
 * - `pass`: a call of a tab that holds a pass, `share.name`, after `mayName`.
 * - `board`: `easel.board`, the cells `frames`, `docs`, `kept` and `removed`, keyed by canvas, that a live tab reads.
 */
export const frames = capsule({
  label: "frames",
  exports: { api: framesApi, board: framesBoard, viewer: shareApi, pass: passApi },
});
