import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { expect, onTestFinished, test } from "vite-plus/test";

import { httpBackend } from "~/components/http";
import { telemetry } from "~/components/telemetry";

const work = operation({ label: "test.work", run: () => 1 });

async function tab(firstSendMark?: string) {
  const clock = makeTestClock({ now: 1_000_000 });
  const sent: string[] = [];
  const scope = createScope({
    clock,
    tags: [
      httpBackend(async (input) => {
        sent.push(String(input));
        return new Response(null, { status: 204 });
      }),
    ],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      telemetry.browser({ service: "test-tab", console: null, firstSendMark }),
    ],
  });
  onTestFinished(async () => {
    await scope.close();
  });
  await scope.run(work);

  const wait = async (ms: number) => {
    for (let at = 0; at < ms; at += 1000) {
      clock.advance(1000);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise((done) => setTimeout(done, 0));
    }
  };
  return { sent, wait };
}

test("SPD-8: the tab sends no telemetry before the page marks its first view; the next tick after the mark sends it", async () => {
  const mark = `test:open-${crypto.randomUUID()}`;
  const at = await tab(mark);

  await at.wait(3000);
  expect(at.sent).toEqual([]);

  performance.mark(mark);
  onTestFinished(() => performance.clearMarks(mark));
  await at.wait(1000);
  expect(at.sent).toEqual(["/api/telemetry"]);
});

test("SPD-8: a page that never marks its first view sends its telemetry at 10 s", async () => {
  const at = await tab(`test:never-${crypto.randomUUID()}`);

  await at.wait(9000);
  expect(at.sent).toEqual([]);

  await at.wait(1000);
  expect(at.sent).toEqual(["/api/telemetry"]);
});

test("SPD-8: with no mark named, the tab sends at the first tick, as before", async () => {
  const at = await tab();

  await at.wait(1000);
  expect(at.sent).toEqual(["/api/telemetry"]);
});
