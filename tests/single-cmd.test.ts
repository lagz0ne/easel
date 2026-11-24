import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serve } from "@tinkered/bun";
import type { Subprocess } from "bun";
import { afterAll, afterEach, expect, test } from "vite-plus/test";

import { homeEnv } from "@/home/env.server";

type Cmd = typeof import("../cmds/server");
type Pages = typeof import("../cmds/pages");

const server: Cmd = await import(new URL("../cmds/server.ts", import.meta.url).href);
const { sitePagesOf }: Pages = await import(new URL("../cmds/pages.ts", import.meta.url).href);

const root = new URL("..", import.meta.url).pathname;

const slow = { timeout: 30_000 };

const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });

afterAll(() => collector.stop());

const closers: Array<() => unknown> = [];
const children: Subprocess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const close of closers.splice(0).reverse()) await close();
});

async function start(env: Record<string, string>) {
  const stop = new AbortController();
  const out: string[] = [];
  const app = await server.default({
    env: {
      PORT: "0",
      OTEL_SERVICE_NAME: "single-cmd-test",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}traces`,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}logs`,
      ...env,
    },
    args: [],
    cwd: root,
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: (code, reason) => stop.abort(reason ?? code),
  });
  if (!("resolve" in app)) throw new Error("the server did not start");
  const url = app.resolve(serve.url).get() ?? new URL("http://localhost:0");
  closers.push(async () => (stop.abort(), await app.closed));

  return {
    origin: `http://localhost:${url.port}`,
    setupCode: () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "",
  };
}

function home() {
  const dir = mkdtempSync(join(tmpdir(), "easel-single-cmd-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));

  return dir;
}

async function easel(dir: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, "cmds/easel.ts", ...args], {
    cwd: root,
    env: { HOME: dir, PATH: process.env.PATH ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { code, out, err };
}

test("EASEL_PROJECT is the name of the one project; a name with marks that are not plain is refused", () => {
  expect(homeEnv.parse({ EASEL_PROJECT: "easel" })).toEqual({ project: "easel" });
  expect(homeEnv.parse({})).toEqual({ project: null });
  expect(homeEnv.safeParse({ EASEL_PROJECT: '"><script>' }).success).toBe(false);
});

test("the page of a server says its mode and its project in its head, and keeps the headers of each page", async () => {
  const dir = join(tmpdir(), `easel-site-${crypto.randomUUID()}`);
  await mkdir(dir);
  const index = join(dir, "index.html");
  await writeFile(
    index,
    "<!doctype html><html><head><title>easel</title></head><body></body></html>",
  );

  const routes = await sitePagesOf.parseAsync({
    built: { "/index.html": index },
    site: { mode: "single", project: "easel" },
  });
  const html = await routes["/*"]?.text();
  expect(html).toContain('<meta name="easel-auth" content="single">');
  expect(html).toContain('<meta name="easel-project" content="easel">');
  expect(routes["/*"]?.headers.get("x-frame-options")).toBe("DENY");
  expect(routes["/*"]?.headers.get("content-type")).toContain("text/html");

  const team = await sitePagesOf.parseAsync({
    built: { "/index.html": index },
    site: { mode: "approve", project: null },
  });
  const teamHtml = await team["/index.html"]?.text();
  expect(teamHtml).toContain('<meta name="easel-auth" content="approve">');
  expect(teamHtml).not.toContain("easel-project");

  await rm(dir, { recursive: true });
});

test(
  "end to end, single: the person sets up, renames itself, and whoami says so; a login with a new name is refused",
  slow,
  async () => {
    const srv = await start({ EASEL_AUTH: "single", EASEL_PROJECT: "easel", PUBLIC_ORIGIN: "" });
    const person = home();
    const stranger = home();

    const setup = await easel(
      person,
      "login",
      srv.origin,
      "--name",
      "rocky",
      "--setup",
      srv.setupCode(),
    );
    expect(setup.code).toBe(0);
    expect(await easel(person, "users", "rename", "rocky", "lagz0ne")).toMatchObject({ code: 0 });
    expect(await easel(person, "whoami")).toMatchObject({
      code: 0,
      out: `lagz0ne (owner) on ${srv.origin}\n`,
    });

    const bob = await easel(stranger, "login", srv.origin, "--name", "bob", "--no-wait");
    expect(bob.code).toBe(1);
    expect(bob.err).toContain("for one person");
    const listed = await easel(person, "users");
    expect(listed.out).toContain("no code waits for approval");
  },
);
