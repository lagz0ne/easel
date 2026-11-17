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
import { hostsAt } from "@/cli/hosts";
import { since } from "@/cli/ops";
import { ops } from "@/ops";

// `easel`: the CLI (SPEC-cli.md). The one place that reads its flags and the hosts file's path
// (fact rule 1): it reads them, fills the `cli` capsule's config, runs one command against one
// server, and exits by the command's answer. `easel serve` runs the server command.

const help = `easel: the canvas CLI. Every command takes --json (one JSON value per line) and --server <url>.

  easel serve                                      start the server (PORT, PUBLIC_ORIGIN, EASEL_AUTH, EASEL_DB)
  easel login <server> --name <name> [--no-wait]   ask an owner to approve a new user; prints the code at once
  easel login <server> --name <name> --setup <code>  become the first owner with the server's setup code
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

Exit: 0 success, 1 another answer, 2 refused, 64 usage, 65 invalid, 69 unreachable, 70 failed,
76 missing, 78 a hosts file that cannot be read.
`;

const options = {
  json: { type: "boolean" },
  server: { type: "string" },
  name: { type: "string" },
  setup: { type: "string" },
  "no-wait": { type: "boolean" },
  resume: { type: "boolean" },
  owner: { type: "boolean" },
  open: { type: "boolean" },
  side: { type: "string" },
  since: { type: "string" },
  trace: { type: "string" },
  build: { type: "string" },
  reason: { type: "string" },
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

/** One run, read from the words, the flags and the hosts file: what to run where, or its end. */
const plan = z
  .object({ args: z.array(z.string()), env: configEnv })
  .transform(({ args, env: path }): Early | { path: string; server: string; command: Command } => {
    const asked = argv.safeParse(args);
    if (!asked.success) {
      const usage = asked.error.issues[0]?.message;
      return { code: 64, text: `${usage}\n\n${help}`, json: { usage } };
    }
    if ("help" in asked.data) return { code: 0, text: help, json: { help } };

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

    return { path, server: at.data, command: asked.data.command };
  });

const main = defineMain(async (ctx) => {
  const { env, args, signal, stdout, stderr, exit } = ctx;
  if (args[0] === "serve") {
    return (await import("./server")).default({ ...ctx, args: args.slice(1) });
  }

  const asJson = args.includes("--json");
  const planned = plan.parse({ args, env });
  if ("code" in planned) {
    (asJson || !planned.code ? stdout : stderr).write(
      asJson ? `${JSON.stringify(planned.json)}\n` : `${planned.text}\n`,
    );
    exit(planned.code);
    return { closed: Promise.resolve() };
  }

  const app = createScope({
    signal,
    capsules: [
      ws.client({ url: `${planned.server.replace(/^http/, "ws")}/rpc`, meta: cli.bearer }),
      access.login({ remote: ws.client }),
      access.user({ remote: ws.client }),
      access.owner({ remote: ws.client }),
      ops.user({ remote: ws.client }),
      ops.owner({ remote: ws.client }),
      cli({ stdout, stderr, json: asJson, server: planned.server, hosts: planned.path }),
    ],
  });
  const live = await app.ready;
  // A stop (Ctrl-C) cancels the run at once: a login that waits stays kept, for `--resume`.
  exit(await live.run(cli.run, { input: planned.command, signal }));
  return app;
});

export default main;

if (import.meta.main) await run(main);
