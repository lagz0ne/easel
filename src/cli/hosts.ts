import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

import { operation, tag } from "@tinkered/core";
import { z } from "zod";

import { roles } from "@/access/contract";

// The hosts file, `~/.config/easel/hosts.json` (SPEC-cli.md § Sign in and out): per server, the
// signed-in user and its token, or the login that waits, with the token it made. As `gh`'s
// `hosts.yml`, keyed by server; as kubectl's `current-context`, one server is the default. Only
// the cmd knows the path (fact rule 1); it is written with mode 0600, in a folder of mode 0700.

const user = z.object({ name: z.string(), role: z.enum(roles), token: z.string() });

/** A login that waits for an owner: kept before the CLI waits, so a stopped CLI can resume. */
const pending = z.object({
  name: z.string(),
  code: z.string(),
  request: z.string(),
  expiresAt: z.number(),
  token: z.string(),
});

const entry = z.object({ user: user.optional(), pending: pending.optional() });

export type Entry = z.infer<typeof entry>;

export const hostsFile = z.object({
  default: z.string().optional(),
  hosts: z.record(z.string(), entry).default({}),
});

export type Hosts = z.infer<typeof hostsFile>;

/** Where the hosts file is, as the cmd read it from the environment. */
export const hostsPath = tag<string>({ label: "cli.hostsPath" });

/**
 * The hosts file's text and shape: a file not there yet is an empty one; a file that is not JSON
 * in the file's shape fails. The cmd reads it with this before it starts (exit 78).
 */
export const hostsAt = z
  .string()
  .transform((path, ctx) => {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if (Object(error).code === "ENOENT") return {};
      ctx.addIssue({ code: "custom", message: `${path} is not a hosts file` });
      return z.NEVER;
    }
  })
  .pipe(hostsFile);

/** The server this run talks to, as an origin: the key of its entry. */
export const server = tag<string>({ label: "cli.server" });

/** The hosts file as it is now. A file that is not one throws: the cmd checked it at start. */
export const loadHosts = operation({
  label: "cli.hosts.load",
  depends: { path: hostsPath.required },
  run: ({ path }) => hostsAt.parse(path),
});

/** This server's entry: empty when it has none. */
export const entryOf = operation({
  label: "cli.hosts.entry",
  depends: { loadHosts, server: server.required },
  run: ({ loadHosts, server }): Entry => loadHosts.run().hosts[server] ?? {},
});

/**
 * Writes this server's entry; an empty one is deleted. The first server written becomes the
 * default, and stays so. A new file, made 0600, is renamed over the old: no other user can read
 * a token, not even for a moment (gh's hosts.yml and kubectl's config are 0600 too).
 */
export const saveEntry = operation({
  label: "cli.hosts.save",
  input: entry,
  depends: { loadHosts, path: hostsPath.required, server: server.required },
  run: ({ loadHosts, path, server }, { input }) => {
    const hosts = loadHosts.run();
    const { [server]: _old, ...others } = hosts.hosts;
    const kept = input.user || input.pending ? { ...others, [server]: input } : others;
    const text = `${JSON.stringify({ default: hosts.default ?? server, hosts: kept }, null, 2)}\n`;

    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomBytes(6).toString("hex")}`;
    // The new file reaches the disk before it takes the old one's name: a crash leaves the old
    // file or the new one, never an empty one (the write-fsync-rename of git's lockfiles).
    const file = openSync(temp, "wx", 0o600);
    try {
      writeSync(file, text);
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    renameSync(temp, path);
  },
});
