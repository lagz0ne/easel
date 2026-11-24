import { capsule, operation } from "@tinkered/core";
import { z } from "zod";

import { code, name, sessionId } from "@/access/contract";
import { build, fingerprint } from "@/ops/contract";

import { channelCommand, channelRun } from "./channels";
import { framesCommand, framesRun, shareCommand, shareRun } from "./frames";
import { entryOf, envToken, hostsPath, server } from "./hosts";
import { login, waitLogin } from "./login";
import { lookCommand, lookRun } from "./look";
import { mcpRun } from "./mcp";
import { openBrowser } from "./open";
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
import { pagesCommand, pagesRun } from "./pages";
import { partsCommand, partsRun } from "./parts";
import { queueCommand, queueRun } from "./queue";
import { startsCommand, startsRun } from "./starts";
import { textsCommand, textsRun } from "./texts";
import {
  addUser,
  approveUser,
  denyUser,
  endSession,
  listUsers,
  logout,
  renameUser,
  revokeUser,
  whoami,
} from "./users";

const usersCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ls") }),
  z.object({ kind: z.literal("add"), name, owner: z.boolean() }),
  z.object({ kind: z.literal("approve"), code, owner: z.boolean() }),
  z.object({ kind: z.literal("deny"), code }),
  z.object({ kind: z.literal("revoke"), name }),
  z.object({ kind: z.literal("end"), session: sessionId }),
  z.object({ kind: z.literal("rename"), name, to: name }),
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

const canvasCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("frames"), act: framesCommand }),
  z.object({ kind: z.literal("pages"), act: pagesCommand }),
  z.object({ kind: z.literal("share"), act: shareCommand }),
]);

const workCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("queue"), act: queueCommand }),
  z.object({ kind: z.literal("channel"), act: channelCommand }),
  z.object({ kind: z.literal("starts"), act: startsCommand }),
]);

export const command = z.discriminatedUnion("kind", [
  ...shellCommand.options,
  z.object({ kind: z.literal("mcp") }),
  z.object({ kind: z.literal("open"), noBrowser: z.boolean() }),
  ...canvasCommand.options,
  ...workCommand.options,
  z.object({ kind: z.literal("look"), act: lookCommand }),
  z.object({ kind: z.literal("texts"), act: textsCommand }),
  z.object({ kind: z.literal("parts"), act: partsCommand }),
]);

export type Command = z.infer<typeof command>;

const users = operation({
  label: "cli.usersCommand",
  input: usersCommand,
  depends: { listUsers, addUser, approveUser, denyUser, revokeUser, endSession, renameUser },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "ls":
        return ops.listUsers.run();
      case "add":
        return ops.addUser.run({ input });
      case "approve":
        return ops.approveUser.run({ input });
      case "deny":
        return ops.denyUser.run({ input });
      case "revoke":
        return ops.revokeUser.run({ input });
      case "end":
        return ops.endSession.run({ input });
      case "rename":
        return ops.renameUser.run({ input });
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

const canvasRun = operation({
  label: "cli.canvasRun",
  input: canvasCommand,
  depends: { framesRun, pagesRun, shareRun },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "frames":
        return ops.framesRun.run({ input: input.act });
      case "pages":
        return ops.pagesRun.run({ input: input.act });
      case "share":
        return ops.shareRun.run({ input: input.act });
    }
  },
});

const workRun = operation({
  label: "cli.workRun",
  input: workCommand,
  depends: { queueRun, channelRun, startsRun },
  run: (ops, { input }) => {
    switch (input.kind) {
      case "queue":
        return ops.queueRun.run({ input: input.act });
      case "channel":
        return ops.channelRun.run({ input: input.act });
      case "starts":
        return ops.startsRun.run({ input: input.act });
    }
  },
});

const run = operation({
  label: "cli.run",
  input: command,
  depends: { shell, canvasRun, workRun, lookRun, textsRun, partsRun, mcpRun, openBrowser },
  run: (ops, { input }) => {
    const { shell, canvasRun, workRun, lookRun, textsRun, mcpRun } = ops;
    const onCanvas = canvasCommand.safeParse(input);
    if (onCanvas.success) return canvasRun.run({ input: onCanvas.data });
    const work = workCommand.safeParse(input);
    if (work.success) return workRun.run({ input: work.data });

    if (input.kind === "look") return lookRun.run({ input: input.act });
    if (input.kind === "texts") return textsRun.run({ input: input.act });
    if (input.kind === "parts") return ops.partsRun.run({ input: input.act });
    if (input.kind === "mcp") return mcpRun.run();
    if (input.kind === "open") return ops.openBrowser.run({ input });
    return shell.run({ input: shellCommand.parse(input) });
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
