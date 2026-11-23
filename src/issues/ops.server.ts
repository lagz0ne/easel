import { operation, tag, transport } from "@tinkered/core";
import { z } from "zod";

import { comments, issueApi, issueBoard, issues, members } from "./contract";

const viewer = tag<string>({ label: "issues.viewer" });

export const signedIn = operation({
  label: "issues.signedIn",
  input: transport.hook.start,
  run: (_, { input }) => {
    const me = input.meta.who;
    return me ? { tags: [viewer(me)] } : input.refuse({ signIn: true });
  },
});

export const membersOnly = operation({
  label: "issues.membersOnly",
  input: transport.hook.start,
  depends: { team: members.controller, me: viewer.required },
  run: ({ team, me }, { input }) => {
    const teamId = issueBoard.part(input)?.teamId ?? "";
    const known = team.of({ teamId, userId: me }).get();
    return known ? undefined : input.refuse({ notMember: teamId });
  },
});

const inTeam = operation({
  label: "issues.inTeam",
  input: z.object({ teamId: z.string() }),
  depends: { team: members.controller, me: viewer.required },
  run: ({ team, me }, { input }) => !!team.of({ teamId: input.teamId, userId: me }).get(),
});

const createTeam = operation({
  label: "team.create.do",
  input: issueApi["team.create"].input,
  depends: { team: members.controller, me: viewer.required },
  run: ({ team, me }, { input }) => {
    if (team.where(input).get().length) return { kind: "exists" as const };

    team.set({ ...input, userId: me });
    return { kind: "created" as const };
  },
});

const addMember = operation({
  label: "team.add.do",
  input: issueApi["team.add"].input,
  depends: { team: members.controller, ok: inTeam },
  run: ({ team, ok }, { input }) => {
    if (!ok.run({ input })) return { kind: "gone" as const };

    team.set(input);
    return { kind: "added" as const };
  },
});

const createIssue = operation({
  label: "issue.create.do",
  input: issueApi["issue.create"].input,
  depends: { list: issues.controller, ok: inTeam },
  run: ({ list, ok }, { input, random }) => {
    if (!ok.run({ input })) return { kind: "gone" as const };

    const team = list.where({ teamId: input.teamId }).get();
    const number = Math.max(0, ...team.map((i) => i.number)) + 1;
    list.set({ ...input, id: random.uuid(), number, state: "backlog", version: 1 });
    return { kind: "created" as const, number };
  },
});

const moveIssue = operation({
  label: "issue.move.do",
  input: issueApi["issue.move"].input,
  depends: { list: issues.controller, ok: inTeam },
  run: ({ list, ok }, { input }) => {
    const key = { teamId: input.teamId, id: input.id };
    const now = list.of(key).get();
    if (!now || !ok.run({ input })) return { kind: "gone" as const };
    if (now.version !== input.version) return { kind: "stale" as const, version: now.version };

    const version = now.version + 1;
    list.set({ ...now, state: input.state, version });
    return { kind: "moved" as const, version };
  },
});

const addComment = operation({
  label: "comment.add.do",
  input: issueApi["comment.add"].input,
  depends: {
    list: issues.controller,
    thread: comments.controller,
    ok: inTeam,
    me: viewer.required,
  },
  run: ({ list, thread, ok, me }, { input, random }) => {
    const there = list.of({ teamId: input.teamId, id: input.issueId }).get();
    if (!there || !ok.run({ input })) return { kind: "gone" as const };

    thread.set({ ...input, id: random.uuid(), author: me });
    return { kind: "added" as const };
  },
});

export const issueOps = {
  "team.create": createTeam,
  "team.add": addMember,
  "issue.create": createIssue,
  "issue.move": moveIssue,
  "comment.add": addComment,
} as const;
