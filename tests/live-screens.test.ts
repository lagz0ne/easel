import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { liveName, liveNameOf, livePlace, livePlan } from "@/live/plan";
import { screens, takeKeys, takes } from "@/live/screens";
import { liveStatusHtml, liveStatusRead } from "@/live/status";
import type { LiveStatus } from "@/live/status";
import { liveColor, liveFindings, liveLook, liveUsed } from "@/live/values";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function scope() {
  const app = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => app.close());
  return app;
}

const design = "E4.2 Accepted, proof on After (M12 M17)";

test("a live frame has the name of its designed frame first, then its role and its take", async () => {
  const app = await scope();

  expect(app.run(liveName, { input: { role: "design", design } })).toBe(`${design} · design`);
  expect(app.run(liveName, { input: { role: "live", design, take: "phone dark" } })).toBe(
    `${design} · live · phone dark`,
  );
  expect(app.run(liveName, { input: { role: "before", design, take: "desktop light" } })).toBe(
    `${design} · before · desktop light`,
  );
});

test("the name of a frame on Live says its designed frame, its role and its take; other names are other", async () => {
  const app = await scope();

  expect(app.run(liveNameOf, { input: `${design} · live · phone dark` })).toEqual({
    kind: "live",
    design,
    take: "phone dark",
  });
  expect(app.run(liveNameOf, { input: `${design} · before · desktop dark` })).toEqual({
    kind: "before",
    design,
    take: "desktop dark",
  });
  expect(app.run(liveNameOf, { input: `${design} · design` })).toEqual({ kind: "design", design });
  expect(app.run(liveNameOf, { input: "Live · status" })).toEqual({ kind: "other" });
  expect(app.run(liveNameOf, { input: `${design} · live · tablet` })).toEqual({ kind: "other" });
});

test("a take of a build: new with no After, next on a newer build, a compare on the same build, then same or differs", async () => {
  const app = await scope();

  expect(app.run(livePlan, { input: { build: 280, after: null } })).toEqual({ kind: "new" });
  expect(app.run(livePlan, { input: { build: 281, after: 280 } })).toEqual({
    kind: "next",
    before: 280,
  });
  expect(app.run(livePlan, { input: { build: 280, after: 280 } })).toEqual({ kind: "compare" });
  expect(app.run(livePlan, { input: { build: 280, after: 280, same: true } })).toEqual({
    kind: "same",
  });
  expect(app.run(livePlan, { input: { build: 280, after: 280, same: false } })).toEqual({
    kind: "differs",
  });
});

test("the page Live: the status at the top left, one row for each screen, the design first, then Before and After of each take", async () => {
  const app = await scope();

  expect(app.run(livePlace, { input: { role: "status" } })).toEqual({ x: 0, y: 0 });
  const row0 = app.run(livePlace, { input: { role: "design", row: 0 } });
  const row1 = app.run(livePlace, { input: { role: "design", row: 1 } });
  expect(row0.x).toBe(0);
  expect(row0.y).toBeGreaterThanOrEqual(900);
  expect(row1.y - row0.y).toBeGreaterThan(Math.max(...takes.map((t) => t.height)));

  let right = 1280;
  for (const take of takeKeys) {
    const before = app.run(livePlace, { input: { role: "before", row: 1, take } });
    const after = app.run(livePlace, { input: { role: "live", row: 1, take } });
    const width = takes.find((t) => t.key === take)?.width ?? 0;

    expect(before.y).toBe(row1.y);
    expect(before.x).toBeGreaterThan(right);
    expect(after.x).toBeGreaterThan(before.x + width);

    right = after.x + width;
  }
});

test("a color reads as its channels: hex, rgb with commas or a slash, color(srgb); transparent is none; other text is unknown", async () => {
  const app = await scope();
  const key = (input: string) => app.run(liveColor, { input });

  expect(key("#1A66C9")).toEqual({ kind: "color", key: "26,102,201,1" });
  expect(key("#fff")).toEqual({ kind: "color", key: "255,255,255,1" });
  expect(key("#00000080")).toEqual({ kind: "color", key: "0,0,0,0.5" });
  expect(key("rgb(26, 102, 201)")).toEqual({ kind: "color", key: "26,102,201,1" });
  expect(key("rgba(133, 133, 130, 0.4)")).toEqual({ kind: "color", key: "133,133,130,0.4" });
  expect(key("rgb(133 133 130 / .4)")).toEqual({ kind: "color", key: "133,133,130,0.4" });
  expect(key("rgb(0 0 0 / 30%)")).toEqual({ kind: "color", key: "0,0,0,0.3" });
  expect(key("color(srgb 1 0 0 / 0.5)")).toEqual({ kind: "color", key: "255,0,0,0.5" });
  expect(key("transparent")).toEqual({ kind: "none" });
  expect(key("rgba(0, 0, 0, 0)")).toEqual({ kind: "none" });
  expect(key("oklab(0.5 0.1 0.1)")).toEqual({ kind: "unknown" });
  expect(key("rgb(a, b, c)")).toEqual({ kind: "unknown" });
  expect(key("color(display-p3 1 0 0)")).toEqual({ kind: "unknown" });
});

const tokens = `:root{--e-text:#151515;--e-accent:#1a66c9;--e-shadow-low:rgb(0 0 0 / .05);--e-size-1:12px;--e-size-2:13px;--e-1:4px;--e-font:"Inter", "Noto Sans", sans-serif}
:root[data-doop-theme="dark"],[data-doop-theme="dark"]{--e-text:#ededec;--e-accent:#6aa6ff;--e-size-2:13px}`;

test("the look of the design system: each color of a token in light and dark, the sizes of --e-size-*, the first font", async () => {
  const app = await scope();

  expect(app.run(liveLook, { input: tokens })).toEqual({
    colors: ["0,0,0,0.05", "106,166,255,1", "21,21,21,1", "237,237,236,1", "26,102,201,1"],
    sizes: ["12px", "13px"],
    fonts: ["inter"],
  });
});

test("a value of a live screen that the look does not have is a finding with the element that uses it; a transparent color is none", async () => {
  const app = await scope();
  const look = app.run(liveLook, { input: tokens });

  const found = app.run(liveFindings, {
    input: {
      look,
      values: [
        {
          screen: "accepted",
          take: "desktop dark",
          colors: [
            "rgb(237, 237, 236)",
            "rgba(0, 0, 0, 0)",
            "rgb(255, 0, 255)",
            "rgb(255, 0, 255)",
          ],
          sizes: ["13px", "16px"],
          fonts: ['Inter, "Noto Sans", sans-serif', "Times New Roman"],
          where: { "rgb(255, 0, 255)": "path in [Close]" },
        },
      ],
    },
  });

  expect(found).toEqual([
    {
      screen: "accepted",
      take: "desktop dark",
      kind: "color",
      value: "rgb(255, 0, 255)",
      where: "path in [Close]",
    },
    { screen: "accepted", take: "desktop dark", kind: "size", value: "16px" },
    { screen: "accepted", take: "desktop dark", kind: "font", value: "Times New Roman" },
  ]);
});

test("the values of a screen: the text, the fill and each drawn border and outline, with the first element that uses each", async () => {
  const app = await scope();

  const used = app.run(liveUsed, {
    input: [
      {
        name: "span.label in [Requests]",
        text: true,
        svg: false,
        style: {
          color: "rgb(21, 21, 21)",
          "font-size": "13px",
          "font-family": "Inter, sans-serif",
          "background-color": "rgba(0, 0, 0, 0)",
          "border-top-width": "1px",
          "border-top-style": "solid",
          "border-top-color": "rgb(229, 229, 226)",
          "border-left-width": "1px",
          "border-left-style": "none",
          "border-left-color": "rgb(1, 2, 3)",
          "outline-style": "solid",
          "outline-width": "2px",
          "outline-color": "rgb(26, 102, 201)",
        },
      },
      {
        name: "path in [Close]",
        text: false,
        svg: true,
        style: {
          color: "rgb(9, 9, 9)",
          "background-color": "rgba(0, 0, 0, 0)",
          fill: "rgb(0, 0, 0)",
          stroke: "none",
          "outline-style": "none",
        },
      },
      {
        name: "div.plain",
        text: false,
        svg: false,
        style: { "background-color": "rgb(255, 255, 255)", fill: "rgb(5, 5, 5)" },
      },
    ],
  });

  expect(used).toEqual({
    colors: [
      "rgb(0, 0, 0)",
      "rgb(21, 21, 21)",
      "rgb(229, 229, 226)",
      "rgb(255, 255, 255)",
      "rgb(26, 102, 201)",
      "rgba(0, 0, 0, 0)",
    ],
    sizes: ["13px"],
    fonts: ["Inter, sans-serif"],
    where: {
      "rgb(21, 21, 21)": "span.label in [Requests] color",
      "13px": "span.label in [Requests] font-size",
      "Inter, sans-serif": "span.label in [Requests] font-family",
      "rgba(0, 0, 0, 0)": "span.label in [Requests] background-color",
      "rgb(229, 229, 226)": "span.label in [Requests] border",
      "rgb(26, 102, 201)": "span.label in [Requests] outline",
      "rgb(0, 0, 0)": "path in [Close] fill",
      "rgb(255, 255, 255)": "div.plain background-color",
    },
  });
});

const status: LiveStatus = {
  build: 280,
  commit: "42281fabc378717e1483876c0d89e277557c0a38",
  designs: { "52b790a2057e": 4 },
  takes: [
    { screen: "accepted", take: "desktop light", word: "next", after: 280, before: 279 },
    {
      screen: "accepted",
      take: "phone dark",
      word: "failed",
      after: 279,
      before: null,
      why: "no <Request #1>",
    },
  ],
  values: [{ screen: "accepted", take: "desktop light", colors: ["#fff"], sizes: [], fonts: [] }],
  findings: [
    { screen: "accepted", take: "desktop light", kind: "color", value: "#f0f" },
    {
      screen: "accepted",
      take: "phone dark",
      kind: "color",
      value: "rgb(0, 0, 0)",
      where: "path in [Close] fill",
    },
  ],
};

test("the status frame shows the build, each take and each finding, and holds the same data for the proof", async () => {
  const app = await scope();

  const html = app.run(liveStatusHtml, { input: status });

  expect(html).toContain("Live · build 280");
  expect(html).toContain("failed: no &lt;Request #1&gt;");
  expect(html).toContain("Values that are not in the design system: 2");
  expect(html).toContain("the color rgb(0, 0, 0) (path in [Close] fill)");
  expect(html).not.toContain("<Request #1>");
  expect(app.run(liveStatusRead, { input: html })).toEqual({ kind: "read", status });
});

test("a frame with no data of the job reads as none; broken data reads as bad", async () => {
  const app = await scope();
  const script = (body: string) =>
    `<script type="application/json" id="easel-live">${body}</script>`;

  expect(app.run(liveStatusRead, { input: "<p>Read me</p>" })).toEqual({ kind: "none" });
  expect(app.run(liveStatusRead, { input: script("{not json") })).toEqual({ kind: "bad" });
  expect(app.run(liveStatusRead, { input: script('{"build":"x"}') })).toEqual({ kind: "bad" });
});

test("each screen names a designed frame of product and how to open it", () => {
  for (const s of screens) {
    expect(s.design.id).toMatch(/^[0-9a-f]{12}$/);
    expect(s.design.name).not.toContain(" · live · ");
  }
  expect(new Set(screens.map((s) => s.key)).size).toBe(screens.length);
});
