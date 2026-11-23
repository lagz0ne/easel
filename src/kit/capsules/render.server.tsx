import { type Capsule, createScope, operation, type Resource, type Scope } from "@tinkered/core";
import { ScopeProvider } from "@tinkered/react";
import { type ComponentType, createElement } from "react";
import { prerender } from "react-dom/static";
import { z } from "zod";

import { look } from "./look";

const refusal = z.object({ kind: z.string(), payload: z.unknown() });

export type Rendered =
  | {
      kind: "rendered";
      html: string;
      styles: string;
      capsules: ReadonlyArray<Capsule.Record>;
    }
  | { kind: "refused"; refused: string; payload: unknown };

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

    const built = units.buildFrame.run({ input: { scope: started.live, view: input.view } });
    if (built.kind === "refused") {
      await scope.close();
      return { kind: "refused", refused: built.refused, payload: built.payload };
    }

    const { View, styles } = built;
    const { prelude } = await prerender(
      createElement(ScopeProvider, { scope, children: createElement(View) }),
    );
    const html = await new Response(prelude).text();
    const capsules = structuredClone(scope.capsules);
    await scope.close();
    return { kind: "rendered", html, styles, capsules };
  },
});
