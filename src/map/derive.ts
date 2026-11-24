import { operation, resource, transport } from "@tinkered/core";
import type { Data } from "@tinkered/core";
import { z } from "zod";

import { jsonSchema, sampler } from "./sample";
import { trials } from "./trial";
import type { Answer, Choice, Trial } from "./trial";
import { cellShape, unitReader } from "./units";
import type { Action } from "./units";

export type Move = {
  from: string;
  to: string;
  action: string;
  answer: Answer | null;
  effects: string[];
  rank: number[];
};

export type Stay = { state: string; action: string; answer: Answer | null; effects: string[] };

type Known = { sample: unknown; actions: string[] };

type Book = {
  states: Map<string, Known>;
  moves: Map<string, Move>;
  stays: Map<string, Stay>;
  calls: Map<string, string[]>;
};

const unitList = z.array(z.unknown());

const offers = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("view"),
    states: z.array(z.object({ state: z.string(), actions: unitList })),
  }),
  z.object({ kind: z.literal("all"), actions: unitList }),
]);

export const mapBook = resource({
  label: "map.book",
  target: "scope",
  depends: { sampler, units: unitReader },
  factory: ({ sampler, units }) => {
    const fault = transport.lost({ ok: false, kind: "link", sent: true });
    const outputs = z.record(
      z.string(),
      z.object({ output: z.custom<z.ZodType>((value) => value instanceof z.ZodType) }).loose(),
    );
    const kindShape = z.object({ kind: z.string() }).loose();
    const unranked = 0;

    const book = {
      answersOf: (call: string, output: z.ZodType): Choice[] => {
        const json = z.toJSONSchema(output, { io: "output", unrepresentable: "any" });
        const schema = jsonSchema.parse(json);
        const answers = (schema.oneOf ?? schema.anyOf ?? [schema]).map((variant) => {
          const value = sampler.sampleOf(variant);
          const kind = kindShape.safeParse(value);
          const named = kind.success ? kind.data.kind : "value";
          const answer = { call, kind: named, fault: false };
          return { answer, reply: { ok: true as const, value } };
        });
        return [...answers, { answer: { call, kind: fault.kind, fault: true }, reply: fault }];
      },

      answersFrom: (contracts: ReadonlyArray<Readonly<Record<string, unknown>>>) => {
        const read = contracts.flatMap((literal) => {
          const contract = outputs.safeParse(literal);
          return contract.success ? Object.entries(contract.data) : [];
        });
        return new Map(read.map(([call, { output }]) => [call, book.answersOf(call, output)]));
      },

      actionsOf: (given: z.infer<typeof offers>, state: string, cell: unknown): Action[] => {
        const list =
          given.kind === "all"
            ? given.actions
            : (given.states.find((each) => each.state === state)?.actions ?? []);
        return list.flatMap((unit) => units.actionOf(unit, cell) ?? []);
      },

      begin: (cell: Data.Cell<unknown>): Book => ({
        states: new Map([[units.kindOf(cell.initial), { sample: cell.initial, actions: [] }]]),
        moves: new Map(),
        stays: new Map(),
        calls: new Map(),
      }),

      rankOf: (answer: Answer | null, answers: ReadonlyMap<string, Choice[]>) => {
        const options = answer ? (answers.get(answer.call) ?? []) : [];
        return answer ? options.findIndex((each) => each.answer.kind === answer.kind) : unranked;
      },

      addMoves: (
        record: Book,
        action: Action,
        order: number,
        trial: Trial,
        answers: ReadonlyMap<string, Choice[]>,
      ) => {
        for (const [at, change] of trial.changes.entries()) {
          if (!record.states.has(change.to)) {
            record.states.set(change.to, { sample: change.value, actions: [] });
          }

          const answer = change.after?.answer ?? null;
          const key = JSON.stringify([change.from, change.to, action.label, answer]);
          const effects = at === trial.changes.length - 1 ? trial.effects : [];
          const before = record.moves.get(key)?.effects ?? [];
          const rank = [book.rankOf(answer, answers), order];
          const move = { from: change.from, to: change.to, action: action.label, answer, rank };
          record.moves.set(key, { ...move, effects: [...new Set([...before, ...effects])] });
        }
      },

      addStay: (record: Book, state: string, action: Action, trial: Trial) => {
        if (trial.changes.length || trial.now !== state) return;

        const answer = trial.used.at(-1)?.answer ?? null;
        const key = JSON.stringify([state, action.label, answer]);
        const before = record.stays.get(key)?.effects ?? [];
        const effects = [...new Set([...before, ...trial.effects])];
        record.stays.set(key, { state, action: action.label, answer, effects });
      },

      end: (record: Book, cell: Data.Cell<unknown>) => ({
        cell: units.labelOf(cell),
        start: units.kindOf(cell.initial),
        states: [...record.states].map(([state, known]) => ({ state, ...known })),
        moves: [...record.moves.values()],
        stays: [...record.stays.values()],
        calls: [...record.calls].map(([call, kinds]) => ({ call, answers: kinds })),
      }),
    };

    return book;
  },
});

export const deriveMap = operation({
  label: "map.derive",
  input: z.object({
    cell: cellShape,
    offers,
    contracts: z.array(z.record(z.string(), z.unknown())),
  }),
  depends: { book: mapBook, trials },
  run: async ({ book, trials }, { input }) => {
    const { cell } = input;
    const answers = book.answersFrom(input.contracts);
    const record = book.begin(cell);

    for (const [state, known] of record.states) {
      const actions = book.actionsOf(input.offers, state, cell);
      known.actions = actions.map((action) => action.label);

      for (const [order, action] of actions.entries()) {
        for (const call of action.calls) {
          record.calls.set(
            call,
            (answers.get(call) ?? []).map((choice) => choice.answer.kind),
          );
        }

        const scripts: Choice[][] = [[]];
        for (let script = scripts.shift(); script; script = scripts.shift()) {
          const trial = await trials.run(cell, { state, ...known }, action, answers, script);
          scripts.push(...trial.branches);
          book.addMoves(record, action, order, trial, answers);
          book.addStay(record, state, action, trial);
        }
      }
    }

    return book.end(record, cell);
  },
});
