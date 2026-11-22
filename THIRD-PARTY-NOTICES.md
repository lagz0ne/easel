# Third-party notices

The easel binary holds code of these projects. Each one keeps its own
licence. This file names each project, its licence, and where its source
is.

## Lightning CSS 1.33.0

- What: a CSS parser, transformer and minifier. The K5 check
  (`src/kit/`) uses it to find colors in CSS. The binary holds its native
  build (`lightningcss-linux-x64-gnu`, `lightningcss-linux-arm64-gnu` or
  `lightningcss-darwin-arm64`, one for each system).
- Licence: Mozilla Public License 2.0 (MPL-2.0),
  <https://www.mozilla.org/en-US/MPL/2.0/>.
- Source: <https://github.com/parcel-bundler/lightningcss>, tag `v1.33.0`;
  and the npm package `lightningcss@1.33.0`.
- easel does not change the Lightning CSS source. Under MPL-2.0, you can
  get the source of the version in the binary at the places above.

## Tailwind CSS 4.3.5

- What: the CSS framework that makes the CSS of the kit and of each frame
  (`src/kit/make.server.ts`). `src/kit/source.server.ts` holds a copy of
  some values of its `theme.css`, and `src/kit/preflight.server.ts` a copy
  of its `preflight.css`. The seed look (`src/kit/seed.server.ts`) takes
  its font stacks, type scale and shadows, and some colors of its palette.
- Licence: MIT. Copyright (c) Tailwind Labs, Inc.
- Source: <https://github.com/tailwindlabs/tailwindcss>, tag `v4.3.5`;
  and the npm package `tailwindcss@4.3.5`.

## shadcn/ui

- What: the names of the colors of the look, and the values of the seed
  look (`src/kit/seed.server.ts`), from its theme with the base color
  "neutral". easel holds no code of shadcn/ui.
- Licence: MIT. Copyright (c) 2023 shadcn.
- Source: <https://github.com/shadcn-ui/ui>.
