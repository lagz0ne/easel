import { type Capsule, createScope, operation, type Resource, type Scope } from "@tinkered/core";
import { ScopeProvider } from "@tinkered/react";
import { type ComponentType, createElement } from "react";
import { prerender } from "react-dom/static";
import { z } from "zod";

import { look } from "./look";

// One frame drawn from its capsules (docs/decisions/kit-capsules.md): a new scope with the
// frame's install list, its start (each capsule checks what it needs), then the View in that
// scope, then the scope closes. The same install list and the same code give the same HTML. A
// change of the locale or of the data state is a new install list, so a new scope.

const refusal = z.object({ kind: z.string(), payload: z.unknown() });

/** The answer of a render: the HTML and the styles, or the refusal of a start. */
export type Rendered =
  | {
      kind: "rendered";
      html: string;
      styles: string;
      capsules: ReadonlyArray<Capsule.Record>;
    }
  | { kind: "refused"; refused: string; payload: unknown };

/**
 * The View of a frame and the styles of its look, built in its scope; `refused` when a unit does
 * not build (a part whose texts have a gap raises `CopyGaps`).
 */
const buildFrame = operation({
  label: "kit.capsules.build",
  input: z.custom<{ scope: Scope.Handle; view: Resource.Handle<ComponentType> }>(),
  run: (_, { input: { scope, view } }) => {
    try {
      const built = { View: scope.resolve(view), styles: scope.resolve(look.styles) };
      return { kind: "built" as const, ...built };
    } catch (error) {
      const known = refusal.safeParse(error);
      if (!known.success) throw error;
      return { kind: "refused" as const, refused: known.data.kind, payload: known.data.payload };
    }
  },
});

/**
 * The frame `view` in a new scope of `capsules`: `rendered` with its HTML, the styles of its look
 * and the scope's list of capsules (as it was after the render), or `refused` with the kind and
 * the payload of the start that stopped the scope.
 */
export const renderFrame = operation({
  label: "kit.capsules.render",
  input: z.custom<{
    capsules: Capsule.Installable[];
    view: Resource.Handle<ComponentType>;
  }>(),
  depends: { buildFrame },
  run: async (units, { input }): Promise<Rendered> => {
    const scope = createScope({ capsules: input.capsules });
    const started = await scope.ready.then(
      (live) => ({ live, refused: null }),
      (error: unknown) => ({ live: null, refused: refusal.safeParse(error) }),
    );
    if (started.live === null) {
      await scope.close();
      if (!started.refused.success) throw new Error("kit: a start failed with no kind");
      const { kind, payload } = started.refused.data;
      return { kind: "refused", refused: kind, payload };
    }

    // A part whose texts have a gap does not build: its frame is refused too (`CopyGaps`).
    const built = units.buildFrame.run({ input: { scope: started.live, view: input.view } });
    if (built.kind === "refused") {
      await scope.close();
      return { kind: "refused", refused: built.refused, payload: built.payload };
    }

    const { View, styles } = built;
    // `prerender` waits for each read that suspends (a cell's first read), then gives the HTML.
    const { prelude } = await prerender(
      createElement(ScopeProvider, { scope, children: createElement(View) }),
    );
    const html = await new Response(prelude).text();
    const capsules = structuredClone(scope.capsules);
    await scope.close();
    return { kind: "rendered", html, styles, capsules };
  },
});
