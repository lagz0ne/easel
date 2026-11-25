import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { operation } from "@tinkered/core";
import type { Server } from "bun";
import type { Browser } from "playwright";
import { z } from "zod";

import { mapShot } from "@/live/screens";
import type { MapEntry } from "@/live/screens";

import { captionLook, mapArrowLift, mapCaption, mapCaptionParts } from "./canvas";
import { mapFrameName, mapPictureHeight } from "./canvas";
import { cardMark } from "./canvas";
import { mapCard, mapCardHtml } from "./card";
import type { MapGraph } from "./card";
import { mapCheck } from "./check";
import type { MapFinding } from "./check";
import { readDesigned } from "./check-run.server";
import { screensRoot, shotTime, shotTimeoutMs, rasterNoise } from "./screens-settings";
import { showPlans, shownMark, walkReplies } from "./show";
import type { ShowPlan } from "./show";
import { deriveOf } from "./source.server";
import type { Derived } from "./source.server";
import type { MapJson } from "./text";
import { pressMarks } from "./view";
import type { WalkData } from "./walk";
import { walkDocument } from "./walk";

export type Shot = { state: string; png: Buffer | null; why: string | null };

export type Card = { state: string; name: string; html: string; size: { w: number; h: number } };

export type Lifts = { title: number; line: number };

export type Done = {
  entry: MapEntry;
  map: MapJson;
  shots: Shot[];
  cards: Card[];
  walk: string;
  findings: MapFinding[];
};

const captionFonts = { title: "600 15px sans-serif", line: "14px sans-serif" } as const;

const browser = z.custom<Browser>();
const entry = z.custom<MapEntry>();
const derived = z.custom<Derived>();
const plans = z.custom<ShowPlan[]>();

const unitsModule = operation({
  label: "mapScreens.unitsModule",
  input: z.object({ entry, derived, plans }),
  run: (_, { input: { entry, derived, plans } }) => {
    const imports = [
      `import { createElement } from "react";`,
      `import { ${entry.view.name} as View } from ${JSON.stringify(derived.view ?? "")};`,
      `import { ${derived.cell.name} as cell } from ${JSON.stringify(derived.cell.file)};`,
      ...derived.actions.map(
        (action, at) => `import { ${action.name} as a${at} } from ${JSON.stringify(action.file)};`,
      ),
    ];
    const actions = derived.actions.map((_action, at) => `a${at}`).join(", ");
    return `${imports.join("\n")}

export const shown = {
  View: () => createElement(View, ${JSON.stringify(entry.view.props)}),
  cell,
  actions: [${actions}],
  plans: ${JSON.stringify(plans)},
};
`;
  },
});

export const buildShowPage = operation({
  label: "mapScreens.buildShowPage",
  input: z.object({ entry, derived, plans, work: z.string() }),
  depends: { unitsModule, pressMarks, root: screensRoot },
  run: async ({ unitsModule, pressMarks, root }, { input: { entry, derived, plans, work } }) => {
    const dir = join(work, entry.name);
    mkdirSync(dir, { recursive: true });
    const unitsFile = join(dir, "units.ts");
    writeFileSync(unitsFile, unitsModule.run({ input: { entry, derived, plans } }));

    const view = (derived.view ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const built = await Bun.build({
      entrypoints: [join(root, "cmds/map-show.html")],
      outdir: join(dir, "out"),
      target: "browser",
      throw: false,
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      plugins: [
        {
          name: "map-show",
          setup(build) {
            build.onResolve({ filter: /^map:units$/ }, () => ({ path: unitsFile }));
            build.onResolve({ filter: /^\/api\/fonts\// }, ({ path }) => ({
              path,
              external: true,
            }));
            build.onLoad({ filter: new RegExp(`^${view}$`) }, async ({ path }) => ({
              contents: pressMarks.run({
                input: { file: path, source: await Bun.file(path).text() },
              }),
              loader: "tsx",
            }));
          },
        },
      ],
    });
    if (!built.success) {
      const logs = built.logs.map((log) => log.message).join("\n");
      throw new Error(`map-screens: the page of ${entry.name} did not build: ${logs}`);
    }
    return { out: join(dir, "out"), unitsFile };
  },
});

export const buildWalk = operation({
  label: "mapScreens.buildWalk",
  input: z.object({
    entry,
    unitsFile: z.string(),
    data: z.custom<WalkData>(),
    work: z.string(),
  }),
  depends: { walkDocument, root: screensRoot },
  run: async ({ walkDocument, root }, { input: { entry, unitsFile, data, work } }) => {
    const built = await Bun.build({
      entrypoints: [join(root, "cmds/map-walk.html")],
      outdir: join(work, entry.name, "walk"),
      target: "browser",
      throw: false,
      minify: true,
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      plugins: [
        {
          name: "map-walk",
          setup(build) {
            build.onResolve({ filter: /^map:units$/ }, () => ({ path: unitsFile }));
            build.onResolve({ filter: /^\/api\/fonts\// }, ({ path }) => ({
              path,
              external: true,
            }));
          },
        },
      ],
    });
    if (!built.success) {
      const logs = built.logs.map((log) => log.message).join("\n");
      throw new Error(`map-screens: the walk of ${entry.name} did not build: ${logs}`);
    }

    const [html = "", js = "", css = ""] = await Promise.all(
      [".html", ".js", ".css"].map(async (end) => {
        const files = built.outputs.filter((output) => output.path.endsWith(end));
        return (await Promise.all(files.map((file) => file.text()))).join("\n");
      }),
    );
    return walkDocument.run({ input: { html, js, css, data } });
  },
});

export const serveShow = operation({
  label: "mapScreens.serveShow",
  input: z.string(),
  depends: { root: screensRoot },
  run: ({ root }, { input: out }): Server<undefined> =>
    Bun.serve({
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        if (path.startsWith("/api/fonts/")) {
          return new Response(Bun.file(join(root, "src/kit/fonts", basename(path))));
        }
        const file = path === "/" ? "map-show.html" : path.slice(1);
        return new Response(Bun.file(join(out, file)));
      },
    }),
});

export const arrowLifts = operation({
  label: "mapScreens.arrowLifts",
  input: browser,
  depends: { mapArrowLift },
  run: async ({ mapArrowLift }, { input: browser }): Promise<Lifts> => {
    const tab = await browser.newPage();
    try {
      const boxes = await tab.evaluate((fonts) => {
        const pen = document.createElement("canvas").getContext("2d");
        if (!pen) throw new Error("no 2d context");

        pen.textBaseline = "middle";
        const [title, line] = [fonts.title, fonts.line].map((font) => {
          pen.font = font;
          const [text, arrow] = ["x", "→"].map((glyph) => {
            const box = pen.measureText(glyph);
            return { ascent: box.actualBoundingBoxAscent, descent: box.actualBoundingBoxDescent };
          });
          const none = { ascent: 0, descent: 0 };
          return { text: text ?? none, arrow: arrow ?? none };
        });
        const none = { text: { ascent: 0, descent: 0 }, arrow: { ascent: 0, descent: 0 } };
        return { title: title ?? none, line: line ?? none };
      }, captionFonts);
      return {
        title: mapArrowLift.run({ input: boxes.title }),
        line: mapArrowLift.run({ input: boxes.line }),
      };
    } finally {
      await tab.close();
    }
  },
});

export const captioned = operation({
  label: "mapScreens.captioned",
  input: z.object({
    browser,
    png: z.custom<Buffer>(),
    lines: z.array(z.array(z.object({ text: z.string(), arrow: z.boolean() }))),
    lifts: z.custom<Lifts>(),
  }),
  run: async (_, { input: { browser, png, lines, lifts } }) => {
    const tab = await browser.newPage();
    try {
      const data = await tab.evaluate(
        async ({ src, lines, lifts, look, fonts }) => {
          const image = await createImageBitmap(await (await fetch(src)).blob());
          const strip = look.pad * 2 + look.line * lines.length;
          const board = document.createElement("canvas");
          board.width = image.width;
          board.height = image.height + strip;
          const pen = board.getContext("2d");
          if (!pen) throw new Error("no 2d context");

          pen.fillStyle = "#ededeb";
          pen.fillRect(0, 0, board.width, board.height);
          pen.drawImage(image, 0, 0);
          pen.textBaseline = "middle";
          lines.forEach((parts, at) => {
            pen.fillStyle = at === 0 ? "#1f1f1d" : "#61615e";
            pen.font = at === 0 ? fonts.title : fonts.line;
            const lift = at === 0 ? lifts.title : lifts.line;
            const y = image.height + look.pad + look.line * at + look.line / 2;

            let x = 14;
            for (const part of parts) {
              pen.fillText(part.text, x, part.arrow ? y + lift : y);
              x += pen.measureText(part.text).width;
            }
          });
          return board.toDataURL("image/png");
        },
        {
          src: `data:image/png;base64,${png.toString("base64")}`,
          lines,
          lifts,
          look: captionLook,
          fonts: captionFonts,
        },
      );
      return Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
    } finally {
      await tab.close();
    }
  },
});

export const samePixels = operation({
  label: "mapScreens.samePixels",
  input: z.object({ browser, a: z.custom<Buffer>(), b: z.custom<Buffer>() }),
  depends: { noise: rasterNoise },
  run: async ({ noise }, { input: { browser, a, b } }) => {
    if (a.equals(b)) return true;

    const tab = await browser.newPage();
    try {
      return await tab.evaluate(
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
      await tab.close();
    }
  },
});

const shotDetail = z.object({ kind: z.string() }).loose();

export const takeShot = operation({
  label: "mapScreens.takeShot",
  input: z.object({
    browser,
    lifts: z.custom<Lifts>(),
    url: z.string(),
    map: z.custom<MapJson>(),
    plan: z.custom<ShowPlan>(),
  }),
  depends: { mapCaption, mapCaptionParts, captioned, time: shotTime, timeout: shotTimeoutMs },
  run: async (deps, { input: { browser, lifts, url, map, plan } }): Promise<Shot> => {
    const context = await browser.newContext({
      viewport: { width: mapShot.width, height: mapShot.height },
      deviceScaleFactor: 1,
      colorScheme: mapShot.theme,
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: "UTC",
    });
    try {
      const tab = await context.newPage();
      await tab.clock.setFixedTime(new Date(deps.time));
      const errors: string[] = [];
      tab.on("pageerror", (error) => errors.push(error.message));
      await tab.goto(`${url}/#${encodeURIComponent(plan.state)}`);
      tab.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });

      const marked = await tab
        .waitForFunction((mark) => document.documentElement.hasAttribute(mark), shownMark, {
          timeout: deps.timeout,
          polling: 100,
        })
        .then(
          () => true,
          () => false,
        );
      const missing = { state: plan.state, png: null };
      if (!marked) return { ...missing, why: `not shown: ${errors.join("; ")}` };

      const told = await tab.evaluate(
        (mark) => document.documentElement.getAttribute(mark),
        shownMark,
      );
      const detail = shotDetail.parse(JSON.parse(told ?? "{}"));
      if (detail.kind !== "shown" && detail.kind !== "pressed") {
        return { ...missing, why: JSON.stringify(detail) };
      }
      if (errors.length) return { ...missing, why: errors[0] ?? "" };

      await tab.addStyleTag({ content: "*{caret-color:transparent !important}" });
      await tab.evaluate(() => document.fonts.ready.then(() => undefined));
      const raw = await tab.screenshot({ type: "png", animations: "disabled" });
      const lines = deps.mapCaption.run({ input: { map, state: plan.state } });
      const parts = lines.map((line) => deps.mapCaptionParts.run({ input: line }));
      const png = await deps.captioned.run({ input: { browser, png: raw, lines: parts, lifts } });
      return { state: plan.state, png, why: null };
    } finally {
      await context.close();
    }
  },
});

export const cardsOf = operation({
  label: "mapScreens.cardsOf",
  input: z.object({
    entry,
    map: z.custom<MapJson>(),
    graph: z.custom<MapGraph>(),
    findings: z.custom<readonly MapFinding[]>(),
  }),
  depends: { mapCard, mapCardHtml, mapCaption, mapPictureHeight, mapFrameName },
  run: (deps, { input: { entry, map, graph, findings } }): Card[] =>
    map.states.map(({ state }) => {
      const plain = deps.mapCard.run({ input: { map, name: entry.name, state, graph } });
      const named = findings.filter((finding) => finding.states.includes(state));
      const check = named.length
        ? [{ head: "Check", lines: named.flatMap((finding) => finding.lines) }]
        : [];
      const card = { ...plain, sections: [...plain.sections, ...check] };

      const lines = deps.mapCaption.run({ input: { map, state } }).length;
      const least = deps.mapPictureHeight.run({ input: { screen: mapShot.height, lines } });
      const frame = deps.mapFrameName.run({ input: { map: entry.name, state } });
      return {
        state,
        name: `${frame} · ${cardMark}`,
        ...deps.mapCardHtml.run({ input: { card, least } }),
      };
    }),
});

export const mapFindingsOf = operation({
  label: "mapScreens.findingsOf",
  input: z.object({
    entries: z.custom<ReadonlyArray<{ entry: MapEntry; map: MapJson }>>(),
    designed: z.string(),
  }),
  depends: { readDesigned, mapCheck },
  run: ({ readDesigned, mapCheck }, { input: { entries, designed } }) => {
    const chosen = new Set<string>(entries.map(({ entry }) => entry.name));
    const input = {
      maps: entries.map(({ entry, map }) => ({ name: entry.name, map })),
      designed: readDesigned.run({ input: designed }),
    };
    return mapCheck.run({ input }).filter((finding) => chosen.has(finding.map));
  },
});

const actionInput = z.object({ input: z.instanceof(z.ZodType) });

export const mapOne = operation({
  label: "mapScreens.mapOne",
  input: z.object({
    browser,
    lifts: z.custom<Lifts>(),
    graph: z.custom<MapGraph>(),
    entry,
    work: z.string(),
    designed: z.string(),
  }),
  depends: {
    deriveOf,
    mapFindingsOf,
    showPlans,
    walkReplies,
    buildShowPage,
    buildWalk,
    serveShow,
    takeShot,
    cardsOf,
    root: screensRoot,
  },
  run: async (deps, { input: { browser, lifts, graph, entry, work, designed } }): Promise<Done> => {
    const found = await deps.deriveOf.run({ input: { root: deps.root, label: entry.cell } });
    const derived = found.kind === "derived" ? found.derived : null;
    if (!derived?.view) throw new Error(`map-screens: no view of ${entry.cell} in src/`);

    const map = derived.map;
    const findings = deps.mapFindingsOf.run({ input: { entries: [{ entry, map }], designed } });
    const inputs = Object.fromEntries(
      derived.actions.flatMap(({ name, unit }) => {
        const input = actionInput.safeParse(unit).data?.input;
        return input ? [[name, input]] : [];
      }),
    );
    const plans = deps.showPlans.run({ input: { map, contracts: derived.contracts, inputs } });
    const page = await deps.buildShowPage.run({ input: { entry, derived, plans, work } });
    const replies = deps.walkReplies.run({ input: derived.contracts });
    const data = { name: entry.name, map, replies };
    const walk = await deps.buildWalk.run({
      input: { entry, unitsFile: page.unitsFile, data, work },
    });

    const server = deps.serveShow.run({ input: page.out });
    try {
      const url = `http://127.0.0.1:${server.port}`;
      const shots = await Promise.all(
        plans.map((plan) =>
          deps.takeShot
            .run({ input: { browser, lifts, url, map, plan } })
            .catch((error: unknown) => ({
              state: plan.state,
              png: null,
              why: error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error),
            })),
        ),
      );
      const cards = deps.cardsOf.run({ input: { entry, map, graph, findings } });
      return { entry, map, shots, cards, walk, findings };
    } finally {
      await server.stop(true);
    }
  },
});
