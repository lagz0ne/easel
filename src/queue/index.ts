import { capsule } from "@tinkered/core";

import { queueApi, requestApi } from "./contract";

/**
 * The queue's capsule: requests from viewers, and the agents that work them (SPEC-queue.md).
 * Others import a file of the feature by its own path; the server's side is in `./*.server.ts`.
 * - `api`: an agent's calls (`request.next`, `extend`, `release`, `decline`, `ask`, `resolve`,
 *   `list`), after the `user` guard.
 * - `viewer`: a viewer's or a user's calls (`request.add`, `edit`, `answer`, `accept`, `reopen`,
 *   `close`), after `mayAct`.
 * The board cells `requests`, `messages` and `serverClock` ride `easel.board` (`frames.board`).
 */
export const queue = capsule({
  label: "queue",
  exports: { api: queueApi, viewer: requestApi },
});
