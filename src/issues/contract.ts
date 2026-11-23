import { data, remoteData, rpc } from "@tinkered/core";
import { z } from "zod";

export const states = ["backlog", "todo", "doing", "done"] as const;

const member = z.object({ teamId: z.string(), userId: z.string() });

const issue = z.object({
  teamId: z.string(),
  id: z.string(),
  number: z.number(),
  title: z.string(),
  state: z.enum(states),
  version: z.number(),
});

export type Issue = z.infer<typeof issue>;

const comment = z.object({
  teamId: z.string(),
  issueId: z.string(),
  id: z.string(),
  author: z.string(),
  text: z.string(),
});

export const members = data({
  label: "issues.members",
  mode: "keyed",
  parse: member,
  key: (m) => ({ teamId: m.teamId, userId: m.userId }),
});

export const issues = data({
  label: "issues.list",
  mode: "keyed",
  parse: issue,
  key: (i) => ({ teamId: i.teamId, id: i.id }),
});

export const comments = data({
  label: "issues.comments",
  mode: "keyed",
  parse: comment,
  key: (c) => ({ teamId: c.teamId, issueId: c.issueId, id: c.id }),
});

export const issueBoard = remoteData({ members, issues, comments });

const team = z.object({ teamId: z.string() });
const gone = z.object({ kind: z.literal("gone") });

export const issueApi = rpc({
  "team.create": {
    input: z.object({
      teamId: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z][A-Z0-9]{1,9}$/),
    }),
    output: z.object({ kind: z.enum(["created", "exists"]) }),
  },
  "team.add": {
    input: team.extend({ userId: z.string().trim().min(1) }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("added") }), gone]),
  },
  "issue.create": {
    input: team.extend({ title: z.string().trim().min(1).max(200) }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("created"), number: z.number() }),
      gone,
    ]),
  },
  "issue.move": {
    input: team.extend({ id: z.string(), version: z.number(), state: z.enum(states) }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("moved"), version: z.number() }),
      z.object({ kind: z.literal("stale"), version: z.number() }),
      gone,
    ]),
  },
  "comment.add": {
    input: team.extend({ issueId: z.string(), text: z.string().trim().min(1).max(5000) }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("added") }), gone]),
  },
});
