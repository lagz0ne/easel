import { createHash } from "node:crypto";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { accessServer, browserCodes, logins } from "@/access/store.server";
import { frames, pages } from "@/frames/contract";
import { canvases, framesServer } from "@/frames/store.server";
import { homeRows, waitingCodes } from "@/home/contract";
import { homeServer, hourMs } from "@/home/feed.server";
import { runtimeNames } from "@/kit/runtime";
import type { BuiltRuntime } from "@/kit/runtime.server";
import { requests } from "@/queue/cells";
import type { Request } from "@/queue/cells";
import { queueServer } from "@/queue/store.server";
import { noAnswerMs } from "@/viewer/follow";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const start = 1_800_000_000_000;

function fakeRuntime(): BuiltRuntime {
  const imports = Object.fromEntries(
    runtimeNames.map((name) => [name, `${name.replace(/^@/, "").replaceAll("/", "__")}.js`]),
  );
  const files = Object.fromEntries(Object.values(imports).map((file) => [file, "export {};"]));
  return { sha: createHash("sha256").update("fake").digest("hex"), imports, files };
}

const putCanvas = operation({
  label: "test.putCanvas",
  input: z.object({ key: z.string(), name: z.string(), created: z.number() }),
  depends: { canvases: canvases.atScope.controller, pages: pages.atScope.controller },
  run: ({ canvases, pages }, { input }) => {
    canvases.set({ ...input, shared: false });
    pages.set({ canvas: input.key, key: "page-1", name: "Page 1", frames: 0, order: 0 });
  },
});

const dropCanvas = operation({
  label: "test.dropCanvas",
  input: z.string(),
  depends: { canvases: canvases.atScope.controller },
  run: ({ canvases }, { input }) => canvases.delete({ key: input }),
});

const putFrame = operation({
  label: "test.putFrame",
  input: z.object({ canvas: z.string(), id: z.string(), version: z.number() }),
  depends: { frames: frames.atScope.controller },
  run: ({ frames }, { input }) =>
    frames.set({
      ...input,
      name: "One",
      page: "page-1",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      status: "exploring",
    }),
});

const putRequest = operation({
  label: "test.putRequest",
  input: z.object({ canvas: z.string(), n: z.number(), status: z.string(), updated: z.number() }),
  depends: { requests: requests.atScope.controller },
  run: ({ requests }, { input }) => {
    const row: Request = {
      canvas: input.canvas,
      id: `r${input.n}`,
      n: input.n,
      frameId: null,
      version: null,
      kit: 0,
      x: 0,
      y: 0,
      page: "page-1",
      author: "ann",
      key: `k${input.n}`,
      status: z.enum(["open", "asking", "resolved", "person", "closed"]).parse(input.status),
      claimedBy: null,
      claimedUntil: null,
      claimedAt: null,
      tries: 0,
      queuedAt: input.updated,
      acceptedBy: null,
      created: input.updated,
      updated: input.updated,
    };
    requests.set(row);
  },
});

const putCodes = operation({
  label: "test.putCodes",
  input: z.object({ state: z.enum(["pending", "approved"]), expiresAt: z.number() }),
  depends: { logins: logins.atScope.controller, codes: browserCodes.atScope.controller },
  run: ({ logins, codes }, { input }) => {
    const common = { name: "bo", address: "127.0.0.1", since: start, ...input };
    logins.set({ ...common, request: "1".repeat(32), code: "BCDF-GHJK", digest: "a".repeat(64) });
    codes.set({ ...common, request: "2".repeat(32), code: "LMNP-QRST" });
  },
});

const readRows = operation({
  label: "test.readRows",
  depends: { rows: homeRows.atScope.controller },
  run: ({ rows }) => rows.get().toSorted((a, b) => a.canvas.localeCompare(b.canvas)),
});

const readCodes = operation({
  label: "test.readCodes",
  depends: { codes: waitingCodes.atScope.controller },
  run: ({ codes }) => codes.get().toSorted((a, b) => a.code.localeCompare(b.code)),
});

const settle = () => new Promise((done) => setTimeout(done, 20));

async function boot() {
  const clock = makeTestClock({ now: start });
  const stdout = { write: () => true };
  const scope = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout, runtime: fakeRuntime() }),
      queueServer({ stdout }),
      homeServer(),
    ],
  }).ready;
  closers.push(() => scope.close());

  return { scope, clock };
}

test("each canvas is a row with its counts of frames and pages; its inbox counts the requests of Waits for you: a question, a result to check, a request that needs a person", async () => {
  const { scope } = await boot();
  scope.run(putCanvas, { input: { key: "shop", name: "Shop", created: start } });
  scope.run(putFrame, { input: { canvas: "shop", id: "f1", version: 1 } });
  scope.run(putFrame, { input: { canvas: "shop", id: "f2", version: 1 } });
  for (const [n, status] of ["asking", "resolved", "person", "open", "closed"].entries()) {
    scope.run(putRequest, { input: { canvas: "shop", n, status, updated: start } });
  }
  await settle();

  expect(scope.run(readRows)).toEqual([
    { canvas: "shop", name: "Shop", frames: 2, pages: 1, changed: start, inbox: 3 },
  ]);
});

test("the inbox moves live: an answer to a question takes it out; a new canvas shows; a removed canvas goes", async () => {
  const { scope } = await boot();
  scope.run(putCanvas, { input: { key: "shop", name: "Shop", created: start } });
  scope.run(putRequest, { input: { canvas: "shop", n: 1, status: "asking", updated: start } });
  scope.run(putRequest, { input: { canvas: "shop", n: 2, status: "asking", updated: start } });
  await settle();
  expect(scope.run(readRows).map((row) => row.inbox)).toEqual([2]);

  scope.run(putRequest, { input: { canvas: "shop", n: 1, status: "open", updated: start + 1 } });
  scope.run(putCanvas, { input: { key: "blog", name: "Blog", created: start } });
  await settle();
  expect(scope.run(readRows).map((row) => [row.canvas, row.inbox])).toEqual([
    ["blog", 0],
    ["shop", 1],
  ]);

  scope.run(dropCanvas, { input: "blog" });
  await settle();
  expect(scope.run(readRows).map((row) => row.canvas)).toEqual(["shop"]);
});

test("a result with no answer for 3 days leaves the inbox at the next hourly look", async () => {
  const { scope, clock } = await boot();
  scope.run(putCanvas, { input: { key: "shop", name: "Shop", created: start } });
  scope.run(putRequest, { input: { canvas: "shop", n: 1, status: "resolved", updated: start } });
  await settle();
  expect(scope.run(readRows)[0]?.inbox).toBe(1);

  clock.advance(noAnswerMs + hourMs);
  await settle();
  expect(scope.run(readRows)[0]?.inbox).toBe(0);
});

test("the last change of a canvas moves when one of its frames changes, and not when nothing changed", async () => {
  const { scope, clock } = await boot();
  scope.run(putCanvas, { input: { key: "shop", name: "Shop", created: start } });
  scope.run(putFrame, { input: { canvas: "shop", id: "f1", version: 1 } });
  await settle();
  const first = scope.run(readRows)[0]?.changed;

  clock.advance(5_000);
  scope.run(putFrame, { input: { canvas: "shop", id: "f1", version: 1 } });
  await settle();
  expect(scope.run(readRows)[0]?.changed).toBe(first);

  scope.run(putFrame, { input: { canvas: "shop", id: "f1", version: 2 } });
  await settle();
  expect(scope.run(readRows)[0]?.changed).toBe(start + 5_000);
});

test("the codes that wait: a pending code of the CLI and of a browser show, with no request id; an approved one goes; a code goes when it runs out", async () => {
  const { scope, clock } = await boot();
  scope.run(putCodes, { input: { state: "pending", expiresAt: start + 60_000 } });
  await settle();
  expect(scope.run(readCodes)).toEqual([
    {
      code: "BCDF-GHJK",
      name: "bo",
      since: start,
      expiresAt: start + 60_000,
      browser: false,
      user: false,
    },
    {
      code: "LMNP-QRST",
      name: "bo",
      since: start,
      expiresAt: start + 60_000,
      browser: true,
      user: false,
    },
  ]);
  expect(JSON.stringify(scope.run(readCodes))).not.toContain("1".repeat(32));

  clock.advance(60_000);
  await settle();
  expect(scope.run(readCodes)).toEqual([]);

  scope.run(putCodes, { input: { state: "pending", expiresAt: start + 120_000 } });
  await settle();
  scope.run(putCodes, { input: { state: "approved", expiresAt: start + 120_000 } });
  await settle();
  expect(scope.run(readCodes)).toEqual([]);
});
