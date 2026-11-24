import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { mapJson } from "./text";
import type { MapJson } from "./text";

const graphLine = z.object({
  reads: z.array(z.string()),
  writes: z.array(z.string()),
  calls: z.array(z.string()),
});

export const mapGraphShape = z.record(z.string(), graphLine);

export type MapGraph = z.infer<typeof mapGraphShape>;

export const mapGraph = operation({
  label: "map.graph",
  input: z.string(),
  run: (_, { input }): MapGraph => {
    const line = /^(\S+) exits\{[^}]*\} reads\{([^}]*)\} writes\{([^}]*)\} calls\{([^}]*)\}$/;
    return Object.fromEntries(
      input.split("\n").flatMap((text) => {
        const found = line.exec(text.trim());
        if (!found?.[1]) return [];

        const [reads = [], writes = [], calls = []] = found
          .slice(2)
          .map((list) => (list ? list.split(",") : []));
        return [[found[1], { reads, writes, calls }]];
      }),
    );
  },
});

const cardSection = z.object({ head: z.string(), lines: z.array(z.string()) });

export const mapCardShape = z.object({
  title: z.string(),
  about: z.string(),
  sections: z.array(cardSection),
});

export type MapCard = z.infer<typeof mapCardShape>;

type Said = { answer: MapJson["moves"][number]["answer"]; effects: readonly string[] };

export const cardWords = resource({
  label: "map.cardWords",
  target: "scope",
  factory: () => {
    const unknownMark = "?";
    const notKnown = "not known";
    const nothing = "nothing";
    const notKnownNote = "tinker.graph shows ? for a call of the server: lagz0ne/tinkered#59";
    const fieldMark = ": ";
    const faultWord = "fault";
    const effectsWord = ", effects: ";
    const unranked = Number.MAX_SAFE_INTEGER;
    const pendingStatus = "pending";
    const entities: Readonly<Record<string, string>> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    };

    const words = {
      showsOf: (sample: unknown): string[] => {
        if (typeof sample === "string") return [sample];
        if (typeof sample !== "object" || sample === null || Array.isArray(sample)) {
          return [JSON.stringify(sample)];
        }
        return Object.entries(sample).map(
          ([key, value]) =>
            `${key}${fieldMark}${typeof value === "string" ? value : JSON.stringify(value)}`,
        );
      },

      listOf: (labels: readonly string[]) =>
        labels.length
          ? labels.map((label) => (label === unknownMark ? notKnown : label)).join(", ")
          : nothing,

      graphOf: (graph: MapGraph, action: string) => {
        const line = graph[action];
        const noLine = `reads, writes, calls: ${notKnown}: tinker.graph has no line for ${action}`;
        if (!line) return [noLine];

        return [
          `reads: ${words.listOf(line.reads)}`,
          `writes: ${words.listOf(line.writes)}`,
          `calls: ${words.listOf(line.calls)}`,
        ];
      },

      hasUnknown: (graph: MapGraph, action: string) =>
        Object.values(graph[action] ?? {}).some((labels) => labels.includes(unknownMark)),

      answerOf: (said: Said, pending: boolean) => {
        const { answer } = said;
        if (!answer) return pending ? "no answer yet" : "no call";
        return `${answer.call} ${answer.fault ? `${answer.kind} ${faultWord}` : answer.kind}`;
      },

      effectsOf: (effects: readonly string[]) =>
        effects.length ? `${effectsWord}${effects.join(", ")}` : "",

      escaped: (text: string) => text.replace(/[&<>"]/g, (mark) => entities[mark] ?? mark),

      pendingOf: (map: MapJson, to: string) =>
        map.states.find((each) => each.state === to)?.run?.status === pendingStatus,

      rankOf: (map: MapJson, answer: Said["answer"]) => {
        const kinds = map.calls.find((call) => call.call === answer?.call)?.answers ?? [];
        const at = answer ? kinds.indexOf(answer.kind) : -1;
        return at < 0 ? unranked : at;
      },

      answersOf: (map: MapJson, state: string, action: string) => {
        const moves = map.moves
          .filter((move) => move.from === state && move.action === action)
          .map((move) => ({
            rank: words.rankOf(map, move.answer),
            line: `${words.answerOf(move, words.pendingOf(map, move.to))} → ${move.to}${words.effectsOf(move.effects)}`,
          }));
        const stays = map.stays
          .filter((stay) => stay.state === state && stay.action === action)
          .map((stay) => ({
            rank: words.rankOf(map, stay.answer),
            line: `${words.answerOf(stay, false)} → stays on ${state}${words.effectsOf(stay.effects)}`,
          }));
        const ranked = [...moves, ...stays].toSorted((a, b) => a.rank - b.rank);
        return [...new Set(ranked.map((each) => each.line))];
      },

      actionSection: (graph: MapGraph, action: string, tail: readonly string[]) => ({
        head: `Action ${action}`,
        lines: [...words.graphOf(graph, action), ...tail],
      }),

      notesOf: (graph: MapGraph, actions: readonly string[]) =>
        actions.some((action) => words.hasUnknown(graph, action))
          ? [{ head: "Not known", lines: [notKnownNote] }]
          : [],
    };

    return words;
  },
});

export const mapCard = operation({
  label: "map.card",
  input: z.object({
    map: mapJson,
    name: z.string(),
    state: z.string(),
    graph: mapGraphShape,
  }),
  depends: { words: cardWords },
  run: ({ words }, { input }): MapCard => {
    const { map, name, state, graph } = input;
    const shown = map.states.find((each) => each.state === state);
    if (!shown) throw new Error(`map: no state ${state} in the map of ${map.cell}`);

    const title = `${name} · ${state}`;

    if (shown.run) {
      const run = shown.run;
      const into = map.moves.find((move) => move.to === state);
      const answer = into ? words.answerOf(into, run.status === "pending") : "no call";
      return {
        title,
        about: `The run of ${run.action} from ${run.from}, ${run.status}. A state of the view, not of the cell ${map.cell}.`,
        sections: [
          {
            head: "Shows",
            lines: [...words.showsOf(shown.sample), `the press ${run.press}: ${run.status}`],
          },
          words.actionSection(graph, run.action, [
            `the answer here: ${answer}`,
            `the moves of ${run.from}: see the card of ${run.from}`,
          ]),
          ...words.notesOf(graph, [run.action]),
        ],
      };
    }

    const own = shown.actions.map((action) => {
      const answers = words.answersOf(map, state, action);
      return words.actionSection(graph, action, answers.length ? answers : ["no move and no stay"]);
    });
    const goingOn = [
      ...new Set(map.moves.filter((move) => move.from === state).map((move) => move.action)),
    ]
      .filter((action) => !shown.actions.includes(action))
      .map((action) => ({
        head: `Action ${action}, from an earlier state`,
        lines: words.answersOf(map, state, action),
      }));
    const moves =
      own.length || goingOn.length
        ? []
        : [{ head: "Moves", lines: ["no move: the end of the map"] }];
    const view = map.view ? `, in the view ${map.view}` : "";

    return {
      title,
      about: `The state ${state} of the cell ${map.cell}${view}.`,
      sections: [
        { head: "Shows", lines: words.showsOf(shown.sample) },
        ...own,
        ...goingOn,
        ...moves,
        ...words.notesOf(graph, shown.actions),
      ],
    };
  },
});

export const cardLook = {
  width: 720,
  pad: 32,
  title: 28,
  about: 20,
  gap: 24,
  head: 24,
  line: 20,
} as const;

const cardClasses = {
  main: "box-border h-full m-0 bg-card p-8 font-sans text-sm/5 text-card-foreground",
  title: "m-0 truncate text-xl/7 font-semibold",
  about: "m-0 truncate text-muted-foreground",
  section: "mt-6",
  head: "m-0 text-base/6 font-semibold",
  list: "m-0 list-none p-0",
  line: "truncate",
} as const;

export const mapCardHtml = operation({
  label: "map.cardHtml",
  input: z.object({ card: mapCardShape, least: z.number() }),
  depends: { words: cardWords },
  run: ({ words }, { input }) => {
    const { card, least } = input;
    const { escaped } = words;
    const sections = card.sections
      .map((section) => {
        const lines = section.lines
          .map((line) => `<li class="${cardClasses.line}">${escaped(line)}</li>`)
          .join("");
        return `<section class="${cardClasses.section}"><h2 class="${cardClasses.head}">${escaped(section.head)}</h2><ul class="${cardClasses.list}">${lines}</ul></section>`;
      })
      .join("");
    const html = `<main class="${cardClasses.main}"><h1 class="${cardClasses.title}">${escaped(card.title)}</h1><p class="${cardClasses.about}">${escaped(card.about)}</p>${sections}</main>`;

    const lines = card.sections.reduce(
      (sum, section) => sum + cardLook.gap + cardLook.head + section.lines.length * cardLook.line,
      0,
    );
    const tall = 2 * cardLook.pad + cardLook.title + cardLook.about + lines;
    return { html, size: { w: cardLook.width, h: Math.max(least, tall) } };
  },
});
