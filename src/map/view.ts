import { operation, resource } from "@tinkered/core";
import type { Node } from "oxc-parser";
import { z } from "zod";

import { oxc } from "@/kit/oxc.server";

export type ViewAction = { name: string; from: string; open: boolean };

export type ViewState = { state: string; actions: ViewAction[] };

type Span = { start: number; end: number };

type Hook = { at: number; open: boolean; local: string };

type Drawn = { at: number; name: string };

type Case = Span & { state: string; reader: string };

type Seen = {
  imports: Map<string, { name: string; from: string }>;
  components: Map<string, Span>;
  readers: Array<{ at: number; local: string; reader: string }>;
  switches: Case[];
  hooks: Hook[];
  drawn: Drawn[];
};

export const viewWalk = resource({
  label: "map.viewWalk",
  target: "scope",
  factory: () => {
    const hookNames: Readonly<Record<string, boolean>> = { useRun: false, useData: true };
    const nameTypes = new Set(["Identifier", "JSXIdentifier"]);
    let source: string | null = null;
    let seen: Seen = {
      imports: new Map(),
      components: new Map(),
      readers: [],
      switches: [],
      hooks: [],
      drawn: [],
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
        };
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
          const hook = walk.hookOf(node.init);
          const reader = walk.nameOf(node.id);
          if (hook && hook.open && reader !== null) {
            seen.readers.push({ at: node.start, local: hook.local, reader });
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
        },
        JSXOpeningElement: (node: Node) => {
          if (node.type !== "JSXOpeningElement") return;
          const name = walk.nameOf(node.name);
          if (name !== null) seen.drawn.push({ at: node.start, name });
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
          return [{ ...imported, open: step.open }];
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
          const unique = actions.filter(
            (action, at) => actions.findIndex((other) => other.name === action.name) === at,
          );
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
