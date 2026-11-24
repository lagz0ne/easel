import { operation, resource } from "@tinkered/core";
import type { Node } from "oxc-parser";
import { z } from "zod";

import { oxc } from "@/kit/oxc.server";

import { runStatuses } from "./units";
import type { RunStatus } from "./units";

export type ViewAction = { name: string; from: string; open: boolean; reads: RunStatus[] };

export type ViewState = { state: string; actions: ViewAction[] };

type Span = { start: number; end: number };

type Hook = { at: number; open: boolean; local: string };

type Drawn = { at: number; name: string };

type Runner = { at: number; local: string; handle: string | null; reads: RunStatus[] };

type FieldRead = { at: number; handle: string; field: string };

type Element = Span & { nameEnd: number };

type Handler = Span & { name: string };

type Case = Span & { state: string; reader: string };

type Seen = {
  imports: Map<string, { name: string; from: string }>;
  components: Map<string, Span>;
  readers: Array<{ at: number; local: string; reader: string }>;
  switches: Case[];
  hooks: Hook[];
  drawn: Drawn[];
  runners: Runner[];
  fields: FieldRead[];
  runs: Array<{ at: number; handle: string }>;
  elements: Element[];
  handlers: Handler[];
};

export const viewWalk = resource({
  label: "map.viewWalk",
  target: "scope",
  factory: () => {
    const hookNames: Readonly<Record<string, boolean>> = { useRun: false, useData: true };
    const nameTypes = new Set(["Identifier", "JSXIdentifier"]);
    let source: string | null = null;
    const statusOf: Readonly<Record<string, RunStatus>> = {
      isPending: "pending",
      error: "failed",
      isError: "failed",
      isSuccess: "done",
      data: "done",
    };
    const runCalls = new Set(["run", "runAsync"]);
    const handlerName = /^on[A-Z]/;
    const pressMark = "data-map-press";
    let seen: Seen = {
      imports: new Map(),
      components: new Map(),
      readers: [],
      switches: [],
      hooks: [],
      drawn: [],
      runners: [],
      fields: [],
      runs: [],
      elements: [],
      handlers: [],
    };

    const walk = {
      begin: () => {
        seen = {
          imports: new Map(),
          components: new Map(),
          readers: [],
          switches: [],
          hooks: [],
          drawn: [],
          runners: [],
          fields: [],
          runs: [],
          elements: [],
          handlers: [],
        };
      },

      runnerOf: (node: Node, hook: Hook): Runner | null => {
        if (node.type !== "VariableDeclarator") return null;
        if (node.id.type !== "ObjectPattern") {
          const handle = walk.nameOf(node.id);
          return { at: hook.at, local: hook.local, handle, reads: [] };
        }

        const keys = node.id.properties.flatMap((property) =>
          property.type === "Property" ? [walk.nameOf(property.key) ?? ""] : [],
        );
        const run = keys.find((key) => runCalls.has(key)) ?? null;
        return {
          at: hook.at,
          local: hook.local,
          handle: run,
          reads: runStatuses.filter((status) => keys.some((key) => statusOf[key] === status)),
        };
      },

      componentAt: (at: number): Span | null =>
        [...seen.components.values()].find((span) => at >= span.start && at < span.end) ?? null,

      readsOf: (runner: Runner): RunStatus[] => {
        const home = walk.componentAt(runner.at);
        const fields = seen.fields
          .filter((read) => read.handle === runner.handle)
          .filter((read) => !home || (read.at >= home.start && read.at < home.end))
          .map((read) => read.field);
        return runStatuses.filter(
          (status) =>
            runner.reads.includes(status) || fields.some((field) => statusOf[field] === status),
        );
      },

      runnerOfRun: (run: { at: number; handle: string }) => {
        const home = walk.componentAt(run.at);
        return seen.runners.find((each) => {
          const own = walk.componentAt(each.at);
          return each.handle === run.handle && own?.start === home?.start;
        });
      },

      elementOfRun: (at: number) => {
        const handler = seen.handlers.find((each) => at >= each.start && at < each.end);
        if (!handler) return undefined;

        return seen.elements
          .filter((each) => handler.start >= each.start && handler.end <= each.end)
          .sort((a, b) => b.start - a.start)[0];
      },

      pressesOf: (): Array<{ at: number; name: string }> =>
        seen.runs.flatMap((run) => {
          const runner = walk.runnerOfRun(run);
          const element = walk.elementOfRun(run.at);
          const imported = runner ? seen.imports.get(runner.local) : undefined;

          return element && imported ? [{ at: element.nameEnd, name: imported.name }] : [];
        }),

      noteHook: (node: Node, hook: Hook | null) => {
        const reader = node.type === "VariableDeclarator" ? walk.nameOf(node.id) : null;
        if (hook && hook.open && reader !== null) {
          seen.readers.push({ at: node.start, local: hook.local, reader });
        }

        const runner = hook && !hook.open ? walk.runnerOf(node, hook) : null;
        if (runner) seen.runners.push(runner);
      },

      noteRun: (node: Node) => {
        if (node.type !== "CallExpression") return;

        const callee = node.callee;
        const direct = walk.nameOf(callee);
        if (direct !== null && runCalls.has(direct)) {
          seen.runs.push({ at: node.start, handle: direct });
        }
        if (callee.type !== "MemberExpression") return;

        const handle = walk.nameOf(callee.object);
        const called = walk.nameOf(callee.property);
        if (handle !== null && called !== null && runCalls.has(called)) {
          seen.runs.push({ at: node.start, handle });
        }
      },

      marked: (source: string): string => {
        const presses = walk
          .pressesOf()
          .filter((press, at, all) => all.findIndex((other) => other.at === press.at) === at)
          .sort((a, b) => b.at - a.at);
        return presses.reduce(
          (text, press) =>
            `${text.slice(0, press.at)} ${pressMark}="${press.name}"${text.slice(press.at)}`,
          source,
        );
      },

      nameOf: (node: Node | null | undefined): string | null => {
        if (!node) return null;
        if (nameTypes.has(node.type) && "name" in node && typeof node.name === "string") {
          return node.name;
        }
        return node.type === "Literal" && typeof node.value === "string" ? node.value : null;
      },

      hookOf: (node: Node): Hook | null => {
        if (node.type !== "CallExpression") return null;
        const hook = walk.nameOf(node.callee);
        const open = hook === null ? undefined : hookNames[hook];
        const [first] = node.arguments;
        if (open === undefined || !first) return null;

        const target = first.type === "CallExpression" ? first.callee : first;
        const local = walk.nameOf(target);
        return local === null ? null : { at: node.start, open, local };
      },

      visitor: {
        ImportSpecifier: (node: Node) => {
          if (node.type !== "ImportSpecifier") return;
          const name = walk.nameOf(node.imported);
          const local = walk.nameOf(node.local);
          const from = source;
          if (name !== null && local !== null && from !== null) {
            seen.imports.set(local, { name, from });
          }
        },
        ImportDeclaration: (node: Node) => {
          source = node.type === "ImportDeclaration" ? node.source.value : null;
        },
        FunctionDeclaration: (node: Node) => {
          if (node.type !== "FunctionDeclaration") return;
          const name = walk.nameOf(node.id);
          if (name !== null) seen.components.set(name, { start: node.start, end: node.end });
        },
        VariableDeclarator: (node: Node) => {
          if (node.type !== "VariableDeclarator" || !node.init) return;

          walk.noteHook(node, walk.hookOf(node.init));
        },
        MemberExpression: (node: Node) => {
          if (node.type !== "MemberExpression") return;
          const handle = walk.nameOf(node.object);
          const field = walk.nameOf(node.property);
          if (handle !== null && field !== null && !node.computed) {
            seen.fields.push({ at: node.start, handle, field });
          }
        },
        JSXAttribute: (node: Node) => {
          if (node.type !== "JSXAttribute") return;
          const name = walk.nameOf(node.name);
          if (name !== null && handlerName.test(name)) {
            seen.handlers.push({ start: node.start, end: node.end, name });
          }
        },
        SwitchStatement: (node: Node) => {
          if (node.type !== "SwitchStatement") return;
          const on = node.discriminant;
          if (on.type !== "MemberExpression" || walk.nameOf(on.property) !== "kind") return;
          const reader = walk.nameOf(on.object);
          if (reader === null) return;

          for (const each of node.cases) {
            const state = walk.nameOf(each.test);
            if (state === null) continue;

            seen.switches.push({ state, reader, start: each.start, end: each.end });
          }
        },
        CallExpression: (node: Node) => {
          const hook = walk.hookOf(node);
          if (hook) seen.hooks.push(hook);

          walk.noteRun(node);
        },
        JSXOpeningElement: (node: Node) => {
          if (node.type !== "JSXOpeningElement") return;
          const name = walk.nameOf(node.name);
          if (name !== null) seen.drawn.push({ at: node.start, name });
          seen.elements.push({ start: node.start, end: node.end, nameEnd: node.name.end });
        },
      },

      actionsIn: (span: Span, cell: string, done: Set<string>): ViewAction[] => {
        const steps = [...seen.hooks, ...seen.drawn]
          .filter((step) => step.at >= span.start && step.at < span.end)
          .sort((a, b) => a.at - b.at);

        return steps.flatMap((step) => {
          if ("name" in step) {
            const component = seen.components.get(step.name);
            if (!component || done.has(step.name)) return [];
            done.add(step.name);
            return walk.actionsIn(component, cell, done);
          }

          const imported = seen.imports.get(step.local);
          if (!imported || step.local === cell) return [];
          const runner = seen.runners.find((each) => each.at === step.at);
          const reads = runner ? walk.readsOf(runner) : [];
          return [{ ...imported, open: step.open, reads }];
        });
      },

      end: (cell: string): ViewState[] | null => {
        const local = [...seen.imports].find(([, from]) => from.name === cell)?.[0];
        const readers = new Set(
          seen.readers.filter((reader) => reader.local === local).map((r) => r.reader),
        );
        const cases = seen.switches.filter((each) => readers.has(each.reader));
        if (!local || !cases.length) return null;

        return cases.map((each) => {
          const actions = walk.actionsIn(each, local, new Set());
          const unique = actions
            .filter((action, at) => actions.findIndex((other) => other.name === action.name) === at)
            .map((action) => {
              const all = actions.filter((other) => other.name === action.name);
              const reads = runStatuses.filter((status) =>
                all.some((other) => other.reads.includes(status)),
              );
              return { ...action, reads };
            });
          return { state: each.state, actions: unique };
        });
      },
    };

    return walk;
  },
});

export const readView = operation({
  label: "map.readView",
  input: z.object({ file: z.string(), source: z.string(), cell: z.string() }),
  depends: { oxc, walk: viewWalk },
  run: ({ oxc, walk }, { input }) => {
    const parsed = oxc.parseSync(input.file, input.source);
    walk.begin();
    oxc.visit(walk.visitor, parsed.program);
    const states = walk.end(input.cell);
    if (states === null) return { kind: "none" } as const;

    return { kind: "found", states } as const;
  },
});

export const pressMarks = operation({
  label: "map.pressMarks",
  input: z.object({ file: z.string(), source: z.string() }),
  depends: { oxc, walk: viewWalk },
  run: ({ oxc, walk }, { input }) => {
    const parsed = oxc.parseSync(input.file, input.source);
    walk.begin();
    oxc.visit(walk.visitor, parsed.program);
    return walk.marked(input.source);
  },
});
