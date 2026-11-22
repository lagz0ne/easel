import { operation, resource } from "@tinkered/core";
import { type Program, parseSync, Visitor, type VisitorObject } from "oxc-parser";
import { z } from "zod";

import { placeWalk } from "./places";

/**
 * oxc-parser (MIT; THIRD-PARTY-NOTICES.md), pinned exactly, the one parser of an app frame
 * (SPEC-kit.md fact rule 9). Its loader finds its native file by a name that it makes at run time,
 * so a compiled binary cannot find it: the build (scripts/build-binary.ts) replaces that loader
 * with a static `require` of the file of its target (fact rule 10).
 */
export const oxc = resource({
  label: "kit.oxc",
  target: "scope",
  factory: () => ({
    parseSync,
    /** Gives each node of a program to the visitor, in the order of the source. */
    visit: (visitor: VisitorObject, program: Program) => new Visitor(visitor).visit(program),
  }),
});

/**
 * The places of a program of an app frame (`places.ts`): what the kit check and the Oxlint rule
 * read. The walk of oxc-parser gives each node to the visitor of the walk, in the order of the
 * source.
 */
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
