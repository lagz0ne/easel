import { createScope, operation, resource, transport } from "@tinkered/core";
import type { Capsule, Data, Scope, Tag } from "@tinkered/core";
import { preset } from "@tinkered/core/testing";
import { ScopeProvider } from "@tinkered/react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { z } from "zod";

import { answerOf, exampleCall, exampleWatch } from "./trial";
import { cellShape, unitReader } from "./units";
import { walkDataOf, walkMark, walkOrder } from "./walk";
import type { WalkData } from "./walk";

const replyShape = z.union([
  z.object({ ok: z.literal(true), value: z.unknown() }),
  z.object({
    ok: z.literal(false),
    kind: z.enum(["refused", "failed", "invalid", "encode", "decode", "missing", "link"]),
    payload: z.unknown(),
  }),
]);

type Wait = { call: string; give: (reply: transport.Reply) => void };

type Setup = {
  data: WalkData;
  to: Window;
  host: HTMLElement;
  View: () => ReactElement;
  cell: Data.Cell<unknown>;
  actions: unknown[];
};

export const walkRuntime = resource({
  label: "map.walkRuntime",
  target: "scope",
  depends: { units: unitReader },
  factory: ({ units }) => {
    const waits = new Map<number, Wait>();
    const now: { setup: Setup | null; root: Root | null; live: Scope.Handle | null } = {
      setup: null,
      root: null,
      live: null,
    };
    const count = { shown: 0, serial: 0 };

    const walk = {
      tellWaits: () => {
        const calls = [...waits].map(([id, wait]) => ({ id, call: wait.call }));
        now.setup?.to.postMessage({ easel: walkMark, kind: "waits", calls }, "*");
      },

      answer: (address: string) =>
        new Promise<transport.Reply>((give) => {
          count.serial += 1;
          waits.set(count.serial, { call: address, give });
          walk.tellWaits();
        }),

      pick: (id: number, kind: string) => {
        const wait = waits.get(id);
        const given = now.setup?.data.replies[wait?.call ?? ""]?.find((each) => each.kind === kind);
        const reply = replyShape.safeParse(given?.reply);
        if (!wait || !reply.success) return;

        waits.delete(id);
        walk.tellWaits();
        wait.give(reply.data);
      },

      optionsFor: (setup: Setup, value: unknown) => {
        const acts = setup.actions.flatMap((unit) => units.actionOf(unit, setup.cell) ?? []);
        const rpcs = [...new Set(acts.flatMap((action) => action.rpcs))];
        const tags = [...new Set(acts.flatMap((action) => action.tags))];

        const quiet: Array<Tag.Binding<unknown>> = tags.map((tag) => ({
          tag,
          value: () => undefined,
        }));
        const capsules: Capsule.Installable[] = rpcs.map((rpc) =>
          rpc({ remote: { call: exampleCall, watch: exampleWatch } }),
        );
        return {
          capsules,
          tags: [{ tag: answerOf, value: walk.answer }, ...quiet],
          presets: [preset<unknown>(setup.cell, value)],
        };
      },

      tell: (setup: Setup, next: Scope.Handle, value: unknown) => {
        if (now.live !== next) return;
        const state = units.kindOf(value);
        setup.to.postMessage({ easel: walkMark, kind: "state", state, value }, "*");
      },

      go: async (value: unknown) => {
        const { setup, root } = now;
        if (!setup || !root) return;

        const before = now.live;
        now.live = null;
        count.shown += 1;
        const shown = count.shown;
        waits.clear();
        walk.tellWaits();
        void before?.close();

        const next = await createScope(walk.optionsFor(setup, value)).ready;
        if (shown !== count.shown) return void next.close();

        now.live = next;
        const held = next.controller(setup.cell);
        held.watch(() => walk.tell(setup, next, held.get()));
        const { View } = setup;
        root.render(
          <ScopeProvider key={shown} scope={next}>
            <View />
          </ScopeProvider>,
        );
        walk.tell(setup, next, value);
      },

      hear: (event: MessageEvent) => {
        if (!now.setup || event.source !== now.setup.to) return;
        const order = walkOrder.safeParse(event.data);
        if (!order.success) return;

        switch (order.data.kind) {
          case "answer":
            return walk.pick(order.data.id, order.data.answer);
          case "go":
            return void walk.go(order.data.value);
        }
      },

      start: async (setup: Setup, page: Document) => {
        now.setup = setup;
        now.root = createRoot(setup.host);
        page.defaultView?.addEventListener("message", walk.hear);
        const { map } = setup.data;
        await walk.go(map.states.find((state) => state.state === map.start)?.sample);
      },
    };

    return walk;
  },
});

export const walkBoot = operation({
  label: "map.walkBoot",
  input: z.object({
    page: z.custom<Document>((value) => value instanceof Document),
    to: z.custom<Window>((value) => typeof value === "object" && value !== null),
    host: z.custom<HTMLElement>((value) => value instanceof HTMLElement),
    View: z.custom<() => ReactElement>((value) => typeof value === "function"),
    cell: cellShape,
    actions: z.array(z.unknown()),
  }),
  depends: { runtime: walkRuntime, dataOf: walkDataOf },
  run: async ({ runtime, dataOf }, { input }) => {
    const { page, ...given } = input;
    const found = dataOf.run({ input: page.getElementById("easel-walk")?.outerHTML ?? "" });
    if (found.kind === "none") return { kind: "noMap" } as const;

    await runtime.start({ ...given, data: found.data }, page);
    return { kind: "walking", map: found.data.name } as const;
  },
});
