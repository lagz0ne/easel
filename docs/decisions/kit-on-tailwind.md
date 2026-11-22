# The kit on Tailwind (A+T), made by Tailwind v4 compile()

Date: 2026-11-21. Status: accepted; specified in [SPEC-kit.md](../SPEC-kit.md). Build order steps 1
to 3 are built. It closes the design of E8 "One look, fast" ([epics](../epics.md#e8-one-look-fast)).

## What the user said

- "Kit is good, but it'll take forever to cover everything, and we don't want generic look. So,
  kit based off known tailwind support."

## Problem

Agents write each frame as one HTML document. With no kit, each agent writes all of its CSS: a
dashboard takes 34 s, and two agents give two different buttons. E8 asks for frames that are fast
to make (K3: less than half the time with no kit), alike (K4), in the look (K5), and that follow
one change of the look (K7, K13) with no agent that writes a frame again.

## Precedent

The research notes and each source are in the study folder of E8; this is the short form.

- **v0, Lovable** (shadcn/ui and Tailwind): the model names known pieces (`Button`) and writes
  utilities for the rest. The look is in CSS variables (`--primary`), so a change reaches old
  output with no rewrite.
- **daisyUI 5**: component classes on plain HTML (`btn btn-primary`, `card`), on Tailwind.
- **Claude artifacts, tldraw make real**: Tailwind utilities with palette values (`bg-blue-600`).
  A change of the look cannot reach them.
- **Figma libraries, Lovable design systems**: each version is kept; a file accepts an update.
  This is the answer to K10 and K11.
- **stylelint `declaration-strict-value`**: refuses a color or a size that is not a variable. This
  is the precedent of K5.
- **W3C Design Tokens Community Group format 2025.10**: the file format of the look. (The format
  has "tokens" in its name; in easel these are look values.)
- **Doop** is AGPL-3.0: easel takes the need only (clean room, `docs/canvas-speed.md`).

## Decision

1. **A+T.** Agents write semantic HTML, easel's kit classes for the common pieces (`navbar`,
   `btn btn-primary`, `card`, `badge-success`, `stat-value`), and Tailwind utilities for all the
   rest. An agent can add a `k-` element piece one time (`k-plan`); each agent then uses it.
2. **The look is the theme.** The look is a DTCG file. Its CSS names are shadcn's color names
   (`--primary`, `--muted-foreground`) and Tailwind's names for the rest (`--text-sm`,
   `--radius-md`, `--shadow-xl`, `--font-sans`, `--spacing`). The kit source maps the Tailwind
   classes to them with `@theme inline reference`, so made CSS holds `var(--primary)`. Tailwind's
   palette and default scales are reset (`--color-*: initial`). The look comes to each document as
   one `:root` block; a change of the look replaces only that block.
3. **One make step.** At a put, the server makes the CSS of the frame's class names. At a change of
   the kit, it makes the CSS of the kit version. Each is kept with its version. A show reads only
   kept CSS. A new Tailwind version is a new pin, and easel never makes again the CSS that it
   keeps (K11: the same bytes).
4. **The engine: Tailwind v4 `compile()` in Bun, pinned exactly to 4.3.5.**
   - A new compiler for each make: `build()` keeps each class that it saw before. A test makes the
     same frame after two different frames, in two orders, and gets the same bytes.
   - Class names come from class attributes only, not from the text of the frame.
   - The theme lists each namespace that the kit allows. A class in a namespace that is not listed
     is a K5 finding. (The study did not list `tracking-*` and `animate-*`; the spec does.)
   - Arbitrary colors and unknown classes are removed before `build()`, and told as findings.
5. **The K5 check.** A scan of the class attributes with Bun HTMLRewriter, Tailwind's design system
   (`parseCandidate`, `candidatesToCss`), and a Lightning CSS color visitor on the frame's own CSS.
   It is kept for each kit version. `__unstable__loadDesignSystem` is not a stable API: the exact
   pin and a test that calls it hold it.
6. **Lightning CSS** (napi). In the binary of `bun build --compile`, a static `require` of the
   `.node` file for each of the 3 release targets (darwin-arm64, linux-x64, linux-arm64). The wasm
   build is the fallback. Do not use the optimize step of `@tailwindcss/node`.
7. **The K8 check is the plain WCAG 2.2 formula** (relative luminance), 4.5:1 for text and 3:1 for
   a field edge and the focus ring. The check found the seed's `warning` on `muted` at 4.48:1; the
   seed now has `#8a5a00` (5.39:1).
8. **HTML transform.** Bun HTMLRewriter (lol-html). It fills the default slot only. If easel
   expands `k-` pieces on the server (deferred), it uses parse5 for named slots.

### The defaults that the user did not object to

| #   | Question                                   | Default                                                                                                                                                                |
| --- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The variation                              | A+T, not daisyUI (D+T measured slower).                                                                                                                                |
| 2   | A frame with findings                      | Saved, and the findings are told. A piece with findings is refused. Palette colors, arbitrary colors and font sizes are findings; arbitrary layout values are allowed. |
| 3   | The names of the look values               | shadcn's color names, Tailwind's names for the rest, mapped by `@theme inline reference`. Kit classes in the known `btn btn-primary` form.                             |
| 4   | Frame pictures after a change of the look  | Live documents in 1 s. Each picture in view is drawn again, nearest first, within 10 s for 20 frames; the last picture stays until then.                               |
| 5   | A frame may turn the kit off               | Yes, with `<meta name="easel-kit" content="off">`: no look, no kit, no make; the document as written.                                                                  |
| 6   | How long kit versions stay                 | All, until the easel is deleted. Each holds its made CSS (about 13 KB for the seed).                                                                                   |
| 7   | A change of the look and "may be outdated" | No.                                                                                                                                                                    |
| 8   | The seed look                              | A design ship on Doop with `design:proof`. It must not look like a default template: its own type pair, color and radius.                                              |
| 9   | Where CSS is made                          | At put time on the server, kept with each version. Not in the browser, not at show time.                                                                               |
| 10  | The engine                                 | Tailwind v4 `compile()`, pinned to 4.3.5 (decision 4).                                                                                                                 |
| 11  | The keys of the look                       | Fixed by the seed. A new key needs all frames made again: deferred to "accept the new kit".                                                                            |

## Measures

K3 method: a new model (`claude -p --model sonnet`, no tools, no settings) gets one guide as its
only help and one brief, and writes only the HTML. The time is `duration_api_ms`. Medians of 3
runs, and in brackets the share of the time with no kit. The 3 reference briefs (form, list,
dashboard) are the ones in K3; hero and kanban are screens that no kit covers.

| Screen    | No kit | A (own kit)   | B (Tailwind)  | **A+T**           | D+T (daisyUI) |
| --------- | ------ | ------------- | ------------- | ----------------- | ------------- |
| form      | 14.3 s | 4.3 s (0.30)  | 12.3 s (0.86) | **4.0 s (0.28)**  | 6.0 s (0.42)  |
| list      | 18.8 s | 9.0 s (0.48)  | 19.3 s (1.03) | **6.9 s (0.37)**  | 15.1 s (0.80) |
| dashboard | 33.8 s | 8.9 s (0.26)  | 22.9 s (0.68) | **10.6 s (0.31)** | 16.5 s (0.49) |
| hero      | 46.7 s | 16.5 s (0.35) | 27.9 s (0.60) | **16.8 s (0.36)** | 19.0 s (0.41) |
| kanban    | 39.3 s | 16.1 s (0.41) | 42.1 s (1.07) | **29.4 s (0.75)** | 31.7 s (0.81) |

- A+T meets K3 on the 3 reference screens.
- K5 findings on hero and kanban: A+T 0, A 38 (each frame wrote its own `<style>` outside the
  look), D+T 1.
- After one agent added `k-plan`, a pricing page took 3.7 s, not 5.9 s (K12).
- The make step (Tailwind 4.3.5, a new compiler, Lightning CSS): p50 1.6 ms for a usual frame,
  8.4 ms for a 208 KB frame, 56 ms for the first make after a start. The kit CSS is 11.7 to
  13.3 KB; the CSS of a frame is about 2 KB.
- A change of the look with no new make: 21 to 26 ms for 12 live frames, 35 ms for an A+T hero.

## Other variations

- **A, easel's own kit with no Tailwind.** As fast on the usual screens, but on a screen that the
  kit does not cover, agents wrote their own CSS outside the look (38 findings). To cover each
  screen would "take forever".
- **B, plain Tailwind with the look as the theme.** 0.60 to 1.07 of the time with no kit: long
  class strings cost nearly as much as the CSS that they replace. It fails K3.
- **C, Web Components with a shadow DOM** (Web Awesome). Weak model recall, about 59 KB of script
  for a button, and a flash before the elements are defined.
- **D+T, daisyUI 5 on Tailwind.** Slower (list 0.80), 27 to 46 KB of CSS for each frame, and
  models mix its v4 and v5 class names.

## The engine: other candidates

| Candidate                          | Result                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Tailwind v4 `compile()`, 4.3.5** | Picked. Pure JS, MIT, no native part. Same bytes in a run and after a restart.                                                  |
| UnoCSS `presetWind4`               | The reserve. 100% of the classes of the 15 study frames. With a new generator for each frame: p50 5.9 ms, about 5 times slower. |
| encre-css (Rust)                   | Refused. About 1 ms faster for each frame, which no person sees. It missed 8 class names (`size-*`, `outline-none`). One owner. |
| railwind (Rust)                    | Refused. It missed 49 class names, the theme colors too. No release since 2023.                                                 |
| `@tailwindcss/browser`             | Refused. A 291 KB script that each live document and each picture would run.                                                    |

## Licences

- `tailwindcss` is MIT.
- `lightningcss` is MPL-2.0. easel uses it as a package and does not change its files. The
  release binary holds it, so the release must name it, give its licence, and tell where its
  source is (it is public on npm and GitHub). A change to its files would have to be published.

## Frame scripts

Replaced on 2026-11-22 by [frame-apps](frame-apps.md): a frame can be a full React and Tinker
app, and class names are only in fixed places. The text below is kept as the record.

On 2026-11-21, the user asked whether frames use React, and then whether they use Tinker
(`@tinkered/core`, the library of the easel app). On 2026-11-22, the user agreed that frame code
does not need to run with no change in a Tinker app. Only the markup, the classes and the look go
into an app.

Decision: a frame script is a short plain `<script>`. It keeps state in `hidden`, `aria-*` and
`data-state`, and the class attribute styles each state with variants. It does not write
`classList` or `className` (K5). It uses `type="button"` and a click handler, because the sandbox
does not send `submit`.

Measured with Sonnet, 3 runs each, one frame with tabs, a modal and a form, each clicked through
in the sandbox:

| Variant                  | Time   | Output tokens | Works  | Size in the frame | Load, 20 live frames |
| ------------------------ | ------ | ------------- | ------ | ----------------- | -------------------- |
| Plain script             | 10.2 s | 1,560         | 3 of 3 | 0.35 KB           | 90 ms                |
| Tinker 0.30.1            | 15.7 s | 2,419         | 3 of 3 | 67–101 KB         | 132 ms               |
| Alpine.js                | 9.9 s  | 1,373         | 0 of 3 | 56 KB             | 158 ms               |
| petite-vue (not written) | —      | —             | —      | 17 KB             | 116 ms               |

React was refused: a runtime in each live frame, classes that the K5 check cannot see, and more to
write. Tinker 0.30.1 was refused for now: it has no DOM binding, so the agent writes glue code, and
its rules refuse the small helpers that a frame script needs.

Planned for prototypes (deferred in E8): a small build of Tinker, "Tinker lite". A flow of frames
that share state, or a review that one viewer leads, needs state, operations and a channel to the
easel page. That is the model of Tinker. Tinker lite is ready for easel when it has:

1. A browser entry with cells, watch and operations only, at 3 KB gzip or less.
   It can use `@preact/signals-core` (MIT; 1.7 KB gzip, 4.8 KB minified, measured on
   2026-11-22) as its reactive core, and not a new core.
2. A binding of cells to attributes and of clicks to operations, so that an agent writes no glue.
3. A fixed, versioned single-file build in each release. easel stores it in a kit version, as it
   stores made CSS (K11).
4. A `postMessage` channel for rpc and remote data, which checks the sender (a frame cannot open a
   socket).
   Each call on it runs in its own request session, as a call on the socket does. A cell write
   there stays in that session, so state that a document changes (a shared prototype state) lives
   in a scope resource or in the database (the library author, 2026-11-22).
5. A rule set for code in a document, which permits small helpers.
6. A test in CI that runs it in a sandboxed `srcdoc` with an opaque origin.

easel takes it when an agent writes a prototype frame with it in no more time than with a plain
script, and when it keeps state in attributes, so the K5 check still sees each class. The
measure is the frame-script test above.

## Build order

1. The make step and the K5 check (`make`, `check`), with the two-order test and the pin test.
   Built on 2026-11-22.
2. The look, the kit versions and compose; a frame put with made CSS. Built on 2026-11-22: the
   look in DTCG 2025.10, the seed from the shadcn/ui theme (a start, see step 5), kit version 1
   with its made CSS, the check and the make at each put, the cell `kit` at scope, and the live
   document composed in the tab. Not in this step: the page does not answer the hello of the
   piece script yet (step 3), and a picture is drawn from the frame's document with no compose
   (step 3, with the kit version in its address).
3. The live change of the look (K7) and the pictures of each kit version (K10). The piece script
   says hello each 50 ms until the page gives it a port (as penpal does), and the page answers with
   the current kit; the TLA+ model of kit-look gets this hello, with a variant that posts only once
   and misses a document that starts late. The cell `kit` is written at scope, as the cells of
   frames: a write in the request session of a call stays in that session, and no other tab sees
   it. Built on 2026-11-22: the hello and the port (the kit-look chart, 250 states; the variant
   kit-look-hello-once breaks K7), `look.get`, `look.set` and `look.undo` with
   `easel look get|set|undo`, a picture address with `&kit=` drawn from the composed document of
   that kit version, and the kit versions that a request and a result keep (`kit`, `beforeKit`,
   `afterKit`). Measured on this host: 12 live documents of 20 in view show a new look 21 ms after
   the write; a real Chromium draws the 20 pictures of the new kit version in 1 s, 2 at once.
4. App frames and the kit's pieces as React components, `put_piece` with its revision (K12, K14).
   The order is in [frame-apps](frame-apps.md#build-order).
5. The seed look: a design ship on Doop that does not look generic (K1).

## Open

- The seed look is not designed yet (default 8).
- The kanban took 0.75 of the time with no kit. The kit has no board card. An agent can add it
  one time (K12); the seed design ship can add the pieces that the first teams need.
