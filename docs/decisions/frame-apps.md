# Frames are full React and Tinker apps; class names only in fixed places, checked with Oxc

Date: 2026-11-22. Status: accepted; the spec change comes with step 4 of E8. It replaces the
"Frame scripts" section of [kit-on-tailwind](kit-on-tailwind.md#frame-scripts). The look, the
make step, the kit versions and the K5 check of that decision stay.

## What the user said

- "I'm willing to pay the cost for the full tinker app. I do think that enable much more than
  simple cost."
- "We can even use react. And that's a good thing because that enable the whole high quality
  react ecosystem rather than just pure html."
- "From the trade offs perspective, however a full app gives actually much much more."
- "We can go even further to have a strict control of classnames so we can sanitize those
  quickly. Look up for ox toolsets like oxc."

## Problem

A frame with a plain script cannot use the React ecosystem (shadcn/ui, Radix, lucide), and its
code has no structure that lasts. A prototype (a flow of frames, a review that one viewer leads)
needs state, operations and a channel to the easel page. Tinker gives that structure in the easel
app. The cost is a runtime in each live frame, and class names that code builds, which the K5 check
cannot see.

## Precedent

- **Claude artifacts, CodeSandbox, StackBlitz:** each preview is a full app in its own sandboxed
  iframe. Claude artifacts allow a fixed list of libraries.
- **v0, Lovable:** React, shadcn/ui and Tailwind. The look is in CSS variables. (Already the
  precedent of the kit.)
- **Webflow Designer, Plasmic Studio, Storybook:** one iframe for the whole canvas. Measured and
  refused here (variant A below).
- **Figma plugins:** code in QuickJS (WebAssembly) after an escape from the Realms shim. Refused:
  React DOM cannot run with no DOM.
- **Tailwind docs, "Dynamic class names":** a class name must be a whole string in the source,
  never built at run time. Its scanner does not see a built name.
- **eslint-plugin-better-tailwindcss, oxlint-tailwindcss:** lint rules that report unknown classes.
  They read classes from attributes and from listed "callees" (`cn`, `clsx`, `cva`). This is the
  precedent of the class places below. Run in Oxlint, the first one loads Tailwind's design system
  in each run (about 6 s); easel keeps the design system per kit version.
- **Oxc** (MIT, VoidZero): the Rust parser, transformer and linter. easel already lints with
  Oxlint (1.85, through Vite+), and the Tinker rules are Oxlint JS plugins.

## The measures

The spike is in `~/work/tmp/e8-kit/stage-spike/` (report.md, results, rerun commands). Chrome for
Testing headless shell 153, 5 runs, medians.

| Measure, 12 live frames, code in the cache | C: an iframe and an app for each frame | A: one iframe, a shadow root for each frame |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------- |
| One frame goes live, p50 / p95             | 48.6 / 71.9 ms                         | 16.4 / 19.3 ms                              |
| 12 frames painted, one per animation frame | 297 ms                                 | 198 ms                                      |
| Process memory                             | 220 MB                                 | 205 MB                                      |
| Dropped frames in a pan                    | 0                                      | 0                                           |
| Radix dialog, focus trap, Escape           | work with no change                    | need 3 workarounds                          |
| Tailwind shadows, rings, gradients         | work                                   | need a workaround                           |
| One frame reads another                    | refused (`SecurityError`)              | possible                                    |

The shared code is one bundle of 147 KB gzip. Chrome downloads it one time; then 0 requests.
The paint wait of the canvas is 1.5 s (SPEC-viewer), so C is far inside it.

Oxc, measured on 2026-11-22 (`~/work/tmp/e8-kit/oxc/`), oxc-parser 0.159.0:

| Source            | Parse and walk the class places |
| ----------------- | ------------------------------- |
| A frame of 8.7 KB | 0.63 ms                         |
| 1 MB              | 22 ms (parse)                   |

oxc-transform makes JS from the 8.7 KB frame in 0.14 ms (Bun.Transpiler: 0.19 ms).

## Decision

1. **A frame can be a full app.** Its document is a TSX module: React 19 and `@tinkered/react`,
   with its own Tinker scope, mounted on `document.body` of its own sandboxed iframe
   (`sandbox="allow-scripts"`, as now). HTML frames stay as they are; a frame is one kind or the
   other.
2. **One runtime bundle for each kit version.** easel builds it one time when it makes the kit
   version and keeps its bytes (K11). It has the packages of the list and the kit's pieces. A frame
   loads it by a versioned address that the browser keeps (`immutable`). A frame imports only from
   this bundle; another import is a finding and the put is refused.
3. **The package list** of the first kit version: `react`, `react-dom`, `@tinkered/core`,
   `@tinkered/react`, `radix-ui`, `lucide-react`, `clsx`, `class-variance-authority`. A new package
   comes with a new kit version. No package that brings its own CSS (Emotion, MUI).
4. **The kit's pieces are shadcn/ui React components** (MIT), in the kit's source, styled with the
   look's names. They replace the `k-` HTML element pieces of step 4. An agent adds a piece with
   `put_piece` (K12, K14), as a component.
5. **Class names only in fixed places.** A class name is a whole string literal in one of these
   places:
   - the `className` attribute;
   - the arguments of `cn`, `clsx` and `cva`: strings, `cond && "..."`, `a ? "..." : "..."`,
     arrays, the keys of an object in `cn` and `clsx`, and the string values of the variants in
     `cva`;
   - a component's own `className` prop that it passes on (the call site gives the literal).
     A template with a value in it (`` `bg-${tone}` ``), a `+` of strings, or any other expression is
     a finding (`kit/class-built`), with the fix: a map of whole names. The spike found both forms
     that Tailwind's scanner misses, and the rule refuses both.
6. **The check reads the AST, not the text.** oxc-parser gives an ESTree AST with the position of
   each literal. The check takes each class from the fixed places. It runs the K5 check of
   kit-on-tailwind on each one, and fixes in place by position: it removes an unknown class and
   puts the nearest look color for an arbitrary color. The make step gets exactly these classes, so
   the CSS has no class that a scan guessed. The same rule is an Oxlint JS plugin for an agent's
   own files, in the way that the Tinker rules are.
7. **JS from TSX:** Bun.Transpiler, built into Bun. No second native module is needed for it.
8. **oxc-parser in the release binary** needs the same work as Lightning CSS: its loader finds the
   `.node` file by a name that it makes at run time. A `Bun.build` plugin replaces the loader with
   a static `require` for each target (tested on linux-x64 in a compiled binary). The release
   script moves from `bun build --compile` to `Bun.build` with this plugin.
9. **Close a frame app before its iframe goes.** When the iframe is removed, the async
   `scope.close()` does not end, so its deferred ends do not run. The page posts `close` on the
   frame's port, waits for `closed` (at most 200 ms), then removes the iframe. The page itself
   ends any work that crosses the port (a subscription) when the port closes. A synchronous close
   in Tinker would remove this step (a request to the library author).
10. **One shape for each frame: `logic` and `View`.** The user picked the variant with the most
    governance (2026-11-22). A frame file exports `logic` (its Tinker cells and operations) and
    `View` (React that only reads cells and runs operations). Each state of a frame is a Tinker
    cell: no React state (`useState`, `useReducer`) and no effect that keeps state; the Tinker rule
    `tinker/react-state` checks it. So the check, the tests and a review see each state and each
    operation of each frame in one place, with no browser.
11. **Where `logic` runs.** By default, in the frame's own scope (the speed of C). When a frame's
    state must stay after the frame closes, or frames share it (a prototype flow), its `logic`
    runs in the board worker: one dedicated Worker for each board and tab, made from a `blob:` URL
    in a hidden sandboxed iframe, so its origin is `null` and it has no session. The page gives the
    frame and the worker the two ends of one `MessageChannel`, then relays nothing. Tinker rpc and
    remote data run over that port. A call there runs in its own request session, so shared state
    is written at scope. The same file works in both places; the build splits it (the worker part
    imports only Tinker, the schema library and easel's frame helper). A text field that a worker
    cell holds uses `defaultValue`, until Tinker has an optimistic write. State that viewers share
    goes to the easel server, through operations that easel defines.
    Measured (`~/work/tmp/e8-kit/worker-spike/`): in the worker, one frame goes live in 48.6 / 85.3
    ms (p50 / p95), its state stays when it comes back, and a 3 s loop in the worker does not stop
    the pan. Agents wrote the split 3 of 3 times, in 17% more time than one plain app.

## Other variations

- **A: one sandbox for the board, a shadow root and a Tinker scope for each frame.** Faster to go
  live (16 ms) and one runtime. Refused: Radix's focus trap and modal break, Tailwind's
  `@property` does not apply in a shadow root, `position: fixed` leaves the frame, one loop stops
  all frames, and one frame can read another. Each library would need its own workaround.
- **B: no iframe; SES `lockdown()` or QuickJS.** `lockdown()` works with React, Radix and Tinker
  (6–7.5 ms), but it does not protect the DOM or `fetch`, and the easel page holds the session.
  QuickJS has no DOM. ShadowRealm is at Stage 2.7 and in no browser.
- **Plain scripts (the earlier decision).** Smallest, but with no ecosystem and no structure.

## Open

- **A loop in one frame, in other browsers.** Measured on 2026-11-22 (Chrome 158,
  `~/work/tmp/e8-kit/proc-test/`): with site isolation on, as on desktop Chrome, and
  `IsolateSandboxedIframes` at its default, a 3 s loop in a sandboxed frame does not stop the page
  (largest gap 67 ms). With that feature off, the page stops for 3 s. Playwright and agent-browser
  turn it off, so the earlier spikes showed a stop. So desktop Chrome needs no second site. Firefox
  and Safari are not measured; if a team uses them and a frame stops the page, serve frame
  documents from a second site, as Claude artifacts and CodePen do.
- **Pictures of an app frame.** The picture of a version must show the app's first paint.
  `react-dom/server` gives HTML with no script; the step 4 spec decides.
- **Charts.** A chart library takes colors as props, which the class places do not cover. Add one
  with a kit version when a team asks for charts, with a check of color props.

## Build order

Step 4 of E8. It replaces the step "Pieces (`k-`)" of kit-on-tailwind. Each item is one or more
ships; each ends green.

1. **Spec and model first.** SPEC-kit and SPEC-viewer get the app frame, with the `logic` and
   `View` shape. A TLA+ model of the app
   frame's life (going live, the hello, a new look, `close`, `closed`, removed), with a variant
   that removes the iframe with no `close` and fails.
2. **The class check on TSX** with oxc-parser: the fixed places, `kit/class-built`, the fixes by
   position, the two-order test, and the static load in the binary with the release script change.
   The same rule as an Oxlint JS plugin.
3. **The runtime bundle for each kit version**, its versioned address, and the import check.
4. **frame.put of a TSX frame:** check, JS, CSS, kept with the frame version.
5. **The live app frame** in the viewer: mount with a Tinker scope, a new look on the port (K7),
   `close` and `closed`. A browser test with 12 live app frames: going live p95 under 150 ms.
6. **The kit's pieces as shadcn components** and `put_piece` (K12, K14).
7. **The board worker** for `logic` that must stay or that frames share, on the port package of
   Tinker when it comes (the feedback is in `~/work/tmp/e8-kit/tinker-feedback.md`), or on
   easel's own port backend until then.
