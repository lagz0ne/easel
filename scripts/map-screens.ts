import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { createScope } from "@tinkered/core";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { z } from "zod";

import { maps, mapShot, mapsName } from "@/live/screens";
import type { MapEntry } from "@/live/screens";
import { mapCaption, mapColumns, mapFrameName, mapOrder, mapRelation } from "@/map/canvas";
import type { Relation } from "@/map/canvas";
import { showPlans, shownMark } from "@/map/show";
import type { ShowPlan } from "@/map/show";
import type { MapJson } from "@/map/text";
import { pressMarks } from "@/map/view";

import { deriveOf } from "./map";
import type { Derived } from "./map";

const usage = `bun scripts/map-screens.ts [--binary <file>] [--dry <dir>] [--map <name>]

Puts each map of src/live/screens.ts on product (SPEC-prototype ship 2). For each map it derives
the map of its cell (bun scripts/map.ts), builds the page cmds/map-show.html with the view of the
cell, and takes one picture of each state: the real view, with the sample of the state as a preset
of the cell, and for a state of a run the press of its action with the answer of its move. Each
picture goes to the page "Map · <name>" as the frame "<name> · <state>", in the section of the map:
the steps from the start as columns, each column in the order of the rows of the map. A picture
with the same pixels puts nothing; a changed one puts a new version of the same frame. The frame
"Maps" on the page Live lists each map with its first state and its count of states.
--dry <dir> writes the pictures and the list there, and puts nothing.

The writes go to EASEL_SERVER with EASEL_TOKEN when both are set, else to the hosts file of
EASEL_CONFIG_HOME (~/.config/easel-agent when not set): the member vibea-claude.
Exit: 0 when each state has its picture; 1 when a picture failed; 64 on a wrong argument.`;

const root = join(import.meta.dir, "..");
const canvas = "product";
const livePageName = "Live";
const fontDir = join(root, "src/kit/fonts");
const fixedTime = new Date("2026-11-24T10:00:00Z");
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

const argOf = (flag: string) => {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args[at + 1];
};

const binary = resolve(argOf("--binary") ?? join(root, "dist/server"));
const dryDir = argOf("--dry");
const onlyMap = argOf("--map");
const scope = createScope();
mkdirSync(join(root, "dist"), { recursive: true });
const work = mkdtempSync(join(root, "dist", "map-show-"));

type Shot = { state: string; png: Buffer | null; why: string | null };

type Frame = z.infer<typeof listed>["frames"][number];

const listed = z.object({
  rev: z.number(),
  frames: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      page: z.string().nullable(),
      version: z.number(),
      section: z.string().nullable().optional(),
    }),
  ),
});

const laidOut = z.object({
  sections: z.array(
    z.object({ key: z.string(), name: z.string(), columns: z.array(z.array(z.string())) }),
  ),
});

const written = z.object({ id: z.string(), version: z.number() });

function localChromium() {
  const found = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      'import { localChromium } from "./tests/support/chromium"; console.log(localChromium() ?? "")',
    ],
    { cwd: root },
  );
  return found.stdout.toString().trim();
}

function escaped(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unitsModule(entry: MapEntry, derived: Derived, plans: ShowPlan[]) {
  const view = derived.view ?? "";
  const imports = [
    `import { createElement } from "react";`,
    `import { ${entry.view.name} as View } from ${JSON.stringify(view)};`,
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
}

async function buildPage(entry: MapEntry, derived: Derived, plans: ShowPlan[]) {
  const dir = join(work, entry.name);
  mkdirSync(dir, { recursive: true });
  const unitsFile = join(dir, "units.ts");
  writeFileSync(unitsFile, unitsModule(entry, derived, plans));

  const view = derived.view ?? "";
  const marks = createScope();
  const built = await Bun.build({
    entrypoints: [join(root, "cmds/map-show.html")],
    outdir: join(dir, "out"),
    target: "browser",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [
      {
        name: "map-show",
        setup(build) {
          build.onResolve({ filter: /^map:units$/ }, () => ({ path: unitsFile }));
          build.onResolve({ filter: /^\/api\/fonts\// }, ({ path }) => ({ path, external: true }));
          build.onLoad({ filter: new RegExp(`^${escaped(view)}$`) }, async ({ path }) => ({
            contents: marks.run(pressMarks, {
              input: { file: path, source: await Bun.file(path).text() },
            }),
            loader: "tsx",
          }));
        },
      },
    ],
  });
  await marks.close();
  if (!built.success) {
    throw new Error(
      `map-screens: the page of ${entry.name} did not build: ${built.logs.map((log) => log.message).join("\n")}`,
    );
  }
  return join(dir, "out");
}

function serve(out: string) {
  return Bun.serve({
    port: 0,
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      if (path.startsWith("/api/fonts/")) {
        return new Response(Bun.file(join(fontDir, basename(path))));
      }
      const file = path === "/" ? "map-show.html" : path.slice(1);
      return new Response(Bun.file(join(out, file)));
    },
  });
}

async function takeOne(browser: Browser, url: string, map: MapJson, plan: ShowPlan): Promise<Shot> {
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
    await tab.clock.setFixedTime(fixedTime);
    const errors: string[] = [];
    tab.on("pageerror", (error) => errors.push(error.message));
    await tab.goto(`${url}/#${encodeURIComponent(plan.state)}`);
    tab.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const marked = await tab
      .waitForFunction((mark) => document.documentElement.hasAttribute(mark), shownMark, {
        timeout: 20_000,
        polling: 100,
      })
      .then(
        () => true,
        () => false,
      );
    if (!marked) return { state: plan.state, png: null, why: `not shown: ${errors.join("; ")}` };
    const told = await tab.evaluate(
      (mark) => document.documentElement.getAttribute(mark),
      shownMark,
    );
    const detail = z
      .object({ kind: z.string() })
      .loose()
      .parse(JSON.parse(told ?? "{}"));
    if (detail.kind !== "shown" && detail.kind !== "pressed") {
      return { state: plan.state, png: null, why: JSON.stringify(detail) };
    }
    if (errors.length) return { state: plan.state, png: null, why: errors[0] ?? "" };

    await tab.addStyleTag({ content: "*{caret-color:transparent !important}" });
    await tab.evaluate(() => document.fonts.ready.then(() => undefined));
    const raw = await tab.screenshot({ type: "png" });
    const lines = scope.run(mapCaption, { input: { map, state: plan.state } });
    return { state: plan.state, png: await captioned(browser, raw, lines), why: null };
  } finally {
    await context.close();
  }
}

async function captioned(browser: Browser, png: Buffer, lines: string[]) {
  const tab = await browser.newPage();
  try {
    const data = await tab.evaluate(
      async ({ src, lines }) => {
        const image = await createImageBitmap(await (await fetch(src)).blob());
        const line = 22;
        const pad = 14;
        const strip = pad * 2 + line * lines.length;
        const board = document.createElement("canvas");
        board.width = image.width;
        board.height = image.height + strip;
        const pen = board.getContext("2d");
        if (!pen) throw new Error("no 2d context");

        pen.fillStyle = "#ededeb";
        pen.fillRect(0, 0, board.width, board.height);
        pen.drawImage(image, 0, 0);
        pen.textBaseline = "middle";
        lines.forEach((text, at) => {
          pen.fillStyle = at === 0 ? "#1f1f1d" : "#61615e";
          pen.font = at === 0 ? "600 15px sans-serif" : "14px sans-serif";
          pen.fillText(text, 14, image.height + pad + line * at + line / 2);
        });
        return board.toDataURL("image/png");
      },
      { src: `data:image/png;base64,${png.toString("base64")}`, lines },
    );
    return Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
  } finally {
    await tab.close();
  }
}

async function samePixels(browser: Browser, a: Buffer, b: Buffer) {
  if (a.equals(b)) return true;

  const tab = await browser.newPage();
  try {
    return await tab.evaluate(
      async ({ one, two }) => {
        const read = async (src: string) => {
          const image = await createImageBitmap(await (await fetch(src)).blob());
          const board = new OffscreenCanvas(image.width, image.height);
          const pen = board.getContext("2d");
          if (!pen) throw new Error("no 2d context");

          pen.drawImage(image, 0, 0);
          return pen.getImageData(0, 0, image.width, image.height).data;
        };
        const [x, y] = [await read(one), await read(two)];
        return x.length === y.length && x.every((v, i) => v === y[i]);
      },
      {
        one: `data:image/png;base64,${a.toString("base64")}`,
        two: `data:image/png;base64,${b.toString("base64")}`,
      },
    );
  } finally {
    await tab.close();
  }
}

function easel(command: Array<string>) {
  const env: Record<string, string | undefined> = { ...process.env };
  if (!(env.EASEL_TOKEN && env.EASEL_SERVER)) {
    env.EASEL_CONFIG_HOME =
      env.EASEL_CONFIG_HOME || join(process.env.HOME ?? "", ".config/easel-agent");
  }
  const out = Bun.spawnSync([binary, ...command, "--json"], { env });
  if (out.exitCode !== 0) {
    throw new Error(
      `map-screens: easel ${command.join(" ")}: ${out.stdout.toString()}${out.stderr.toString()}`,
    );
  }
  return JSON.parse(out.stdout.toString().trim().split("\n").at(-1) ?? "null");
}

function pageKey(name: string) {
  const pages = z.object({ pages: z.array(z.object({ key: z.string(), name: z.string() })) });
  const found = pages.parse(easel(["pages", canvas])).pages.find((page) => page.name === name);
  if (found) return found.key;
  return z.object({ key: z.string() }).parse(easel(["page", "new", canvas, name])).key;
}

function framesOn(page: string) {
  const frames = listed.parse(easel(["ls", canvas])).frames.filter((frame) => frame.page === page);
  return new Map(frames.map((frame) => [frame.name, frame]));
}

function placeFlags(to: Relation, page: string) {
  switch (to.kind) {
    case "section":
      return ["--page", page, "--section", to.section];
    case "after":
      return ["--after", to.id];
    case "below":
      return ["--below", to.id];
  }
}

function sectionName(entry: MapEntry) {
  return `${entry.name}: the map of ${entry.cell}`;
}

function goneName(entry: MapEntry) {
  return `${entry.name}: states that the map does not have now`;
}

async function putShot(browser: Browser, frame: Frame | undefined, file: string, png: Buffer) {
  if (!frame) return null;
  const old = join(work, `old-${frame.id}.png`);
  easel(["get", canvas, frame.id, "-o", old]);
  if (await samePixels(browser, readFileSync(old), png)) return "same";

  easel(["put", canvas, file, "--id", frame.id, "--base", String(frame.version)]);
  return "next";
}

type Board = {
  entry: MapEntry;
  page: string;
  section: string;
  columns: string[][];
  byName: Map<string, Frame>;
  ids: Record<string, string>;
  words: string[];
};

async function putState(browser: Browser, board: Board, state: string, shot: Shot | undefined) {
  const { entry, page, section, columns, ids, words } = board;
  const name = scope.run(mapFrameName, { input: { map: entry.name, state } });
  const frame = board.byName.get(name);
  if (frame) ids[state] = frame.id;
  if (!shot?.png) return void words.push(`${state}: failed: ${shot?.why ?? "no picture"}`);

  const file = join(work, `${entry.name}-${columns.flat().indexOf(state)}.png`);
  writeFileSync(file, shot.png);
  const put = await putShot(browser, frame, file, shot.png);
  if (put) return void words.push(`${state}: ${put}`);

  const to = scope.run(mapRelation, { input: { section, columns, ids, state } });
  const made = written.parse(easel(["put", canvas, file, "--name", name, ...placeFlags(to, page)]));
  ids[state] = made.id;
  words.push(`${state}: new`);
}

function moveGone(board: Board) {
  const { entry, page, ids, words } = board;
  const before = laidOut.parse(easel(["layout", canvas, "--page", page]));
  const gone = before.sections.find((each) => each.name === goneName(entry))?.columns.flat();
  const known = new Set([...Object.values(ids), ...(gone ?? [])]);

  for (const frame of framesOn(page).values()) {
    if (known.has(frame.id)) continue;

    easel(["move", canvas, frame.id, "--page", page, "--section", goneName(entry)]);
    words.push(`${frame.name}: not in the map now`);
  }
}

function putOrder(board: Board) {
  const { page, section, columns, ids, words } = board;
  const layout = laidOut.parse(easel(["layout", canvas, "--page", page]));
  const now = layout.sections.find((each) => each.name === section)?.columns ?? [];
  const want = columns.map((column) => column.flatMap((state) => ids[state] ?? []));
  const moves = scope.run(mapOrder, { input: { section, want, now } });

  for (const move of moves) easel(["move", canvas, move.id, ...placeFlags(move.to, page)]);
  if (moves.length) words.push(`order: ${moves.length} moves`);
}

async function putMap(browser: Browser, entry: MapEntry, map: MapJson, shots: Shot[]) {
  const page = pageKey(`Map · ${entry.name}`);
  const columns = scope.run(mapColumns, { input: map.states });
  const board: Board = {
    entry,
    page,
    section: sectionName(entry),
    columns,
    byName: framesOn(page),
    ids: {},
    words: [],
  };

  for (const state of columns.flat()) {
    await putState(
      browser,
      board,
      state,
      shots.find((each) => each.state === state),
    );
  }

  moveGone(board);
  putOrder(board);
  return { page, words: board.words };
}

function listHtml(rows: Array<{ entry: MapEntry; map: MapJson; page: string }>) {
  const cells = rows
    .map(
      ({ entry, map }) =>
        `<tr><td>${entry.name}</td><td>Map · ${entry.name}</td><td>${map.cell}</td><td>${map.start}</td><td>${map.states.length}</td></tr>`,
    )
    .join("");
  return `<main style="font-family:var(--e-font);padding:32px;background:var(--e-bg);color:var(--e-text)"><h1 style="margin:0 0 8px">Maps</h1><p style="margin:0 0 16px;color:var(--e-muted)">Each map of the product: its page, its cell, its first state and its count of states. bun scripts/map-screens.ts puts them after each deploy.</p><table style="border-collapse:collapse;width:100%"><thead><tr><th align="left">Map</th><th align="left">Page</th><th align="left">Cell</th><th align="left">First state</th><th align="left">States</th></tr></thead><tbody>${cells}</tbody></table></main>`;
}

function putList(html: string) {
  const page = pageKey(livePageName);
  const frame = framesOn(page).get(mapsName);
  const file = join(work, "maps.html");
  writeFileSync(file, html);
  if (!frame) {
    easel(["put", canvas, file, "--name", mapsName, "--page", page, "--size", "960x400"]);
    return "new";
  }

  const old = join(work, "old-maps.html");
  easel(["get", canvas, frame.id, "-o", old]);
  if (readFileSync(old, "utf8") === html) return "same";
  easel(["put", canvas, file, "--id", frame.id, "--base", String(frame.version)]);
  return "next";
}

async function mapOne(browser: Browser, entry: MapEntry) {
  const derived = await deriveOf(entry.cell);
  if (!derived?.view) throw new Error(`map-screens: no view of ${entry.cell} in src/`);

  const inputs = Object.fromEntries(
    derived.actions.flatMap(({ name, unit }) => {
      const input = z.object({ input: z.instanceof(z.ZodType) }).safeParse(unit).data?.input;
      return input ? [[name, input]] : [];
    }),
  );
  const plans = scope.run(showPlans, {
    input: { map: derived.map, contracts: derived.contracts, inputs },
  });
  const out = await buildPage(entry, derived, plans);
  const server = serve(out);
  try {
    const url = `http://127.0.0.1:${server.port}`;
    const shots = await Promise.all(
      plans.map((plan) =>
        takeOne(browser, url, derived.map, plan).catch((error: unknown) => ({
          state: plan.state,
          png: null,
          why: error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error),
        })),
      ),
    );
    return { entry, map: derived.map, shots };
  } finally {
    await server.stop(true);
  }
}

const browser = await chromium.launch({
  executablePath: localChromium() || chromium.executablePath(),
});

try {
  const chosen = maps.filter((entry) => !onlyMap || entry.name === onlyMap);
  if (!chosen.length) {
    console.error(usage);
    process.exitCode = 64;
  }

  const done = [];
  for (const entry of chosen) done.push(await mapOne(browser, entry));

  let failed = 0;
  const rows = [];
  for (const { entry, map, shots } of done) {
    failed += shots.filter((shot) => !shot.png).length;
    if (dryDir) {
      mkdirSync(dryDir, { recursive: true });
      for (const shot of shots) {
        const name = scope.run(mapFrameName, { input: { map: entry.name, state: shot.state } });
        if (shot.png) writeFileSync(join(dryDir, `${name}.png`), shot.png);
        console.log(`map-screens: ${name}: ${shot.png ? "taken" : `failed: ${shot.why}`}`);
      }
      rows.push({ entry, map, page: `Map · ${entry.name}` });
      continue;
    }

    const put = await putMap(browser, entry, map, shots);
    for (const word of put.words) console.log(`map-screens: ${entry.name} · ${word}`);
    rows.push({ entry, map, page: put.page });
  }

  const html = listHtml(rows);
  if (dryDir) writeFileSync(join(dryDir, "maps.html"), html);
  else if (rows.length) console.log(`map-screens: ${mapsName}: ${putList(html)}`);

  console.log(
    `map-screens: ${done.length} maps, ${failed} pictures failed: ${failed ? "red" : "OK"}`,
  );
  if (failed) process.exitCode = 1;
} finally {
  await browser.close();
  await scope.close();
  rmSync(work, { recursive: true, force: true });
}
