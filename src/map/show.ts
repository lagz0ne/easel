import { operation, resource, transport } from "@tinkered/core";
import type { Capsule, Data, Scope, Tag } from "@tinkered/core";
import { preset } from "@tinkered/core/testing";
import { z } from "zod";

import { mapBook } from "./derive";
import { jsonSchema, sampler } from "./sample";
import { mapJson } from "./text";
import { answerOf, exampleCall, exampleWatch } from "./trial";
import { cellShape, unitReader } from "./units";

const faults = ["refused", "failed", "invalid", "encode", "decode", "missing", "link"] as const;

const reply = z.union([
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), kind: z.enum(faults), payload: z.unknown() }),
]);

export const showPlan = z.object({
  state: z.string(),
  sample: z.unknown(),
  press: z.object({ name: z.string(), fields: z.record(z.string(), z.string()) }).nullable(),
  replies: z.record(z.string(), reply),
});

export type ShowPlan = z.infer<typeof showPlan>;

export const pressMark = "data-map-press";

export const shownMark = "data-map-shown";

export const showFields = resource({
  label: "map.showFields",
  target: "scope",
  depends: { sampler },
  factory: ({ sampler }) => ({
    of: (schema: z.ZodType | undefined): Record<string, string> => {
      const json = schema ? z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) : {};
      const properties = jsonSchema.safeParse(json).data?.properties ?? {};
      return Object.fromEntries(
        Object.entries(properties).map(([field, node]) => [field, String(sampler.sampleOf(node))]),
      );
    },
  }),
});

export const showPlans = operation({
  label: "map.showPlans",
  input: z.object({
    map: mapJson,
    contracts: z.array(z.record(z.string(), z.unknown())),
    inputs: z.record(
      z.string(),
      z.custom<z.ZodType>((value) => value instanceof z.ZodType),
    ),
  }),
  depends: { book: mapBook, fields: showFields },
  run: ({ book, fields }, { input }) => {
    const answers = book.answersFrom(input.contracts);

    return input.map.states.map((state): ShowPlan => {
      const run = state.run;
      if (!run || run.status === "pending") {
        const press = run ? { name: run.press, fields: fields.of(input.inputs[run.press]) } : null;
        return { state: state.state, sample: state.sample, press, replies: {} };
      }

      const into = input.map.moves.find((move) => move.to === state.state)?.answer ?? null;
      const replies = Object.fromEntries(
        [...answers].flatMap(([call, choices]) => {
          const picked =
            into?.call === call ? choices.find((c) => c.answer.kind === into.kind) : null;
          const chosen = picked ?? choices[0];
          return chosen ? [[call, chosen.reply]] : [];
        }),
      );
      const press = { name: run.press, fields: fields.of(input.inputs[run.press]) };
      return { state: state.state, sample: state.sample, press, replies };
    });
  },
});

export const showScope = operation({
  label: "map.showScope",
  input: z.object({ cell: cellShape, actions: z.array(z.unknown()), plan: showPlan }),
  depends: { units: unitReader },
  run: ({ units }, { input }) => {
    const { cell, plan } = input;
    const found = input.actions.flatMap((unit) => units.actionOf(unit, cell) ?? []);
    const rpcs = [...new Set(found.flatMap((action) => action.rpcs))];
    const tags = [...new Set(found.flatMap((action) => action.tags))];
    const never = new Promise<transport.Reply>(() => {});
    const answer = (address: string) => {
      const given = reply.safeParse(plan.replies[address]);
      return given.success ? Promise.resolve(given.data) : never;
    };

    const capsules: Capsule.Installable[] = rpcs.map((rpc) =>
      rpc({ remote: { call: exampleCall, watch: exampleWatch } }),
    );
    const quiet: Array<Tag.Binding<unknown>> = tags.map((tag) => ({
      tag,
      value: () => undefined,
    }));
    const presets: Scope.Preset[] = [preset<unknown>(cell, plan.sample)];
    return { capsules, tags: [{ tag: answerOf, value: answer }, ...quiet], presets };
  },
});

export const pageTurns = resource({
  label: "map.pageTurns",
  target: "scope",
  factory: () => ({
    frame: () => new Promise<void>((done) => requestAnimationFrame(() => done())),
    after: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  }),
});

export const pressIn = operation({
  label: "map.pressIn",
  input: z.object({
    page: z.custom<Document>((value) => value instanceof Document),
    press: showPlan.shape.press,
  }),
  depends: { turns: pageTurns },
  run: async ({ turns }, { input }) => {
    const settle = 200;
    await turns.frame();
    await turns.after(settle);
    const { press, page } = input;
    if (!press) return { kind: "shown" } as const;

    const target = page.querySelector(`[${pressMark}="${press.name}"]`);
    if (!target) return { kind: "noPress", press: press.name } as const;

    if (target instanceof HTMLFormElement) {
      for (const [field, value] of Object.entries(press.fields)) {
        const control = target.elements.namedItem(field);
        if (control instanceof HTMLInputElement) control.value = value;
      }
      target.requestSubmit();
    } else if (target instanceof HTMLElement) {
      target.click();
    }

    await turns.after(settle);
    await turns.frame();
    return { kind: "pressed", press: press.name } as const;
  },
});

export type ShowUnits = {
  cell: Data.Cell<unknown>;
  actions: unknown[];
  plans: ShowPlan[];
};
