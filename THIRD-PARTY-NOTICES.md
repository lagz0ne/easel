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

## oxc-parser 0.159.0

- What: the parser of the TSX of an app frame. The kit check of an app
  frame (`src/kit/oxc.server.ts`, `src/kit/app.server.ts`) and the Oxlint
  rule `easel/class-built` (`src/kit/lint.server.ts`) read the syntax
  tree that it makes. The binary holds its native build
  (`@oxc-parser/binding-linux-x64-gnu`, `@oxc-parser/binding-linux-arm64-gnu`
  or `@oxc-parser/binding-darwin-arm64`, one for each system).
- Licence: MIT. Copyright (c) 2024-present VoidZero Inc. & Contributors;
  Copyright (c) 2023 Boshen.
- Source: <https://github.com/oxc-project/oxc>, the npm package
  `oxc-parser@0.159.0`.
- easel does not change the oxc-parser source. The build
  (`scripts/build-binary.ts`) replaces only how its loader finds its
  native file, with a static `require` of the same file.

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
  "neutral". The shapes of the seed's class pieces (pill buttons, fields
  and badges, round cards) follow its "Maia" style. easel holds no code of
  shadcn/ui.
- Licence: MIT. Copyright (c) 2023 shadcn.
- Source: <https://github.com/shadcn-ui/ui>.

## Geist and Geist Mono 1.9.2

- What: the fonts of the seed look. The binary holds the variable WOFF2
  files `Geist-Variable.woff2` and `GeistMono-Variable.woff2`
  (`src/kit/fonts/`), and serves them at `/api/fonts/geist-1.9.2/`.
  easel does not change them.
- Licence: SIL Open Font License 1.1. Copyright (c) 2023 Vercel, in
  collaboration with basement.studio. The full licence is in
  `src/kit/fonts/OFL.txt`.
- Source: <https://github.com/vercel/geist-font>; the npm package
  `geist@1.9.2`.

## Inter 5.3.0

- What: the font of the viewer (SPEC-design.md). The binary holds the
  variable WOFF2 files for Latin, Latin Extended and Vietnamese
  (`src/kit/fonts/inter-*-wght-normal.woff2`), and serves them at
  `/api/fonts/inter-5.3.0/`. easel does not change them.
- Licence: SIL Open Font License 1.1. Copyright 2016 The Inter Project
  Authors. The full licence is in `src/kit/fonts/OFL-Inter.txt`.
- Source: <https://github.com/rsms/inter>; the npm package
  `@fontsource-variable/inter@5.3.0`.

## The runtime of app frames

The binary holds the runtime bundle of app frames (`src/kit/runtime.server.ts`;
SPEC-kit.md § App frames, "The runtime"), and serves it to each frame. The
bundle holds the code of these packages, at these exact versions. easel does
not change their source; the build bundles and minifies it.

- React 19.3.1, React DOM 19.3.1 and Scheduler 0.28.0: MIT. Copyright (c)
  Meta Platforms, Inc. and affiliates. <https://github.com/facebook/react>.
- @tinkered/core 0.30.1 and @tinkered/react 0.30.1: MIT.
  <https://github.com/lagz0ne/tinkered>.
- Zod 4.6.7: MIT. Copyright (c) 2025 Colin McDonnell.
  <https://github.com/colinhacks/zod>.
- Radix UI (`radix-ui` 1.8.1, and the `@radix-ui/*` packages that it holds):
  MIT. Copyright (c) 2022 WorkOS. <https://github.com/radix-ui/primitives>.
- Lucide (`lucide-react` 1.77.0): ISC. Copyright (c) 2026 Lucide Icons and
  Contributors; the parts from Feather are MIT, Copyright (c) 2013-present Cole
  Bemis. <https://github.com/lucide-icons/lucide>.
- clsx 2.1.1: MIT. Copyright (c) Luke Edwards. <https://github.com/lukeed/clsx>.
- class-variance-authority 0.7.1: Apache License 2.0,
  <https://www.apache.org/licenses/LICENSE-2.0>. Copyright 2022 Joe Bell.
  <https://github.com/joe-bell/cva>.
- tailwind-merge 3.7.1: MIT. Copyright (c) 2021 Dany Castillo.
  <https://github.com/dcastil/tailwind-merge>.
- The packages that Radix UI uses: `@floating-ui/core`, `@floating-ui/dom`,
  `@floating-ui/react-dom` and `@floating-ui/utils` (MIT, Floating UI
  contributors), `aria-hidden`, `get-nonce`, `react-remove-scroll`,
  `react-remove-scroll-bar`, `react-style-singleton`, `use-callback-ref` and
  `use-sidecar` (MIT, Anton Korzunov), and `tslib` 2.9.1 (0BSD, Microsoft).
