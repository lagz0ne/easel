import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope, data, operation, rpc } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { mapCheck, mapCheckText, mapDesignLines, mapsListHtml } from "@/map/check";
import type { MapFinding } from "@/map/check";
import { deriveMap } from "@/map/derive";
import { placeMap } from "@/map/place";
import type { MapJson } from "@/map/text";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function scope() {
  const app = await createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] }).ready;
  closers.push(() => app.close());
  return app;
}

const step = data<{ kind: string }>({ label: "fixture.step", initial: { kind: "idle" } });

const twoAnswers = {
  "fixture.go": {
    input: z.null(),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("done") }),
      z.object({ kind: z.literal("refused") }),
    ]),
  },
};

const threeAnswers = {
  "fixture.go": {
    input: z.null(),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("done") }),
      z.object({ kind: z.literal("refused") }),
      z.object({ kind: z.literal("later") }),
    ]),
  },
};

const twoApi = rpc(twoAnswers);

const threeApi = rpc(threeAnswers);

const go = operation({
  label: "fixture.go",
  depends: { go: twoApi["fixture.go"], step: step.controller },
  run: async ({ go, step }) => step.set({ kind: (await go.run({ input: null })).kind }),
});

const goWithLater = operation({
  label: "fixture.go",
  depends: { go: threeApi["fixture.go"], step: step.controller },
  run: async ({ go, step }) => step.set({ kind: (await go.run({ input: null })).kind }),
});

type App = Awaited<ReturnType<typeof scope>>;

async function mapOf(app: App, unit: unknown, contract: Record<string, unknown>): Promise<MapJson> {
  const offers = {
    kind: "view" as const,
    states: [{ state: "idle", actions: [{ unit, name: "go", reads: [] }] }],
  };
  const found = await app.run(deriveMap, { input: { cell: step, offers, contracts: [contract] } });
  const places = app.run(placeMap, {
    input: {
      start: found.start,
      states: found.states.map((each) => each.state),
      moves: found.moves,
    },
  });
  return {
    cell: found.cell,
    start: found.start,
    view: null,
    calls: found.calls,
    states: places.flatMap((place) => {
      const state = found.states.find((each) => each.state === place.state);
      return state
        ? [{ ...place, sample: state.sample, actions: state.actions, run: state.run }]
        : [];
    }),
    moves: found.moves.map(({ rank: _rank, ...move }) => move),
    stays: found.stays,
  };
}

function numbered(lines: readonly string[]) {
  return lines.map((text, at) => ({ line: at + 1, text }));
}

test("the designed lines of a map name each state and each answer, sorted", async () => {
  const app = await scope();
  const map = await mapOf(app, go, twoAnswers);

  expect(app.run(mapDesignLines, { input: { name: "fixture", map } })).toEqual([
    "fixture: answer fixture.go done",
    "fixture: answer fixture.go fault link",
    "fixture: answer fixture.go refused",
    "fixture: state done",
    "fixture: state idle",
    "fixture: state refused",
  ]);
});

test("one more answer of a call is one finding, and with the answer removed the check is OK (J8)", async () => {
  const app = await scope();
  const designed = numbered(
    app.run(mapDesignLines, { input: { name: "fixture", map: await mapOf(app, go, twoAnswers) } }),
  );

  const later = await mapOf(app, goWithLater, threeAnswers);
  expect(
    app.run(mapCheck, { input: { maps: [{ name: "fixture", map: later }], designed } }),
  ).toEqual([
    {
      rule: "map/answer",
      map: "fixture",
      at: { kind: "call", call: "fixture.go", answer: "later" },
      what: "fixture: fixture.go later is a new answer: idle, fixture.go → later. The state later has no designed frame.",
      lines: [
        "fixture.go later is a new answer.",
        "idle, fixture.go → later",
        "The state later has no designed frame.",
      ],
      states: ["later"],
    },
  ]);

  const back = await mapOf(app, go, twoAnswers);
  expect(
    app.run(mapCheck, { input: { maps: [{ name: "fixture", map: back }], designed } }),
  ).toEqual([]);
});

test("a state that no new answer reaches, and a line that the code does not have, are findings", async () => {
  const app = await scope();
  const later = await mapOf(app, goWithLater, threeAnswers);
  const lines = app.run(mapDesignLines, { input: { name: "fixture", map: later } });

  const noState = numbered(lines.filter((line) => line !== "fixture: state later"));
  expect(
    app.run(mapCheck, { input: { maps: [{ name: "fixture", map: later }], designed: noState } }),
  ).toEqual([
    {
      rule: "map/state",
      map: "fixture",
      at: { kind: "state", state: "later", press: null },
      what: "fixture: the state later has no designed frame: idle, fixture.go, fixture.go later → later.",
      lines: [
        "The state later has no designed frame.",
        "idle, fixture.go, fixture.go later → later",
      ],
      states: ["later"],
    },
  ]);

  const two = await mapOf(app, go, twoAnswers);
  const stale = numbered([...lines, "other: state gone"]);
  expect(
    app.run(mapCheck, { input: { maps: [{ name: "fixture", map: two }], designed: stale } }),
  ).toEqual([
    {
      rule: "map/gone",
      map: "fixture",
      at: { kind: "record", line: 3 },
      what: "fixture: answer fixture.go later: in maps.designed, not in the code.",
      lines: ["fixture: answer fixture.go later: in maps.designed, not in the code."],
      states: [],
    },
    {
      rule: "map/gone",
      map: "fixture",
      at: { kind: "record", line: 7 },
      what: "fixture: state later: in maps.designed, not in the code.",
      lines: ["fixture: state later: in maps.designed, not in the code."],
      states: [],
    },
    {
      rule: "map/gone",
      map: "other",
      at: { kind: "record", line: 9 },
      what: "other: state gone: in maps.designed, not in the code.",
      lines: ["other: state gone: in maps.designed, not in the code."],
      states: [],
    },
  ]);
});

test("an answer that changes no state, and an action with no answer, name what the person sees", async () => {
  const app = await scope();
  const map: MapJson = {
    cell: "fixture.step",
    start: "idle",
    view: null,
    calls: [{ call: "fixture.wait", answers: ["done", "pending", "link"] }],
    states: [
      { state: "idle", column: 0, row: 0, sample: {}, actions: ["f.go", "f.back"], run: null },
      { state: "done", column: 1, row: 0, sample: {}, actions: [], run: null },
      {
        state: "idle · go pending",
        column: 1,
        row: 1,
        sample: {},
        actions: [],
        run: { from: "idle", action: "f.go", press: "go", status: "pending" },
      },
    ],
    moves: [
      {
        from: "idle",
        to: "done",
        action: "f.go",
        answer: { call: "fixture.wait", kind: "done", fault: false },
        effects: [],
      },
      { from: "idle", to: "idle · go pending", action: "f.go", answer: null, effects: [] },
    ],
    stays: [
      {
        state: "idle",
        action: "f.go",
        answer: { call: "fixture.wait", kind: "link", fault: true },
        effects: [],
      },
      { state: "idle", action: "f.back", answer: null, effects: [] },
    ],
  };
  const findings = app.run(mapCheck, { input: { maps: [{ name: "f", map }], designed: [] } });

  expect(findings.map((finding) => [finding.rule, finding.what])).toEqual([
    [
      "map/answer",
      "f: fixture.wait done is a new answer: idle, f.go → done. The state done has no designed frame.",
    ],
    [
      "map/answer",
      "f: fixture.wait pending is a new answer: no move and no stay has it, so the screen does not change.",
    ],
    ["map/answer", "f: fixture.wait fault link is a new answer: idle, f.go → stays on idle."],
    [
      "map/answer",
      "f: f.go with no answer is a new answer: idle → idle · go pending. The state idle · go pending has no designed frame.",
    ],
    ["map/answer", "f: f.back with no answer is a new answer: idle → stays on idle."],
    ["map/state", "f: the state idle has no designed frame: the first state of the map."],
  ]);
  expect(findings.at(3)?.at).toEqual({ kind: "action", action: "f.go" });
  expect(findings.at(-1)?.at).toEqual({ kind: "state", state: "idle", press: null });
});

test("the text of the check: each finding, its fix once for each rule, then what to do next", async () => {
  const app = await scope();
  const located = [
    { path: "src/a.ts", line: 4, rule: "map/answer", what: "m: a.go later is a new answer." },
    { path: "src/a.ts", line: 9, rule: "map/state", what: "m: the state x has no designed frame." },
    { path: "maps.designed", line: 2, rule: "map/gone", what: "m: state y: in maps.designed." },
    { path: "src/a.ts", line: 1, rule: "map/answer", what: "m: a.go sooner is a new answer." },
  ];

  const text = app.run(mapCheckText, {
    input: { findings: located, count: { maps: 1, states: 3, answers: 4 } },
  });
  const lines = text.split("\n");
  expect(lines[0]).toBe("maps.designed:2 map/gone m: state y: in maps.designed.");
  expect(lines[1]).toBe("  fix: run bun cmds/map-check.ts --write, and commit maps.designed.");
  expect(lines[3]).toBe("src/a.ts:1 map/answer m: a.go sooner is a new answer.");
  expect(lines[4]).toMatch(/^ {2}fix: look at the picture of each state that it names/);
  expect(text).toContain(
    "\n\nsrc/a.ts:4 map/answer m: a.go later is a new answer.\n  fix: as above\n",
  );
  expect(text).toContain(
    "\n\nsrc/a.ts:9 map/state m: the state x has no designed frame.\n  fix: as above\n",
  );
  expect(lines.slice(-3)).toEqual([
    "map check: failed, 4 findings.",
    "Next: fix each finding, then run bun cmds/map-check.ts again.",
    "",
  ]);

  expect(
    app.run(mapCheckText, { input: { findings: [], count: { maps: 1, states: 3, answers: 4 } } }),
  ).toBe("map check: OK (1 map, 3 states, 4 answers)\n");
});

test("the frame Maps marks a map with a finding, and says OK for a map with none (J8, J9)", async () => {
  const app = await scope();
  const finding: MapFinding = {
    rule: "map/answer",
    map: "sign-in",
    at: { kind: "call", call: "browser.wait", answer: "blocked" },
    what: "sign-in: browser.wait blocked is a new answer: code, home.askForCode → <blocked>.",
    lines: ["browser.wait blocked is a new answer.", "code, home.askForCode → <blocked>"],
    states: ["blocked"],
  };
  const rows = [
    { name: "sign-in", cell: "home.signInStep", start: "name", states: 11, findings: [finding] },
    { name: "home", cell: "home.view", start: "list", states: 2, findings: [] },
  ];

  const html = app.run(mapsListHtml, { input: rows });
  expect(html).toContain('<span class="badge badge-warning">1 finding</span>');
  expect(html).toContain('<span class="badge badge-success">OK</span>');
  expect(html).toContain("code, home.askForCode → &lt;blocked&gt;.");
  expect(html).toContain('data-easel-walk="sign-in"');
  expect(html).toContain('<th align="left">Check</th>');

  const clean = app.run(mapsListHtml, { input: rows.slice(1) });
  expect(clean).not.toContain("badge-warning");
  expect(clean).not.toContain("<ul");
});

async function check(...args: string[]) {
  const child = Bun.spawn([process.execPath, "cmds/map-check.ts", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, out, err };
}

test("the maps of easel have no finding: each state and each answer is designed", async () => {
  expect(await check()).toEqual({
    code: 0,
    out: "map check: OK (1 map, 10 states, 13 answers)\n",
    err: "",
  });
});

test("the check on easel finds an answer that maps.designed does not have, and a line it does not need", async () => {
  const dir = mkdtempSync(join(tmpdir(), "map-check-"));
  const file = join(dir, "maps.designed");
  const lines = readFileSync(join(root, "maps.designed"), "utf8").trimEnd().split("\n");
  const kept = lines.filter((line) => line !== "sign-in: answer browser.wait slow");
  writeFileSync(file, `${[...kept, "sign-in: state gone"].join("\n")}\n`);
  const contract = readFileSync(join(root, "src/access/contract.ts"), "utf8").split("\n");
  const waitAt = contract.findIndex((line) => line.includes('"browser.wait":')) + 1;

  const found = await check("--designed", file);
  expect(found.code).toBe(1);
  expect(found.out).toContain(
    `${file}:${kept.length + 1} map/gone sign-in: state gone: in maps.designed, not in the code.`,
  );
  expect(found.out).toMatch(
    new RegExp(
      `\\nsrc/access/contract\\.ts:(\\d+) map/answer sign-in: browser\\.wait slow is a new answer: no move and no stay has it, so the screen does not change\\.\\n`,
    ),
  );
  const at = Number(/contract\.ts:(\d+) map\/answer/.exec(found.out)?.[1]);
  expect(at).toBeGreaterThanOrEqual(waitAt);
  expect(
    found.out.endsWith(
      "map check: failed, 2 findings.\nNext: fix each finding, then run bun cmds/map-check.ts again.\n",
    ),
  ).toBe(true);

  const written = await check("--write", "--designed", file);
  expect(written.code).toBe(0);
  expect(readFileSync(file, "utf8")).toBe(readFileSync(join(root, "maps.designed"), "utf8"));
});

test("a wrong argument exits 64 with the usage text", async () => {
  const wrong = await check("--what");
  expect(wrong.code).toBe(64);
  expect(wrong.err).toContain("bun cmds/map-check.ts [--write] [--designed <file>]");
});
