import { afterEach, expect, test } from "vite-plus/test";

import { release } from "@/release";

import {
  boot,
  claimOf,
  closers,
  natsChannel,
  sharedFlow,
  viewer,
  watchQueue,
} from "./support/queue";
import type { Client, Server } from "./support/queue";

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const liveBuild = 300;

async function accepted(more: { canvases?: string[]; agreement?: boolean } = {}) {
  const srv = await boot(":memory:", [], {
    agreement: more.agreement ?? true,
    extra: [release({ commit: "c".repeat(40), build: liveBuild })],
  });
  if (more.canvases) await srv.server.run(natsChannel, { input: more.canvases });

  const { a, id, link } = await sharedFlow(srv);
  const bo = await viewer(srv, link, "Bo");
  expect((await bo.add("flow", id, "Make the button blue.")).kind).toBe("added");
  expect((await a.agree("flow", 1)).kind).toBe("agreed");
  expect(await a.resolve(claimOf(await a.next({ canvas: "flow" })))).toEqual({
    kind: "resolved",
  });

  return { srv, a, bo, id };
}

async function rows(agent: Client) {
  return (await agent.list({ canvas: "flow" })).requests;
}

async function textOf(srv: Server, agent: Client, n: number) {
  const tab = watchQueue(agent);
  const row = (await rows(agent)).find((r) => r.n === n);
  for (let i = 0; i < 50 && !tab.messages().some((m) => m.request === row?.id); i++) {
    await Bun.sleep(20);
  }
  srv.clock.advance(0);

  return tab.messages().filter((m) => m.request === row?.id);
}

test("an accept on a canvas that a nats channel covers adds one build request: author easel, on the same frame, its text starts with Build: and names the request and the frame version, and it is agreed at add, so an agent can take it", async () => {
  const { srv, a, bo, id } = await accepted({ canvases: [] });

  expect(await bo.accept("flow", 1)).toEqual({ kind: "accepted" });

  const after = await rows(a);
  expect(after).toHaveLength(2);
  const build = after.find((r) => r.n === 2);
  expect(build).toMatchObject({ author: "easel", frameId: id, status: "open" });
  const [ask] = await textOf(srv, a, 2);
  expect(ask?.text).toMatch(/^Build: /);
  expect(ask?.text).toContain("#1");
  expect(ask?.text).toContain(`frame ${id}, version`);
  expect((await a.next({ canvas: "flow", n: 2 })).kind).toBe("claimed");
});

test("an accept on a canvas that no nats channel covers adds no build request", async () => {
  const { a, bo } = await accepted({ canvases: ["other"] });

  expect(await bo.accept("flow", 1)).toEqual({ kind: "accepted" });

  expect(await rows(a)).toHaveLength(1);
});

test("an accept of a build request adds no other request", async () => {
  const { a, bo } = await accepted({ canvases: ["flow"] });
  await bo.accept("flow", 1);
  const claim = claimOf(await a.next({ canvas: "flow", n: 2 }));
  expect(await a.resolve(claim, "Done.", undefined, liveBuild)).toEqual({ kind: "resolved" });

  expect(await bo.accept("flow", 2)).toEqual({ kind: "accepted" });

  expect(await rows(a)).toHaveLength(2);
});

test("a resolve that names a build over the live build is refused notLive with the live build; at or under it, the result ends with Live in build <n>.", async () => {
  const { srv, a, bo } = await accepted();
  await bo.reopen("flow", 1, "Bluer.");
  await a.agree("flow", 1);
  const claim = claimOf(await a.next({ canvas: "flow" }));

  expect(await a.resolve(claim, "Bluer now.", undefined, liveBuild + 1)).toEqual({
    kind: "notLive",
    live: liveBuild,
  });
  expect(await a.resolve(claim, "Bluer now.", undefined, liveBuild)).toEqual({
    kind: "resolved",
  });

  const results = (await textOf(srv, a, 1)).filter((m) => m.kind === "result");
  expect(results.at(-1)?.text).toBe(`Bluer now. Live in build ${liveBuild}.`);
});

test("a build request needs a build: its resolve with no build is refused needsBuild, and the request stays in work", async () => {
  const { a, bo } = await accepted({ canvases: ["flow"] });
  await bo.accept("flow", 1);
  const claim = claimOf(await a.next({ canvas: "flow", n: 2 }));

  expect(await a.resolve(claim, "Done.")).toEqual({ kind: "needsBuild" });

  expect((await rows(a)).find((r) => r.n === 2)?.status).toBe("open");
});
