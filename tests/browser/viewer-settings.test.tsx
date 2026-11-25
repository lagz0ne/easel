import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { expect, onTestFinished, test } from "vite-plus/test";

import type { Request } from "@/queue/cells";
import { fold, foldNow } from "@/viewer/fold";
import { shownState, stateLine } from "@/viewer/follow";
import {
  dayMs,
  foldDelayMs,
  maxZoom,
  minZoom,
  noAnswerDays,
  popGap,
  viewerDefaults,
} from "@/viewer/settings";
import { popPlace, stage, zoomShown } from "@/viewer/stage";

const ticks = async () => {
  for (let n = 0; n < 5; n += 1) await Promise.resolve();
};

test("the viewer tags keep their old defaults", () => {
  expect(viewerDefaults).toEqual({
    liveCap: 12,
    readZoom: 0.3,
    goLiveMargin: 0.1,
    stayLiveMargin: 0.5,
    showMargin: 0.5,
    hideAtRestMargin: 0.75,
    hideMovingMargin: 1.5,
    restMs: 120,
    paintCapMs: 1_500,
    zoomFactor: 1.25,
    pinchRate: 0.01,
    minZoom: 0.001,
    maxZoom: 4,
    fitEdge: 40,
    labelDrift: 0.1,
    clickSlop: 4,
    popGap: 8,
    dockBand: 64,
    pinSize: 24,
    paneMax: { w: 480, h: 720 },
    closeWaitMs: 200,
    wheelLine: 16,
    showAt: 0.4,
    foldDelayMs: 300,
    noAnswerDays: 3,
    oldMs: 7 * 24 * 60 * 60_000,
    tickMs: 60_000,
    retryJitter: 1_000,
  });
});

test("minZoom and maxZoom of a scope clamp the zoom of the stage; with no tag the old limits act", async () => {
  const tuned = await createScope({
    tags: [minZoom(0.5), maxZoom(2)],
    capsules: [exits({ store: localStorage })],
  }).ready;
  const plain = await createScope({ capsules: [exits({ store: localStorage })] }).ready;
  onTestFinished(async () => {
    await Promise.all([tuned.close(), plain.close()]);
  });

  const at = tuned.resolve(stage);
  for (let n = 0; n < 10; n += 1) at.zoomIn();
  expect(tuned.resolve(zoomShown)).toBe(200);
  for (let n = 0; n < 20; n += 1) at.zoomOut();
  expect(tuned.resolve(zoomShown)).toBe(50);

  const old = plain.resolve(stage);
  for (let n = 0; n < 10; n += 1) old.zoomIn();
  expect(plain.resolve(zoomShown)).toBe(400);
});

test("foldDelayMs of a scope sets when a column folds after the pointer leaves", async () => {
  const clock = makeTestClock();
  const scope = await createScope({
    clock,
    tags: [foldDelayMs(50)],
    capsules: [exits({ store: localStorage })],
  }).ready;
  onTestFinished(async () => {
    await scope.close();
  });

  scope.resolve(fold).pointerOff("f1", "mouse");
  expect(scope.resolve(foldNow).lingering).toEqual(["f1"]);

  clock.advance(49);
  await ticks();
  expect(scope.resolve(foldNow).lingering).toEqual(["f1"]);

  clock.advance(1);
  await ticks();
  expect(scope.resolve(foldNow).lingering).toEqual([]);
});

test("popGap of a scope sets the gap between a pin and its pop-over", async () => {
  const scope = await createScope({
    tags: [popGap(20)],
    capsules: [exits({ store: localStorage })],
  }).ready;
  onTestFinished(async () => {
    await scope.close();
  });

  const room = { left: 0, top: 0, right: 1000, bottom: 1000 };
  const pin = { left: 100, top: 100, right: 124, bottom: 124 };
  const spot = scope.run(popPlace, { input: { pin, w: 200, h: 100, room } });

  expect(spot).toEqual({ side: "below", left: 140, top: 144 });
});

const result: Request = {
  canvas: "c",
  id: "r1",
  n: 1,
  frameId: "f1",
  version: 2,
  kit: 1,
  x: 0,
  y: 0,
  page: null,
  author: "Mai",
  key: "k",
  status: "resolved",
  claimedBy: null,
  claimedUntil: null,
  claimedAt: null,
  tries: 1,
  queuedAt: 0,
  acceptedBy: null,
  created: 0,
  updated: 0,
};

test("noAnswerDays of a scope sets when a result with no answer is done, and the step says the days", async () => {
  const one = await createScope({
    tags: [noAnswerDays(1)],
    capsules: [exits({ store: localStorage })],
  }).ready;
  const plain = await createScope({ capsules: [exits({ store: localStorage })] }).ready;
  onTestFinished(async () => {
    await Promise.all([one.close(), plain.close()]);
  });

  const now = dayMs + 1;
  const input = { request: result, closer: null, now };
  expect(one.run(shownState, { input })).toBe("doneNoAnswer");
  expect(plain.run(shownState, { input })).toBe("result");

  const step = (on: typeof one) =>
    on.run(stateLine, { input: { r: result, shown: "doneNoAnswer", last: null } })[0];
  expect(step(one)).toMatchObject({
    what: "No viewer answered in 1 day, so it is done",
    at: dayMs,
  });
  expect(step(plain)).toMatchObject({
    what: "No viewer answered in 3 days, so it is done",
    at: 3 * dayMs,
  });
});
