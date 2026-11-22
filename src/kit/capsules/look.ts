import { capsule, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { aboutShape } from "./about";

// The look as a capsule (docs/decisions/kit-capsules.md): the look values and the kit's CSS of
// one kit version are its config. Each capsule that draws reads them from here, so a frame gets
// the look of the kit version that its scope installs, and no other.

const values = tag({
  label: "look.values",
  parse: z.record(z.string().regex(/^--[a-z][a-z0-9-]*$/), z.string()),
});

const css = tag({ label: "look.css", parse: z.string() });

const about = tag({ label: "look.about", parse: aboutShape });

/** The look values, by CSS name: `{ "--primary": "#171717", ... }`. */
const lookValues = resource({
  label: "look.values.read",
  depends: { values },
  factory: ({ values }) => values,
});

/** The look as one `:root` block, then the kit's CSS: the styles of a frame. */
const styles = resource({
  label: "look.styles",
  depends: { values, css },
  factory: ({ values, css }) =>
    `:root {\n${Object.entries(values)
      .map(([name, value]) => `  ${name}: ${value};\n`)
      .join("")}}\n${css}`,
});

export const look = capsule({
  label: "look",
  config: { values: values.required, css: css.required },
  tags: [
    about({
      does: "The look values and the kit's CSS of one kit version.",
      exports: {
        values: "The look values, by CSS name.",
        styles: "The :root block of the look, then the kit's CSS.",
      },
    }),
  ],
  exports: { values: lookValues, styles },
});
