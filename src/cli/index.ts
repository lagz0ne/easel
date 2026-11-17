import { capsule, operation } from "@tinkered/core";
import { z } from "zod";

import { code, name } from "@/access/contract";

import { entryOf, hostsPath, server } from "./hosts";
import { login, waitLogin } from "./login";
import { json, stderr, stdout } from "./output";
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

/** One command, as the cmd read it from its flags. */
export const command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("login"), name, setup: code.optional(), noWait: z.boolean() }),
  z.object({ kind: z.literal("resume") }),
  z.object({ kind: z.literal("whoami") }),
  z.object({ kind: z.literal("logout") }),
  z.object({ kind: z.literal("users"), act: usersCommand }),
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

/** Runs one command; answers its exit code (SPEC-cli.md § Contract). */
const run = operation({
  label: "cli.run",
  input: command,
  depends: { login, waitLogin, whoami, logout, users },
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
    }
  },
});

/**
 * The token this server's user holds, as the call's bearer (RFC 6750): the `meta` of the rpc
 * client, read on each call. None when the CLI holds no token for it.
 */
const bearer = operation({
  label: "cli.bearer",
  depends: { entryOf },
  run: async ({ entryOf }): Promise<Record<string, string>> => {
    const token = entryOf.run().user?.token;

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
  },
  exports: { run, bearer },
});
