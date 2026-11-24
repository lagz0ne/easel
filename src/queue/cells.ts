import { data } from "@tinkered/core";
import { z } from "zod";

export const requestStatus = z.enum(["open", "asking", "resolved", "person", "closed"]);

export const request = z.object({
  canvas: z.string(),
  id: z.string(),
  n: z.number(),
  frameId: z.string().nullable(),
  version: z.number().nullable(),
  kit: z.number(),
  x: z.number(),
  y: z.number(),
  page: z.string().nullable(),
  author: z.string(),
  key: z.string(),
  status: requestStatus,
  claimedBy: z.string().nullable(),
  claimedUntil: z.number().nullable(),
  claimedAt: z.number().nullable(),
  tries: z.number(),
  queuedAt: z.number(),
  acceptedBy: z.string().nullable(),
  created: z.number(),
  updated: z.number(),
});

export type Request = z.infer<typeof request>;

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

export const message = z.object({
  canvas: z.string(),
  id: z.string(),
  request: z.string(),
  kind: messageKind,
  from: z.string(),
  text: z.string().nullable(),
  html: z.string().nullable(),
  options: z.array(z.string()).nullable(),
  option: z.number().nullable(),
  before: z.number().nullable(),
  after: z.number().nullable(),
  beforeKit: z.number().nullable(),
  afterKit: z.number().nullable(),
  created: z.number(),
});

export type Message = z.infer<typeof message>;

export const requests = data({
  label: "queue.requests",
  mode: "keyed",
  parse: request,
  key: (r) => ({ canvas: r.canvas, id: r.id }),
});

export const messages = data({
  label: "queue.messages",
  mode: "keyed",
  parse: message,
  key: (m) => ({ canvas: m.canvas, id: m.id }),
});

export const serverClock = data({
  label: "queue.serverClock",
  mode: "keyed",
  parse: z.object({ canvas: z.string(), now: z.number() }),
  key: (c) => ({ canvas: c.canvas }),
});

export const requestShot = z.object({
  canvas: z.string(),
  id: z.string(),
  kind: z.enum(["image", "region"]),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  w: z.number(),
  h: z.number(),
  url: z.string(),
});

export type RequestShot = z.infer<typeof requestShot>;

export const shots = data({
  label: "queue.shots",
  mode: "keyed",
  parse: requestShot,
  key: (s) => ({ canvas: s.canvas, id: s.id }),
});
