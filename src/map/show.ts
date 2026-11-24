import { operation, resource, transport } from "@tinkered/core";
import type { Capsule, Data, Observe, Scope, Tag } from "@tinkered/core";
import { preset } from "@tinkered/core/testing";
import { z } from "zod";

import { mapBook } from "./derive";
import { jsonSchema, sampler } from "./sample";
import { mapJson } from "./text";
import { answerOf, exampleCall, exampleWatch } from "./trial";
import { cellShape, runStatuses, unitReader } from "./units";
import type { RunStatus } from "./units";

const faults = ["refused", "failed", "invalid", "encode", "decode", "missing", "link"] as const;

const reply = z.union([
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({ ok: z.literal(false), kind: z.enum(faults), payload: z.unknown() }),
]);

export const showPlan = z.object({
  state: z.string(),
  sample: z.unknown(),
  press: z
    .object({
      name: z.string(),
      fields: z.record(z.string(), z.string()),
      action: z.string(),
      status: z.enum(runStatuses),
    })
    .nullable(),
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
      if (!run) return { state: state.state, sample: state.sample, press: null, replies: {} };

      const press = {
        name: run.press,
        fields: fields.of(input.inputs[run.press]),
        action: run.action,
        status: run.status,
      };
      if (run.status === "pending") {
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
      return { state: state.state, sample: state.sample, press, replies };
    });
  },
});

export const runSeen = resource({
  label: "map.runSeen",
  target: "scope",
  factory: () => {
    const endOf = { failed: "failed", done: "ok" } as const;
    const seen: Array<{ call: true } | { action: string; status: Observe.Span["status"] }> = [];
    return {
      mark: () => seen.length,
      called: () => void seen.push({ call: true }),
      ended: (span: Observe.Span) => {
        if (span.kind !== "operation" || span.end === undefined) return;
        seen.push({ action: span.name, status: span.status });
      },
      reached: (from: number, action: string, status: RunStatus) => {
        const after = seen.slice(from);
        switch (status) {
          case "pending":
            return after.some((one) => "call" in one);
          case "failed":
          case "done":
            return after.some(
              (one) => "action" in one && one.action === action && one.status === endOf[status],
            );
        }
      },
    };
  },
});

export const showScope = operation({
  label: "map.showScope",
  input: z.object({ cell: cellShape, actions: z.array(z.unknown()), plan: showPlan }),
  depends: { units: unitReader, seen: runSeen },
  run: ({ units, seen }, { input }) => {
    const { cell, plan } = input;
    const found = input.actions.flatMap((unit) => units.actionOf(unit, cell) ?? []);
    const rpcs = [...new Set(found.flatMap((action) => action.rpcs))];
    const tags = [...new Set(found.flatMap((action) => action.tags))];
    const never = new Promise<transport.Reply>(() => {});
    const answer = (address: string) => {
      seen.called();
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
    return {
      capsules,
      tags: [{ tag: answerOf, value: answer }, ...quiet],
      presets,
      observe: { export: seen.ended },
    };
  },
});

export const pageTurns = resource({
  label: "map.pageTurns",
  target: "scope",
  factory: () => {
    const framesAfter = 2;
    const turns = {
      until: async (shows: () => boolean, late: () => boolean) => {
        for (let after = framesAfter; after > 0;) {
          await new Promise<void>((done) => requestAnimationFrame(() => done()));
          if (shows() || late()) after -= 1;
        }
        return shows();
      },
      press: (target: Element, fields: Record<string, string>) => {
        if (target instanceof HTMLFormElement) {
          for (const [field, value] of Object.entries(fields)) {
            const control = target.elements.namedItem(field);
            if (control instanceof HTMLInputElement) control.value = value;
          }
          return target.requestSubmit();
        }
        if (target instanceof HTMLElement) target.click();
      },
    };
    return turns;
  },
});

export const pressIn = operation({
  label: "map.pressIn",
  input: z.object({
    page: z.custom<Document>((value) => value instanceof Document),
    press: showPlan.shape.press,
    limit: z.number().optional(),
  }),
  depends: { turns: pageTurns, seen: runSeen },
  run: async ({ turns, seen }, { input, clock }) => {
    const { press, page } = input;
    const deadline = clock.currentTimeMillis() + (input.limit ?? 10_000);
    const late = () => clock.currentTimeMillis() >= deadline;
    const selector = press ? `[${pressMark}="${press.name}"]` : "body *";
    await turns.until(() => page.querySelector(selector) !== null, late);
    if (!press) return { kind: "shown" } as const;

    const target = page.querySelector(selector);
    if (!target) return { kind: "noPress", press: press.name } as const;

    const from = seen.mark();
    turns.press(target, press.fields);
    const reached = await turns.until(() => seen.reached(from, press.action, press.status), late);
    if (!reached) return { kind: "noStatus", press: press.name, status: press.status } as const;
    return { kind: "pressed", press: press.name } as const;
  },
});

export type ShowUnits = {
  cell: Data.Cell<unknown>;
  actions: unknown[];
  plans: ShowPlan[];
};
