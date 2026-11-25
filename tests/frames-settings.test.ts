import { createHash, randomBytes } from "node:crypto";

import { bunSqlite } from "@tinkered/bun/sqlite";
import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import type { Scope, Tag } from "@tinkered/core";
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { access } from "@/access";
import { user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { arrangeGap, sectionHead } from "@/frames/arrange";
import { findingsOf, layoutPage } from "@/frames/arrange.server";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { clearance, frameGap, framesDefaults, sectionSpace, touchSpace } from "@/frames/settings";
import { framesServer } from "@/frames/store.server";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const screen = { w: 390, h: 844 };

async function boot(tags: Tag.Bindings, install: { frameGap?: number }) {
  const out: string[] = [];
  const stdout = { write: (chunk: string) => out.push(chunk) };
  const server = await createScope({
    clock: makeTestClock({ now: 1_800_000_000_000 }),
    tags,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      bunSqlite({ file: ":memory:" }),
      accessServer({ mode: "approve", origin: null, stdout, trusted: [], durable: false }),
      framesServer({ stdout, ...install }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      memory.server({ services: [access.login, access.user, frames.api, frames.board] }),
    ],
  }).ready;
  closers.push(() => server.close());
  return { server, setupCode: () => /setup code: (\S+)/.exec(out.join(""))?.[1] ?? "" };
}

async function client(server: Scope.Handle, token?: string) {
  const meta = operation({
    label: "test.settingsMeta",
    run: async (): Promise<Record<string, string>> =>
      token ? { authorization: `Bearer ${token}` } : {},
  });
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memory.client({ peer: server, headers: { "x-easel-peer": "198.51.100.1" }, meta }),
      access.login({ remote: memory.client }),
      frames.api({ remote: memory.client }),
      frames.board({ read: memory.client }),
    ],
  }).ready;
  closers.push(() => scope.close());
  return scope;
}

async function easel(tags: Tag.Bindings, install: { frameGap?: number } = {}) {
  const srv = await boot(tags, install);
  const text = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(text).digest("hex");
  const login = await client(srv.server);
  await login.run(access.login["login.setup"], {
    input: { name: "ann", code: srv.setupCode(), digest },
  });

  const scope = await client(srv.server, text);
  const api = frames.api;
  await scope.run(api["canvas.create"], { input: { name: "flow" } });

  const made = async (input: { name: string; section?: string }) => {
    const answer = await scope.run(api["frame.put"], {
      input: { canvas: "flow", html: "<p>x</p>", size: screen, ...input },
    });
    if (answer.kind !== "created") throw new Error(answer.kind);
    return answer;
  };
  const boxes = async () => {
    const answer = await scope.run(api["frame.list"], { input: { canvas: "flow" } });
    if (answer.kind !== "found") throw new Error(answer.kind);
    return new Map(answer.frames.map((f) => [f.id, f]));
  };
  return { made, boxes };
}

async function scope(tags: Tag.Bindings) {
  const s = await createScope({
    tags,
    capsules: [exits({ file: process.env.TINKER_EXITS })],
  }).ready;
  closers.push(() => s.close());
  return s;
}

const flow = (key: string, ord: number) => ({
  key,
  name: key.toUpperCase(),
  ord,
  atX: null,
  atY: null,
  wrap: null,
  gap: arrangeGap,
});

test("the frames tags keep their old defaults", () => {
  expect(framesDefaults).toMatchObject({
    frameGap: 80,
    sectionSpace: 160,
    clearance: 80,
    touchSpace: 16,
  });
});

test("framesServer installed with frameGap 200 and no root tag puts a new frame with no place 200 px right of the last frame", async () => {
  const e = await easel([], { frameGap: 200 });
  const first = await e.made({ name: "One" });
  const next = await e.made({ name: "Two" });

  const all = await e.boxes();
  expect(all.get(first.id)).toMatchObject({ x: 0, y: 0 });
  expect(all.get(next.id)).toMatchObject({ x: screen.w + 200, y: 0 });
});

test("the tag frames.frameGap at 200 puts a new frame with no place 200 px right of the last frame", async () => {
  const e = await easel([frameGap(200)]);
  const first = await e.made({ name: "One" });
  const next = await e.made({ name: "Two" });

  const all = await e.boxes();
  expect(framesDefaults.frameGap).not.toBe(200);
  expect(all.get(first.id)).toMatchObject({ x: 0, y: 0 });
  expect(all.get(next.id)).toMatchObject({ x: screen.w + 200, y: 0 });
});

test("the tag frames.sectionSpace at 300 puts the next section 300 px under the section before it", async () => {
  const e = await easel([sectionSpace(300)]);
  await e.made({ name: "Pay", section: "Checkout" });
  const other = await e.made({ name: "Login", section: "Sign in" });

  expect(framesDefaults.sectionSpace).not.toBe(300);
  expect((await e.boxes()).get(other.id)).toMatchObject({
    x: 0,
    y: sectionHead + screen.h + 300 + sectionHead,
  });
});

test("the tag frames.clearance at 200 puts a section in the flow 200 px under an exact frame that it would come near", async () => {
  const s = await scope([clearance(200)]);
  const fixed = [{ id: "x", x: 500, y: 10, w: 100, h: 300 }];
  const slots = [{ id: "a", section: "flow", col: 0, row: 0, w: 600, h: 50 }];
  const laid = s.run(layoutPage, { input: { sections: [flow("flow", 0)], slots, fixed } });

  expect(framesDefaults.clearance).not.toBe(200);
  expect(laid.sections.find((one) => one.key === "flow")?.y).toBe(310 + 200);
});

test("the tag frames.touchSpace at 40 gives a touch for two frames 30 px apart, and the default gives none", async () => {
  const pair = [
    { id: "a", x: 0, y: 0, w: 100, h: 100, section: null },
    { id: "b", x: 130, y: 0, w: 100, h: 100, section: null },
  ];
  const wide = await scope([touchSpace(40)]);
  const plain = await scope([]);

  expect(framesDefaults.touchSpace).toBeLessThan(30);
  expect(wide.run(findingsOf, { input: { frames: pair, sections: [] } })).toEqual([
    { touch: ["a", "b"] },
  ]);
  expect(plain.run(findingsOf, { input: { frames: pair, sections: [] } })).toEqual([]);
});
