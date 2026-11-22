import { capsule, operation } from "@tinkered/core";
import { z } from "zod";

import { code, name } from "@/access/contract";
import { build, fingerprint } from "@/ops/contract";

import { channelCommand, channelRun } from "./channels";
import { framesCommand, framesRun, shareCommand, shareRun } from "./frames";
import { entryOf, envToken, hostsPath, server } from "./hosts";
import { login, waitLogin } from "./login";
import { lookCommand, lookRun } from "./look";
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

// The `easel` CLI's capsule (SPEC-cli.md): one command against one server. The cmd reads the
// flags and the hosts file's path (fact rule 1), and fills the config: where to print, `--json`,
// the hosts file, and the server. It reaches the server only through access's rpc client.

/** An owner's `easel users` command. */
const usersCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ls") }),
  z.object({ kind: z.literal("approve"), code, owner: z.boolean() }),
  z.object({ kind: z.literal("deny"), code }),
  z.object({ kind: z.literal("revoke"), name }),
]);

/** An owner's `easel errors` command (SPEC-ops.md). */
const errorsCommand = z.discriminatedUnion("kind", [
  errorsLsInput.extend({ kind: z.literal("ls") }),
  z.object({ kind: z.literal("show"), find: errorsShowInput }),
  z.object({ kind: z.literal("resolve"), fingerprint, build: build.positive() }),
  z.object({ kind: z.literal("hand-off"), fingerprint, reason: z.string().trim().min(1).max(500) }),
  z.object({ kind: z.literal("tick") }),
]);

/** One command of the shell's own, as the cmd read it from its flags. */
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

/** One command, as the cmd read it from its flags: the shell's, a frames, share, queue, channel or look one. */
export const command = z.discriminatedUnion("kind", [
  ...shellCommand.options,
  z.object({ kind: z.literal("frames"), act: framesCommand }),
  z.object({ kind: z.literal("share"), act: shareCommand }),
  z.object({ kind: z.literal("queue"), act: queueCommand }),
  z.object({ kind: z.literal("channel"), act: channelCommand }),
  z.object({ kind: z.literal("look"), act: lookCommand }),
]);

export type Command = z.infer<typeof command>;

/** Runs one `easel users` command; answers its exit code. */
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

/** Runs one `easel errors` command; answers its exit code. */
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

/** Runs one of the shell's own commands; answers its exit code. */
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

/** Runs one command; answers its exit code (SPEC-cli.md § Contract). */
const run = operation({
  label: "cli.run",
  input: command,
  depends: { shell, framesRun, shareRun, queueRun, channelRun, lookRun },
  run: ({ shell, framesRun, shareRun, queueRun, channelRun, lookRun }, { input }) => {
    if (input.kind === "frames") return framesRun.run({ input: input.act });
    if (input.kind === "share") return shareRun.run({ input: input.act });
    if (input.kind === "queue") return queueRun.run({ input: input.act });
    if (input.kind === "channel") return channelRun.run({ input: input.act });

    if (input.kind === "look") return lookRun.run({ input: input.act });
    return shell.run({ input });
  },
});

/**
 * The token this server's user holds, as the call's bearer (RFC 6750): the `meta` of the rpc
 * client, read on each call. `EASEL_TOKEN` comes first. None when the CLI holds no token for it.
 */
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
