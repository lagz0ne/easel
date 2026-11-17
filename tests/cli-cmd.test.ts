import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ws } from "@tinkered/bun/client";
import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import type { Server as BunServer, Subprocess } from "bun";
import { afterAll, afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { cli } from "@/cli";
import type { Command } from "@/cli";

type Cmd = typeof import("../cmds/server");

// The `easel` command for real: the server command in this process on its own port, and the CLI
// as its own process (`bun cmds/easel.ts`), each with its own hosts file. The flags, the exit
// codes, the hosts file, and the chart's arrows that need a real socket: a lost `granted` answer,
// a reply that never comes, and a CLI that is stopped while it waits. A CLI that must wait out a
// deadline or a backoff runs in this process on a test clock, over the real socket.

/** The real commands, loaded at run time; the lint bans a static parent import. */
const server: Cmd = await import(new URL("../cmds/server.ts", import.meta.url).href);
const easelCmd: Cmd = await import(new URL("../cmds/easel.ts", import.meta.url).href);

const root = new URL("..", import.meta.url).pathname;

/** A test that starts CLI processes: each start of `bun` takes a while on a busy machine. */
const slow = { timeout: 30_000 };

/** Takes the telemetry the server sends, so nothing leaves this machine. */
const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });

const closers: Array<() => unknown> = [];
const children: Subprocess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const close of closers.splice(0).reverse()) await close();
});

afterAll(() => collector.stop());

/** The real server command on port 0: its URL, and its log (with the setup code). */
async function serve() {
  const stop = new AbortController();
  const out: string[] = [];
  const app = await server.default({
    env: {
      PORT: "0",
      PUBLIC_ORIGIN: "",
      OTEL_SERVICE_NAME: "cli-test",
      VICTORIA_TRACES_URL: `${collector.url}traces`,
      VICTORIA_LOGS_URL: `${collector.url}logs`,
    },
    args: [],
    cwd: root,
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: (code, reason) => stop.abort(reason ?? code),
  });
  if (!("resolve" in app)) throw new Error("the server did not start");
  const { serve: port } = await import("@tinkered/bun");
  const url = app.resolve(port.url).get() ?? new URL("http://localhost:0");
  closers.push(async () => (stop.abort(), await app.closed));
  const setupCode = () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "";

  return { origin: `http://localhost:${url.port}`, port: url.port, setupCode };
}

/** A home of its own: its hosts file is `<home>/.config/easel/hosts.json`. */
function home() {
  const dir = mkdtempSync(join(tmpdir(), "easel-cmd-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));

  return dir;
}

const hostsOf = (dir: string) => join(dir, ".config", "easel", "hosts.json");

/** The CLI as its own process, in its home: its exit code and what it printed. */
function spawn(dir: string, args: string[]) {
  const child = Bun.spawn([process.execPath, "cmds/easel.ts", ...args], {
    cwd: root,
    env: { HOME: dir, PATH: process.env.PATH ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);

  return child;
}

async function easel(dir: string, ...args: string[]) {
  const child = spawn(dir, args);
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return {
    code,
    out,
    err,
    json: args.includes("--json")
      ? out
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [],
  };
}

/** A CLI that runs on: what it has printed so far, and its first line once there is one. */
function running(child: Subprocess<"ignore", "pipe", "pipe">) {
  const printed = { text: "" };
  const done = (async () => {
    for await (const chunk of child.stdout) printed.text += new TextDecoder().decode(chunk);
  })();
  const firstLine = async () => {
    while (!printed.text.includes("\n")) await Promise.race([done, Bun.sleep(10)]);
    return JSON.parse(printed.text.split("\n")[0] ?? "null");
  };

  return { child, printed, firstLine, ended: async () => (await done, printed.text) };
}

/** The cmd's main in this process: its exit code and what it printed. */
async function main(args: string[], env: Record<string, string> = {}) {
  const out: string[] = [];
  const codes: number[] = [];
  const stop = new AbortController();
  const app = await easelCmd.default({
    env,
    args,
    cwd: root,
    signal: stop.signal,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => out.push(chunk) },
    exit: (code) => (codes.push(code), stop.abort()),
  });
  await app.closed;

  return { code: codes[0], out: out.join("") };
}

// ---- The flags, and what ends a run before it reaches a server

test("usage is 64, --help is 0, a hosts file that is not one is 78, no server is 64", async () => {
  const dir = home();
  const env = { HOME: dir };

  expect(await main(["--help"], env)).toEqual({
    code: 0,
    out: expect.stringContaining("easel login <server>"),
  });
  expect((await main(["login", "--name"], env)).code).toBe(64);
  expect((await main(["whoami", "--owner"], env)).code).toBe(64);
  expect((await main(["users", "approve"], env)).code).toBe(64);
  expect((await main(["users", "approve", "not-a-code"], env)).code).toBe(64);
  expect((await main(["login", "x", "--name", "Not Valid!"], env)).code).toBe(64);
  expect(await main(["frobnicate", "--json"], env)).toEqual({
    code: 64,
    out: expect.stringMatching(/^\{"usage":/),
  });
  expect(await main(["whoami", "--json"], env)).toEqual({
    code: 64,
    out: `${JSON.stringify({ usage: "no server: run `easel login <server> --name <name>`, or pass --server" })}\n`,
  });

  mkdirSync(join(dir, ".config", "easel"), { recursive: true });
  writeFileSync(hostsOf(dir), "{ not json");
  expect((await main(["whoami"], env)).code).toBe(78);
  writeFileSync(hostsOf(dir), JSON.stringify({ hosts: { x: { user: { name: 1 } } } }));
  expect((await main(["whoami", "--json"], env)).out).toBe(
    `${JSON.stringify({ config: hostsOf(dir) })}\n`,
  );
  // A valid file with no server: root reads it anyway (64); anyone else cannot (78).
  writeFileSync(hostsOf(dir), JSON.stringify({ hosts: {} }));
  chmodSync(hostsOf(dir), 0o000);
  expect((await main(["whoami"], { XDG_CONFIG_HOME: join(dir, ".config") })).code).toBe(
    process.getuid?.() === 0 ? 64 : 78,
  );
});

test("a server that is not there is unreachable (69)", async () => {
  const dir = home();
  const free = Bun.serve({ port: 0, fetch: () => new Response(null) });
  const port = free.port;
  await free.stop();

  const run = await main(["whoami", "--json", "--server", `localhost:${port}`], { HOME: dir });
  expect(run).toEqual({
    code: 69,
    out: `${JSON.stringify({ unreachable: `http://localhost:${port}` })}\n`,
  });
});

// ---- End to end

test(
  "end to end: setup, the agent logs in, an owner approves, whoami, revoke, and the agent is refused",
  slow,
  async () => {
    const srv = await serve();
    const ann = home();
    const agentHome = home();

    const setup = await easel(
      ann,
      "login",
      srv.origin,
      "--name",
      "ann",
      "--setup",
      srv.setupCode(),
      "--json",
    );
    expect(setup).toMatchObject({
      code: 0,
      json: [{ kind: "granted", user: { name: "ann", role: "owner" } }],
    });
    expect(statSync(hostsOf(ann)).mode & 0o777).toBe(0o600);
    expect(statSync(join(ann, ".config", "easel")).mode & 0o777).toBe(0o700);
    const annToken = JSON.parse(readFileSync(hostsOf(ann), "utf8")).hosts[srv.origin].user.token;
    expect(setup.out + setup.err).not.toContain(annToken);

    const agent = running(
      spawn(agentHome, ["login", `localhost:${srv.port}`, "--name", "agent", "--json"]),
    );
    const pending = await agent.firstLine();
    expect(pending).toEqual({
      kind: "pending",
      code: expect.stringMatching(/^[A-Z]{4}-[A-Z]{4}$/),
      expiresAt: expect.any(Number),
    });

    const listed = await easel(ann, "users");
    expect(listed.code).toBe(0);
    expect(listed.out).toContain(pending.code);
    expect(await easel(ann, "users", "approve", pending.code.toLowerCase())).toMatchObject({
      code: 0,
      out: "approved agent (member)\n",
    });
    expect(await agent.child.exited).toBe(0);
    expect(await agent.ended()).toContain('"kind":"granted"');

    expect(await easel(agentHome, "whoami")).toMatchObject({
      code: 0,
      out: `agent (member) on ${srv.origin}\n`,
    });
    expect(await easel(ann, "users", "revoke", "agent")).toMatchObject({
      code: 0,
      out: "revoked agent\n",
    });
    const refused = await easel(agentHome, "whoami");
    expect(refused).toMatchObject({ code: 2, out: "" });
    expect(refused.err).toContain(`not signed in to ${srv.origin}: log in again`);
    expect(JSON.parse(readFileSync(hostsOf(agentHome), "utf8")).hosts[srv.origin]).toBeUndefined();
  },
);

test(
  "the agent stops waiting (SIGINT): the login is kept; the agent resumes (login --resume), and is told granted",
  slow,
  async () => {
    const srv = await serve();
    const ann = home();
    const agentHome = home();
    await easel(ann, "login", srv.origin, "--name", "ann", "--setup", srv.setupCode());

    const agent = running(spawn(agentHome, ["login", srv.origin, "--name", "agent", "--json"]));
    const pending = await agent.firstLine();
    await Bun.sleep(200);
    const stoppedAt = Date.now();
    agent.child.kill("SIGINT");
    expect(await agent.child.exited).toBe(130);
    expect(Date.now() - stoppedAt).toBeLessThan(5_000);
    expect(
      JSON.parse(readFileSync(hostsOf(agentHome), "utf8")).hosts[srv.origin].pending.code,
    ).toBe(pending.code);

    await easel(ann, "users", "approve", pending.code);
    const resumed = await easel(agentHome, "login", "--resume", "--json");
    expect(resumed).toMatchObject({
      code: 0,
      json: [{ kind: "pending", code: pending.code }, { kind: "granted" }],
    });
  },
);

/**
 * A socket proxy in front of the server. While `lose` is on, a reply that carries `lose` is
 * dropped: with `close`, the CLI's socket is closed too, as when a network drops a packet and
 * then the link; without it, the socket stays open and the CLI is never answered (half-open).
 * `once` drops only the first.
 */
function lossyProxy(port: string, lose = "granted", how = { close: true, once: true }) {
  const dropped: string[] = [];
  const state = { lose: true };
  const proxy: BunServer<{ upstream: WebSocket }> = Bun.serve<{ upstream: WebSocket }>({
    port: 0,
    fetch: (request, srv) => {
      const upstream = new WebSocket(`ws://localhost:${port}${new URL(request.url).pathname}`);
      return srv.upgrade(request, { data: { upstream } })
        ? undefined
        : new Response(null, { status: 400 });
    },
    websocket: {
      open: (client) => {
        const { upstream } = client.data;
        upstream.onmessage = (event) => {
          const text = String(event.data);
          const drop = state.lose && text.includes(lose) && !(how.once && dropped.length);
          if (!drop) return void client.send(text);
          dropped.push(text);
          if (how.close) client.close();
        };
        upstream.onclose = () => client.close();
      },
      message: (client, frame) => {
        const { upstream } = client.data;
        if (upstream.readyState === WebSocket.OPEN) upstream.send(frame);
        else upstream.addEventListener("open", () => upstream.send(frame), { once: true });
      },
      close: (client) => client.data.upstream.close(),
    },
  });
  closers.push(() => proxy.stop(true));

  return { origin: `http://localhost:${proxy.port}`, dropped, state };
}

/**
 * The CLI as the cmd builds it, in this process on a test clock, over a real socket: the call
 * deadline and the backoff pass when the test advances the clock, not in real time.
 */
async function clocked(origin: string, path: string) {
  const clock = makeTestClock({ now: Date.now() });
  const out: string[] = [];
  const app = createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      ws.client({ url: `${origin.replace(/^http/, "ws")}/rpc`, meta: cli.bearer }),
      access.login({ remote: ws.client }),
      access.user({ remote: ws.client }),
      access.owner({ remote: ws.client }),
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => out.push(chunk) },
        json: true,
        server: origin,
        hosts: path,
      }),
    ],
  });
  const scope = await app.ready;
  closers.push(() => scope.close());

  return {
    clock,
    run: (command: Command) => scope.run(cli.run, { input: command }),
    /** Each JSON line printed since the last read. */
    lines: () =>
      out
        .splice(0)
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    hosts: () => JSON.parse(readFileSync(path, "utf8")).hosts[origin] ?? {},
  };
}

/** Moves the clock on, a second at a time, until the run ends. */
async function drive(clock: { advance: (ms: number) => void }, run: Promise<number>) {
  const done = { code: -1 };
  void run.then((code) => (done.code = code));
  for (let i = 0; i < 200 && done.code < 0; i++) {
    await Bun.sleep(20);
    clock.advance(1_000);
  }
  return run;
}

/** The first owner, signed in straight to the server on her own clocked CLI. */
async function owner(srv: { origin: string; setupCode: () => string }) {
  const ann = await clocked(srv.origin, hostsOf(home()));
  const setup = await ann.run({
    kind: "login",
    name: "ann",
    noWait: false,
    setup: srv.setupCode(),
  });
  expect(setup).toBe(0);
  ann.lines();

  return ann;
}

test(
  "the server answers granted, but the answer is lost; the agent is told granted, and is signed in (AWorkingTokenIsNeverDropped)",
  slow,
  async () => {
    const srv = await serve();
    const ann = home();
    const agentHome = home();
    await easel(ann, "login", srv.origin, "--name", "ann", "--setup", srv.setupCode());
    const proxy = lossyProxy(srv.port);

    const agent = running(spawn(agentHome, ["login", proxy.origin, "--name", "agent", "--json"]));
    const pending = await agent.firstLine();
    await easel(ann, "users", "approve", pending.code);

    expect(await agent.child.exited).toBe(0);
    expect(proxy.dropped).toHaveLength(1);
    expect(await agent.ended()).toContain('"kind":"granted"');
    const held = JSON.parse(readFileSync(hostsOf(agentHome), "utf8")).hosts[proxy.origin];
    expect(held).toEqual({ user: { name: "agent", role: "member", token: expect.any(String) } });
    expect(await easel(agentHome, "whoami")).toMatchObject({
      code: 0,
      out: `agent (member) on ${proxy.origin}\n`,
    });
  },
);

test(
  "a reply that never comes (half-open socket): the call's deadline ends it as a dropped link; the agent asks again, and is signed in (ALostGrantedAnswerStillSignsTheAgentIn)",
  slow,
  async () => {
    const srv = await serve();
    const ann = await owner(srv);
    const proxy = lossyProxy(srv.port, "granted", { close: false, once: true });
    const agent = await clocked(proxy.origin, hostsOf(home()));
    expect(await agent.run({ kind: "login", name: "agent", noWait: true })).toBe(0);
    const [pending] = agent.lines();
    expect(
      await ann.run({ kind: "users", act: { kind: "approve", code: pending.code, owner: false } }),
    ).toBe(0);

    const run = agent.run({ kind: "resume" });
    for (let i = 0; i < 200 && !proxy.dropped.length; i++) await Bun.sleep(10);
    expect(proxy.dropped).toHaveLength(1);
    await Bun.sleep(50);
    // SPEC-cli.md § Contract: a call with no answer after 60 s is a `link` fault.
    agent.clock.advance(60_000);
    expect(await drive(agent.clock, run)).toBe(0);
    expect(agent.lines().map((line) => line.kind)).toEqual(["pending", "granted"]);
    expect(agent.hosts()).toEqual({
      user: { name: "agent", role: "member", token: expect.any(String) },
    });
  },
);

test(
  "the agent stops waiting on an approved code: every granted is lost, so it exits 69 and keeps the login; the agent resumes (login --resume) onto approved, and is signed in",
  slow,
  async () => {
    const srv = await serve();
    const ann = await owner(srv);
    const proxy = lossyProxy(srv.port, "granted", { close: true, once: false });
    const agent = await clocked(proxy.origin, hostsOf(home()));
    expect(await agent.run({ kind: "login", name: "agent", noWait: true })).toBe(0);
    const [pending] = agent.lines();
    await ann.run({ kind: "users", act: { kind: "approve", code: pending.code, owner: false } });

    expect(await drive(agent.clock, agent.run({ kind: "resume" }))).toBe(69);
    expect(proxy.dropped).toHaveLength(6);
    expect(agent.lines()).toEqual([
      { kind: "pending", code: pending.code, expiresAt: pending.expiresAt },
      { unreachable: proxy.origin },
    ]);
    expect(agent.hosts()).toEqual({ pending: expect.objectContaining({ code: pending.code }) });

    proxy.state.lose = false;
    expect(await agent.run({ kind: "resume" })).toBe(0);
    expect(agent.lines().map((line) => line.kind)).toEqual(["pending", "granted"]);
    expect(agent.hosts().user).toMatchObject({ name: "agent", role: "member" });
  },
);

test(
  "the agent logs out, but the answer is lost: exit 69, the token is kept; the next call is refused (2), and the token is dropped",
  slow,
  async () => {
    const srv = await serve();
    const ann = await owner(srv);
    const proxy = lossyProxy(srv.port, "ended", { close: true, once: true });
    const agent = await clocked(proxy.origin, hostsOf(home()));
    expect(await agent.run({ kind: "login", name: "agent", noWait: true })).toBe(0);
    const [pending] = agent.lines();
    await ann.run({ kind: "users", act: { kind: "approve", code: pending.code, owner: false } });
    expect(await agent.run({ kind: "resume" })).toBe(0);
    agent.lines();
    const token = agent.hosts().user.token;

    expect(await agent.run({ kind: "logout" })).toBe(69);
    expect(proxy.dropped).toHaveLength(1);
    expect(agent.lines()).toEqual([{ unreachable: proxy.origin }]);
    expect(agent.hosts().user.token).toBe(token);

    expect(await agent.run({ kind: "whoami" })).toBe(2);
    expect(agent.lines()).toEqual([{ refused: { signIn: true } }]);
    expect(agent.hosts()).toEqual({});
  },
);
