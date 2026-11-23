import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { cli } from "@/cli";
import { channelRun } from "@/cli/channels";
import type { ChannelCommand } from "@/cli/channels";
import { frames } from "@/frames";
import { queue } from "@/queue";

import { githubDouble } from "./support/github";
import { boot, closers, rounds, viewer } from "./support/queue";
import type { Server } from "./support/queue";

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";
const token = "ghp_cli0123456789abcdefWXYZ";

async function easel(json = false) {
  const github = githubDouble(token);
  const srv = await boot(":memory:", [], { github: github.fetch });
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-channels-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, "token");
  writeFileSync(tokenFile, `${token}\n`);
  const out: string[] = [];
  const scope = await createScope({
    clock: srv.clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({
        peer: srv.server,
        headers: { "x-easel-peer": "198.51.100.1" },
        meta: cli.bearer,
      }),
      access.login({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      queue.api({ remote: memory.client }),
      queue.viewer({ remote: memory.client }),
      queue.channels({ remote: memory.client }),
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => out.push(chunk) },
        json,
        server: origin,
        hosts: join(dir, "hosts.json"),
      }),
    ],
  }).ready;
  closers.push(() => scope.close());
  const signedIn = await scope.run(cli.run, {
    input: { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false },
  });
  expect(signedIn).toBe(0);
  out.length = 0;

  return {
    srv,
    github,
    scope,
    tokenFile,
    dir,
    run: (command: ChannelCommand) => scope.run(channelRun, { input: command }),
    text: () => out.splice(0).join(""),
  };
}

type Easel = Awaited<ReturnType<typeof easel>>;

const set = (e: Easel, more: Partial<Extract<ChannelCommand, { kind: "set" }>> = {}) =>
  e.run({
    kind: "set",
    name: "gh",
    channel: "github",
    repo: "acme/design",
    label: "easel",
    tokenFile: e.tokenFile,
    ...more,
  });

async function asked(e: Easel, srv: Server) {
  await e.scope.run(frames.api["canvas.create"], { input: { name: "flow" } });
  const made = await e.scope.run(frames.api["frame.put"], {
    input: { canvas: "flow", html: "<p>1</p>", name: "Home" },
  });
  if (made.kind !== "created") throw new Error(made.kind);

  const shared = await e.scope.run(frames.api["canvas.share"], { input: { canvas: "flow" } });
  if (shared.kind !== "shared") throw new Error(shared.kind);

  const bo = await viewer(srv, shared.path.slice("/s/".length), "Bo");
  expect((await bo.add("flow", made.id)).kind).toBe("added");
}

test("channel set saves a channel and exits 0; channel ls shows it with the last 4 characters of the token; no output holds the token", async () => {
  const e = await easel();

  expect(await set(e)).toBe(0);
  expect(e.text()).toBe(
    "saved: channel gh gets each waiting period of a request, as an issue in acme/design\n",
  );
  expect(await set(e, { trigger: "@bot" })).toBe(0);
  e.text();
  expect(await e.run({ kind: "ls" })).toBe(0);
  const listed = e.text();
  expect(listed).toBe("gh\tgithub\tacme/design\tlabel easel\ttrigger @bot\ttoken …WXYZ\n");
  expect(listed).not.toContain(token);
});

test("channel set with --json prints the answer; ls with no channel says so", async () => {
  const e = await easel(true);
  expect(await e.run({ kind: "ls" })).toBe(0);
  expect(JSON.parse(e.text())).toEqual({ kind: "listed", channels: [] });

  expect(await set(e)).toBe(0);
  expect(JSON.parse(e.text())).toEqual({ kind: "saved" });
});

test("channel set on a public repository exits 1, public; on one that GitHub does not show, 1, refused with GitHub's status and message; nothing is saved", async () => {
  const e = await easel();
  e.github.repos.set("acme/open", { private: false, labels: new Set(), canWrite: true });

  expect(await set(e, { repo: "acme/open" })).toBe(1);
  expect(e.text()).toBe(
    "public: acme/open is public, and a request of a viewer must not go there. Nothing was saved.\n",
  );
  expect(await set(e, { repo: "acme/none" })).toBe(1);
  expect(e.text()).toBe("refused: GitHub answered 404: Not Found. Nothing was saved.\n");
  expect(await e.run({ kind: "ls" })).toBe(0);
  expect(e.text()).toBe("no channel\n");
});

test("channel set with a bad flag exits 64 before it calls, and a name that the contract refuses exits 65", async () => {
  const e = await easel();
  const cases: Array<[Partial<Extract<ChannelCommand, { kind: "set" }>>, string]> = [
    [{ channel: "webhook" }, "the kind of a channel is github"],
    [{ repo: undefined }, "--repo takes the repository"],
    [{ label: undefined }, "--label takes the label"],
    [{ tokenFile: undefined }, "--token-file takes the path of a file that holds the token"],
    [{ tokenFile: join(e.dir, "none") }, "--token-file takes the path of a file that can be read"],
  ];
  for (const [more, line] of cases) {
    expect(await set(e, more)).toBe(64);
    expect(e.text()).toContain(line);
  }

  expect(await set(e, { name: "Bad_Name" })).toBe(65);
  expect(e.text()).toMatch(/^the input is wrong: name: /);
  expect(await set(e, { repo: "not-a-repo" })).toBe(65);
  expect(e.text()).toMatch(/^the input is wrong: repo: /);
  expect(e.github.calls).toEqual([]);
});

test("channel rm removes the channel and exits 0; a second rm exits 1, gone; a bad name exits 65", async () => {
  const e = await easel();
  expect(await set(e)).toBe(0);
  e.text();

  expect(await e.run({ kind: "rm", name: "gh" })).toBe(0);
  expect(e.text()).toBe("removed: gh. Its issues stay on GitHub.\n");
  expect(await e.run({ kind: "rm", name: "gh" })).toBe(1);
  expect(e.text()).toBe("gone: no such channel. Nothing was written.\n");
  expect(await e.run({ kind: "rm", name: "Bad_Name" })).toBe(65);
});

test("deliveries shows each delivery: the channel, the period, sent or failed, the attempts and the issue; with no channel it says so; an unknown request exits 1, gone; a bad number exits 64", async () => {
  const e = await easel();
  await asked(e, e.srv);

  expect(await e.run({ kind: "deliveries", canvas: "flow", n: "1" })).toBe(0);
  expect(e.text()).toBe(
    "no delivery: the server has no channel. An agent that asks for work takes the request.\n",
  );
  expect(await set(e)).toBe(0);
  e.text();
  expect(await e.run({ kind: "deliveries", canvas: "flow", n: "1" })).toBe(0);
  expect(e.text()).toBe("no delivery yet\n");

  e.srv.clock.advance(10);
  expect(
    await e.scope.run(queue.viewer["request.edit"], {
      input: { canvas: "flow", n: 1, text: "Move it to the left." },
    }),
  ).toEqual({ kind: "edited" });
  await rounds(e.srv, 1000);
  expect(await e.run({ kind: "deliveries", canvas: "flow", n: "1" })).toBe(0);
  expect(e.text()).toMatch(/^gh\twaiting since \S+Z\tsent \S+Z\tattempts 1\tissue #1\n$/);

  e.github.failWith(() => ({ status: 502, message: "Bad Gateway" }));
  e.srv.clock.advance(10);
  expect(
    await e.scope.run(queue.viewer["request.close"], { input: { canvas: "flow", n: 1 } }),
  ).toEqual({ kind: "closed" });
  await rounds(e.srv, 1000);
  expect(await e.run({ kind: "deliveries", canvas: "flow", n: "1" })).toBe(0);
  expect(e.text().split("\n")[1]).toMatch(
    /^gh\tout after \S+Z\tpending \S+Z\tattempts 1\tno issue\tgithub 502: Bad Gateway$/,
  );

  expect(await e.run({ kind: "deliveries", canvas: "flow", n: "9" })).toBe(1);
  expect(e.text()).toBe("gone: no such request. Nothing was written.\n");
  expect(await e.run({ kind: "deliveries", canvas: "flow", n: "x" })).toBe(64);
  expect(await e.run({ kind: "deliveries", canvas: "Flow!", n: "1" })).toBe(65);
});

test("each channel command on a server that is gone exits 69, unreachable", async () => {
  const e = await easel(true);
  await e.srv.server.close();
  const commands: ChannelCommand[] = [
    { kind: "ls" },
    { kind: "rm", name: "gh" },
    { kind: "deliveries", canvas: "flow", n: "1" },
    {
      kind: "set",
      name: "gh",
      channel: "github",
      repo: "acme/design",
      label: "easel",
      tokenFile: e.tokenFile,
    },
  ];
  for (const command of commands) {
    expect(await e.run(command)).toBe(69);
    expect(JSON.parse(e.text())).toEqual({ unreachable: origin });
  }
});
