import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { access } from "@/access";
import { browserOps, openOps } from "@/access/browser.server";
import { byToken, owner, user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, renameOps, userOps } from "@/access/users.server";
import { cli } from "@/cli";
import type { Command } from "@/cli";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

async function boot(mode: "approve" | "open" | "single") {
  const clock = makeTestClock({ now: 1_800_000_000_000 });
  const out: string[] = [];
  const services = [
    access.login,
    access.browser,
    access.open,
    access.user,
    access.owner,
    access.rename,
  ];
  const server = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({
        mode,
        origin: mode === "open" ? "http://localhost:4318" : null,
        stdout: { write: (chunk: string) => out.push(chunk) },
        trusted: [],
        durable: false,
      }),
      access.login({ implement: loginOps }),
      access.browser({ implement: browserOps }),
      access.open({ implement: openOps, onStart: [user, byToken] }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user, owner] }),
      access.rename({ implement: renameOps, onStart: [user, owner] }),
      memory.server({ services }),
    ],
  }).ready;
  closers.push(() => server.close());

  return { server, clock, setupCode: () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "" };
}

type Srv = Awaited<ReturnType<typeof boot>>;

async function easel(srv: Srv, json = true) {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-single-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const out: string[] = [];
  const err: string[] = [];
  const scope = await createScope({
    clock: srv.clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({
        peer: srv.server,
        headers: { "x-easel-peer": "203.0.113.7" },
        meta: cli.bearer,
      }),
      access.login({ remote: memory.client }),
      access.open({ remote: memory.client }),
      access.user({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      access.rename({ remote: memory.client }),
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => err.push(chunk) },
        json,
        server: origin,
        hosts: join(dir, "easel", "hosts.json"),
        token: null,
      }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return {
    run: (command: Command) => scope.run(cli.run, { input: command }),
    lines: () =>
      out
        .splice(0)
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    text: () => [...out.splice(0), ...err.splice(0)].join(""),
  };
}

const login = (name: string, setup?: string): Command => ({
  kind: "login",
  name,
  noWait: true,
  ...(setup ? { setup } : {}),
});

const users = (act: Extract<Command, { kind: "users" }>["act"]): Command => ({
  kind: "users",
  act,
});

async function person(srv: Srv, json = true) {
  const rocky = await easel(srv, json);
  expect(await rocky.run(login("rocky", srv.setupCode()))).toBe(0);
  rocky.text();

  return rocky;
}

async function browserCode(srv: Srv) {
  const page = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: srv.server, headers: { "x-easel-peer": "192.0.2.4" } }),
      access.browser({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => page.close());
  const shown = await page.run(access.browser["browser.start"], { input: {} });
  if (shown.kind !== "pending") throw new Error(`not pending: ${shown.kind}`);

  return shown.code;
}

test("criterion 3: in single, easel login --name bob --no-wait is refused with exit 1, and says why", async () => {
  const srv = await boot("single");
  await person(srv);
  const bob = await easel(srv, false);

  expect(await bob.run(login("bob"))).toBe(1);
  expect(bob.text()).toContain("for one person");
});

test("in single, easel users approve <code> signs the browser in as the person; --owner is refused with exit 1", async () => {
  const srv = await boot("single");
  const rocky = await person(srv);

  expect(
    await rocky.run(users({ kind: "approve", code: await browserCode(srv), owner: true })),
  ).toBe(1);
  expect(rocky.lines()).toEqual([{ kind: "single" }]);
  expect(
    await rocky.run(users({ kind: "approve", code: await browserCode(srv), owner: false })),
  ).toBe(0);
  expect(rocky.lines()).toEqual([
    { kind: "approved", user: expect.objectContaining({ name: "rocky", role: "owner" }) },
  ]);
});

test("in single, the list names a code with no name as a code for the owner who approves it", async () => {
  const srv = await boot("single");
  const rocky = await person(srv, false);
  const code = await browserCode(srv);

  expect(await rocky.run(users({ kind: "ls" }))).toBe(0);
  expect(rocky.text()).toContain(`${code}\t(the owner who approves it)\tbrowser`);
});

test("in single, easel users add --owner is refused with exit 1; users add makes an agent", async () => {
  const srv = await boot("single");
  const rocky = await person(srv, false);

  expect(await rocky.run(users({ kind: "add", name: "boss", owner: true }))).toBe(1);
  expect(rocky.text()).toContain("for one person");
  expect(await rocky.run(users({ kind: "add", name: "vibea-claude", owner: false }))).toBe(0);
  expect(rocky.text()).toContain("added vibea-claude (member)");
});

test("easel users rename rocky lagz0ne: whoami then says lagz0ne, owner, with the same token", async () => {
  const srv = await boot("approve");
  const rocky = await person(srv);

  expect(await rocky.run(users({ kind: "rename", name: "rocky", to: "lagz0ne" }))).toBe(0);
  expect(rocky.lines()).toEqual([
    { kind: "renamed", user: expect.objectContaining({ name: "lagz0ne", role: "owner" }) },
  ]);
  expect(await rocky.run({ kind: "whoami" })).toBe(0);
  expect(rocky.lines()).toEqual([{ kind: "me", name: "lagz0ne", owner: true, server: origin }]);
});

test("easel users rename answers taken and gone with exit 1, and says why", async () => {
  const srv = await boot("approve");
  const rocky = await person(srv, false);
  await rocky.run(users({ kind: "add", name: "vibea-claude", owner: false }));
  rocky.text();

  expect(await rocky.run(users({ kind: "rename", name: "rocky", to: "vibea-claude" }))).toBe(1);
  expect(rocky.text()).toContain("the name vibea-claude is in use");
  expect(await rocky.run(users({ kind: "rename", name: "nobody", to: "dee" }))).toBe(1);
  expect(rocky.text()).toContain("no user nobody");
  expect(await rocky.run(users({ kind: "rename", name: "rocky", to: "lagz0ne" }))).toBe(0);
  expect(rocky.text()).toContain("renamed rocky to lagz0ne (owner)");
});

test("approve and open stay as before: on an open server, easel login signs in at once as an owner, and whoami says so", async () => {
  const srv = await boot("open");
  const ann = await easel(srv);

  expect(await ann.run(login("ann"))).toBe(0);
  expect(ann.lines()).toEqual([
    { kind: "granted", user: expect.objectContaining({ name: "ann", role: "owner" }) },
  ]);
  expect(await ann.run({ kind: "whoami" })).toBe(0);
  expect(ann.lines()).toEqual([{ kind: "me", name: "ann", owner: true, server: origin }]);
});
