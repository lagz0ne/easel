import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { liveNoise } from "@/live/settings";
import { liveSamePixels } from "@/live/takes.server";

import { localChromium } from "./support/chromium";

const scope = createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] });

const exact = createScope({
  capsules: [exits({ file: process.env.TINKER_EXITS })],
  tags: [liveNoise(0)],
});

let browser: Browser | null = null;

beforeAll(async () => {
  const executablePath = localChromium();
  if (executablePath === null) {
    throw new Error("no local Chromium: run `bunx playwright install chromium`");
  }
  browser = await chromium.launch({ executablePath });
});

afterAll(async () => {
  await browser?.close();
  await scope.close();
  await exact.close();
});

async function grey(level: number, lift: { at: number; by: number } | null) {
  if (browser === null) throw new Error("no browser");
  const page = await browser.newPage();
  try {
    const data = await page.evaluate(
      async ({ level, lift }) => {
        const board = new OffscreenCanvas(4, 4);
        const pen = board.getContext("2d");
        if (!pen) throw new Error("no 2d context");

        pen.fillStyle = `rgb(${level},${level},${level})`;
        pen.fillRect(0, 0, 4, 4);
        if (lift) {
          pen.fillStyle = `rgb(${level + lift.by},${level},${level})`;
          pen.fillRect(lift.at, lift.at, 1, 1);
        }

        const blob = await board.convertToBlob({ type: "image/png" });
        return [...new Uint8Array(await blob.arrayBuffer())];
      },
      { level, lift },
    );
    return Buffer.from(data);
  } finally {
    await page.close();
  }
}

const same = (on: typeof scope, a: Buffer, b: Buffer) => {
  if (browser === null) throw new Error("no browser");
  return on.run(liveSamePixels, { input: { browser, a, b } });
};

test("the same buffers are the same pixels", async () => {
  const a = await grey(100, null);
  expect(await same(scope, a, Buffer.from(a))).toBe(true);
});

test("a red channel 6 levels off on one pixel is raster noise: the pixels are the same", async () => {
  const a = await grey(100, null);
  const b = await grey(100, { at: 2, by: 6 });
  expect(a.equals(b)).toBe(false);
  expect(await same(scope, a, b)).toBe(true);
});

test("a red channel 8 levels off on one pixel is the edge of the noise: the pixels are the same", async () => {
  const a = await grey(100, null);
  const b = await grey(100, { at: 2, by: 8 });
  expect(await same(scope, a, b)).toBe(true);
});

test("a red channel 9 levels off on one pixel is over the noise: the pixels differ", async () => {
  const a = await grey(100, null);
  const b = await grey(100, { at: 2, by: 9 });
  expect(await same(scope, a, b)).toBe(false);
});

test("a red channel 20 levels off on one pixel is a change: the pixels differ", async () => {
  const a = await grey(100, null);
  const b = await grey(100, { at: 2, by: 20 });
  expect(await same(scope, a, b)).toBe(false);
});

test("with liveScreens.noise 0, a red channel 6 levels off on one pixel differs", async () => {
  const a = await grey(100, null);
  const b = await grey(100, { at: 2, by: 6 });
  expect(await same(exact, a, b)).toBe(false);
});
