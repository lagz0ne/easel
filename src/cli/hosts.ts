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

const user = z.object({ name: z.string(), role: z.enum(roles), token: z.string() });

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

export const hostsPath = tag<string>({ label: "cli.hostsPath" });

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

export const server = tag<string>({ label: "cli.server" });

export const envToken = tag<string | null>({ label: "cli.envToken", default: null });

export const loadHosts = operation({
  label: "cli.hosts.load",
  depends: { path: hostsPath.required },
  run: ({ path }) => hostsAt.parse(path),
});

export const entryOf = operation({
  label: "cli.hosts.entry",
  depends: { loadHosts, server: server.required, envToken },
  run: ({ loadHosts, server, envToken }): Entry =>
    envToken === null ? (loadHosts.run().hosts[server] ?? {}) : {},
});

export const saveEntry = operation({
  label: "cli.hosts.save",
  input: entry,
  depends: { loadHosts, path: hostsPath.required, server: server.required, envToken },
  run: ({ loadHosts, path, server, envToken }, { input }) => {
    if (envToken !== null) return;
    const hosts = loadHosts.run();
    const { [server]: _old, ...others } = hosts.hosts;
    const kept = input.user || input.pending ? { ...others, [server]: input } : others;
    const text = `${JSON.stringify({ default: hosts.default ?? server, hosts: kept }, null, 2)}\n`;

    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomBytes(6).toString("hex")}`;
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
