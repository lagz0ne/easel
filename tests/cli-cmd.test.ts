import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ws } from "@tinkered/bun/client";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import type { Server as BunServer, Subprocess } from "bun";
import { afterAll, afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { cli } from "@/cli";
import type { Command } from "@/cli";
import { frames } from "@/frames";
import { maxDocBytes } from "@/frames/contract";

import { inbox, natsServer } from "./support/nats";

type Cmd = typeof import("../cmds/server");

const server: Cmd = await import(new URL("../cmds/server.ts", import.meta.url).href);
const easelCmd: Cmd = await import(new URL("../cmds/easel.ts", import.meta.url).href);

const root = new URL("..", import.meta.url).pathname;

const slow = { timeout: 30_000 };

const collector = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 204 }) });

const closers: Array<() => unknown> = [];
const children: Subprocess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const close of closers.splice(0).reverse()) await close();
});

afterAll(() => collector.stop());

async function serve() {
  const stop = new AbortController();
  const out: string[] = [];
  const app = await server.default({
    env: {
      PORT: "0",
      PUBLIC_ORIGIN: "",
      OTEL_SERVICE_NAME: "cli-test",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${collector.url}traces`,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${collector.url}logs`,
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

function home() {
  const dir = mkdtempSync(join(tmpdir(), "easel-cmd-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));

  return dir;
}

const hostsOf = (dir: string) => join(dir, ".config", "easel", "hosts.json");

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

test("usage is 64, --help is 0, a hosts file that is not one is 78, no server is 64", async () => {
  const dir = home();
  const env = { HOME: dir };

  expect(await main(["--help"], env)).toEqual({
    code: 0,
    out: expect.stringContaining("easel login <server>"),
  });
  expect((await main(["--help"], env)).out).toContain("claude mcp add easel -- easel mcp");
  expect((await main(["mcp", "--owner"], env)).code).toBe(64);
  expect((await main(["login", "--name"], env)).code).toBe(64);
  expect((await main(["whoami", "--owner"], env)).code).toBe(64);
  expect((await main(["users", "approve"], env)).code).toBe(64);
  expect((await main(["users", "approve", "not-a-code"], env)).code).toBe(64);
  expect((await main(["login", "x", "--name", "Not Valid!"], env)).code).toBe(64);
  expect((await main(["login", "x", "--name", "gh", "--print-token", "--no-wait"], env)).code).toBe(
    64,
  );
  expect(
    (await main(["login", "x", "--name", "gh", "--print-token", "--setup", "ABCD-EFGH"], env)).code,
  ).toBe(64);
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
  writeFileSync(hostsOf(dir), JSON.stringify({ hosts: {} }));
  chmodSync(hostsOf(dir), 0o000);
  expect((await main(["whoami"], { XDG_CONFIG_HOME: join(dir, ".config") })).code).toBe(
    process.getuid?.() === 0 ? 64 : 78,
  );
});

test("with EASEL_CONFIG_HOME set, the CLI reads the hosts file in that folder, before XDG_CONFIG_HOME and HOME, and --help says so", async () => {
  const dir = home();
  const agentConfig = join(dir, "easel-agent");
  mkdirSync(join(agentConfig, "easel"), { recursive: true });
  writeFileSync(join(agentConfig, "easel", "hosts.json"), "{ not json");
  const env = { HOME: dir, XDG_CONFIG_HOME: join(dir, "xdg"), EASEL_CONFIG_HOME: agentConfig };

  expect(await main(["whoami", "--json"], env)).toEqual({
    code: 78,
    out: `${JSON.stringify({ config: join(agentConfig, "easel", "hosts.json") })}\n`,
  });
  expect((await main(["--help"], env)).out).toContain("$EASEL_CONFIG_HOME/easel/hosts.json");
});

test(
  "whoami with EASEL_CONFIG_HOME answers as the user of that hosts file, not the user of HOME",
  slow,
  async () => {
    const srv = await serve();
    const ann = home();
    const setup = await easel(
      ann,
      "login",
      srv.origin,
      "--name",
      "ann",
      "--setup",
      srv.setupCode(),
    );
    expect(setup.code).toBe(0);
    const other = home();
    const agentConfig = join(other, "easel-agent");
    mkdirSync(join(agentConfig, "easel"), { recursive: true });
    writeFileSync(join(agentConfig, "easel", "hosts.json"), readFileSync(hostsOf(ann), "utf8"));

    expect(await main(["whoami"], { HOME: other })).toMatchObject({ code: 64 });
    expect(await main(["whoami"], { HOME: other, EASEL_CONFIG_HOME: agentConfig })).toEqual({
      code: 0,
      out: `ann (owner) on ${srv.origin}\n`,
    });
  },
);

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

test("EASEL_TOKEN: with no EASEL_SERVER it is usage (64); it reads no hosts file; --server must be EASEL_SERVER", async () => {
  const dir = home();
  mkdirSync(join(dir, ".config", "easel"), { recursive: true });
  writeFileSync(hostsOf(dir), "{ not json");
  const free = Bun.serve({ port: 0, fetch: () => new Response(null) });
  const port = free.port;
  await free.stop();
  const env = { HOME: dir, EASEL_TOKEN: "t0ken" };

  expect(await main(["whoami", "--json"], env)).toEqual({
    code: 64,
    out: `${JSON.stringify({ usage: "EASEL_TOKEN needs EASEL_SERVER, the address of its server" })}\n`,
  });
  expect(await main(["whoami", "--json"], { ...env, EASEL_SERVER: `localhost:${port}` })).toEqual({
    code: 69,
    out: `${JSON.stringify({ unreachable: `http://localhost:${port}` })}\n`,
  });
  expect(
    await main(["whoami", "--json", "--server", "other.example"], {
      ...env,
      EASEL_SERVER: `localhost:${port}`,
    }),
  ).toEqual({
    code: 64,
    out: `${JSON.stringify({ usage: `EASEL_TOKEN is for http://localhost:${port}: unset it to use other.example` })}\n`,
  });
  expect(readFileSync(hostsOf(dir), "utf8")).toBe("{ not json");
});

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

async function drive(clock: { advance: (ms: number) => void }, run: Promise<number>) {
  const done = { code: -1 };
  void run.then((code) => (done.code = code));
  for (let i = 0; i < 200 && done.code < 0; i++) {
    await Bun.sleep(20);
    clock.advance(1_000);
  }
  return run;
}

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

test(
  "frames on the real server: a guest is refused (2), a document a little over 1 MiB answers tooBig on the socket, bad put flags are one usage line (64), and canvas rm exits 0 then 1",
  slow,
  async () => {
    const srv = await serve();
    const ann = home();
    const guest = home();
    await easel(ann, "login", srv.origin, "--name", "ann", "--setup", srv.setupCode());
    const env = { HOME: ann };
    expect((await main(["canvas", "new", "Flow", "--json"], env)).code).toBe(0);

    expect(await main(["canvas", "ls", "--json", "--server", srv.origin], { HOME: guest })).toEqual(
      { code: 2, out: `${JSON.stringify({ refused: { signIn: true } })}\n` },
    );

    const token = String(
      JSON.parse(readFileSync(hostsOf(ann), "utf8")).hosts[srv.origin].user.token,
    );
    const bearer = createScope({
      capsules: [
        exits({ file: process.env.TINKER_EXITS }),
        ws.client({
          url: `${srv.origin.replace(/^http/, "ws")}/rpc`,
          meta: operation({
            label: "test.bearer",
            run: async (): Promise<Record<string, string>> => ({
              authorization: `Bearer ${token}`,
            }),
          }),
        }),
        frames.api({ remote: ws.client }),
      ],
    });
    const scope = await bearer.ready;
    closers.push(() => scope.close());
    const put = (html: string) =>
      scope.run(frames.api["frame.put"], { input: { canvas: "flow", html } });
    expect(await put("x".repeat(maxDocBytes + 4096))).toEqual({
      kind: "tooBig",
      maxBytes: maxDocBytes,
    });
    expect(await put("<p>1</p>")).toMatchObject({ kind: "created", version: 1 });

    const file = join(ann, "x.html");
    writeFileSync(file, "<p>x</p>");
    const id = "0123456789ab";
    expect(await main(["put", "flow", file, "--id", id, "--json"], env)).toEqual({
      code: 64,
      out: `${JSON.stringify({ usage: "--id needs --base, the version you got: `easel get` prints it" })}\n`,
    });
    expect(await main(["put", "flow", file, "--id", id, "--base", "0"], env)).toEqual({
      code: 64,
      out: "--base takes the version you got, 1 or more: `easel get` prints it\n",
    });
    expect(await main(["put", "flow", file, "--size", "0x5"], env)).toEqual({
      code: 64,
      out: "--size takes WxH in CSS pixels, each 1 to 16000, as 390x844\n",
    });
    expect(await main(["put", "flow", file, "--ready"], env)).toEqual({
      code: 64,
      out: "--ready is for an app frame: a .tsx file or a folder\n",
    });
    expect(await main(["ready", "flow", id, "--json"], env)).toEqual({
      code: 1,
      out: `${JSON.stringify({ kind: "gone" })}\n`,
    });
    expect(await main(["explore", "flow", id, "--json"], env)).toEqual({
      code: 1,
      out: `${JSON.stringify({ kind: "gone" })}\n`,
    });
    expect(await main(["canvas", "rm", "flow", "--json"], env)).toEqual({
      code: 0,
      out: `${JSON.stringify({ kind: "deleted" })}\n`,
    });
    expect(await main(["canvas", "rm", "flow", "--json"], env)).toEqual({
      code: 1,
      out: `${JSON.stringify({ kind: "gone" })}\n`,
    });
  },
);

test(
  "a run with only EASEL_TOKEN and EASEL_SERVER: whoami and next answer, and it leaves no file",
  slow,
  async () => {
    const srv = await serve();
    const ann = home();
    await easel(ann, "login", srv.origin, "--name", "ann", "--setup", srv.setupCode());
    const token = String(
      JSON.parse(readFileSync(hostsOf(ann), "utf8")).hosts[srv.origin].user.token,
    );
    const run = home();
    const env = { HOME: run, EASEL_TOKEN: token, EASEL_SERVER: srv.origin };

    expect(await main(["whoami"], env)).toEqual({ code: 0, out: `ann (owner) on ${srv.origin}\n` });
    expect(await main(["next", "--json"], env)).toEqual({
      code: 0,
      out: `${JSON.stringify({ kind: "empty" })}\n`,
    });
    expect(await main(["logout", "--json"], env)).toMatchObject({ code: 64 });
    expect(await main(["whoami"], env)).toMatchObject({ code: 0 });
    expect(readdirSync(run)).toEqual([]);
  },
);

test(
  "login --print-token on the real cmds: an owner approves, the token is the one line on stdout, no file is left, and a run signs in with it",
  slow,
  async () => {
    const srv = await serve();
    const ann = home();
    await easel(ann, "login", srv.origin, "--name", "ann", "--setup", srv.setupCode());
    const lead = home();

    const asked = spawn(lead, ["login", srv.origin, "--name", "github", "--print-token"]);
    const said = { text: "" };
    void (async () => {
      for await (const chunk of asked.stderr) said.text += new TextDecoder().decode(chunk);
    })();
    for (let i = 0; i < 500 && !/code (\S+)/.test(said.text); i++) await Bun.sleep(10);
    const code = /code (\S+) for github/.exec(said.text)?.[1] ?? "";
    expect(await easel(ann, "users", "approve", code)).toMatchObject({ code: 0 });
    const [exited, out] = await Promise.all([asked.exited, new Response(asked.stdout).text()]);
    expect(exited).toBe(0);
    expect(readdirSync(lead).filter((name) => name !== ".bun")).toEqual([]);

    const token = out.trim();
    const run = home();
    const env = { HOME: run, EASEL_TOKEN: token, EASEL_SERVER: srv.origin };
    expect(await main(["whoami"], env)).toEqual({
      code: 0,
      out: `github (member) on ${srv.origin}\n`,
    });
    expect(readdirSync(run)).toEqual([]);
  },
);

test(
  "channel set nats on the real cmds takes --url, --subject, --seed-file and a repeated --canvas; next takes one --canvas only",
  slow,
  async () => {
    const srv = await serve();
    const nats = await natsServer();
    closers.push(() => nats.close());
    const ann = home();
    await easel(ann, "login", srv.origin, "--name", "ann", "--setup", srv.setupCode());
    const seedFile = join(ann, "seed");
    writeFileSync(seedFile, nats.seed);

    const flags = ["--url", nats.wsUrl, "--subject", "easel.requests", "--seed-file", seedFile];
    flags.push("--inbox", inbox);
    const canvases = ["--canvas", "product", "--canvas", "design-system"];
    const set = await easel(ann, "channel", "set", "loop", "nats", ...flags, ...canvases, "--json");
    expect(set).toMatchObject({ code: 0, json: [{ kind: "saved" }] });
    const listed = await easel(ann, "channel", "ls", "--json");
    expect(listed.json[0].channels).toMatchObject([
      {
        name: "loop",
        kind: "nats",
        url: nats.wsUrl,
        inbox,
        canvases: ["product", "design-system"],
        key: nats.publicKey,
      },
    ]);
    expect(listed.out).not.toContain(nats.seed);

    expect(await easel(ann, "next", "--canvas", "flow", "--json")).toMatchObject({
      code: 0,
      json: [{ kind: "empty" }],
    });
    expect(await easel(ann, "next", "--canvas", "a", "--canvas", "b")).toMatchObject({ code: 64 });
  },
);
