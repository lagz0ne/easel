import { operation, resource } from "@tinkered/core";
import { type Program, parseSync, Visitor, type VisitorObject } from "oxc-parser";
import { z } from "zod";

import { placeWalk } from "./places";

export const oxc = resource({
  label: "kit.oxc",
  target: "scope",
  factory: () => ({
    parseSync,
    visit: (visitor: VisitorObject, program: Program) => new Visitor(visitor).visit(program),
    members: (program: Program, names: ReadonlySet<string>) => {
      const found: Array<{ name: string; at: number }> = [];
      new Visitor({
        MemberExpression: (node) => {
          const { property } = node;
          if (!node.computed && property.type === "Identifier" && names.has(property.name)) {
            found.push({ name: property.name, at: property.start });
          }
        },
      }).visit(program);
      return found;
    },
  }),
});

export const placesOf = operation({
  label: "kit.placesOf",
  input: z.custom<{ source: string; program: Program }>(),
  depends: { oxc, walk: placeWalk },
  run: ({ oxc, walk }, { input }) => {
    walk.begin(input.source);
    oxc.visit(walk.visitor, input.program);
    return walk.end();
  },
});
