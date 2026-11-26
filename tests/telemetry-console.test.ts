import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { expect, onTestFinished, test } from "vite-plus/test";

import { httpBackend } from "~/components/http";
import { telemetry } from "~/components/telemetry";
import type { Telemetry } from "~/components/telemetry";

type Shown = { method: "error" | "warn" | "info"; msg: string };

const work = operation({ label: "test.work", run: () => 1 });

const talks = operation({
  label: "test.talks",
  run: (_deps, ctx) => {
    ctx.log.info("tab info");
    ctx.log.warn("tab warn");
    ctx.log.error("tab error");
    return 1;
  },
});

const msgOf = (value: unknown) => {
  const msg: unknown = Object(value).msg;
  return typeof msg === "string" ? msg : "";
};

async function tab(consoleSpans?: boolean) {
  const clock = makeTestClock({ now: 1_000_000 });
  const shown: Shown[] = [];
  const sent: Telemetry.Batch[] = [];

  const scope = createScope({
    clock,
    tags: [
      httpBackend(async (_input, init) => {
        sent.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
        return new Response(null, { status: 204 });
      }),
    ],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      telemetry.browser({
        service: "test-tab",
        consoleSpans,
        console: {
          error: (value: unknown) => shown.push({ method: "error", msg: msgOf(value) }),
          warn: (value: unknown) => shown.push({ method: "warn", msg: msgOf(value) }),
          info: (value: unknown) => shown.push({ method: "info", msg: msgOf(value) }),
        },
      }),
    ],
  });
  onTestFinished(async () => {
    await scope.close();
  });
  const live = await scope.ready;

  const settle = async () => {
    for (let at = 0; at < 3; at++) {
      clock.advance(1000);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise((done) => setTimeout(done, 0));
    }
  };

  const spanLines = () => shown.filter((line) => line.msg === "core.span");
  const exported = (name: string) =>
    sent.flatMap((batch) => batch.traces).filter((span) => span.name === name);

  return { live, shown, sent, settle, spanLines, exported };
}

test("T7: with the default tags, the tab writes no span to the console for 1000 spans", async () => {
  const at = await tab();

  for (let index = 0; index < 1000; index++) at.live.run(work);

  expect(at.shown).toEqual([]);
});

test("T7: with consoleSpans on, the tab writes one console info line for each span that it exports", async () => {
  const at = await tab(true);

  for (let index = 0; index < 20; index++) at.live.run(work);
  await at.settle();

  expect(at.exported("test.work")).toHaveLength(20);
  const spans = at.sent.flatMap((batch) => batch.traces);
  expect(at.spanLines()).toHaveLength(spans.length);
  expect(at.spanLines().every((line) => line.method === "info")).toBe(true);
});

test("T7: with the default tags, the tab still exports each span to the collector", async () => {
  const at = await tab();

  for (let index = 0; index < 20; index++) at.live.run(work);
  await at.settle();

  expect(at.exported("test.work")).toHaveLength(20);
  expect(at.shown).toEqual([]);
});

test("T7: with the default tags, the info, warn and error lines of the app still reach the console", async () => {
  const at = await tab();

  at.live.run(talks);

  expect(at.shown).toEqual([
    { method: "info", msg: "tab info" },
    { method: "warn", msg: "tab warn" },
    { method: "error", msg: "tab error" },
  ]);
});
