import { join } from "node:path";
import { parseArgs } from "node:util";

import { run } from "@tinkered/bun";
import { ws } from "@tinkered/bun/client";
import { createScope } from "@tinkered/core";
import { z } from "zod";

import { defineMain } from "~/base/main";

import { access } from "@/access";
import { cli, command } from "@/cli";
import type { Command } from "@/cli";
import { pictureFetch, stdinText } from "@/cli/frames";
import { hostsAt } from "@/cli/hosts";
import { since } from "@/cli/ops";
import { frames } from "@/frames";
import { kit } from "@/kit";
import { ops } from "@/ops";
import { queue } from "@/queue";

// `easel`: the CLI (SPEC-cli.md). The one place that reads its flags and the hosts file's path
// (fact rule 1): it reads them, fills the `cli` capsule's config, runs one command against one
// server, and exits by the command's answer. `easel serve` runs the server command.

const help = `easel: the canvas CLI. Every command takes --json (one JSON value per line) and --server <url>.

  easel serve                                      start the server (PORT, PUBLIC_ORIGIN, EASEL_AUTH, EASEL_DB)
  easel login <server> --name <name> [--no-wait]   ask an owner to approve a new user; prints the code at once
  easel login <server> --name <name> --setup <code>  become the first owner with the server's setup code
  easel login <server> --name <name> --print-token  keep nothing; when approved, print the token one time
                                                   on stdout, for the secret EASEL_TOKEN of a run
  easel login --resume                             wait again for the login that waits
  easel whoami                                     the name, the role and the server
  easel logout                                     end this user on the server, then forget its token
  easel users                                      the users, and the codes that wait (owner)
  easel users approve <code> [--owner]             approve a code; --owner makes an owner (owner)
  easel users deny <code>                          deny a code (owner)
  easel users revoke <name>                        end a user and its token (owner)
  easel status                                     the build, the checks, the counters, the errors and the fixer's tick
  easel errors [ls] [--open] [--side server|browser] [--since 2h]
                                                   the error groups; --open is the work list (owner)
  easel errors show <fingerprint> | --trace <id>   one group and its samples; --trace takes a failed call's trace id (owner)
  easel errors resolve <fingerprint> --build <n>   mark it fixed in build n, once n is live and the error did not come back (owner)
  easel errors hand-off <fingerprint> --reason <text>  a person takes it (owner)
  easel errors tick                                stamp the fixer's tick (owner)
  easel canvas new <name>                          make a canvas; prints its key
  easel canvas ls                                  the canvases: key, name, when made, shared
  easel put <canvas> <file|dir|-> [--name N] [--size WxH]  make a frame from a file, a folder, or stdin with -
  easel put <canvas> <file|dir|-> --id <id> --base <v>     write a frame again on the version you got
                                                   a .tsx file is an app frame; a folder is one of its .ts and .tsx files, from index.tsx
  easel ls <canvas>                                the frames: id, name, box, version
  easel get <canvas> <id> [-o <file|dir>]          the document; -o writes it (a folder frame: each file) and prints the version
  easel rm <canvas> <id>                           delete a frame
  easel share <canvas>                             a link anyone who has it can open; prints it
  easel share <canvas> --password <pw>             the link asks a password (8 or more characters)
  easel share <canvas> --no-password               the link asks none; open tabs stay open
  easel unshare <canvas>                           end the link; open tabs say it has ended
  easel shot <canvas> <id> -o <file> [--scale 0.25|0.5|1|2] [--region x,y,w,h]
                                                   draw the frame as a browser does; writes a WebP
  easel kit capsules                               the capsules of the kit: what each does, its install, config and exports
  easel kit check <file|->                         the check of a put, and nothing written; a .tsx file is an app frame
  easel look get [-o <file>] [--at <kit>]         the look as DTCG JSON, its revision and its kit version
  easel look set <file|-> --base <rev>             change values of the look (a JSON Merge Patch); every tab shows it
  easel look undo --base <rev>                     the look before the last change, as a new kit version
  easel next [--canvas <k>] [--n <n>] [--wait <s>] [--lease <s>]
                                                   claim the oldest waiting request; prints it and its claim
  easel extend <claim> [--lease <s>]               start the lease again (30 to 3600 s, 300 when none)
  easel release <claim> --reason <text>            give the request back: it waits again, the try counts
  easel ask <claim> --text <q> [--html <file>] [--option <o>]...
                                                   a question for a viewer, with up to 6 options
  easel resolve <claim> --text <t> [--html <file>] the result: say what changed
  easel decline <claim> --reason <text>            the request goes to a person
  easel requests [--canvas <k>] [--state <state>]  the requests; --state person: those that need a person
  easel edit <canvas> <n> --text <t>               make a request clear: it waits again, with no tries
  easel close <canvas> <n> [--text <t>]            close a request
  easel deliveries <canvas> <n>                    each delivery of a request to the channels
  easel channel set <name> github --repo <o/n> --label <l> [--trigger <t>] --token-file <f>
                                                   deliver each waiting request to a private GitHub repository (owner)
  easel channel ls                                 the channels; the last 4 characters of each token (owner)
  easel channel rm <name>                          remove a channel; its issues stay on GitHub (owner)

With EASEL_TOKEN set, the CLI sends that token to EASEL_SERVER, and reads and writes no hosts file.

Exit: 0 success, 1 another answer, 2 refused, 64 usage, 65 invalid, 69 unreachable, 70 failed,
76 missing, 78 a hosts file that cannot be read.
`;

const options = {
  json: { type: "boolean" },
  server: { type: "string" },
  name: { type: "string" },
  setup: { type: "string" },
  "no-wait": { type: "boolean" },
  "print-token": { type: "boolean" },
  resume: { type: "boolean" },
  owner: { type: "boolean" },
  open: { type: "boolean" },
  side: { type: "string" },
  since: { type: "string" },
  trace: { type: "string" },
  build: { type: "string" },
  reason: { type: "string" },
  size: { type: "string" },
  id: { type: "string" },
  base: { type: "string" },
  out: { type: "string", short: "o" },
  password: { type: "string" },
  "no-password": { type: "boolean" },
  scale: { type: "string" },
  region: { type: "string" },
  canvas: { type: "string" },
  n: { type: "string" },
  wait: { type: "string" },
  lease: { type: "string" },
  text: { type: "string" },
  html: { type: "string" },
  option: { type: "string", multiple: true },
  state: { type: "string" },
  repo: { type: "string" },
  label: { type: "string" },
  trigger: { type: "string" },
  "token-file": { type: "string" },
  at: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const;

const common = { json: z.boolean().optional(), server: z.string().optional() };

/** `--build`: a whole number, as typed. */
const buildFlag = z
  .string()
  .regex(/^\d+$/, "--build takes a build number")
  .transform((typed) => Number(typed));

/** The words and flags of `easel status` and `easel errors` (SPEC-ops.md). */
const opsInvocations = [
  z
    .object({ positionals: z.tuple([z.literal("status")]), values: z.strictObject(common) })
    .transform(({ values }): unknown => ({ at: values.server, command: { kind: "status" } })),
  z
    .object({
      positionals: z.union([
        z.tuple([z.literal("errors")]),
        z.tuple([z.literal("errors"), z.literal("ls")]),
      ]),
      values: z.strictObject({
        ...common,
        open: z.boolean().optional(),
        side: z.string().optional(),
        since: since.optional(),
      }),
    })
    .transform(({ values }): unknown => ({
      at: values.server,
      command: {
        kind: "errors",
        act: { kind: "ls", open: !!values.open, side: values.side, since: values.since },
      },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("errors"), z.literal("show"), z.string()]),
      values: z.strictObject(common),
    })
    .transform(({ positionals: [, , fingerprint], values }): unknown => ({
      at: values.server,
      command: { kind: "errors", act: { kind: "show", find: { fingerprint } } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("errors"), z.literal("show")]),
      values: z.strictObject({ ...common, trace: z.string() }),
    })
    .transform(({ values }): unknown => ({
      at: values.server,
      command: { kind: "errors", act: { kind: "show", find: { trace: values.trace } } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("errors"), z.literal("resolve"), z.string()]),
      values: z.strictObject({ ...common, build: buildFlag }),
    })
    .transform(({ positionals: [, , fingerprint], values }): unknown => ({
      at: values.server,
      command: { kind: "errors", act: { kind: "resolve", fingerprint, build: values.build } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("errors"), z.literal("hand-off"), z.string()]),
      values: z.strictObject({ ...common, reason: z.string() }),
    })
    .transform(({ positionals: [, , fingerprint], values }): unknown => ({
      at: values.server,
      command: { kind: "errors", act: { kind: "hand-off", fingerprint, reason: values.reason } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("errors"), z.literal("tick")]),
      values: z.strictObject(common),
    })
    .transform(({ values }): unknown => ({
      at: values.server,
      command: { kind: "errors", act: { kind: "tick" } },
    })),
] as const;

/**
 * The words and flags of `easel canvas`, `put`, `ls`, `get`, `rm`, `share`, `unshare` and `shot`
 * (SPEC-frames.md).
 */
const framesInvocations = [
  z
    .object({
      positionals: z.tuple([z.literal("canvas"), z.literal("new"), z.string()]),
      values: z.strictObject(common),
    })
    .transform(({ positionals: [, , name], values }): unknown => ({
      at: values.server,
      command: { kind: "frames", act: { kind: "canvas new", name } },
    })),
  z
    .object({
      positionals: z.union([
        z.tuple([z.literal("canvas")]),
        z.tuple([z.literal("canvas"), z.literal("ls")]),
      ]),
      values: z.strictObject(common),
    })
    .transform(({ values }): unknown => ({
      at: values.server,
      command: { kind: "frames", act: { kind: "canvas ls" } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("put"), z.string(), z.string()]),
      values: z.strictObject({
        ...common,
        name: z.string().optional(),
        // As typed: `put` reads them, and a bad one is one line that names it (64).
        size: z.string().optional(),
        id: z.string().optional(),
        base: z.string().optional(),
      }),
    })
    .transform(({ positionals: [, canvas, file], values }): unknown => ({
      at: values.server,
      command: {
        kind: "frames",
        act: {
          kind: "put",
          canvas,
          file,
          name: values.name,
          size: values.size,
          id: values.id,
          base: values.base,
        },
      },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("ls"), z.string()]),
      values: z.strictObject(common),
    })
    .transform(({ positionals: [, canvas], values }): unknown => ({
      at: values.server,
      command: { kind: "frames", act: { kind: "ls", canvas } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("get"), z.string(), z.string()]),
      values: z.strictObject({ ...common, out: z.string().optional() }),
    })
    .transform(({ positionals: [, canvas, id], values }): unknown => ({
      at: values.server,
      command: { kind: "frames", act: { kind: "get", canvas, id, out: values.out } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("rm"), z.string(), z.string()]),
      values: z.strictObject(common),
    })
    .transform(({ positionals: [, canvas, id], values }): unknown => ({
      at: values.server,
      command: { kind: "frames", act: { kind: "rm", canvas, id } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("share"), z.string()]),
      values: z.strictObject({
        ...common,
        password: z.string().optional(),
        "no-password": z.literal(true).optional(),
      }),
    })
    .transform(({ positionals: [, canvas], values }): unknown => ({
      at: values.server,
      command: {
        kind: "share",
        act: {
          kind: "share",
          canvas,
          password: values.password,
          noPassword: values["no-password"],
        },
      },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("unshare"), z.string()]),
      values: z.strictObject(common),
    })
    .transform(({ positionals: [, canvas], values }): unknown => ({
      at: values.server,
      command: { kind: "share", act: { kind: "unshare", canvas } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("shot"), z.string(), z.string()]),
      values: z.strictObject({
        ...common,
        out: z.string(),
        // As typed: `shot` reads them, and a bad one is one line that names it (64).
        scale: z.string().optional(),
        region: z.string().optional(),
      }),
    })
    .transform(({ positionals: [, canvas, id], values }): unknown => ({
      at: values.server,
      command: {
        kind: "frames",
        act: {
          kind: "shot",
          canvas,
          id,
          out: values.out,
          scale: values.scale,
          region: values.region,
        },
      },
    })),
] as const;

/** The words and flags of `easel next`, `extend`, `release`, `decline`, `ask`, `resolve`,
 * `requests`, `edit` and `close` (SPEC-queue.md). */
const queueInvocations = [
  z
    .object({
      positionals: z.tuple([z.literal("next")]),
      values: z.strictObject({
        ...common,
        canvas: z.string().optional(),
        n: z.string().optional(),
        wait: z.string().optional(),
        lease: z.string().optional(),
      }),
    })
    .transform(({ values: { server, canvas, n, wait, lease } }): unknown => ({
      at: server,
      command: { kind: "queue", act: { kind: "next", canvas, n, wait, lease } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("extend"), z.string()]),
      values: z.strictObject({ ...common, lease: z.string().optional() }),
    })
    .transform(({ positionals: [, claim], values }): unknown => ({
      at: values.server,
      command: { kind: "queue", act: { kind: "extend", claim, lease: values.lease } },
    })),
  z
    .object({
      positionals: z.tuple([z.enum(["release", "decline"]), z.string()]),
      values: z.strictObject({ ...common, reason: z.string() }),
    })
    .transform(({ positionals: [kind, claim], values }): unknown => ({
      at: values.server,
      command: { kind: "queue", act: { kind, claim, reason: values.reason } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("ask"), z.string()]),
      values: z.strictObject({
        ...common,
        text: z.string(),
        html: z.string().optional(),
        option: z.array(z.string()).optional(),
      }),
    })
    .transform(({ positionals: [, claim], values }): unknown => ({
      at: values.server,
      command: {
        kind: "queue",
        act: { kind: "ask", claim, text: values.text, html: values.html, options: values.option },
      },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("resolve"), z.string()]),
      values: z.strictObject({ ...common, text: z.string(), html: z.string().optional() }),
    })
    .transform(({ positionals: [, claim], values }): unknown => ({
      at: values.server,
      command: {
        kind: "queue",
        act: { kind: "resolve", claim, text: values.text, html: values.html },
      },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("requests")]),
      values: z.strictObject({
        ...common,
        canvas: z.string().optional(),
        state: z.string().optional(),
      }),
    })
    .transform(({ values }): unknown => ({
      at: values.server,
      command: {
        kind: "queue",
        act: { kind: "requests", canvas: values.canvas, state: values.state },
      },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("edit"), z.string(), z.string()]),
      values: z.strictObject({ ...common, text: z.string() }),
    })
    .transform(({ positionals: [, canvas, n], values }): unknown => ({
      at: values.server,
      command: { kind: "queue", act: { kind: "edit", canvas, n, text: values.text } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("close"), z.string(), z.string()]),
      values: z.strictObject({ ...common, text: z.string().optional() }),
    })
    .transform(({ positionals: [, canvas, n], values }): unknown => ({
      at: values.server,
      command: { kind: "queue", act: { kind: "close", canvas, n, text: values.text } },
    })),
] as const;

/**
 * The words and flags of `easel look get|set|undo` (SPEC-kit.md § Change the look), of
 * `easel kit check` (§ Make an app frame) and of `easel kit capsules` (§ The capsules).
 */
const lookInvocations = [
  z
    .object({
      positionals: z.tuple([z.literal("kit"), z.literal("capsules")]),
      values: z.strictObject(common),
    })
    .transform(({ values }): unknown => ({
      at: values.server,
      command: { kind: "look", act: { kind: "capsules" } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("kit"), z.literal("check"), z.string()]),
      values: z.strictObject(common),
    })
    .transform(({ positionals: [, , file], values }): unknown => ({
      at: values.server,
      command: { kind: "look", act: { kind: "check", file } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("look"), z.literal("get")]),
      values: z.strictObject({ ...common, out: z.string().optional(), at: z.string().optional() }),
    })
    .transform(({ values }): unknown => ({
      at: values.server,
      command: { kind: "look", act: { kind: "get", out: values.out, at: values.at } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("look"), z.literal("set"), z.string()]),
      values: z.strictObject({ ...common, base: z.string() }),
    })
    .transform(({ positionals: [, , file], values }): unknown => ({
      at: values.server,
      command: { kind: "look", act: { kind: "set", file, base: values.base } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("look"), z.literal("undo")]),
      values: z.strictObject({ ...common, base: z.string() }),
    })
    .transform(({ values }): unknown => ({
      at: values.server,
      command: { kind: "look", act: { kind: "undo", base: values.base } },
    })),
] as const;

/** The words and flags of `easel channel set|ls|rm` and `easel deliveries` (SPEC-queue.md). */
const channelInvocations = [
  z
    .object({
      positionals: z.tuple([z.literal("channel"), z.literal("set"), z.string(), z.string()]),
      values: z.strictObject({
        ...common,
        repo: z.string().optional(),
        label: z.string().optional(),
        trigger: z.string().optional(),
        "token-file": z.string().optional(),
      }),
    })
    .transform(({ positionals: [, , name, channel], values }): unknown => ({
      at: values.server,
      command: {
        kind: "channel",
        act: {
          kind: "set",
          name,
          channel,
          repo: values.repo,
          label: values.label,
          trigger: values.trigger,
          tokenFile: values["token-file"],
        },
      },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("channel"), z.literal("ls")]),
      values: z.strictObject(common),
    })
    .transform(({ values }): unknown => ({
      at: values.server,
      command: { kind: "channel", act: { kind: "ls" } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("channel"), z.literal("rm"), z.string()]),
      values: z.strictObject(common),
    })
    .transform(({ positionals: [, , name], values }): unknown => ({
      at: values.server,
      command: { kind: "channel", act: { kind: "rm", name } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("deliveries"), z.string(), z.string()]),
      values: z.strictObject(common),
    })
    .transform(({ positionals: [, canvas, n], values }): unknown => ({
      at: values.server,
      command: { kind: "channel", act: { kind: "deliveries", canvas, n } },
    })),
] as const;

/**
 * The words and flags of each command, read into its `command` input and the server it names.
 * A flag that the command does not take is bad usage, as a word too many is.
 */
const invocation = z.union([
  z
    .object({
      positionals: z.union([
        z.tuple([z.literal("login")]),
        z.tuple([z.literal("login"), z.string()]),
      ]),
      values: z.strictObject({
        ...common,
        name: z.string(),
        setup: z.string().optional(),
        "no-wait": z.boolean().optional(),
      }),
    })
    .transform(({ positionals: [, at], values }): unknown => ({
      at: at ?? values.server,
      command: {
        kind: "login",
        name: values.name,
        setup: values.setup,
        noWait: !!values["no-wait"],
      },
    })),
  z
    .object({
      positionals: z.union([
        z.tuple([z.literal("login")]),
        z.tuple([z.literal("login"), z.string()]),
      ]),
      // No --setup and no --no-wait: it keeps nothing, so it cannot resume.
      values: z.strictObject({ ...common, name: z.string(), "print-token": z.literal(true) }),
    })
    .transform(({ positionals: [, at], values }): unknown => ({
      at: at ?? values.server,
      command: { kind: "login", name: values.name, noWait: false, printToken: true },
    })),
  z
    .object({
      positionals: z.union([
        z.tuple([z.literal("login")]),
        z.tuple([z.literal("login"), z.string()]),
      ]),
      values: z.strictObject({ ...common, resume: z.literal(true) }),
    })
    .transform(({ positionals: [, at], values }): unknown => ({
      at: at ?? values.server,
      command: { kind: "resume" },
    })),
  z
    .object({
      positionals: z.union([
        z.tuple([z.enum(["whoami", "logout"])]),
        z.tuple([z.literal("users")]).transform(() => ["users", "ls"] as const),
        z.tuple([z.literal("users"), z.literal("ls")]),
      ]),
      values: z.strictObject(common),
    })
    .transform(({ positionals: [kind, act], values }): unknown => ({
      at: values.server,
      command: kind === "users" ? { kind, act: { kind: act } } : { kind },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("users"), z.literal("approve"), z.string()]),
      values: z.strictObject({ ...common, owner: z.boolean().optional() }),
    })
    .transform(({ positionals: [, , code], values }): unknown => ({
      at: values.server,
      command: { kind: "users", act: { kind: "approve", code, owner: !!values.owner } },
    })),
  z
    .object({
      positionals: z.tuple([z.literal("users"), z.enum(["deny", "revoke"]), z.string()]),
      values: z.strictObject(common),
    })
    .transform(({ positionals: [, kind, word], values }): unknown => ({
      at: values.server,
      command: {
        kind: "users",
        act: kind === "deny" ? { kind, code: word } : { kind, name: word },
      },
    })),
  ...opsInvocations,
  ...framesInvocations,
  ...queueInvocations,
  ...channelInvocations,
  ...lookInvocations,
]);

/** The words and flags, read by `parseArgs`: `--help` anywhere asks for the help. */
const argv = z
  .array(z.string())
  .transform((args, ctx): unknown => {
    try {
      return parseArgs({ args, options, allowPositionals: true, strict: true });
    } catch (error) {
      ctx.addIssue({ code: "custom", message: String(Object(error).message) });
      return z.NEVER;
    }
  })
  .pipe(
    z.union([
      z
        .object({ values: z.looseObject({ help: z.literal(true) }) })
        .transform(() => ({ help: true as const })),
      invocation.pipe(z.object({ at: z.string().optional(), command })),
    ]),
  );

/** Where the hosts file is: `$XDG_CONFIG_HOME/easel`, else `~/.config/easel` (as gh). */
const configEnv = z
  .object({ XDG_CONFIG_HOME: z.string().optional(), HOME: z.string().optional() })
  .transform((env) =>
    join(env.XDG_CONFIG_HOME || join(env.HOME ?? "", ".config"), "easel", "hosts.json"),
  );

/**
 * A server as typed, as an origin: `easel.vibea.dev` is https, a loopback name is http, and a URL
 * keeps its scheme. The origin is its key in the hosts file.
 */
const origin = z
  .string()
  .transform((typed) => {
    const local = /^(localhost|127\.|\[::1\])/.test(typed) ? "http" : "https";

    return URL.parse(/^https?:\/\//.test(typed) ? typed : `${local}://${typed}`)?.origin ?? "null";
  })
  .pipe(z.string().regex(/^https?:\/\//, "not a server URL"));

/** A run that ends before it reaches a server: its exit code, and what it prints. */
type Early = { code: number; text: string; json: Record<string, unknown> };

/**
 * A run with no file (SPEC-cli.md § Sign in with no file): `EASEL_TOKEN` and `EASEL_SERVER`, as
 * `gh` reads `GH_TOKEN` and `GH_HOST`. Empty counts as unset. Null when `EASEL_TOKEN` is not set.
 */
const tokenEnv = z
  .object({ EASEL_TOKEN: z.string().optional(), EASEL_SERVER: z.string().optional() })
  .transform((env) => (env.EASEL_TOKEN ? { token: env.EASEL_TOKEN, at: env.EASEL_SERVER } : null));

type Planned = { path: string; server: string; token: string | null; command: Command };

/**
 * With `EASEL_TOKEN`: the server is `EASEL_SERVER`, and no hosts file is read (judged rule 5). A
 * `--server` (or a login's server) must be that one.
 */
const tokenRun = z
  .object({
    token: z.string(),
    at: z.string().optional(),
    asked: z.custom<{ at?: string; command: Command }>(),
    path: z.string(),
  })
  .transform(({ token, at, asked, path }): Early | Planned => {
    const server = origin.safeParse(at ?? "");
    if (!server.success) {
      const usage = "EASEL_TOKEN needs EASEL_SERVER, the address of its server";
      return { code: 64, text: usage, json: { usage } };
    }

    const typed = origin.safeParse(asked.at ?? server.data);
    if (typed.success && typed.data === server.data) {
      return { path, server: server.data, token, command: asked.command };
    }

    const usage = `EASEL_TOKEN is for ${server.data}: unset it to use ${asked.at}`;
    return { code: 64, text: usage, json: { usage } };
  });

/** One run, read from the words, the flags and the hosts file: what to run where, or its end. */
const plan = z
  .object({ args: z.array(z.string()), env: configEnv, tokenEnv })
  .transform(({ args, env: path, tokenEnv }): Early | Planned => {
    const asked = argv.safeParse(args);
    if (!asked.success) {
      const usage = asked.error.issues[0]?.message;
      return { code: 64, text: `${usage}\n\n${help}`, json: { usage } };
    }
    if ("help" in asked.data) return { code: 0, text: help, json: { help } };
    if (tokenEnv) return tokenRun.parse({ ...tokenEnv, asked: asked.data, path });

    const hosts = hostsAt.safeParse(path);
    if (!hosts.success) {
      const text = `${path} is not a hosts file: fix it, or delete it and log in again`;
      return { code: 78, text, json: { config: path } };
    }

    const at = origin.safeParse(asked.data.at ?? hosts.data.default);
    if (!at.success) {
      const usage = "no server: run `easel login <server> --name <name>`, or pass --server";
      return { code: 64, text: usage, json: { usage } };
    }

    return { path, server: at.data, token: null, command: asked.data.command };
  });

const main = defineMain(async (ctx) => {
  const { env, args, signal, stdout, stderr, exit } = ctx;
  if (args[0] === "serve") {
    return (await import("./server")).default({ ...ctx, args: args.slice(1) });
  }

  const asJson = args.includes("--json");
  const planned = plan.parse({ args, env, tokenEnv: env });
  if ("code" in planned) {
    (asJson || !planned.code ? stdout : stderr).write(
      asJson ? `${JSON.stringify(planned.json)}\n` : `${planned.text}\n`,
    );
    exit(planned.code);
    return { closed: Promise.resolve() };
  }

  const app = createScope({
    signal,
    // `easel put <canvas> -` reads the document from stdin; `easel shot` fetches the picture.
    tags: [stdinText(() => Bun.stdin.text()), pictureFetch((request) => fetch(request))],
    capsules: [
      ws.client({ url: `${planned.server.replace(/^http/, "ws")}/rpc`, meta: cli.bearer }),
      access.login({ remote: ws.client }),
      access.user({ remote: ws.client }),
      access.owner({ remote: ws.client }),
      ops.user({ remote: ws.client }),
      ops.owner({ remote: ws.client }),
      frames.api({ remote: ws.client }),
      kit.api({ remote: ws.client }),
      queue.api({ remote: ws.client }),
      queue.viewer({ remote: ws.client }),
      queue.channels({ remote: ws.client }),
      cli({
        stdout,
        stderr,
        json: asJson,
        server: planned.server,
        hosts: planned.path,
        token: planned.token,
      }),
    ],
  });
  const live = await app.ready;
  // A stop (Ctrl-C) cancels the run at once: a login that waits stays kept, for `--resume`.
  exit(await live.run(cli.run, { input: planned.command, signal }));
  return app;
});

export default main;

if (import.meta.main) await run(main);
