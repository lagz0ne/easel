import { accessSync, constants } from "node:fs";

import { operation } from "@tinkered/core";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { z } from "zod";

import { speedViewport } from "./settings";

const page = z.custom<Page>();
const context = z.custom<BrowserContext>();
const browser = z.custom<Browser>();

export const localChromium = operation({
  label: "speed.localChromium",
  run: () => {
    const full = chromium.executablePath();
    const shell = full
      .replace("/chromium-", "/chromium_headless_shell-")
      .replace("chrome-linux64/chrome", "chrome-headless-shell-linux64/chrome-headless-shell");
    const found = [shell, full].find((path) => {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
    if (!found) throw new Error("speed: no local Chromium (bunx playwright install chromium)");
    return found;
  },
});

export const markOf = operation({
  label: "speed.markOf",
  input: z.object({ page, name: z.string(), timeout: z.number() }),
  run: async (_, { input: { page, name, timeout } }) => {
    await page.waitForFunction((n) => performance.getEntriesByName(n, "mark").length > 0, name, {
      timeout,
      polling: 10,
    });
    return page.evaluate(
      (n) => performance.timeOrigin + (performance.getEntriesByName(n, "mark")[0]?.startTime ?? 0),
      name,
    );
  },
});

export const opened = operation({
  label: "speed.opened",
  input: z.object({ context, link: z.string(), timeout: z.number().optional() }),
  depends: { markOf },
  run: async ({ markOf }, { input: { context, link, timeout } }) => {
    const tab = await context.newPage();
    await tab.goto(link);
    await markOf.run({ input: { page: tab, name: "easel:open", timeout: timeout ?? 30_000 } });
    return tab;
  },
});

export const warmUp = operation({
  label: "speed.warmUp",
  input: z.object({ context, link: z.string(), timeout: z.number() }),
  depends: { opened },
  run: async ({ opened }, { input }) => {
    const tab = await opened.run({ input });
    await tab.close();
  },
});

export const opens = operation({
  label: "speed.opens",
  input: z.object({ context, link: z.string() }),
  depends: { opened },
  run: async ({ opened }, { input }) => {
    const tab = await opened.run({ input });
    const time = await tab.evaluate(
      () => performance.getEntriesByName("easel:open", "mark")[0]?.startTime ?? 0,
    );
    await tab.close();
    return [time];
  },
});

export const coldOpen = operation({
  label: "speed.coldOpen",
  input: z.object({ browser, link: z.string() }),
  depends: { opened, viewport: speedViewport },
  run: async ({ opened, viewport }, { input: { browser, link } }) => {
    const fresh = await browser.newContext({ viewport });
    const tab = await opened.run({ input: { context: fresh, link } });

    const seen = await tab.evaluate(async () => {
      const open = performance.getEntriesByName("easel:open", "mark")[0]?.startTime ?? 0;
      const requests = performance
        .getEntriesByType("resource")
        .filter((e) => e.startTime < open)
        .map((e) => e.name);
      const frames = await new Promise<number[]>((done) => {
        const got: number[] = [];
        const watch = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (e.startTime < open) got.push(e.duration);
        });
        watch.observe({ type: "long-animation-frame", buffered: true });
        setTimeout(() => {
          watch.disconnect();
          done(got);
        }, 200);
      });

      return { open, requests, frames };
    });

    await fresh.close();
    return seen;
  },
});

export const throttledOpen = operation({
  label: "speed.throttledOpen",
  input: z.object({ browser, link: z.string() }),
  depends: { markOf, viewport: speedViewport },
  run: async ({ markOf, viewport }, { input: { browser, link } }) => {
    const fresh = await browser.newContext({ viewport });
    const tab = await fresh.newPage();
    const cdp = await fresh.newCDPSession(tab);

    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    await tab.goto(link);
    await markOf.run({ input: { page: tab, name: "easel:open", timeout: 60_000 } });
    const time = await tab.evaluate(
      () => performance.getEntriesByName("easel:open", "mark")[0]?.startTime ?? 0,
    );
    await fresh.close();
    return time;
  },
});

export const shownAt = operation({
  label: "speed.shownAt",
  input: z.object({ page, what: z.string() }),
  run: async (_, { input: { page, what } }) => {
    const shown = await page.evaluate(() => ({
      live: document.querySelectorAll("iframe.e-doc").length,
      zoom: document.querySelector("output[aria-label=Zoom]")?.textContent ?? "",
    }));
    return `${what}: ${shown.live} live, zoom ${shown.zoom}`;
  },
});

export const drawnOf = operation({
  label: "speed.drawnOf",
  input: z.object({ context, link: z.string() }),
  depends: { opened },
  run: async ({ opened }, { input }) => {
    const tab = await opened.run({ input });
    const drawn = await tab.evaluate(() => document.querySelectorAll(".e-shell").length);
    await tab.close();
    return `a page of 20 frames on a canvas of 5 pages: ${drawn} frames drawn`;
  },
});

export const zoomTo = operation({
  label: "speed.zoomTo",
  input: z.object({ page, pct: z.number() }),
  run: async (_, { input: { page, pct } }) => {
    const zoom = page.getByRole("status", { name: "Zoom" });
    const zoomInOfABaseBuild = page.getByRole("button", { name: "Zoom in" });
    for (let i = 0; i < 60; i++) {
      if (Number.parseFloat((await zoom.textContent()) ?? "0") >= pct) break;
      if ((await zoomInOfABaseBuild.count()) > 0) await zoomInOfABaseBuild.click();
      else await page.keyboard.press("Control+Equal");
    }
    await page.waitForFunction(() => document.querySelector(".e-card[hidden]") !== null, null, {
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
  },
});

export const centreFrame = operation({
  label: "speed.centreFrame",
  input: page,
  run: (_, { input: page }) =>
    page.evaluate(() => {
      const [cx, cy] = [innerWidth / 2, innerHeight / 2];
      const near = [...document.querySelectorAll<HTMLElement>(".e-shell[data-id]")]
        .map((el) => {
          const r = el.getBoundingClientRect();
          const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
          return { id: el.dataset.id ?? "", d };
        })
        .sort((a, b) => a.d - b.d);
      return near[0]?.id ?? "";
    }),
});

export const askMarks = operation({
  label: "speed.askMarks",
  input: page,
  run: (_, { input: page }) =>
    page.evaluate(
      () =>
        performance.getEntriesByType("mark").filter((m) => m.name.startsWith("easel:ask:")).length,
    ),
});

export const pan = operation({
  label: "speed.pan",
  input: z.object({ page, dx: z.number(), ms: z.number() }),
  run: async (_, { input: { page, dx, ms } }) => {
    const times = await page.evaluate(
      async ({ dx, ms }) => {
        const region = document.querySelector('[aria-label="Frames"]');
        if (!region) return { frames: [], handlers: [] };

        const at = { x: innerWidth / 2, y: innerHeight / 2 };
        const pointer = { pointerId: 1, button: 0, bubbles: true };
        region.dispatchEvent(
          new PointerEvent("pointerdown", { ...pointer, clientX: at.x, clientY: at.y }),
        );

        const got: { frames: number[]; handlers: number[] } = { frames: [], handlers: [] };
        const start = performance.now();
        let last = start;
        while (performance.now() - start < ms) {
          await new Promise((done) => requestAnimationFrame(done));
          const now = performance.now();
          got.frames.push(now - last);
          last = now;

          at.x += dx;
          const t0 = performance.now();
          region.dispatchEvent(
            new PointerEvent("pointermove", { ...pointer, clientX: at.x, clientY: at.y }),
          );
          got.handlers.push(performance.now() - t0);
        }
        region.dispatchEvent(
          new PointerEvent("pointerup", { ...pointer, clientX: at.x, clientY: at.y }),
        );

        return got;
      },
      { dx, ms },
    );

    await page.waitForTimeout(500);
    return times;
  },
});
