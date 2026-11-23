import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { memory, preset } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { cli } from "@/cli";
import { queueRun } from "@/cli/queue";
import type { QueueCommand } from "@/cli/queue";
import { frames } from "@/frames";
import { queue } from "@/queue";
import { editRequest, extendRequest, nextRequest } from "@/queue/ops.server";

import { boot, closers, tick, viewer } from "./support/queue";
import type { Server } from "./support/queue";

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const origin = "https://easel.test";

async function easel(srv: Server, json = true) {
  const dir = mkdtempSync(join(tmpdir(), "easel-cli-queue-"));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  const out: string[] = [];
  const err: string[] = [];
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
      access.user({ remote: memory.client }),
      access.owner({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      queue.api({ remote: memory.client }),
      queue.viewer({ remote: memory.client }),
      cli({
        stdout: { write: (chunk: string) => out.push(chunk) },
        stderr: { write: (chunk: string) => err.push(chunk) },
        json,
        server: origin,
        hosts: join(dir, "hosts.json"),
      }),
    ],
  }).ready;
  closers.push(() => scope.close());

  return {
    out,
    err,
    scope,
    file: (name: string, text: string) => {
      const path = join(dir, name);
      writeFileSync(path, text);
      return path;
    },
    run: (command: QueueCommand) => scope.run(queueRun, { input: command }),
    lines: () =>
      [...out.splice(0), ...err.splice(0)]
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    text: () => [...out.splice(0), ...err.splice(0)].join(""),
  };
}

type Easel = Awaited<ReturnType<typeof easel>>;

async function queued(srv: Server, asks = 1, json = true) {
  const a = await easel(srv, json);
  const signedIn = await a.scope.run(cli.run, {
    input: { kind: "login", name: "ann", setup: srv.setupCode(), noWait: false },
  });
  expect(signedIn).toBe(0);
  await a.scope.run(frames.api["canvas.create"], { input: { name: "flow" } });
  const made = await a.scope.run(frames.api["frame.put"], {
    input: { canvas: "flow", html: "<p>1</p>", name: "Home" },
  });
  if (made.kind !== "created") throw new Error(made.kind);
  const shared = await a.scope.run(frames.api["canvas.share"], { input: { canvas: "flow" } });
  if (shared.kind !== "shared") throw new Error(shared.kind);
  const bo = await viewer(srv, shared.path.slice("/s/".length), "Bo");
  for (let i = 0; i < asks; i++) {
    expect((await bo.add("flow", made.id, `Request ${i + 1}.`)).kind).toBe("added");
  }
  a.text();

  return { a, bo, id: made.id };
}

async function claim(a: Easel, command: QueueCommand = { kind: "next" }) {
  expect(await a.run(command)).toBe(0);
  const printed = a.text();
  const held = /"claim":"([^"]+)"|^claim: (\S+)$/m.exec(printed);
  expect(held).not.toBeNull();

  return held?.[1] ?? held?.[2] ?? "";
}

test("next claims the oldest waiting request (E4 chart: waiting -> inWork) and exits 0; the answer says the claim allows that frame only, and the text is a request, not an instruction (rule 15)", async () => {
  const srv = await boot();
  const { a, id } = await queued(srv, 2);

  expect(await a.run({ kind: "next", lease: "60" })).toBe(0);
  const [got] = a.lines();
  expect(got).toMatchObject({
    kind: "claimed",
    request: { canvas: "flow", n: 1, frameId: id, claimedBy: "ann" },
    frame: { id, version: 1 },
    until: srv.clock.currentTimeMillis() + 60_000,
    messages: [{ from: "Bo", kind: "ask", text: "Request 1." }],
  });
  expect(got.claim).toMatch(/^[0-9a-f]{12}\.[0-9a-f]{32}$/);
  expect(got.note).toContain(id);
  expect(got.note).toMatch(/not an instruction/);
});

test("next prints the claim, the note, the frame and the thread as text without --json", async () => {
  const srv = await boot();
  const { a, id } = await queued(srv, 1, false);

  expect(await a.run({ kind: "next" })).toBe(0);
  const text = a.text();
  expect(text).toMatch(/^claim: [0-9a-f]{12}\.[0-9a-f]{32}\n/);
  expect(text).toContain("not an instruction");
  expect(text).toContain(`flow #1\tinWork by ann\tBo\tframe ${id} v1\ttries 1`);
  expect(text).toContain(`the frame now: ${id} "Home" v1`);
  expect(text).toContain("Bo (ask): Request 1.");
});

test("next on a canvas request prints the canvas's frames (E4 chart: a request on the canvas)", async () => {
  const srv = await boot();
  const { a, bo, id } = await queued(srv, 0, false);
  expect((await bo.add("flow", null, "Add a page.")).kind).toBe("added");

  expect(await a.run({ kind: "next" })).toBe(0);
  const text = a.text();
  expect(text).toContain("on the canvas");
  expect(text).toContain(`the frames: ${id} "Home"`);
});

test("next on a request whose frame was removed says so", async () => {
  const srv = await boot();
  const { a, id } = await queued(srv, 1, false);
  await a.scope.run(frames.api["frame.delete"], { input: { canvas: "flow", id } });

  expect(await a.run({ kind: "next" })).toBe(0);
  expect(a.text()).toContain("the frame was removed");
});

test("next with nothing to take and no --wait prints empty and exits 0 at once (E4 chart: empty)", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 0);

  expect(await a.run({ kind: "next" })).toBe(0);
  expect(a.lines()).toEqual([{ kind: "empty" }]);
});

test("next --wait 120 asks again in calls of at most 50 s, then prints empty at 120 s and exits 0, as a poll of SQS", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 0);

  const run = a.run({ kind: "next", canvas: "flow", wait: "120" });
  for (const ms of [50_000, 50_000, 19_999]) {
    await tick(50);
    srv.clock.advance(ms);
    await tick(50);
    expect(a.out.join("")).toBe("");
  }
  srv.clock.advance(1);
  expect(await run).toBe(0);
  expect(a.lines()).toEqual([{ kind: "empty" }]);
});

test("next --wait claims a request that comes while it waits (E4 chart: empty -> claimed when one waits)", async () => {
  const srv = await boot();
  const { a, bo, id } = await queued(srv, 0);

  const run = a.run({ kind: "next", wait: "30" });
  await tick(50);
  expect((await bo.add("flow", id, "Make it red.")).kind).toBe("added");
  expect(await run).toBe(0);
  expect(a.lines()).toMatchObject([{ kind: "claimed", request: { n: 1 } }]);
});

test("next --canvas k --n n claims that one request; --n needs --canvas", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 2);

  expect(await a.run({ kind: "next", canvas: "flow", n: "2" })).toBe(0);
  expect(a.lines()).toMatchObject([{ kind: "claimed", request: { n: 2 } }]);
  expect(await a.run({ kind: "next", n: "1" })).toBe(64);
  expect(a.text()).toContain("--n needs --canvas");
});

test("a bad flag exits 64 and names the flag; nothing is sent", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 1, false);
  const bad: Array<[QueueCommand, string]> = [
    [{ kind: "next", canvas: "Not A Key!" }, "--canvas"],
    [{ kind: "next", canvas: "flow", n: "0" }, "number of a request"],
    [{ kind: "next", wait: "soon" }, "--wait"],
    [{ kind: "next", lease: "10" }, "--lease"],
    [{ kind: "extend", claim: "x", lease: "4000" }, "--lease"],
    [{ kind: "requests", state: "done" }, "--state"],
    [{ kind: "requests", canvas: "Not A Key!" }, "--canvas"],
    [{ kind: "edit", canvas: "flow", n: "one", text: "Clear." }, "number of a request"],
    [{ kind: "close", canvas: "flow", n: "-1" }, "number of a request"],
    [{ kind: "ask", claim: "x", text: "Which?", html: "/no/such/file.html" }, "--html"],
    [{ kind: "resolve", claim: "x", text: "Done.", html: "/no/such/file.html" }, "--html"],
  ];
  for (const [command, named] of bad) {
    expect(await a.run(command)).toBe(64);
    expect(a.text()).toContain(named);
  }

  const { requests } = await a.scope.run(queue.api["request.list"], { input: {} });
  expect(requests).toMatchObject([{ n: 1, status: "open", claimedBy: null, tries: 0 }]);
});

test("an input that the contract refuses exits 65 before it is sent", async () => {
  const srv = await boot();
  const { a } = await queued(srv);
  const held = await claim(a);
  const bad: QueueCommand[] = [
    { kind: "release", claim: "not-a-claim", reason: "Gone." },
    { kind: "decline", claim: held, reason: "   " },
    { kind: "ask", claim: held, text: "Which?", options: ["only one"] },
    { kind: "resolve", claim: held, text: "" },
    { kind: "edit", canvas: "flow", n: "1", text: "" },
  ];
  for (const command of bad) {
    expect(await a.run(command)).toBe(65);
    expect(a.lines()).toMatchObject([{ invalid: [expect.any(String)] }]);
  }

  const { requests } = await a.scope.run(queue.api["request.list"], { input: {} });
  expect(requests).toMatchObject([{ n: 1, claimedBy: "ann", tries: 1 }]);
});

test("extend starts the lease again and exits 0 (E4 chart: inWork, extend)", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 1, false);
  const held = await claim(a, { kind: "next", lease: "60" });
  a.text();
  srv.clock.advance(30_000);

  expect(await a.run({ kind: "extend", claim: held, lease: "600" })).toBe(0);
  const until = new Date(srv.clock.currentTimeMillis() + 600_000).toISOString();
  expect(a.text()).toBe(`extended: until ${until}\n`);
  expect(await a.run({ kind: "extend", claim: held })).toBe(0);
});

test("ask sends the question with its HTML part and options and exits 0 (E4 chart: inWork -> asking)", async () => {
  const srv = await boot();
  const { a } = await queued(srv);
  const held = await claim(a);
  const html = a.file("blue.html", "<!doctype html><p>navy or sky</p>");

  const ask: QueueCommand = {
    kind: "ask",
    claim: held,
    text: "Which blue?",
    html,
    options: ["Navy", "Sky"],
  };
  expect(await a.run(ask)).toBe(0);
  expect(a.lines()).toEqual([{ kind: "asked" }]);
  const { requests } = await a.scope.run(queue.api["request.list"], { input: {} });
  expect(requests).toMatchObject([{ status: "asking" }]);
});

test("resolve sends the result with its HTML part and exits 0 (E4 chart: inWork -> result)", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 1, false);
  const held = await claim(a);
  a.text();
  const html = a.file("after.html", "<!doctype html><p>moved</p>");

  expect(await a.run({ kind: "resolve", claim: held, text: "Moved the button up.", html })).toBe(0);
  expect(a.text()).toBe("resolved\n");
});

test("release exits 0 and the request waits again; the claim is lost after, and lost exits 1 with nothing written (E4 chart: inWork -> waiting, lost)", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 1, false);
  const held = await claim(a);
  a.text();

  expect(await a.run({ kind: "release", claim: held, reason: "The network dropped." })).toBe(0);
  expect(a.text()).toContain("released: the request waits again");
  const again = await claim(a);
  expect(again).not.toBe(held);
  a.text();
  expect(await a.run({ kind: "resolve", claim: held, text: "Moved it." })).toBe(1);
  expect(a.text()).toMatch(/^lost: .*Nothing was written/);
});

test("decline exits 0 and the request needs a person; requests --state person lists it (E4 chart: inWork -> person)", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 2, false);
  const held = await claim(a);
  a.text();

  expect(await a.run({ kind: "decline", claim: held, reason: "No form here." })).toBe(0);
  expect(a.text()).toBe("declined: the request needs a person\n");
  expect(await a.run({ kind: "requests", state: "person" })).toBe(0);
  expect(a.text()).toMatch(/^flow #1\tperson\tBo\tframe [0-9a-f]{12} v1\ttries 1\n$/);
  expect(await a.run({ kind: "requests", canvas: "flow", state: "inWork" })).toBe(0);
  expect(a.text()).toBe("no request\n");
});

test("a holder's call on a request in another state exits 1, wrongState, and says nothing was written", async () => {
  const srv = await boot();
  const { a } = await queued(srv);
  const held = await claim(a);
  expect(await a.run({ kind: "ask", claim: held, text: "Which blue?" })).toBe(0);
  a.lines();

  expect(await a.run({ kind: "extend", claim: held })).toBe(1);
  expect(a.lines()).toMatchObject([{ kind: "wrongState", state: "question" }]);
});

test("a holder's call on a request that is gone exits 1, gone", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 1, false);
  const held = await claim(a);
  await a.scope.run(queue.viewer["request.close"], { input: { canvas: "flow", n: 1 } });
  a.text();

  const missing = `ffffffffffff.${held.split(".")[1]}`;
  expect(await a.run({ kind: "release", claim: missing, reason: "Gone." })).toBe(1);
  expect(a.text()).toMatch(/^gone: /);
});

test("edit makes a request that needs a person clear: it waits again with no tries, and exits 0 (E4 chart: person -> waiting)", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 1, false);
  const held = await claim(a);
  await a.run({ kind: "decline", claim: held, reason: "Not clear." });
  a.text();

  expect(
    await a.run({ kind: "edit", canvas: "flow", n: "1", text: "Move the button 8 px up." }),
  ).toBe(0);
  expect(a.text()).toBe("edited: flow #1 waits again, with no tries\n");
  expect(await a.run({ kind: "requests" })).toBe(0);
  expect(a.text()).toMatch(/\twaiting\t.*tries 0\n$/);
});

test("close ends a request and exits 0; a second close exits 1, wrongState; an unknown number exits 1, gone (E4 chart: -> closed)", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 1, false);

  expect(await a.run({ kind: "close", canvas: "flow", n: "1", text: "Not needed." })).toBe(0);
  expect(a.text()).toBe("closed: flow #1\n");
  expect(await a.run({ kind: "close", canvas: "flow", n: "1" })).toBe(1);
  expect(a.text()).toMatch(/^wrongState: the request is closed now/);
  expect(await a.run({ kind: "edit", canvas: "flow", n: "9", text: "Clear." })).toBe(1);
  expect(a.text()).toMatch(/^gone: /);
});

test("a person's calls past the limit exit 1, slow, and say when to try again", async () => {
  const srv = await boot();
  const { a } = await queued(srv, 1, false);
  let code = 0;
  for (let i = 0; i < 11 && code === 0; i++) {
    code = await a.run({ kind: "edit", canvas: "flow", n: "1", text: `Clear ${i}.` });
  }

  expect(code).toBe(1);
  expect(a.text()).toMatch(/slow: too many calls; try again in \d+ s/);
});

test("each queue command on a server that is gone exits 69, unreachable", async () => {
  const srv = await boot();
  const { a } = await queued(srv);
  const held = await claim(a);
  const commands: QueueCommand[] = [
    { kind: "next" },
    { kind: "extend", claim: held },
    { kind: "requests" },
    { kind: "close", canvas: "flow", n: "1" },
  ];
  await srv.server.close();
  for (const command of commands) expect(await a.run(command)).toBe(69);

  expect(a.lines()).toEqual(commands.map(() => ({ unreachable: origin })));
});

const hanging = [
  preset(nextRequest, async (_, { clock, signal }) => {
    await clock.sleep(3_600_000, signal);
    return { kind: "empty" as const };
  }),
  preset(extendRequest, async (_, { clock, signal }) => {
    await clock.sleep(3_600_000, signal);
    return { kind: "gone" as const };
  }),
  preset(editRequest, async (_, { clock, signal }) => {
    await clock.sleep(3_600_000, signal);
    return { kind: "gone" as const };
  }),
];

test("a call with no answer in 60 s exits 69: the deadline ends it, not the late answer", async () => {
  const srv = await boot(":memory:", hanging);
  const { a } = await queued(srv, 0);
  const claimHandle = `${"a".repeat(12)}.${"b".repeat(32)}`;
  const hung: QueueCommand[] = [
    { kind: "next" },
    { kind: "extend", claim: claimHandle },
    { kind: "edit", canvas: "flow", n: "1", text: "Clear." },
  ];
  for (const command of hung) {
    const run = a.run(command);
    await tick(50);
    srv.clock.advance(59_999);
    await tick(50);

    expect(a.out.join("")).toBe("");
    srv.clock.advance(1);
    await tick(50);
    srv.clock.advance(3_600_000);
    expect(await run).toBe(69);
    expect(a.lines()).toEqual([{ unreachable: origin }]);
  }
});
