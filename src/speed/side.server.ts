import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { operation } from "@tinkered/core";
import type { Subprocess } from "bun";
import type { Browser, BrowserContext } from "playwright";
import { z } from "zod";

import { warmUp } from "./page.server";
import { speedEnv, speedViewport, startMs } from "./settings";

export type Seeded = { canvas: string; versions: Map<string, number>; link: string };

export type Side = {
  name: "base" | "tree";
  url: string;
  token: string;
  small: Seeded;
  big: Seeded;
  paged: { canvas: string; keys: string[]; link: string };
  warm: BrowserContext;
  many: BrowserContext;
  asked: number;
  server: Subprocess;
};

const toolAnswer = z.object({
  result: z
    .object({
      isError: z.boolean().optional(),
      structuredContent: z.unknown(),
      content: z.unknown(),
    })
    .optional(),
  error: z.unknown().optional(),
});

const keyed = z.object({ key: z.string() });
const pathed = z.object({ path: z.string() });
const versioned = z.object({ id: z.string(), version: z.number() });

export const baseTree = operation({
  label: "speed.baseTree",
  input: z.object({
    root: z.string(),
    work: z.string(),
    sha: z.string().optional(),
    dir: z.string().optional(),
  }),
  run: (_, { input: { root, work, sha, dir } }) => {
    if (dir) return resolve(dir);
    if (!sha || !/^[\w./~^-]+$/.test(sha)) throw new Error(`speed: not a commit: ${sha}`);

    const tar = join(work, "base.tar");
    const archived = Bun.spawnSync(["git", "-C", root, "archive", "--format=tar", "-o", tar, sha]);
    if (archived.exitCode !== 0) {
      throw new Error(`speed: git archive ${sha} failed (no .git here? use --base-dir)`);
    }

    const base = join(work, "base");
    mkdirSync(base, { recursive: true });
    if (Bun.spawnSync(["tar", "-xf", tar, "-C", base]).exitCode !== 0) {
      throw new Error("speed: tar failed");
    }
    return base;
  },
});

export const buildTree = operation({
  label: "speed.buildTree",
  input: z.object({ dir: z.string(), packages: z.boolean() }),
  run: (_, { input: { dir, packages } }) => {
    const install = packages ? [["bun", "install", "--frozen-lockfile"]] : [];
    for (const command of [
      ...install,
      ["bun", "run", "build:client"],
      ["bun", "run", "build:server"],
    ]) {
      const built = Bun.spawnSync(command, { cwd: dir, stdout: "ignore" });
      if (built.exitCode !== 0) throw new Error(`speed: ${command.join(" ")} failed in ${dir}`);
    }
  },
});

export const serverUp = operation({
  label: "speed.serverUp",
  input: z.object({ url: z.string(), log: z.string() }),
  depends: { limit: startMs },
  run: async ({ limit }, { input: { url, log }, clock }) => {
    const until = clock.currentTimeMillis() + limit;
    while (clock.currentTimeMillis() < until) {
      const ok = await fetch(`${url}/api/health`).then(
        (r) => r.ok,
        () => false,
      );
      if (ok) return;
      await clock.sleep(100);
    }
    throw new Error(`speed: the server did not start (log: ${log})`);
  },
});

export const signIn = operation({
  label: "speed.signIn",
  input: z.object({ url: z.string(), log: z.string(), binary: z.string(), home: z.string() }),
  depends: { env: speedEnv },
  run: ({ env }, { input: { url, log, binary, home } }) => {
    const code = /setup code: (\S+)/.exec(readFileSync(log, "utf8"))?.[1];
    if (!code) throw new Error("speed: no setup code in the server log");

    const login = Bun.spawnSync([binary, "login", url, "--name", "speed", "--setup", code], {
      env: { ...env, HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      stdout: "ignore",
    });
    if (login.exitCode !== 0) throw new Error("speed: easel login --setup failed");

    const hosts = readFileSync(join(home, ".config/easel/hosts.json"), "utf8");
    const token = /"token":\s*"([^"]+)"/.exec(hosts)?.[1];
    if (!token) throw new Error("speed: no token in the hosts file");
    return token;
  },
});

export const toolCall = operation({
  label: "speed.toolCall",
  input: z.object({
    url: z.string(),
    token: z.string(),
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  run: async (_, { input: { url, token, name, args }, clock }) => {
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const body = toolAnswer.parse(await response.json());
    const at = clock.currentTimeMillis();
    if (!body.result || body.result.isError) {
      throw new Error(
        `speed: ${name} failed: ${JSON.stringify(body.error ?? body.result?.content)}`,
      );
    }
    return { answer: body.result.structuredContent, at };
  },
});

export const frameDoc = operation({
  label: "speed.frameDoc",
  input: z.object({ id: z.string(), version: z.number() }),
  run: (_, { input: { id, version } }) =>
    `<main style="font:16px system-ui;padding:24px;display:grid;gap:12px"><h1 style="margin:0">Screen ${id}</h1><p>Version ${version}: a list of things to do, with a form to add one.</p><ul>${Array.from({ length: 6 }, (_, i) => `<li>Item ${i + 1}</li>`).join("")}</ul><form style="display:flex;gap:8px"><input placeholder="New item"><button>Add</button></form></main>`,
});

const signedIn = z.object({ url: z.string(), token: z.string() });

export const seedCanvas = operation({
  label: "speed.seedCanvas",
  input: z.object({ at: signedIn, name: z.string(), frames: z.number() }),
  depends: { toolCall, frameDoc },
  run: async ({ toolCall, frameDoc }, { input: { at, name, frames } }) => {
    const canvas = keyed.parse(
      (await toolCall.run({ input: { ...at, name: "create_canvas", args: { name } } })).answer,
    ).key;

    const versions = new Map<string, number>();
    for (let i = 0; i < frames; i++) {
      const html = frameDoc.run({ input: { id: `s${i}`, version: 1 } });
      const put = await toolCall.run({
        input: { ...at, name: "put_frame", args: { canvas, html, name: `Screen ${i + 1}` } },
      });
      const frame = versioned.parse(put.answer);
      versions.set(frame.id, frame.version);
    }

    const path = pathed.parse(
      (await toolCall.run({ input: { ...at, name: "share_canvas", args: { canvas } } })).answer,
    ).path;
    return { canvas, versions, link: `${at.url}${path}` };
  },
});

export const seedPages = operation({
  label: "speed.seedPages",
  input: z.object({ at: signedIn, name: z.string(), pages: z.number(), frames: z.number() }),
  depends: { toolCall, frameDoc },
  run: async ({ toolCall, frameDoc }, { input: { at, name, pages, frames } }) => {
    const canvas = keyed.parse(
      (await toolCall.run({ input: { ...at, name: "create_canvas", args: { name } } })).answer,
    ).key;
    const listed = await toolCall.run({ input: { ...at, name: "list_pages", args: { canvas } } });
    const keys = z
      .object({ pages: z.array(keyed) })
      .parse(listed.answer)
      .pages.map((p) => p.key);
    for (let p = keys.length + 1; p <= pages; p++) {
      const page = await toolCall.run({
        input: { ...at, name: "create_page", args: { canvas, name: `Page ${p}` } },
      });
      keys.push(keyed.parse(page.answer).key);
    }

    for (const [p, page] of keys.entries()) {
      for (let i = 0; i < frames; i++) {
        const html = frameDoc.run({ input: { id: `p${p + 1}s${i}`, version: 1 } });
        await toolCall.run({
          input: {
            ...at,
            name: "put_frame",
            args: { canvas, html, name: `Screen ${p + 1}.${i + 1}`, page },
          },
        });
      }
    }

    const path = pathed.parse(
      (await toolCall.run({ input: { ...at, name: "share_canvas", args: { canvas } } })).answer,
    ).path;
    const middle = keys[Math.floor(keys.length / 2)] ?? "";
    return { canvas, keys, link: `${at.url}${path}?page=${middle}` };
  },
});

export const startSide = operation({
  label: "speed.startSide",
  input: z.object({
    browser: z.custom<Browser>(),
    name: z.enum(["base", "tree"]),
    dir: z.string(),
    work: z.string(),
    chromium: z.string(),
  }),
  depends: {
    serverUp,
    signIn,
    seedCanvas,
    seedPages,
    warmUp,
    env: speedEnv,
    viewport: speedViewport,
  },
  run: async (deps, { input: { browser, name, dir, work, chromium } }): Promise<Side> => {
    const own = join(work, name);
    mkdirSync(own, { recursive: true });

    const probe = Bun.serve({ port: 0, fetch: () => new Response() });
    const port = probe.port;
    await probe.stop(true);

    const url = `http://127.0.0.1:${port}`;
    const log = join(own, "server.log");
    const binary = join(dir, "dist/server");
    const server = Bun.spawn([binary, "serve"], {
      env: {
        ...deps.env,
        BUILD: "1",
        PORT: String(port),
        PUBLIC_ORIGIN: url,
        NODE_ENV: "production",
        EASEL_DB: join(own, "easel.db"),
        EASEL_CHROMIUM: chromium,
        OTEL_SERVICE_NAME: `easel-speed-${name}`,
      },
      stdout: Bun.file(log),
      stderr: Bun.file(log),
    });

    await deps.serverUp.run({ input: { url, log } });
    const token = deps.signIn.run({ input: { url, log, binary, home: join(own, "home") } });
    const at = { url, token };
    const small = await deps.seedCanvas.run({ input: { at, name: "Speed 20", frames: 20 } });
    const big = await deps.seedCanvas.run({ input: { at, name: "Speed 200", frames: 200 } });
    const paged = await deps.seedPages.run({
      input: { at, name: "Speed pages", pages: 5, frames: 20 },
    });

    const warm = await browser.newContext({ viewport: deps.viewport });
    await deps.warmUp.run({ input: { context: warm, link: small.link, timeout: 60_000 } });
    await deps.warmUp.run({ input: { context: warm, link: paged.link, timeout: 60_000 } });
    const many = await browser.newContext({ viewport: deps.viewport });
    await deps.warmUp.run({ input: { context: many, link: big.link, timeout: 300_000 } });

    return { name, url, token, small, big, paged, warm, many, asked: 0, server };
  },
});

export const stopSide = operation({
  label: "speed.stopSide",
  input: z.custom<Side>(),
  run: async (_, { input: side }) => {
    side.server.kill();
    await side.server.exited;
  },
});
