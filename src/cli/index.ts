import { capsule, operation } from "@tinkered/core";
import { z } from "zod";

import { code, name } from "@/access/contract";
import { build, fingerprint } from "@/ops/contract";

import { channelCommand, channelRun } from "./channels";
import { framesCommand, framesRun, shareCommand, shareRun } from "./frames";
import { entryOf, envToken, hostsPath, server } from "./hosts";
import { login, waitLogin } from "./login";
import { lookCommand, lookRun } from "./look";
import { mcpRun } from "./mcp";
import {
  errorsHandOff,
  errorsLs,
  errorsLsInput,
  errorsResolve,
  errorsShow,
  errorsShowInput,
  errorsTick,
  opsStatus,
} from "./ops";
import { json, stderr, stdout } from "./output";
import { queueCommand, queueRun } from "./queue";
import { approveUser, denyUser, listUsers, logout, revokeUser, whoami } from "./users";

const usersCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ls") }),
  z.object({ kind: z.literal("approve"), code, owner: z.boolean() }),
  z.object({ kind: z.literal("deny"), code }),
  z.object({ kind: z.literal("revoke"), name }),
]);

const errorsCommand = z.discriminatedUnion("kind", [
  errorsLsInput.extend({ kind: z.literal("ls") }),
  z.object({ kind: z.literal("show"), find: errorsShowInput }),
  z.object({ kind: z.literal("resolve"), fingerprint, build: build.positive() }),
  z.object({ kind: z.literal("hand-off"), fingerprint, reason: z.string().trim().min(1).max(500) }),
  z.object({ kind: z.literal("tick") }),
]);

const shellCommand = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("login"),
    name,
    setup: code.optional(),
    noWait: z.boolean(),
    printToken: z.literal(true).optional(),
  }),
  z.object({ kind: z.literal("resume") }),
  z.object({ kind: z.literal("whoami") }),
  z.object({ kind: z.literal("logout") }),
  z.object({ kind: z.literal("users"), act: usersCommand }),
  z.object({ kind: z.literal("status") }),
  z.object({ kind: z.literal("errors"), act: errorsCommand }),
]);

export const command = z.discriminatedUnion("kind", [
  ...shellCommand.options,
  z.object({ kind: z.literal("mcp") }),
  z.object({ kind: z.literal("frames"), act: framesCommand }),
  z.object({ kind: z.literal("share"), act: shareCommand }),
  z.object({ kind: z.literal("queue"), act: queueCommand }),
  z.object({ kind: z.literal("channel"), act: channelCommand }),
  z.object({ kind: z.literal("look"), act: lookCommand }),
]);

export type Command = z.infer<typeof command>;

const users = operation({
  label: "cli.usersCommand",
  input: usersCommand,
  depends: { listUsers, approveUser, denyUser, revokeUser },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "ls":
        return ops.listUsers.run();
      case "approve":
        return ops.approveUser.run({ input });
      case "deny":
        return ops.denyUser.run({ input });
      case "revoke":
        return ops.revokeUser.run({ input });
    }
  },
});

const errors = operation({
  label: "cli.errorsCommand",
  input: errorsCommand,
  depends: { errorsLs, errorsShow, errorsResolve, errorsHandOff, errorsTick },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "ls":
        return ops.errorsLs.run({ input });
      case "show":
        return ops.errorsShow.run({ input: input.find });
      case "resolve":
        return ops.errorsResolve.run({ input });
      case "hand-off":
        return ops.errorsHandOff.run({ input });
      case "tick":
        return ops.errorsTick.run();
    }
  },
});

const shell = operation({
  label: "cli.shell",
  input: shellCommand,
  depends: { login, waitLogin, whoami, logout, users, opsStatus, errors },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "login":
        return ops.login.run({ input });
      case "resume":
        return ops.waitLogin.run();
      case "whoami":
        return ops.whoami.run();
      case "logout":
        return ops.logout.run();
      case "users":
        return ops.users.run({ input: input.act });
      case "status":
        return ops.opsStatus.run();
      case "errors":
        return ops.errors.run({ input: input.act });
    }
  },
});

const run = operation({
  label: "cli.run",
  input: command,
  depends: { shell, framesRun, shareRun, queueRun, channelRun, lookRun, mcpRun },
  run: ({ shell, framesRun, shareRun, queueRun, channelRun, lookRun, mcpRun }, { input }) => {
    if (input.kind === "frames") return framesRun.run({ input: input.act });
    if (input.kind === "share") return shareRun.run({ input: input.act });
    if (input.kind === "queue") return queueRun.run({ input: input.act });
    if (input.kind === "channel") return channelRun.run({ input: input.act });

    if (input.kind === "look") return lookRun.run({ input: input.act });
    if (input.kind === "mcp") return mcpRun.run();
    return shell.run({ input });
  },
});

const bearer = operation({
  label: "cli.bearer",
  depends: { entryOf, envToken },
  run: async ({ entryOf, envToken }): Promise<Record<string, string>> => {
    const token = envToken ?? entryOf.run().user?.token;

    return token ? { authorization: `Bearer ${token}` } : {};
  },
});

export const cli = capsule({
  label: "cli",
  config: {
    stdout: stdout.required,
    stderr: stderr.required,
    json,
    hosts: hostsPath.required,
    server: server.required,
    token: envToken,
  },
  exports: { run, bearer },
});
