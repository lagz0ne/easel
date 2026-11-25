import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { mapJson } from "./text";
import type { MapJson } from "./text";
import { walkAttribute } from "./walk";

export const designedFile = "maps.designed";

export const mapRules = z.enum(["map/answer", "map/state", "map/gone"]);

const findingAt = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("call"), call: z.string(), answer: z.string() }),
  z.object({ kind: z.literal("action"), action: z.string() }),
  z.object({ kind: z.literal("state"), state: z.string(), press: z.string().nullable() }),
  z.object({ kind: z.literal("record"), line: z.number() }),
]);

export const mapFinding = z.object({
  rule: mapRules,
  map: z.string(),
  at: findingAt,
  what: z.string(),
  lines: z.array(z.string()),
  states: z.array(z.string()),
});

export type MapFinding = z.infer<typeof mapFinding>;

type Outcome = { from: string; to: string; action: string; said: string };

type Designed = {
  line: string;
  at: MapFinding["at"];
  head: string;
  outcomes: Outcome[];
};

export const checkWords = resource({
  label: "map.checkWords",
  target: "scope",
  factory: () => {
    const noFrame = "no designed frame";
    const faultKind = "link";
    const faultWord = "fault";
    const stayWord = "stays on";
    const entities: Readonly<Record<string, string>> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };
    const badges = { ok: "badge badge-success", found: "badge badge-warning" } as const;

    const words = {
      isFault: (answers: readonly string[], at: number) =>
        at === answers.length - 1 && answers[at] === faultKind,

      kindOf: (kind: string, fault: boolean) => (fault ? `${faultWord} ${kind}` : kind),

      outcomesOf: (map: MapJson, match: (said: MapJson["moves"][number]["answer"]) => boolean) => {
        const moves = map.moves
          .filter((move) => match(move.answer))
          .map((move) => ({ from: move.from, to: move.to, action: move.action }));
        const stays = map.stays
          .filter((stay) => match(stay.answer))
          .map((stay) => ({ from: stay.state, to: stay.state, action: stay.action }));
        return [...moves, ...stays].map((each) => {
          const said = each.from === each.to ? `${stayWord} ${each.to}` : each.to;
          return { ...each, said };
        });
      },

      answersOf: (name: string, map: MapJson): Designed[] => {
        const ofCalls = map.calls.flatMap(({ call, answers }) =>
          answers.map((kind, at) => {
            const fault = words.isFault(answers, at);
            const head = `${call} ${words.kindOf(kind, fault)}`;
            const outcomes = words.outcomesOf(
              map,
              (said) => said?.call === call && said.kind === kind && said.fault === fault,
            );
            return {
              line: `${name}: answer ${head}`,
              at: { kind: "call" as const, call, answer: kind },
              head,
              outcomes,
            };
          }),
        );
        const silent = [...map.moves, ...map.stays].flatMap((each) =>
          each.answer ? [] : [each.action],
        );
        const ofActions = [...new Set(silent)].map((action) => ({
          line: `${name}: answer ${action} no answer`,
          at: { kind: "action" as const, action },
          head: `${action} with no answer`,
          outcomes: words
            .outcomesOf(map, (said) => said === null)
            .filter((outcome) => outcome.action === action)
            .map((outcome) => ({ ...outcome, action: "" })),
        }));
        return [...ofCalls, ...ofActions];
      },

      stateLine: (name: string, state: string) => `${name}: state ${state}`,

      outcomeText: (outcome: Outcome) => {
        const by = outcome.action ? `${outcome.from}, ${outcome.action}` : outcome.from;
        return `${by} → ${outcome.said}`;
      },

      framesText: (states: readonly string[]) => {
        if (!states.length) return "";

        const [only] = states;
        return states.length === 1
          ? ` The state ${only} has ${noFrame}.`
          : ` The states ${states.join(", ")} have ${noFrame}.`;
      },

      answerWhat: (name: string, designed: Designed, unframed: readonly string[]) => {
        const outcomes = [...new Set(designed.outcomes.map(words.outcomeText))];
        const leads = outcomes.length
          ? outcomes.join("; ")
          : "no move and no stay has it, so the screen does not change";
        const frames = words.framesText(unframed);
        const lines = [
          `${designed.head} is a new answer.`,
          ...(outcomes.length ? outcomes : [`${leads}.`]),
        ];
        return {
          what: `${name}: ${designed.head} is a new answer: ${leads}.${frames}`,
          lines: frames ? [...lines, frames.trim()] : lines,
        };
      },

      stateWhat: (name: string, map: MapJson, state: string) => {
        const into = map.moves
          .filter((move) => move.to === state)
          .map((move) => {
            const said = move.answer
              ? `, ${move.answer.call} ${words.kindOf(move.answer.kind, move.answer.fault)}`
              : "";
            return `${move.from}, ${move.action}${said} → ${state}`;
          });
        const ways = into.length ? [...new Set(into)] : ["the first state of the map"];
        return {
          what: `${name}: the state ${state} has no designed frame: ${ways.join("; ")}.`,
          lines: [`The state ${state} has no designed frame.`, ...ways],
        };
      },

      escaped: (text: string) => text.replace(/[&<>"]/g, (mark) => entities[mark] ?? mark),

      badgeOf: (count: number) => {
        if (!count) return `<span class="${badges.ok}">OK</span>`;

        const said = count === 1 ? "1 finding" : `${count} findings`;
        return `<span class="${badges.found}">${said}</span>`;
      },
    };

    return words;
  },
});

export const mapDesignLines = operation({
  label: "map.designLines",
  input: z.object({ name: z.string(), map: mapJson }),
  depends: { words: checkWords },
  run: ({ words }, { input: { name, map } }) => {
    const states = map.states.map((each) => words.stateLine(name, each.state));
    const answers = words.answersOf(name, map).map((each) => each.line);
    return [...new Set([...states, ...answers])].sort();
  },
});

const recordLine = z.object({ line: z.number(), text: z.string() });

export const mapCheck = operation({
  label: "map.check",
  input: z.object({
    maps: z.array(z.object({ name: z.string(), map: mapJson })),
    designed: z.array(recordLine),
  }),
  depends: { words: checkWords },
  run: ({ words }, { input }): MapFinding[] => {
    const record = new Set(input.designed.map((each) => each.text));
    const inCode = new Set<string>();

    const found = input.maps.flatMap(({ name, map }) => {
      const states = map.states.map((each) => ({
        line: words.stateLine(name, each.state),
        state: each,
      }));
      const answers = words.answersOf(name, map);
      for (const each of [...states, ...answers]) inCode.add(each.line);

      const newStates = new Set(
        states.filter((each) => !record.has(each.line)).map((each) => each.state.state),
      );
      const newAnswers = answers.filter((each) => !record.has(each.line));
      const moved = newAnswers.map((each) => ({
        each,
        to: each.outcomes.filter((one) => one.from !== one.to).map((one) => one.to),
      }));
      const reached = new Set(moved.flatMap((one) => one.to));

      const answerFindings = moved.map(({ each, to }): MapFinding => {
        const unframed = [...new Set(to)].filter((state) => newStates.has(state));
        const { what, lines } = words.answerWhat(name, each, unframed);
        return { rule: "map/answer", map: name, at: each.at, what, lines, states: unframed };
      });
      const stateFindings = states
        .filter((each) => newStates.has(each.state.state) && !reached.has(each.state.state))
        .map(({ state }): MapFinding => ({
          rule: "map/state",
          map: name,
          at: { kind: "state", state: state.state, press: state.run?.press ?? null },
          ...words.stateWhat(name, map, state.state),
          states: [state.state],
        }));
      return [...answerFindings, ...stateFindings];
    });

    const gone = input.designed
      .filter((each) => !inCode.has(each.text))
      .map((each): MapFinding => {
        const what = `${each.text}: in ${designedFile}, not in the code.`;
        const map = each.text.split(": ")[0] ?? "";
        const at = { kind: "record" as const, line: each.line };
        return { rule: "map/gone", map, at, what, lines: [what], states: [] };
      });
    return [...found, ...gone];
  },
});

const located = z.object({
  path: z.string(),
  line: z.number(),
  rule: z.string(),
  what: z.string(),
});

const fixes: Readonly<Record<string, readonly string[]>> = {
  "map/answer": [
    "fix: look at the picture of each state that it names: bun scripts/map-screens.ts --dry <dir>.",
    "When a screen is not right, change the view. Then run bun cmds/map-check.ts --write.",
    `Commit ${designedFile} with the change: its diff is the sign-off (SPEC-prototype decision 40).`,
  ],
  "map/gone": [`fix: run bun cmds/map-check.ts --write, and commit ${designedFile}.`],
};

export const mapCheckText = operation({
  label: "map.checkText",
  input: z.object({
    findings: z.array(located),
    count: z.object({ maps: z.number(), states: z.number(), answers: z.number() }),
  }),
  run: (_, { input: { findings, count } }) => {
    if (!findings.length) {
      const maps = count.maps === 1 ? "1 map" : `${count.maps} maps`;
      return `map check: OK (${maps}, ${count.states} states, ${count.answers} answers)\n`;
    }

    const sorted = findings.toSorted(
      (a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule),
    );
    const shown = new Set<string>();
    const blocks = sorted.map((finding) => {
      const fix = fixes[finding.rule === "map/gone" ? "map/gone" : "map/answer"] ?? [];
      const key = fix.join("\n");
      const said = shown.has(key) ? ["fix: as above"] : fix;
      shown.add(key);

      const head = `${finding.path}:${finding.line} ${finding.rule} ${finding.what}`;
      return [head, ...said.map((line) => `  ${line}`)].join("\n");
    });
    const total = findings.length === 1 ? "1 finding" : `${findings.length} findings`;
    return [
      blocks.join("\n\n"),
      "",
      `map check: failed, ${total}.`,
      "Next: fix each finding, then run bun cmds/map-check.ts again.",
      "",
    ].join("\n");
  },
});

const listRow = z.object({
  name: z.string(),
  cell: z.string(),
  start: z.string(),
  states: z.number(),
  findings: z.array(mapFinding),
});

const listClasses = {
  main: "box-border h-full m-0 bg-background font-sans text-foreground",
  about: "text-muted-foreground",
  walk: "cursor-pointer rounded-md border border-border bg-background px-3 py-1 font-medium shadow-xs hover:bg-accent",
  head: "text-base/6 font-semibold",
  finding: "text-sm/5",
} as const;

export const mapsListHtml = operation({
  label: "map.listHtml",
  input: z.array(listRow),
  depends: { words: checkWords },
  run: ({ words }, { input }) => {
    const { escaped, badgeOf } = words;
    const cells = input
      .map(
        (row) =>
          `<tr><td>${escaped(row.name)}</td><td>Map · ${escaped(row.name)}</td><td>${escaped(row.cell)}</td><td>${escaped(row.start)}</td><td>${row.states}</td><td>${badgeOf(row.findings.length)}</td><td><button type="button" ${walkAttribute}="${escaped(row.name)}" class="${listClasses.walk}">Walk ${escaped(row.name)}</button></td></tr>`,
      )
      .join("");

    const found = input.flatMap((row) => row.findings);
    const list = found.length
      ? `<h2 class="${listClasses.head}" style="margin:24px 0 8px">Check</h2><ul class="${listClasses.finding}" style="margin:0;padding-left:20px">${found.map((finding) => `<li>${escaped(finding.what)}</li>`).join("")}</ul>`
      : "";
    return `<main class="${listClasses.main}" style="padding:32px"><h1 style="margin:0 0 8px">Maps</h1><p class="${listClasses.about}" style="margin:0 0 16px">Each map of the product: its page, its cell, its first state, its count of states and its check. bun scripts/map-screens.ts puts them after each deploy. A press on Walk starts the walk of the map.</p><table style="border-collapse:collapse;width:100%"><thead><tr><th align="left">Map</th><th align="left">Page</th><th align="left">Cell</th><th align="left">First state</th><th align="left">States</th><th align="left">Check</th><th align="left">Walk</th></tr></thead><tbody>${cells}</tbody></table>${list}</main>`;
  },
});
