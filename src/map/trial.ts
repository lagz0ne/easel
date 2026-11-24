import { createScope, operation, resource, tag, transport } from "@tinkered/core";
import type { Data, Scope } from "@tinkered/core";
import { makeTestClock, preset } from "@tinkered/core/testing";

import { unitReader } from "./units";
import type { Action } from "./units";

export type Answer = { call: string; kind: string; fault: boolean };

export type Choice = { answer: Answer; reply: transport.Reply };

export type Trial = {
  used: Choice[];
  effects: string[];
  branches: Choice[][];
  changes: Array<{ from: string; to: string; value: unknown; after: Choice | null }>;
  ended: boolean;
  parked: number;
  sleeping: number;
  now: string;
};

type TestClock = ReturnType<typeof makeTestClock>;

export const answerOf = tag<(address: string) => Promise<transport.Reply>>({
  label: "map.answerOf",
});

export const exampleCall: transport.Call = operation({
  label: "map.exampleCall",
  input: transport.callInput,
  depends: { answerOf },
  run: ({ answerOf }, { input }) => answerOf(input.address),
});

export const exampleWatch: transport.Watch = operation({
  label: "map.exampleWatch",
  input: transport.watchInput,
  run: async () => undefined,
});

export const trials = resource({
  label: "map.trials",
  target: "scope",
  depends: { units: unitReader },
  factory: ({ units }) => {
    const limits = { calls: 4, turns: 1000, steps: 20, day: 24 * 60 * 60 * 1000, start: 0 };
    const remote = { call: exampleCall, watch: exampleWatch };
    const noInput = {};

    const trial = {
      answerFor:
        (record: Trial, answers: ReadonlyMap<string, Choice[]>, script: readonly Choice[]) =>
        (address: string) => {
          const options = answers.get(address) ?? [];
          const at = record.used.length;
          const pick = script[at] ?? options[0];
          if (at >= limits.calls || !pick) {
            record.parked += 1;
            return new Promise<transport.Reply>(() => {});
          }

          const others = script[at] ? [] : options.slice(1);
          record.branches.push(...others.map((other) => [...record.used, other]));
          record.used.push(pick);
          return Promise.resolve(pick.reply);
        },

      clockFor: (record: Trial) => {
        const time = makeTestClock({ now: limits.start });
        const clock = {
          currentTimeMillis: () => time.currentTimeMillis(),
          currentTimeNanos: () => time.currentTimeNanos(),
          sleep: (ms: number, signal?: AbortSignal) => {
            record.sleeping += 1;
            const slept = time.sleep(ms, signal);
            slept.then(
              () => void (record.sleeping -= 1),
              () => void (record.sleeping -= 1),
            );
            return slept;
          },
        };
        return { time, clock };
      },

      watchCell: (scope: Scope.Handle, cell: Data.Cell<unknown>, record: Trial) => {
        const shown = scope.controller(cell);
        return shown.watch(() => {
          const value = shown.get();
          const next = units.kindOf(value);
          if (next === record.now) return;

          record.changes.push({
            from: record.now,
            to: next,
            value,
            after: record.used.at(-1) ?? null,
          });
          record.now = next;
        });
      },

      start: (scope: Scope.Handle, action: Action, record: Trial) => {
        if (action.run.kind === "open") return scope.resolve(action.run.unit).watch(() => {});

        const input = action.run.unit.input ? noInput : undefined;
        const end = () => void (record.ended = true);
        Promise.resolve(scope.run(action.run.unit, { input })).then(end, end);
        return () => {};
      },

      settle: async (record: Trial, time: TestClock) => {
        for (let step = 0; step < limits.steps && !record.ended; step += 1) {
          for (let turn = 0; turn < limits.turns && !record.ended; turn += 1) {
            await Promise.resolve();
          }
          if (!record.sleeping) return;

          time.advance(limits.day);
        }
      },

      run: async (
        cell: Data.Cell<unknown>,
        from: { state: string; sample: unknown },
        action: Action,
        answers: ReadonlyMap<string, Choice[]>,
        script: readonly Choice[],
      ): Promise<Trial> => {
        const record: Trial = {
          used: [],
          effects: [],
          branches: [],
          changes: [],
          ended: false,
          parked: 0,
          sleeping: 0,
          now: from.state,
        };
        const { time, clock } = trial.clockFor(record);
        const recorders = action.tags.map((each) => ({
          tag: each,
          value: () => void record.effects.push(units.labelOf(each)),
        }));

        const scope = await createScope({
          clock,
          tags: [{ tag: answerOf, value: trial.answerFor(record, answers, script) }, ...recorders],
          capsules: action.rpcs.map((rpc) => rpc({ remote })),
          presets: [preset(cell, from.sample)],
        }).ready;
        const unwatch = trial.watchCell(scope, cell, record);
        const stop = trial.start(scope, action, record);
        await trial.settle(record, time);

        unwatch();
        stop();
        if (record.ended || (!record.parked && !record.sleeping)) await scope.close();
        return record;
      },
    };

    return trial;
  },
});
