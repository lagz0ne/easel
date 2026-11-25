import { join } from "node:path";

import { operation } from "@tinkered/core";
import type { Browser, Page } from "playwright";
import { z } from "zod";

import { openLinked, openList, markedOpen } from "./fixture.server";
import type { Fixture } from "./fixture.server";
import { screens, takes } from "./screens";
import type { Screen, Take } from "./screens";
import { fixturePins, keptDir, liveNoise, liveOutput, liveWaits } from "./settings";
import { liveUsed, styleProps } from "./values";
import type { ElementStyle, TakeValues } from "./values";

export type Shot = {
  screen: Screen;
  take: Take;
  png: Buffer | null;
  why?: string;
  values: TakeValues | null;
};

const tab = z.custom<Page>();
const browser = z.custom<Browser>();
const fixture = z.custom<Fixture>();

export const justNow = operation({
  label: "liveScreens.justNow",
  input: tab,
  run: async (_, { input: page }) => {
    const old = await page.evaluate(() =>
      [...document.querySelectorAll(".e-rr-when, .e-when, .e-pop, .e-req")]
        .map((el) => el.textContent ?? "")
        .filter((text) => /\d+\s?(min|h|days)\b|Yesterday/.test(text)),
    );
    if (old.length > 0) {
      throw new Error(`an age is not "just now" (${old[0]?.slice(0, 60)}): the take came too late`);
    }
  },
});

export const eachRequest = operation({
  label: "liveScreens.eachRequest",
  input: tab,
  depends: { pins: fixturePins, waits: liveWaits },
  run: async ({ pins, waits }, { input: page }) => {
    await page.waitForFunction(
      ({ count }) => document.querySelectorAll("button.e-pin").length >= count,
      { count: pins },
      { timeout: waits.pins },
    );
  },
});

export const settle = operation({
  label: "liveScreens.settle",
  input: tab,
  depends: { waits: liveWaits },
  run: async ({ waits }, { input: page }) => {
    await page.mouse.move(0, 0);
    await page.addStyleTag({ content: "*{caret-color:transparent !important}" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));

    await page.waitForFunction(
      () =>
        [...document.images].every((i) => {
          const box = i.getBoundingClientRect();
          const shown =
            box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
          return !shown || (i.complete && i.naturalWidth > 0);
        }),
      undefined,
      { timeout: waits.images },
    );

    await page.waitForLoadState("networkidle", { timeout: waits.idle }).catch(() => undefined);
    await page.waitForTimeout(waits.still);
  },
});

export const stylesOf = operation({
  label: "liveScreens.stylesOf",
  input: tab,
  run: (_, { input: page }): Promise<ElementStyle[]> =>
    page.evaluate(
      (props) =>
        [...document.querySelectorAll("body *")]
          .filter((el) => {
            const box = el.getBoundingClientRect();
            const inside =
              box.bottom >= 0 && box.right >= 0 && box.top <= innerHeight && box.left <= innerWidth;
            return inside && box.width > 0 && box.height > 0;
          })
          .filter((el) => getComputedStyle(el).visibility === "visible")
          .map((el) => ({
            el,
            owner: el.closest("[aria-label]")?.getAttribute("aria-label"),
            classes: el.getAttribute("class"),
            svg: el instanceof SVGElement ? el.closest("svg")?.getAttribute("class") : null,
          }))
          .map(({ el, owner, classes, svg }) => ({
            el,
            name: [
              el.tagName.toLowerCase(),
              classes ? `.${classes.trim().split(/\s+/).join(".")}` : "",
              svg ? ` in svg.${svg}` : "",
              owner ? ` in [${owner}]` : "",
            ].join(""),
          }))
          .map(({ el, name }) => ({
            name,
            text: [...el.childNodes].some(
              (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
            ),
            svg: el instanceof SVGElement && !(el instanceof SVGSVGElement),
            style: Object.fromEntries(
              props.map((p) => [p, getComputedStyle(el).getPropertyValue(p)]),
            ),
          })),
      styleProps,
    ),
});

export const liveCaptioned = operation({
  label: "liveScreens.captioned",
  input: z.object({ browser, png: z.custom<Buffer>(), text: z.string() }),
  run: async (_, { input: { browser, png, text } }) => {
    const page = await browser.newPage();
    try {
      const data = await page.evaluate(
        async ({ src, label }) => {
          const image = await createImageBitmap(await (await fetch(src)).blob());
          const strip = 40;
          const board = document.createElement("canvas");
          board.width = image.width;
          board.height = image.height + strip;
          const pen = board.getContext("2d");
          if (!pen) throw new Error("no 2d context");

          pen.fillStyle = "#ededeb";
          pen.fillRect(0, 0, board.width, board.height);
          pen.drawImage(image, 0, 0);
          pen.fillStyle = "#61615e";
          pen.font = "13px sans-serif";
          pen.textBaseline = "middle";
          pen.fillText(label, 12, image.height + strip / 2);
          return board.toDataURL("image/png");
        },
        { src: `data:image/png;base64,${png.toString("base64")}`, label: text },
      );
      return Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
    } finally {
      await page.close();
    }
  },
});

export const liveSamePixels = operation({
  label: "liveScreens.samePixels",
  input: z.object({ browser, a: z.custom<Buffer>(), b: z.custom<Buffer>() }),
  depends: { noise: liveNoise },
  run: async ({ noise }, { input: { browser, a, b } }) => {
    if (a.equals(b)) return true;

    const page = await browser.newPage();
    try {
      return await page.evaluate(
        async ({ one, two, noise }) => {
          const [x = new Uint8ClampedArray(), y = new Uint8ClampedArray()] = await Promise.all(
            [one, two].map(async (src) => {
              const image = await createImageBitmap(await (await fetch(src)).blob());
              const board = new OffscreenCanvas(image.width, image.height);
              const pen = board.getContext("2d");
              if (!pen) throw new Error("no 2d context");

              pen.drawImage(image, 0, 0);
              return pen.getImageData(0, 0, image.width, image.height).data;
            }),
          );
          return x.length === y.length && x.every((v, i) => Math.abs(v - (y[i] ?? 0)) <= noise);
        },
        {
          one: `data:image/png;base64,${a.toString("base64")}`,
          two: `data:image/png;base64,${b.toString("base64")}`,
          noise,
        },
      );
    } finally {
      await page.close();
    }
  },
});

export const takeOne = operation({
  label: "liveScreens.takeOne",
  input: z.object({
    browser,
    fixture,
    screen: z.custom<Screen>(),
    take: z.custom<Take>(),
    build: z.number(),
  }),
  depends: {
    markedOpen,
    eachRequest,
    openList,
    openLinked,
    settle,
    justNow,
    stylesOf,
    liveUsed,
    liveCaptioned,
    kept: keptDir,
  },
  run: async (deps, { input: { browser, fixture, screen, take, build } }): Promise<Shot> => {
    const context = await browser.newContext({
      viewport: { width: take.width, height: take.height },
      deviceScaleFactor: 1,
      isMobile: take.phone,
      hasTouch: take.phone,
      colorScheme: take.theme,
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "UTC",
      storageState: fixture.state,
    });
    try {
      const page = await context.newPage();
      const { open } = screen;
      await page.goto(open.kind === "request" ? `${fixture.link}#request-${open.n}` : fixture.link);
      await deps.markedOpen.run({ input: page });
      await deps.eachRequest.run({ input: page });

      if (open.kind === "list") await deps.openList.run({ input: page });
      else await deps.openLinked.run({ input: { page, n: open.n } });

      await deps.settle.run({ input: page });
      await deps.justNow.run({ input: page });
      const used = deps.liveUsed.run({ input: await deps.stylesOf.run({ input: page }) });
      const raw = await page.screenshot({ type: "png" });
      const text = `build ${build} · ${take.key}`;
      const png = await deps.liveCaptioned.run({ input: { browser, png: raw, text } });
      return { screen, take, png, values: { screen: screen.key, take: take.key, ...used } };
    } catch (error) {
      const kept = join(deps.kept, `easel-live-${screen.key}-${take.key.replace(" ", "-")}.png`);
      for (const page of context.pages()) {
        await page.screenshot({ path: kept }).catch(() => undefined);
      }
      throw error;
    } finally {
      await context.close();
    }
  },
});

export const takeAll = operation({
  label: "liveScreens.takeAll",
  input: z.object({
    browser,
    fixture,
    build: z.number(),
    screen: z.string().optional(),
    take: z.string().optional(),
  }),
  depends: { takeOne, output: liveOutput },
  run: async ({ takeOne, output }, { input, clock }): Promise<Shot[]> => {
    const { browser, fixture, build } = input;
    const chosen = screens
      .filter((screen) => !input.screen || screen.key === input.screen)
      .flatMap((screen) =>
        takes
          .filter((take) => !input.take || take.key === input.take)
          .map((take) => ({ screen, take })),
      );

    const started = clock.currentTimeMillis();
    const shots = await Promise.all(
      chosen.map(({ screen, take }) =>
        takeOne
          .run({ input: { browser, fixture, screen, take, build } })
          .catch((error: unknown) => ({
            screen,
            take,
            png: null,
            values: null,
            why: error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error),
          })),
      ),
    );
    const took = clock.currentTimeMillis() - started;
    output.write(`live-screens: took ${shots.length} takes in ${took} ms\n`);
    return shots;
  },
});
