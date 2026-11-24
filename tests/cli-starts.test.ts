import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { cli } from "@/cli";
import { channelRun } from "@/cli/channels";
import { startsRun } from "@/cli/starts";
import type { StartsCommand } from "@/cli/starts";
import { frames } from "@/frames";
import { queue } from "@/queue";

import { inbox, natsServer } from "./support/nats";
import { boot, closers, rounds, viewer } from "./support/queue";

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

async function easel(json = false) {
  const nats = await natsServer();
  closers.push(() => nats.close());
  const srv = await boot(":memory:", [], { agreement: true });
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-starts-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
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
      queue.starts({ remote: memory.client }),
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
  const saved = await scope.run(queue.channels["channel.set"], {
    input: {
      name: "loop",
      kind: "nats",
      url: nats.url,
      subject: "easel.requests",
      seed: nats.seed,
      inbox,
    },
  });
  expect(saved).toEqual({ kind: "saved" });

  await scope.run(frames.api["canvas.create"], { input: { name: "flow" } });
  const made = await scope.run(frames.api["frame.put"], {
    input: { canvas: "flow", html: "<p>1</p>", name: "Home" },
  });
  if (made.kind !== "created") throw new Error(made.kind);
  const shared = await scope.run(frames.api["canvas.share"], { input: { canvas: "flow" } });
  if (shared.kind !== "shared") throw new Error(shared.kind);
  const bo = await viewer(srv, shared.path.slice("/s/".length), "Bo");
  expect((await bo.add("flow", made.id)).kind).toBe("added");
  out.length = 0;

  return {
    srv,
    scope,
    run: (command: StartsCommand) => scope.run(startsRun, { input: command }),
    text: () => out.splice(0).join(""),
  };
}

test("easel agree agrees a request of a viewer and exits 0; a second agree says agreed again; no request exits 1, gone; a bad number exits 64; a closed request exits 1, wrongState", async () => {
  const e = await easel();

  expect(await e.run({ kind: "agree", canvas: "flow", n: "1" })).toBe(0);
  expect(e.text()).toBe(
    "agreed: flow#1 goes to the agents now. A new text of a viewer needs a new agreement.\n",
  );
  expect(await e.run({ kind: "agree", canvas: "flow", n: "1" })).toBe(0);
  e.text();

  expect(await e.run({ kind: "agree", canvas: "flow", n: "9" })).toBe(1);
  expect(e.text()).toBe("gone: no such request. Nothing was written.\n");
  expect(await e.run({ kind: "agree", canvas: "flow", n: "x" })).toBe(64);
  expect(await e.run({ kind: "agree", canvas: "Flow!", n: "1" })).toBe(65);
  e.text();

  await e.scope.run(queue.viewer["request.close"], { input: { canvas: "flow", n: 1 } });
  expect(await e.run({ kind: "agree", canvas: "flow", n: "1" })).toBe(1);
  expect(e.text()).toBe(
    "wrongState: flow#1 is closed. Only a request that waits or is in work takes an agreement.\n",
  );
});

test("easel channel limits saves the limits of a nats channel and exits 0; a limit that is not a whole number exits 64, one over the most exits 65, and no channel exits 1, gone", async () => {
  const e = await easel();

  expect(await e.run({ kind: "limits", name: "loop", running: "3", perDay: "50" })).toBe(0);
  expect(e.text()).toBe(
    "saved: loop starts at most 3 agents at the same time, and 50 in a UTC day. Its starter reads them within 30 s.\n",
  );
  expect(await e.run({ kind: "limits", name: "loop", running: "x" })).toBe(64);
  expect(await e.run({ kind: "limits", name: "loop", running: "21" })).toBe(65);
  e.text();
  expect(await e.run({ kind: "limits", name: "lost", running: "1" })).toBe(1);
  expect(e.text()).toBe("gone: no such channel. Nothing was written.\n");
});

test("easel channel report sends the state, a start and a failed start of the starter, and prints the limits; easel deliveries then shows the start; a report to no channel exits 1", async () => {
  const e = await easel(true);
  expect(await e.run({ kind: "agree", canvas: "flow", n: "1" })).toBe(0);
  await rounds(e.srv, 1000);
  const deliveries = await e.scope.run(queue.api["request.deliveries"], {
    input: { canvas: "flow", n: 1 },
  });
  if (deliveries.kind !== "listed") throw new Error(deliveries.kind);
  const ref = `flow:1:${deliveries.deliveries[0]?.period ?? 0}`;
  e.text();

  expect(
    await e.run({ kind: "report", name: "loop", running: "1", today: "2", at: "running" }),
  ).toBe(0);
  expect(JSON.parse(e.text())).toEqual({ kind: "noted", limits: { running: 2, perDay: 20 } });
  expect(
    await e.run({
      kind: "report",
      name: "loop",
      failed: ref,
      cause: "paseo run: no provider",
      retry: "60000",
    }),
  ).toBe(0);
  expect(await e.run({ kind: "report", name: "loop", started: ref, agent: "agent-7" })).toBe(0);
  e.text();

  expect(
    await e.scope.run(channelRun, { input: { kind: "deliveries", canvas: "flow", n: "1" } }),
  ).toBe(0);
  expect(e.text()).toContain('"agent":"agent-7"');

  expect(await e.run({ kind: "report", name: "lost", running: "0", today: "0" })).toBe(1);
  expect(JSON.parse(e.text())).toEqual({ kind: "gone" });
  expect(await e.run({ kind: "report", name: "loop", running: "-1", today: "0" })).toBe(65);
});

test("easel agree runs through the command of the CLI as a starts command, as cmds/easel.ts gives it", async () => {
  const e = await easel();

  expect(
    await e.scope.run(cli.run, {
      input: { kind: "starts", act: { kind: "agree", canvas: "flow", n: "1" } },
    }),
  ).toBe(0);
  expect(e.text()).toContain("agreed: flow#1");
});

test("each starts command on a server that is gone exits 69, unreachable", async () => {
  const e = await easel(true);
  await e.srv.server.close();
  const commands: StartsCommand[] = [
    { kind: "agree", canvas: "flow", n: "1" },
    { kind: "limits", name: "loop", running: "3" },
    { kind: "report", name: "loop", running: "0", today: "0" },
  ];

  for (const command of commands) expect(await e.run(command)).toBe(69);
});
