import { data } from "@tinkered/core";
import { z } from "zod";

// The queue's board cells (SPEC-queue.md § Contract): `requests` and `messages`, keyed by canvas,
// and `serverClock`, the time of the server for one canvas. They ride `easel.board`
// (`framesBoard`), so the one `mayRead` guard and the one refusal push cover them with the frames
// (SPEC-viewer.md § Contract). This file imports nothing from frames, so frames' contract can
// import it. Only the queue store writes `requests` and `messages` (fact rules 4, 5).

/** A request's stored status. The state a tab shows comes from it and the time (`stateOf`). */
export const requestStatus = z.enum(["open", "asking", "resolved", "person", "closed"]);

/** A request on the board. */
export const request = z.object({
  canvas: z.string(),
  id: z.string(),
  n: z.number(),
  /** `null`: a request on the canvas. Then `x` and `y` are on the canvas, else on the frame. */
  frameId: z.string().nullable(),
  /** The frame version that the viewer saw; `null` for a request on the canvas. */
  version: z.number().nullable(),
  /** The kit version that the viewer saw (SPEC-kit K10). */
  kit: z.number(),
  x: z.number(),
  y: z.number(),
  author: z.string(),
  key: z.string(),
  status: requestStatus,
  /** The name of the user who holds the claim, or held the last one. */
  claimedBy: z.string().nullable(),
  /** In work while this is ahead of the time of the server. Past it, the lease ran out. */
  claimedUntil: z.number().nullable(),
  /**
   * The time of the claim that `claimedBy` holds, or held last. The claim writes it; each end of
   * the lease but its run out sets it to null with `claimedBy`.
   */
  claimedAt: z.number().nullable(),
  tries: z.number(),
  queuedAt: z.number(),
  acceptedBy: z.string().nullable(),
  created: z.number(),
  updated: z.number(),
});

export type Request = z.infer<typeof request>;

/** The kinds of message in the thread of a request. */
export const messageKind = z.enum([
  "ask",
  "edit",
  "question",
  "answer",
  "result",
  "accept",
  "reopen",
  "release",
  "decline",
  "close",
]);

/** A message on the board. No call changes or removes one. */
export const message = z.object({
  canvas: z.string(),
  id: z.string(),
  request: z.string(),
  kind: messageKind,
  from: z.string(),
  /** The text, or the reason of a release or a decline. `null`: a close or an accept with none. */
  text: z.string().nullable(),
  html: z.string().nullable(),
  options: z.array(z.string()).nullable(),
  option: z.number().nullable(),
  /** On a `result` only: the frame version at the claim, and at the resolve. */
  before: z.number().nullable(),
  after: z.number().nullable(),
  /** On a `result` only: the kit version at the claim, and at the resolve (K10). */
  beforeKit: z.number().nullable(),
  afterKit: z.number().nullable(),
  created: z.number(),
});

export type Message = z.infer<typeof message>;

/** Each canvas's requests: a tab reads one canvas with `where({ canvas })`. */
export const requests = data({
  label: "queue.requests",
  mode: "keyed",
  parse: request,
  key: (r) => ({ canvas: r.canvas, id: r.id }),
});

/** Each canvas's messages: a tab reads one canvas with `where({ canvas })`. */
export const messages = data({
  label: "queue.messages",
  mode: "keyed",
  parse: message,
  key: (m) => ({ canvas: m.canvas, id: m.id }),
});

/**
 * The time of the server, as a tab reads it for its canvas: each read loads it again, and the tab
 * keeps `now` less its own time as the offset. A lease ends by time alone (judged rule 7), so a tab
 * needs the time of the server to show a request waiting at `claimedUntil`.
 */
export const serverClock = data({
  label: "queue.serverClock",
  mode: "keyed",
  parse: z.object({ canvas: z.string(), now: z.number() }),
  key: (c) => ({ canvas: c.canvas }),
});
