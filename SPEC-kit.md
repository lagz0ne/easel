# Spec: kit — V1

Module `kit` of [SPEC.md](SPEC.md). Depends on [access](SPEC-access.md).

## Objective

Give the frames of one easel one look and one kit, so that agents make frames fast and alike from
the first day, and the frames of a team do not look generic (epic
[E8](docs/epics.md#e8-one-look-fast), K1 to K14).

- The **look** is the look values of the easel: colors, fonts, type sizes, spaces, radii and
  shadows. easel keeps it in the DTCG format 2025.10 (a W3C Community Group report). Each look value is a CSS
  custom property: a color has its shadcn/ui name (`color.primary` is `--primary`), and the others
  have their Tailwind name (`--text-sm`, `--radius-md`, `--spacing`). The kit's Tailwind theme maps
  each class to a look value, so `bg-primary` gives `var(--primary)`. Tailwind's own palette is
  off: only the colors of the look exist.
- The **kit** is the pieces of screen. A class piece is a component class in the CSS layer
  `components` (`btn btn-primary`, `card`, `badge-success`). An element piece is a short tag that
  the frame expands (`<k-plan name="Pro">`); agents add them.
- An agent writes only content: semantic HTML, kit classes for the common pieces, and Tailwind
  utilities for all the rest (layout, sections of its own, a look that is not generic). A utility
  on a piece wins over the piece.
- At each put, easel makes the CSS of the frame's class names (the **make step**) and keeps it with
  the frame version. When easel shows a frame, or draws its picture, it composes the document from
  the look, the kit's made CSS, the frame's made CSS and the frame. A change of the look changes
  only the values of the variables, so it reaches each frame with no make and no write.
- A frame is an **HTML frame** (one HTML document, as above) or an **app frame**: a TSX module,
  a React and Tinker app in its own sandboxed iframe (decision
  [frame-apps](docs/decisions/frame-apps.md)). An app frame writes its class names only in fixed
  places, so the check reads each class from the syntax tree, and the make step gets exactly those
  classes. § App frames tells the rest.
- Each change of the look or of a piece makes a new **kit version**. A kit version and a frame
  version never change, and their made CSS is kept with them. What a viewer saw is a frame version
  and a kit version, so the Before of a result still shows the look of that time.

Terms of this spec:

| Term        | Definition                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| look value  | One named value of the look, such as `color.primary`. Its CSS name is `--primary`.                                         |
| piece       | One part of the kit: a component class, or an element with a template. It has a name, a text, and two lines for the guide. |
| revision    | The number of one piece, or of the look. It starts at 1 and increases at each change of it.                                |
| kit version | The number of one state of the look and the kit together. It starts at 1 and increases at each change of either.           |
| seed        | The look and the kit that the binary holds. The first start writes them as kit version 1.                                  |
| make step   | The one step that makes CSS from the kit source and a list of class names. Its engine is named in one place (§ Contract).  |
| made CSS    | The CSS that the make step gave. It is kept with the kit version or the frame version that it was made for.                |
| finding     | One place in a document that is not in the look or the kit, with the fix.                                                  |
| guide       | The text that tells an agent how to make a frame. easel makes it from the look and the pieces.                             |
| compose     | To make the document that a frame shows: the frame's document with the look, the made CSS and the piece script added.      |
| app frame   | A frame that is a TSX module: it exports `logic` (its Tinker cells and operations) and `View` (React). § App frames.       |
| class place | A place in an app frame where a class name can be: the `className` attribute, and the arguments of `cn`, `clsx` and `cva`. |
| runtime     | The runtime bundle of a kit version: the packages that an app frame can import, built one time for each kit version.       |

Prior art:

- v0 and Lovable give the model shadcn/ui on Tailwind, with the rule "use the semantic colors"
  (`bg-primary`). A change of the CSS variables reaches each screen. easel takes the color names
  of shadcn/ui (MIT) as the names of the look's colors.
- daisyUI is a Tailwind plugin of component classes (`btn btn-primary`), with an `llms.txt` "so
  the agent writes less code". easel's kit is the same form: component classes for the common
  pieces, Tailwind for the rest.
- Tailwind CSS v4 makes CSS from class names with a compile API, and its theme is CSS variables
  (`@theme`; `--color-*: initial` turns the palette off; `inline reference` maps a class to a
  variable that the theme does not define).
- The decision, the measures and the other engines are in
  [docs/decisions/kit-on-tailwind.md](docs/decisions/kit-on-tailwind.md). The app frames are in
  [docs/decisions/frame-apps.md](docs/decisions/frame-apps.md).
- Claude artifacts, CodeSandbox and StackBlitz run each preview as a full app in its own
  sandboxed iframe; Claude artifacts allow a fixed list of libraries: the app frame and its
  runtime.
- Tailwind's docs ("Dynamic class names") ask for each class name whole in the source, and the
  lint rules eslint-plugin-better-tailwindcss and oxlint-tailwindcss read classes from attributes
  and from listed callees (`cn`, `clsx`, `cva`): the class places.
- Chromatic and the Storybook test runner take the picture of a component in a real browser: the
  picture of an app frame.
- 11ty WebC and Enhance expand a short tag to plain HTML in the light DOM, with slots: the element
  pieces.
- Figma libraries and Lovable design systems keep versions: a file keeps its version until the
  team accepts an update. Kit versions and the seed do the same (K11).
- stylelint's `declaration-strict-value` refuses a color that is not a variable: the K5 check.
- The WCAG 2.2 contrast formula (1.4.3, 1.4.11) for K8.
- A write with a base is optimistic concurrency, as `frame.put` ([frames](SPEC-frames.md)).

## Journeys

### Make a frame from the kit (E8.1)

1. An agent runs `easel kit`. It prints the guide: how to style, the colors of the look, and each
   piece with its `use:` line. The CLI help of `easel put` and the MCP server's instructions say
   to read it first (K2).
2. The agent writes the frame with kit classes and Tailwind utilities, and runs
   `easel put <canvas> page.html`. easel makes the CSS of the frame's class names, saves the frame
   with it, and answers the findings of the check (K5). With no finding, the CLI prints the id and
   the version only. With findings, it prints each one on stderr as
   `page.html:<line>:<col> <rule> <what>. Fix: <fix>`, at most 20, then the count. The findings do
   not stop the put.
3. Every open tab shows the frame in the look (K1). The picture shows it in the look too.
4. `easel kit check page.html` runs the same check and writes nothing.
5. A frame that is not a screen of the product (a diagram, a mood board) holds
   `<meta name="easel-kit" content="off">`. easel then adds nothing to it, makes no CSS for it,
   and finds nothing.

### Make an app frame (E8.1)

1. An agent needs state or the React ecosystem in a frame (tabs, a dialog, a flow of steps). It
   runs `easel kit`; the guide also tells the shape of an app frame and the packages of the
   runtime.
2. It writes one file, `page.tsx`:

   ```tsx
   import { data, operation } from "@tinkered/core";
   import { useData, useRun } from "@tinkered/react";
   import { cn, frameLogic } from "@easel/frame";
   import { z } from "zod";

   const period = data<"month" | "year">({ label: "pricing.period", initial: "month" });
   const pick = operation({
     label: "pricing.pick",
     input: z.enum(["month", "year"]),
     depends: { period: period.controller },
     run: ({ period }, { input }) => period.set(input),
   });

   export const logic = frameLogic({ cells: { period }, ops: { pick } });

   const tone = { month: "bg-primary text-primary-foreground", year: "bg-muted" };

   export function View() {
     const now = useData(logic.cells.period);
     const { run } = useRun(logic.ops.pick);
     return (
       <main className="flex flex-col gap-4 p-8">
         <button type="button" className={cn("btn", tone[now])} onClick={() => run({ input: "year" })}>
           Per year
         </button>
       </main>
     );
   }
   ```

3. `easel put <canvas> page.tsx` puts it (build order item 4 of the decision). easel checks it,
   makes its JS and its CSS, and saves them with the frame version. The answer holds the findings,
   as for an HTML frame. A class that code builds (`` `bg-${tone}` ``) is the finding
   `kit/class-built`, with the fix: a map of whole names, as `tone` above.
4. A file that does not parse, imports a package that is not in the runtime, keeps state in React,
   or does not export `logic` and `View`, answers `offKit` with its findings. Nothing is saved.
5. `easel kit check page.tsx` runs the same check and writes nothing.

### Change the look (E8.2)

1. A user runs `easel look get -o look.json`. It writes the look (DTCG JSON) and prints its
   revision and the kit version.
2. The user changes values, for example `color.primary`, and runs
   `easel look set look.json --base <rev>`. The file may hold only the values to change (a JSON
   Merge Patch, RFC 7386). It can change values only: a name that the look does not have is
   `invalid`. easel checks each pair of the kit (K8).
3. All pairs pass: easel saves the look, makes a new kit version, and prints the new revision and
   kit version. Each live document in each open tab shows the new look within 1 second, with no
   reload. Each other frame in view shows it within 10 seconds on a canvas with 20 frames in view;
   until then it shows its last picture, never a white box. No frame is written (K7).
4. A pair fails: nothing is saved. The answer is `unreadable`, and the CLI prints each failing
   pair: `primary-foreground on primary: 1.53:1, needs 4.5:1 (a primary button)`, and exits 1.
5. Another user changed the look first: the answer is `stale` with the current revision, and
   nothing is saved. The user gets the look again and makes the change on it.
6. `easel look undo --base <rev>` gives the look from before the last change of the look, as a new
   kit version. The step is a change too, so a second step gives the changed look back (K9). With
   no change of the look yet, it answers `none`.
7. A viewer asks for a change of the look in a request (E4). The agent that takes it does steps 1
   to 3, and resolves the request. The Before of the result, and the When asked picture of the
   request, show the old look; the After shows the new look (K10).

### Add to the kit (E8.3)

Not built. [SPEC-pieces](SPEC-pieces.md) (proposed on 2026-11-23) replaces this section: the
pieces of a team are TSX components, not HTML templates.

1. An agent needs a pricing card that the kit does not have. It writes one file, `k-plan.html`:

   ```html
   <!-- doc: a pricing card: its name, price, features as a check list, and a button -->
   <!-- use: <k-plan name="Pro" price="$29" period="month" cta="Start trial" featured><li>10 projects</li></k-plan> -->
   <template>
     <article class="card gap-6">
       <header><h3>{name}</h3><span class="badge badge-info" data-if="badge">{badge}</span></header>
       <p><strong class="text-4xl font-semibold">{price}</strong> <span class="text-muted-foreground">/ {period}</span></p>
       <ul class="flex flex-1 flex-col gap-2"><slot></slot></ul>
       <button class="btn btn-primary" data-if="featured">{cta}</button>
       <button class="btn" data-if-not="featured">{cta}</button>
     </article>
   </template>
   ```

2. `easel kit put k-plan k-plan.html` adds it. easel makes the CSS of its class names into the new
   kit version, and prints its revision 1 and the kit version. A name that the kit has answers
   `taken`: the agent gets that piece and uses it.
3. A second agent runs `easel kit`. The guide lists `k-plan` with its `use:` line. The agent writes
   `<k-plan ...>` in its frame, and copies no markup (K12).
4. A class piece is changed the same way: `easel kit get btn -o btn.html` prints the revision; the
   agent changes the CSS (`@apply` of utilities is allowed) and runs
   `easel kit put btn btn.html --base <rev>`. Each frame that uses it shows the new button: each
   live document within 1 second, with no reload when only CSS changed (K13).
5. Another agent changed the piece first: the answer is `stale` with the current revision. Nothing
   is written. The agent gets the piece again and makes its change on it (K14).
6. A piece with a color or a size that is not in the look answers `offLook` with its findings. A
   piece that makes a pair fail answers `unreadable`. Nothing is written.

## Contract

Every call is refused `{ signIn: true }` without a live user token. Any user may read and change
the look and the kit: one server is one team.

```ts
type PieceInfo = { name: string; kind: "class" | "element"; doc: string; use: string; rev: number }
type Piece = PieceInfo & { file: string }            // the piece file: comments, template, style
type Finding = { line: number; col: number; rule: Rule; what: string; fix: string }
type Rule = "look/color" | "look/size" | "look/override" | "kit/class" | "kit/piece" | "kit/script"
          | "kit/class-built" | "kit/parse" | "kit/import" | "kit/react-state" | "kit/shape"   // app frames
type Pair = { text: string; on: string; ratio: number; min: number; where: string }

"kit.guide": { kind: "found"; kit: number; text: string }
"kit.capsules": { kind: "found"; kit: number; start: Start; capsules: CapsuleRow[] }   // § The capsules
"kit.list":  { kind: "found"; kit: number; pieces: PieceInfo[] }
"kit.get":   { kind: "found"; kit: number; piece: Piece } | { kind: "gone" }
"kit.put":   { kind: "created" | "updated" | "unchanged"; name: string; rev: number; kit: number }
           | { kind: "stale"; rev: number; kit: number } | { kind: "taken"; rev: number }
           | { kind: "gone" } | { kind: "offLook"; findings: Finding[] }
           | { kind: "unreadable"; fails: Pair[] } | { kind: "tooBig"; maxBytes: number }
"kit.check": { kind: "checked"; kit: number; findings: Finding[]; more: number }
           | { kind: "tooBig"; maxBytes: number }
"kit.accept": { kind: "updated"; rev: number; kit: number; runtime: string }   // § App frames
           | { kind: "unchanged"; rev: number; kit: number }
"look.get":  { kind: "found"; kit: number; rev: number; look: Dtcg } | { kind: "gone" }
"look.set":  { kind: "updated" | "unchanged"; rev: number; kit: number }
           | { kind: "stale"; rev: number; kit: number } | { kind: "unreadable"; fails: Pair[] }
"look.undo": { kind: "updated"; rev: number; kit: number } | { kind: "stale"; rev: number; kit: number }
           | { kind: "none" }
```

| Call                    | Success kinds                     |
| ----------------------- | --------------------------------- |
| `kit.guide`, `kit.list` | `found`                           |
| `kit.capsules`          | `found`                           |
| `kit.get`, `look.get`   | `found`                           |
| `kit.put`               | `created`, `updated`, `unchanged` |
| `kit.check`             | `checked`                         |
| `kit.accept`            | `updated`, `unchanged`            |
| `look.set`              | `updated`, `unchanged`            |
| `look.undo`             | `updated`                         |

Inputs:

- `kit.get` takes `{ name, at? }`; `look.get` takes `{ at? }`. `at` is a kit version: the piece or
  the look as it was in it. A kit version that is not stored answers `gone`: the server knows
  which kit versions it has, and `invalid` is only for an input that the contract's shape refuses.
- `kit.put` takes `{ name, file, base? }`. No `base` adds the piece; a name that is there answers
  `taken`. With `base`, a name that is not there answers `gone`. A name is `[a-z][a-z0-9-]{0,39}`.
  An element piece's name starts with `k-` and its file has a `<template>`; a class piece has a
  `<style>` and no template. The file has the `doc:` and `use:` lines, each 1 to 200 characters.
  A file that breaks these is `invalid`, with the line.
- The template language: `{attr}` is the value of an attribute of the element, put in as text;
  `<slot>` takes the children with no `slot` attribute; `<slot name="x">` takes the children with
  `slot="x"`; `data-if="attr"` keeps an element only when the attribute is there, `data-if-not`
  only when it is not. There is nothing else: no loops, no expressions.
- `kit.check` takes `{ html }` or `{ tsx }` (an app frame), with the size limit of `frame.put`:
  over it, `tooBig` with `maxBytes` (1048576 for `html`, 262144 for `tsx`). For a `tsx` that does
  not parse, the findings are the `kit/parse` ones. `easel kit check <file>` sends a file whose
  name ends in `.tsx` as `tsx`, any other file or stdin as `html`.
- `look.set` takes `{ look, base }`. `look` is DTCG JSON, merged into the stored look as a JSON
  Merge Patch of values only. The look's names and types are fixed (`src/kit/shape.ts`, the names
  of the seed), so the contract's shape checks a patch before it is sent. A name that the look
  does not have, a `$type` that does not match, a `null` (a removal in RFC 7386), a value that
  does not fit its type, a color whose `hex` is not the color of its `components`, or an alias
  that does not name an earlier look value of the same type (in the order of the look; so no
  alias makes a loop) is `invalid`, with its path. Each `$value` of the patch replaces the stored
  `$value` whole; a value is not merged into the old one. A `$type` or `$description` in the patch
  changes nothing, so the whole file of `look.get` is a patch too. The same look values answer
  `unchanged`. An old `base` answers `stale` before the pairs are measured. `look.undo` takes
  `{ base }`.
- `tooBig`: a piece file over 64 KiB, or a kit whose made CSS and templates would be over 128 KiB,
  in UTF-8 bytes.

The board (`easel.board`) gets the cell `kit`, keyed by canvas, with the same value for each
canvas: `{ kit, look, css, pieces: { name, template }[] }`. `look` is the look as an unlayered
`:root` block of look values; `css` is the kit's made CSS (theme, base, components, the
classes of the templates). Every read runs the `mayRead` guard of [frames](SPEC-frames.md). When
the kit version changes, the cell of each canvas changes.

easel writes the cell `kit` at scope (`kit.atScope`), as the cells of frames
(src/frames/store.server.ts). A call runs in its own request session; a cell write there stays in
that session, and no other tab sees it. frames' start runs the kit's start first (the table, and
the seed into an empty store), then sets the cell of each canvas; `canvas.create` sets the cell of
its canvas.

The answer of `frame.put` and of `kit.check` holds the first 20 findings, in document order;
`more` is the count of the others.

### The look and the kit versions

The look is a DTCG 2025.10 file. Each look value has a `$type` (its own, or that of the nearest
group) and a `$value`:

| `$type`      | `$value`                                                               | CSS                       |
| ------------ | ---------------------------------------------------------------------- | ------------------------- |
| `color`      | `{ colorSpace: "srgb", components: [r, g, b], alpha?, hex? }`          | `#rrggbb`, or `#rrggbbaa` |
| `dimension`  | `{ value, unit }`, `unit` is `px` or `rem`                             | `14px`, `0.875rem`        |
| `fontFamily` | a name, or a list of names                                             | the names, with commas    |
| `shadow`     | a layer `{ color, offsetX, offsetY, blur, spread, inset? }`, or a list | the layers, with commas   |

A `$value` can be an alias, `{font.sans}`: the look value gets the value that the alias names. The
CSS name of a color drops its group (`color.primary` is `--primary`). The other names join their
path with `-` (`text.sm` is `--text-sm`, `spacing` is `--spacing`). A color in another color space
is `invalid` in this version of easel.

A kit version is one row of `kit_versions` in the app's SQLite file. It holds: its number, the
revision of the look, the look (the DTCG file), the look values by CSS name, the look as a `:root`
block, the kit's own CSS (its base rules and pieces), its made CSS, and its element pieces. The
newest row is the current kit version. The `:root` block and the made CSS are made once, when the
row is written; a show reads them as stored.

A frame version keeps its made CSS and the number of the kit version that it was made for. A
frame that turns the kit off, and a frame version stored before the kit, keep no made CSS (null):
easel shows them as they are.

### The seed

The binary holds the seed. The first start writes it as kit version 1, with look revision 1.

- The seed is the look of ui.shadcn.com (shadcn/ui, MIT). The user chose it on 2026-11-22: a look
  with no color of its own does not push frames toward one style.
- The colors are the shadcn/ui names and the values of its base color "neutral", from oklch to
  sRGB. The chart colors are its grey scale (`chart-1` `#d4d4d4` to `chart-5` `#262626`).
- The fonts are Geist and Geist Mono 1.9.2 (Vercel, OFL-1.1), then Tailwind's font stacks. The
  radii are those of shadcn/ui's `--radius` (10px): `sm` 6px to `4xl` 26px. The type scale, the
  shadows and `--spacing` are Tailwind's (MIT).
- A shadcn/ui value that fails K8 is changed to the nearest value that passes, and its
  `$description` tells the change: `muted-foreground` (4.35:1 on `muted`), `destructive` (4.47:1
  on `muted`), `input` and `ring` (under 3:1 on `background`). The colors that shadcn/ui does not
  have (`success`, `warning`, the three `-soft` colors) come from Tailwind's palette, except
  `warning`, which is `#8a5a00` (5.44:1 on `muted`).
- The kit's pieces have the class names of the E8 study (A+T) and the shapes of the shadcn/ui
  "Maia" style: pill buttons, fields, badges and tabs, and round cards (`src/kit/seed.server.ts`).
  A field keeps an edge of `input` (3.45:1), as K8 asks; the Maia field of the site has none.
- The binary holds the two font files (`src/kit/fonts/`). `GET /api/fonts/geist-1.9.2/<file>`
  serves each one, immutable, to any origin, as a frame's origin is `null`. It also holds Inter
  5.3.0, the font of the viewer, in three files by `unicode-range` (`/api/fonts/inter-5.3.0/`); a
  look that names Inter gets its three faces. The look's CSS
  (`easel-look`) starts with an `@font-face` for each held font that a `--font-*` value names. A
  picture gets each font as a `data:` URL, as it is drawn with no route to the easel.
- An easel that has a kit keeps it (K11). A new seed reaches only a new easel.

### The make step

`make(source, classNames)` answers CSS. It is the only place that makes CSS, in
`src/kit/make.server.ts`. It is a pure function of its two inputs: the same inputs give the same
bytes, in any order of calls.

- **The engine** is the Tailwind CSS v4 `compile()` API (`tailwindcss`, MIT, pure JS), in Bun, at
  one exact pinned version (4.3.5). Each make uses a new compiler: a compiler keeps the class
  names of earlier builds, so a shared one makes CSS that depends on the order of puts. There is
  no browser runtime. A new engine version is a new pin; it never makes the stored CSS again.
- **For a kit version:** the source is the kit source: the theme, Tailwind's preflight as the
  base (a copy of `preflight.css` of the pin, in `src/kit/preflight.server.ts`, which a test holds
  to the file of the package), the base rules of the kit, and the CSS of each piece in the layer
  `components`. The class
  names are those of the templates. The made CSS goes into the kit version.
- **For a frame version:** the class names are those of the frame's `class` attributes only. The
  names that the check finds (a palette color, an arbitrary color or font size, a name that gives
  no CSS) are removed before the build: Tailwind has no setting that turns arbitrary values off.
  Only the layer `utilities` goes into the frame version.
- **The theme** maps each class of the look's namespaces (color, font, text, radius, shadow,
  spacing) to a look value with `@theme inline reference`. So the made CSS holds `var(--primary)`
  and defines no look value; the look's own `<style>` gives the values. The default palette and
  the default scales of these namespaces are off. The other namespaces that the kit allows
  (font-weight, leading, tracking, breakpoint, container, ease, animate, blur, aspect, and the
  others of Tailwind's theme) keep Tailwind's values, fixed in the kit source. A namespace that
  the kit source does not list gives no CSS, and is a finding.
- A change of the look makes no CSS: the look's names are fixed by the seed, and only their
  values change.
- **The reserve engine** is UnoCSS (`presetWind4`), with a new generator for each make. It draws
  the same pictures, at about 5 times the time.

Speed budget (measured on 2026-11-21, on this host): the check, the make of the utilities and
`compose` together take 1.6 ms (p50) for a usual frame and 8.4 ms for a frame of 208 KB. The
first make after a start takes 56 ms. A put spends at most 50 ms in this chain for a frame of
1 MiB.

Measured on 2026-11-22, on this host, with the step-1 code (`check` and `make`, no `compose`):
about 3 ms (p50) for a usual frame; for a frame of 1 MiB, 30 ms for the check and 3 ms for the
make. With the step-2 code, all of `frame.put` (the check, the make and the write): 4 ms (p50)
for a usual frame, 32 to 43 ms for a frame of 1 MiB.

Measured on 2026-11-22 (vibea2, p50), the check of an app frame (`kit.checkApp`: the parse, the
walk of the class places and the K5 verdicts): 0.8 ms for a usual frame (the pricing frame of
`tests/kit/frames/`, 4.7 KB), 28 ms for a frame of 256 KiB, 110 ms for a frame of 1 MiB (the
parse alone is 40 to 50 ms of it). So the limit of an app frame is 256 KiB (§ App frames).

### compose

The shared module `src/kit/compose.ts` (no `.server.`) holds the pure functions that the page
and the server both use:

- `compose(html, css, kit)`: `css` is the frame version's made CSS. When it is null, the check at
  the put found `<meta name="easel-kit" content="off">`, or the version was stored before the
  kit: `compose` answers `html` as it is. Else it answers `<!doctype html>`,
  `<style id="easel-look">` (the look), `<style id="easel-kit">` (the kit's made CSS),
  `<style id="easel-frame">` (the frame version's made CSS), the piece script, then `html` without
  its own doctype. In a style text, `</style` is written `<\/style`, so no stored text can end its
  element.
- `contrast(look, kit)`: the pairs of K8 and their ratios.

`check(html, kit)` is not in `compose.ts`: it needs Tailwind and Lightning CSS, so it runs on the
server only, in `src/kit/check.server.ts` (with `scan`, `prepare`, `judge`, `colors` and `names`
in `src/kit/`). It gives the findings of K5 in document order, and the class names to make:

- It reads the document with a tokenizer of the HTML start tags (`scan.server.ts`), not with
  Bun's `HTMLRewriter`: `HTMLRewriter` gives no offset of an attribute, and each finding needs its
  line and column. The tokenizer reads the class, `style`, `fill`, `stroke` and `stop-color`
  attributes, the `on*` attributes, the `k-` tags, and the text of `<style>` and of each script.
  It skips comments and the text of `<textarea>`, `<title>` and the other raw-text elements. Of
  two attributes with one name on one tag, the first counts, as in a browser.
- It asks the Tailwind design system of the kit version which names give CSS (`parseCandidate`,
  `candidatesToCss`), and finds colors in CSS with a Lightning CSS `Color` visitor. The design
  system is made one time for each kit version, in a resource at scope (never in a session cell).
  `__unstable__loadDesignSystem` is not a stable API of Tailwind: the pin and a test hold it.
- The binary holds the native build of Lightning CSS for its system
  (`src/kit/lightningcss.server.ts`): a static `require` of the `.node` file of each release
  target (darwin-arm64, linux-x64, linux-arm64). The package's own loader makes the name at run
  time, so `bun build --compile` cannot find it. A test compiles a binary and makes CSS with it.

The piece script (in the composed document, at most 3 KiB) defines one custom element for each
element piece, when the document is parsed (`DOMContentLoaded`), so that each element has its
children. It expands the template into the element's light DOM.

A frame document can start before the page listens. So the piece script sends a hello
(`{ easel: "hello" }`) to its parent at once, and again each 50 ms, until it gets a `MessagePort`
(as penpal does). When it gets the port, it stops. The page answers only a hello whose
`event.source` is one of its own live iframes: at once, with a kit message that carries the port,
for the current kit. Each later kit message goes on that port. Two hellos can be in flight before
the first answer: the page answers each with a new port and closes the one before, so the script
takes each port that its parent gives and keeps the newest. A kit message is
`{ easel: "kit", kit, look, css }`; the piece script then replaces the text of the two `<style>`
elements `easel-look` and `easel-kit`.

### App frames

The decision is [frame-apps](docs/decisions/frame-apps.md). This section tells what its build order
items 2 to 6 need. The board worker (item 7) comes later: only its place is told here.

**The file.** An app frame is one TSX module in UTF-8, or a folder of them (below), of at most
256 KiB together (262144 bytes; a larger one is `tooBig`, see SPEC-frames). The limit is less than
the 1 MiB of an HTML frame because the parse of 1 MiB of TSX alone takes 40 to 50 ms, all of the
speed budget. The entry exports `View`, and `logic` or `frame`, and no other name. A name can come
from another file of the frame (`export { View } from "./view"`) or have another name in the file
(`export { V as View }`): the JS imports the entry as a whole. A frame of the first form exports
these two:

- `logic`: the frame's Tinker cells and operations, as `frameLogic({ cells, ops })` of
  `@easel/frame` gives them. Each state of the frame is a Tinker cell (decision 10).
- `View`: a React component with no props. It only reads cells (`useData`) and runs operations
  (`useRun`). It holds no React state and no effect: no `useState`, `useReducer`,
  `useActionState`, `useOptimistic`, `useSyncExternalStore`, `useEffect`, `useLayoutEffect` or
  `useInsertionEffect` in the file (`kit/react-state`, as `tinker/react-state`). A text field that
  must keep each key uses `defaultValue`.

So a review, a test and the check see each state and each operation of a frame in one place,
with no browser. A capsule frame exports `View` as a resource, and its own capsule as `frame` if it
has one (§ The capsules, "A capsule frame"). Only `View` is required (`kit/shape`).

**A folder** (built on 2026-11-22; prior art: the file maps of Sandpack, StackBlitz and
CodeSandbox, and the `files` of a shadcn registry item). A frame of more than one file is a map of
paths to texts, with the entry `index.tsx`, at most 64 files. A path is relative, with `/` between
its parts; each part starts with a letter or a digit, and the name ends in `.ts` or `.tsx`. So no
path starts with `/` or has `..` as a part. Each file gets the check of a TSX file. An import of a
file of the frame is a path from the importing file (`./copy`, `../entities.ts`), as written or
with `.ts`, `.tsx`, `/index.ts` or `/index.tsx`; a path that no file has is `kit/import`. Only the
entry has `kit/shape`. Each finding names its file (`file`). The store keeps a folder as the JSON
of its files, sorted by path: a TSX module is never a JSON object, so `frame.get` knows the form.

**The JS** (changed on 2026-11-22). The JS of an app frame is one ES module, from its fixed files,
made by `Bun.build` in memory (`appBundle`). Its entry is easel's own: it imports the entry file
as a whole and calls `mount({ View, frame })` of `@easel/frame`, so a bundler that renames a name
cannot break the mount. Each import of a name stays an import, for the import map. The white space
is minified, so the JS has no comment with a path of the host. It builds in the compiled binary
too (`tests/kit-binary.test.ts`). The JS of an app frame made before this change gets the mount
line that compose added then, one time at start (`frames_migrations`, `mount-old-js`).

**Where `logic` runs.** In build order items 2 to 6, `logic` runs in the frame's own Tinker scope,
in its iframe. When a frame's state must stay after the frame closes, or frames share it (a flow of
frames), its `logic` will run in the board worker (item 7, not built): one dedicated Worker for
each board and tab, with an origin of `null`. The file is the same in both places, so a frame
written now works in the worker later. Item 7 tells how a frame asks for the worker.

**The runtime.** Each kit version has one runtime bundle, kept with it (K11), as its made CSS
(build order item 3). Its packages, for the first kit version, each pinned exactly in
package.json: `react` and `react-dom` 19.3.1, `@tinkered/core` and `@tinkered/react` 0.30.1, `zod`
4.6.7, `radix-ui` 1.8.1, `lucide-react` 1.77.0, `clsx` 2.1.1, `class-variance-authority` 0.7.1,
`tailwind-merge` 3.7.1, `@easel/frame` (easel's own helper, `src/kit/easel-frame.ts`:
`frameLogic`, `cn`, and the mount), and `@easel/kit` (the kit's capsules, the exports of
`src/kit/capsules/look.ts`, `copy.ts` and `ui.tsx`: `look`, `copy`, `ui`, `locales`, `textGaps`). A new package comes with a new kit version; no package that
brings its own CSS. An app frame imports only the names of its kit version's runtime: these
packages, and the subpaths `react/jsx-runtime` and `react-dom/client`. Another import, a relative
import, an address, or a dynamic `import()` is the finding `kit/import`, and it refuses the put.
`@easel/frame` mounts the app. A View component and a capsule frame both get a scope with the
kit's capsules (`look`, `copy`, `ui`), so a part of either form can say the texts of the team.
The mount renders the View after the start of its scope, which runs no timer, in one synchronous
step (`flushSync`). So its first render is in the document before the `load` event (a browser
test reads the body at `load`).

- **The build** (`src/kit/runtime.server.ts`, `buildRuntime`): one `Bun.build` for the browser,
  with React's production build, minified, with one entry file for each name (`react.js`,
  `tinkered__core.js`, `easel__frame.js`, ...) and the code that they share in chunks named by
  their hash (`splitting`). A frame loads only the entries that it imports and their chunks. Its
  SHA-256 is of the file names and texts, so the same pins give the same SHA-256: a test builds it
  twice and finds the same bytes.
- **The binary holds it.** `scripts/build-binary.ts` makes it with the same `buildRuntime` and
  puts it in the binary (the module `easel:runtime`), so a binary needs no `node_modules`. Dev and
  the tests build it in their scope at its first use. A test finds the SHA-256 of the binary's
  runtime equal to that of a build in a scope.
- **Kept with the kit version** (`runtimeOf`). A kit version gets the runtime of the easel that
  runs at its first use by an app frame (a put), and keeps it from then: one transaction writes
  the files in `kit_runtimes` (once for each SHA-256) and sets the kit version's `runtime` where it
  has none, so of two first uses the first wins. It is never made again. So after an update of
  easel with other pins, a kit version that has a runtime keeps its bytes, and a restart reads the
  same bytes (K11). A change of the look keeps the runtime of the kit version before it: the look
  is in CSS, not in the runtime. A kit version stored before the runtime has none until its first
  use. This is the one column of a kit version that is written after the row: one time, from null.
  It is at the first use, and not when the kit version is made, because most kit versions have no
  app frame, and a build in each test scope would cost about 0.15 s.
- **Accept the runtime of this easel** (built on 2026-11-22; the chart
  [kit-runtime](docs/statecharts/kit-runtime.md), TLA+ model `KitRuntime`). After an update of
  easel, a team keeps the runtime that it has (K11). So a change to `@easel/frame` (the mount, the
  controls) or to `@easel/kit` reaches its frames only when the team accepts it. This is the
  library update of Figma: a file keeps its library version until the team accepts the update.
  1. The team runs `easel kit accept` (`kit.accept`; the MCP tool `accept_kit`).
  2. One transaction keeps the runtime of this easel in `kit_runtimes`, and one statement writes
     the next kit version (`acceptRuntime`). It is the current kit version with this runtime: the
     look revision, the look, the kit's CSS, the made CSS and the pieces stay byte for byte the
     same. The answer is `updated` with the kit version and the SHA-256 of the runtime.
  3. The statement writes only when the current kit version has a runtime and that runtime is
     another one. Else it answers `unchanged` and writes nothing. A kit version with no runtime
     gets the one of this easel at its first use. Of two accepts, the first writes, and the other
     answers `unchanged`.
  4. A frame keeps its kit version until a put. A put of the same TSX (or the same files) on a
     kit version with another runtime is a new frame version (SPEC-frames § Contract). So the
     agent puts each app frame again, as the CLI says: `Put each app frame again to give it
this runtime`.
  5. A frame version that is not put again shows the runtime of its kit version, as before. The
     look of the board comes from the current kit version, as after a change of the look.
     The chart [kit-runtime-same-text](docs/statecharts/kit-runtime-same-text.md) shows why step 4
     compares the runtime: with the text only, the put after the accept writes nothing.
- **The address**: `GET /api/runtime/<kit version>/<sha-256>/<file>`, from the stored bytes, with
  `Content-Type: text/javascript; charset=utf-8`, `Cache-Control: public, max-age=31536000,
immutable` and `Access-Control-Allow-Origin: *`. It needs no user and no pass: a frame's origin
  is `null`, so its module requests carry no cookie, and the runtime is the code of the package
  list, the same for each team. Another SHA-256, a kit version with no such runtime, a file that
  the runtime does not have, or a malformed address answers 404 with `Cache-Control: no-store`.
- **The import check** uses the names of the kit version's runtime, or, when it has none yet, the
  names of the runtime that this easel will give it. `kit.check` writes no runtime.
- Measured on 2026-11-22 (this host, Bun 1.4.4): 22 files, 1 895 107 bytes minified, 513 495
  bytes gzip (`lucide-react.js` 862 KB of it, `zod.js` 368 KB, `radix-ui.js` 267 KB). A build
  takes 116 to 156 ms. With `@easel/kit`: 25 files, 1 911 353 bytes, 520 790 bytes gzip, 161 ms. The bytes and the SHA-256 are the same in each build, after a restart, and
  in the compiled binary.

**The class rule before a put.** An agent has the easel CLI only, and the Oxlint plugin of
`kit/class-built` (`src/kit/lint.server.ts`) is in the repository, not in the binary: it needs
Oxlint and its `node_modules`. So an agent runs `easel kit check page.tsx` (`kit.check`): the
server runs the one check of the put on the file, against the current kit version, and writes
nothing. It gives each finding that the put would give, `kit/class-built` and the module
findings included, at its line and column, with the fix. The binary could run the parse alone,
but the K5 verdicts need the kit version on the server, and a second path could give other
findings than the put. An agent that works in this repository can also use the Oxlint plugin.

**Class places** (decision 5). The check reads the TSX with `oxc-parser` (MIT, pinned exactly),
which gives each literal with its offset. A class name is a whole string in a class place:

- the `className` (or `class`) attribute of a JSX element: a string, or an expression of the forms
  below;
- each argument of a call of `cn`, `clsx` or `cva`, and the forms below in it;
- the forms: a string; a template with no `${}`; `cond && <form>` (only its right side is a place);
  `a ? <form> : <form>` (not its test); `a || <form>` and `a ?? <form>` (both sides); an array of
  forms; in `cn` and `clsx`, an object whose keys are class names (its values are conditions);
- in `cva(base, config)`: `base`, each value of each variant in `config.variants`, and the `class`
  or `className` of each item of `config.compoundVariants`;
- a component's own `className` prop that it passes on (an identifier or a member named
  `className`): the call site gives the literal;
- a `const` name of the same file whose value is a form (`const base = "flex gap-2"`), or a call of
  a `const` that `cva` made (`buttonVariants({ size })`);
- a map of whole names: `tone[now]` or `tone.month`, where `tone` is a `const` object of the same
  file whose values are forms. Each value is a class place.

`null`, `undefined`, `false` and `true` in a place give no class. Anything else in a class place is
the finding `kit/class-built`: a template with a value in it (`` `bg-${tone}` ``), a `+` of strings,
a call of another function, or a name that is not one of the above. Its `what` names what is there;
its fix is: "write each class name whole: a map of whole names, as
const tone = { info: "bg-info", danger: "bg-destructive" } and className={tone[kind]}". A name is
looked up by its text in the file, not by its scope (a known limit).

Each class name of each place goes through the K5 check of an HTML frame (judged rule 12): the
same verdicts, in the same kit version. The check also finds, as in an HTML frame:

- a color or a look value in the string values of a `style` object (`style={{ color: "#f00" }}`),
  and in the string `fill`, `stroke` and `stopColor` attributes;
- a write of a class from code (`kit/script`): `classList.add`, `remove`, `toggle` or `replace`, an
  assignment to `className`, or `setAttribute("class", ...)`.

The walk reads each kind of place with its own reader. A second kind of place (the visible texts
of E9) is one more reader, with no change to the walk.

**Fixes by position.** The check answers the findings, the class names to make, and the fixed
text: the TSX with each fix applied at the offset of its class. A class of `kit/class` is removed
(with one space next to it). A color or a font size whose fix is a class of the look
(`text-red-500` gives `text-destructive`, `bg-[#f00]` gives `bg-destructive`, `text-[13px]` gives
`text-sm`) is replaced by that class. A `kit/class-built` place stays as it is: it gets no CSS.
The make step gets exactly the class names of the fixed text, so the CSS has no class that a scan
guessed. The two-order test of the make step holds for this path too.

**The put** (build order item 4). A frame version of an app frame keeps the TSX as the agent wrote
it, its JS (`appBundle`, from the fixed files), its made CSS, and its kit version. A finding of
`kit/parse`, `kit/import`, `kit/react-state` or `kit/shape` (no `View`, or an export other than
`View`, `logic`, `frame`, `controls`, `part` and `panes`)
refuses the put with `offKit`; the other findings do not stop it. An app frame always has
the kit: `<meta name="easel-kit" content="off">` is for HTML frames only. The first app frame of a
kit version gives that kit version its runtime (§ "The runtime"), so the check and the import map
use the same names. Built on 2026-11-22. Measured on 2026-11-22 (this host, Bun 1.4.4): a whole
`frame.put` of `tests/kit/frames/pricing.tsx` (the check, the fixes, the JS, the make and the
write) takes 5 to 7 ms at p50 and 7 to 10 ms at p95, in 30 puts after the first; with the JS of
`Bun.build`, 7.7 ms at p50 and 13.3 ms at p95.

**compose of an app frame** (`composeApp`, built with item 4). The viewer composes each live app
frame with it (`composeDoc` in `src/viewer/canvas.tsx`), and so does the draw of its picture.
`compose` gives `<!doctype html>`, the three `<style>` elements of an HTML frame, an import map
that names the runtime of the frame version's kit version, the axes as JSON
(`<script type="application/json" id="easel-axes">`: the locale and the data state of a capsule
frame, `{}` by default), and the frame's JS as a module script, which calls the mount itself (§
"The JS"). The body is empty: the mount renders into it. In the JS, `</script` is written
`<\/script` and `<!--` is written `<\!--`, and in the import map and the axes `<` is `\u003c`, so
no stored text ends its element. A browser test loads one composed app frame in a
sandboxed `srcdoc` iframe (`allow-scripts` only, so its origin is `null`) from the runtime's
route, clicks a button that runs an operation of `logic`, and sends `close`, then gets `closed`.
The runtime's address holds the kit version and the SHA-256 of its bytes; it answers with
`Cache-Control: public, max-age=31536000, immutable` and `Access-Control-Allow-Origin: *` (the
frame's origin is `null`).

**The hello and the port.** `@easel/frame` says hello as the piece script does (§ compose), each
50 ms until it gets a port, takes a port only from its parent, and keeps the newest port. A kit
message on the port replaces the two style texts, as in an HTML frame (K7). The port also carries
`close` and `closed`.

**Close before the iframe goes** (decision 9). In an iframe that the page removes, the async
`scope.close()` does not end, so the deferred ends of the frame's scope do not run. So the page
posts `{ easel: "close" }` to the frame (on its port; to its window when it has no port yet), and
waits for `{ easel: "closed" }`, at most 200 ms. The frame closes its scope (each deferred end
runs), then posts `closed`. Then the page removes the iframe. A frame that does not answer in
200 ms (a long loop) is removed all the same. When it removes the iframe, the page ends its own
work on the port: it sends no more kit messages there, and it ends each subscription that crosses
the port. The chart [kit-app-frame](docs/statecharts/kit-app-frame.md) holds this life; the chart
[kit-app-frame-no-close](docs/statecharts/kit-app-frame-no-close.md) shows that an iframe removed
with no `close` never runs the frame's ends. A synchronous close in Tinker would remove this step
(a request to the library author).

**How the page keeps the iframe** (the viewer, `src/viewer/stage.ts` and `canvas.tsx`). React
removes an element at once, and an iframe that moves in the document loads again. So the page
keeps the same element while the app closes, as `AnimatePresence` of Framer Motion keeps a child
for its exit:

- A frame's documents are one list: the current one, then each app document that is closing. A
  new version or another pick of the axes puts the current one in the list of closing ones.
- A frame that leaves the live set, or an app document that stops showing, goes in `holding`
  first. While it is there, its shell keeps the list.
- A deleted frame whose app document was live keeps its shell, hidden and at its place in the
  list, until it leaves `holding`.
- A closing iframe is hidden (`visibility: hidden`, `aria-hidden`), with its own `srcdoc`. It
  leaves when its app posts `closed`, or 200 ms later on the tab's clock (`closeDone`).
- An HTML frame has no `close`, so its iframe goes at once.

`tests/browser/viewer-kit.test.tsx` checks each of the three ways an iframe goes.

**The picture of an app frame** (build order item 5). The draw loads the composed app document in
Chromium, as for an HTML frame (frames § Pictures). Chromium reaches the network only through the
egress proxy, which refuses easel's own address. So the picture's document names the runtime at
`http://runtime.easel.invalid/api/runtime/<kit version>/<sha-256>/` (a `.invalid` name never
resolves, RFC 2606), and the draw answers each request to it from the stored bytes of the frame
version's kit version (Puppeteer's request interception, `pictureDoc`). Each other request goes
to the proxy as now. A test in a real Chromium draws an app frame and an HTML frame that show the
same thing, and gets the same WebP bytes. The mount renders in one step before `load`, so the draw takes the
first render, after the fonts are ready, as now. Reasons, and the option that is refused:

- The picture is the same document that a tab shows: the same runtime bytes, the same JS, the same
  CSS. So it shows what a viewer sees, Radix and layout included.
- `react-dom/server` is refused. It would run the frame's code in the server process, out of each
  sandbox, with the server's files, database and secrets. Chromium in its container is the
  boundary that frames already have (frames, known risk). It also gives no layout, and its HTML is
  not the document of the tab.

### The capsules

The kit is three Tinker capsules (decision [kit-capsules](docs/decisions/kit-capsules.md)):
`look` (the look values and the kit's CSS of a kit version), `copy` (the locale, `say` and
`format`) and `ui` (the pieces as React components). easel installs them for each app frame, with
the look of the frame's kit version. A frame is a component that depends on them (form 1) or a
capsule of its own (form 2).

**The list.** `kit.capsules` installs the kit's capsules with the look of the current kit version,
in a new scope, and reads the scope's list of capsules. For each capsule it answers:

```ts
type CapsuleRow = {
  label: string; does: string; install: string;
  config: { key: string; tag: string; required: boolean; schema: JsonSchema }[];
  exports: {
    name: string; kind: "resource" | "operation" | "cell" | "tag" | "value";
    does: string; use: string;                  // from the capsule's `<label>.about` tag
    depends: { as: string; unit: string; how: "uses" | "reads" | "writes" | "calls" }[];
    input?: JsonSchema;                         // an operation's input
    texts?: Record<string, string>;             // a part's `text`: each key, its English text
  }[];
};
type Start = { kind: "started" } | { kind: "refused"; refused: string; payload: unknown };
```

- `does`, `install` and each `use` come from the capsule's own `<label>.about` tag. A capsule
  that has no such tag is not in the kit.
- `depends` comes from the graph: the units in the `depends` of each export.
- `texts` comes from the `copy.texts` tag of a part's `text` resource.
- `start` is the start of the kit's capsules with the look of this kit version. A look that fails
  K8 gives `refused` with `LookFailsK8`.

`easel kit capsules` prints the list for a person (a schema as a short type, such as
`"en" | "vi"`); with `--json`, the answer as it is. The MCP tool `kit_capsules` gives the answer.

**A capsule frame.** The file exports `View`, a `resource` whose factory gives a React component,
and, if the frame has entities or data states, its own capsule `frame`. The mount installs
`[look({ values, css }), copy({ locale }), ui(), frame(config)]` in a new scope, then renders the
View of that scope:

- `values` are the custom properties of the `:root` rule of the frame's `easel-look` sheet, and
  `css` is the text of `easel-kit`. So the scope has the look that the document shows.
- `locale` and `config` are the frame's axes: `composeApp` writes them into the document
  (`easel-axes`), and the mount reads them. The locale is `en` by default, and each config key has
  the default of its tag. Another locale or
  another data state is another document, so another scope.
- A start that is refused (`CopyGaps`, `LookFailsK8`, `SampleInvalid`, `CapsuleMissing`, ...)
  draws an alert in place of the View: `This frame does not start: <kind>.` and the payload. The
  alert has `data-easel-refused="<kind>"`.
- A kit message (K7) replaces the two styles, then the frame draws in a new scope with that look.
  Its cells start again from the data state.
- Each draw and the close run one after the other. So `closed` comes after the close of each scope
  that the frame made, and the chart [kit-app-frame](docs/statecharts/kit-app-frame.md) holds: the
  messages of the frame and the page do not change.
- `@easel/kit` and the mount import the same modules, and the runtime keeps them in one shared
  chunk. So the `copy` that a frame imports is the `copy` that the mount installs.
- A kit version that has no runtime yet gets the runtime with `@easel/kit` at its first use. A kit
  version that has a runtime with no `@easel/kit` keeps it (K11), and so does each change of its
  look: an import of `@easel/kit` in its frames is `kit/import`.

**The axes in the viewer** (the chart [kit-frame-axes](docs/statecharts/kit-frame-axes.md)). A
capsule frame tells the page what it can show. On each new port, the mount posts
`{ easel: "axes", locales, config }`: the locales of the kit, and each config key of the frame's
own capsule whose schema lists its values (a `z.enum`), with its values and its default
(`offerOf`). A frame with no capsule posts nothing. The page keeps the axes of each frame version
(`offeredAxes`) and offers only those values:

- **The locale is one pick for the canvas**, in the dock (Storybook's toolbar globals). It shows
  once a live frame posted its axes.
- **A config key is a pick for each frame**, after the frame's name (Storybook's args): its data
  state.
- **A pick is another document.** The page composes the frame version again with the axes that it
  posted and that differ from their defaults (`axesFor`), so the frame draws in a new scope. A
  frame with no axes, or with no pick, is not composed again.
- The picks are the tab's own: another tab, and the picture of a frame, show the defaults.
- After a new version, the frame draws once with its defaults, then with the picks when it posted
  its axes: a new version can drop a value.

**The controls in the viewer** (the chart [kit-frame-controls](docs/statecharts/kit-frame-controls.md)).
A data state is a snapshot: another one is another document. A control changes the state of the
document that shows, as React Cosmos's fixture inputs and Storybook's Controls (with `useArgs`) do.
The entry file of an app frame, of either form, can export `controls`, made with `frameControls`
of `@easel/frame`. Each control has a `label` and `run`, an operation of the frame. A control can
also have `value`, a cell of the frame, whose value it shows. A write goes through the operation,
as Tinker asks of code outside a capsule. The input schema of `run` gives the control:

| The input of `run` | The control                          |
| ------------------ | ------------------------------------ |
| none               | a button                             |
| `z.boolean()`      | a switch                             |
| `z.enum([...])`    | a select of its values               |
| `z.number()`       | a number field, with its min and max |
| `z.string()`       | a text field                         |

Another input (an object, a union) has no control: the panel leaves it out.

- **The frame tells the page.** On each new port, the mount posts
  `{ easel: "controls", controls }` after its axes, and `{ easel: "values", values }`: the value of
  each value control in the scope on screen. It posts the values again after each draw, each run of
  a control, and each change of a value cell (the View's own buttons too). A frame with no controls
  posts none.
- **The page runs a control.** `{ easel: "control", key, value }` goes on the port of the frame's
  current document. The mount runs the operation in the scope on screen (`settle`, with `value` as
  its raw input), after the draws before it. A refused run posts `{ easel: "ran", key, failed }`,
  with the kind of the refusal; the panel says `The frame refused it: <kind>.` under the control.
- **Only the current document counts.** The page keeps the controls and the values of the frame's
  current document (`shownControls`), and takes a post only from it. A new document, or none,
  clears them. The port of an old document closes, so a control on the way to it is lost.
- **The place of a control** (built on 2026-11-22). A control can also have `place`: `panel` (the
  default), `top`, `left` or `right`. The frame registers it, so its author decides what is always
  at hand. Storybook puts its global controls in a toolbar on top, and its Controls in a panel
  docked to the side, in the same way.
  - `top`: in the frame's label row, after its name and the picks of its data state, as small as
    those picks.
  - `left`, `right`: in a column docked to that edge of the frame, outside it, 8 px from it, with
    its top at the top of the frame. The column keeps its screen size at each zoom, as the label
    and the pins do, and it stacks over the frames beside it.
  - Each place reads the same values of the current document (`shownControls`), so the chart
    holds for each place. While the frame has no live document, the docked controls are not
    shown. A refused run says its kind beside the control. A runtime from before the places posts
    no `place`: each of its controls goes in the panel.
- **The panel.** A frame whose current document posted a control with the place `panel` has a
  button `Controls` after its name. It opens the panel `Controls` at the right edge, in the place
  of `Requests`: one closes the other. The panel shows the frame's name and its `panel` controls,
  with the values that the document posted last. While the frame has no live document, it says
  `The frame is not live. Move it into view to use its controls.`
- **A change is not composed.** A control runs in the live scope, so the frame does not load
  again. A new document (a new version, another pick of the axes, a return into view, a kit
  message) starts again from the start of its scope. The picture of a frame, and another tab, show
  that start.
- **The runtime keeps its mount (K11).** The controls need the mount of this easel. A kit version
  that has a runtime from before keeps it: its frames post no controls until the team accepts the
  runtime of this easel (`easel kit accept`, § App frames) and puts each frame again.

**A capsule across scopes** (step 1 built on 2026-11-23: the link). A frame's capsule runs in
the frame's own scope, in its iframe. A control that is a React component, with its own state and
icons, must run in a scope of its own too, as the page runs no frame code. So a part of the
frame's capsule (its cells and its operations) must be read and called from another scope, in
another realm. Tinker gives this already: `remoteData` and `rpc` are served in one scope and read
in another, over a backend (`ws`, `memory`). easel adds the backend for two realms, over a
`MessagePort` (`src/kit/port-link.ts`). Prior art: Figma plugins, whose UI iframe talks to the
main thread only by `postMessage`, and Comlink, an RPC over a `MessagePort`.

- `portServer({ services })` serves its services on each port that `portServer.accept` gets, until
  its `stop` aborts. Each call and each watch runs in its own session, with `transport.request`, as
  over `ws`. When it stops, it posts `gone`.
- `portClient({ port })` takes a promise of the port, as an iframe gets its port after its scope
  starts. rpc (`remote: portClient`) and remoteData (`read: portClient`) reach the services at the
  other end. A write in the serving scope reaches each reader at once.
- The faults are those of any backend: `missing` for an address that no one serves, `refused`,
  `failed`, `invalid`, `encode` and `decode` as the protocol gives them, and `link` for each call
  and watch on the way when the server posts `gone`. Values go as text with the JSON codec.

**A control in its own scope** (built on 2026-11-23; the chart kit-control-link). A capsule frame
can have panes: React components, with their own state and icons, that the viewer draws beside
the frame, each in a sandboxed iframe and a scope of its own. A pane reaches the frame only through
the part of its capsule that the frame names, in the controlled way of Tinker: it reads the
frame's cells as read views, and it changes the frame only with a call that the frame runs.
Prior art: the Figma plugin UI (an iframe that talks to the main thread only with messages), and
Storybook's toolbar addons (a control beside the story, in another frame).

- **The entry file.** It exports `part = framePart({ services, serve, reach })` and
  `panes = framePanes({ top, left, right })` (`kit/shape` lets them through). `part` names the
  frame's cells as `remoteData` and its calls as `rpc`: `serve` installs them in the frame's scope
  (`board({ serve: true })`, `api({ implement })`), `reach` in each pane's scope
  (`board({ read: link })`, `api({ remote: link })`). Each pane is a View resource, as the View is.
- **The mirror.** In a pane's scope, `board.<cell>` is the cell of `remoteData`, which the pane
  link fills: `useData`, `scope.resolve` and a `depends` slot read the frame's value. A write in the
  frame (its own button, or a call) reaches each pane at once. The cells of the frame's own files
  are other cells in the pane's scope, so a pane cannot write the frame's state by them.
- **The state of a pane** is a cell of the pane's scope (`kit/react-state` holds for a pane too).
  A pane's own operation can call the frame: it depends on `api["<key>"]`.
- **The pane link** (chart kit-control-link). After each start of its scope, and on each new port, the
  frame posts `panes` (the places), then one `link` for each place: a pane link, one end of a new
  `MessageChannel`. The frame serves the other end in that scope (`portServer.accept`), until the
  next pane link of that place or the end of the scope. The page keeps the newest end of each place
  until the pane has a port, then gives it on that port; it reads nothing on it. A pane with no
  pane link asks: the page posts `link` with no end to the frame, and the frame posts a new one.
- **A pane on each pane link.** The pane's document is the frame's own, with `easel-pane` (its place).
  The mount draws only that pane, in a new scope on each pane link; the scope before it closes. A new
  look draws the frame in a new scope, so the pane links of the scope before it end (`gone`), and
  the panes get new ones. The pane posts the size of its content; its iframe takes it, up to 480 by
  720 px.
- **The places.** `top` is in the frame's label row, after its controls; `left` and `right` are in
  the column at that edge, under its controls, at screen size. A frame's panes show only while it
  has a live document.
- Not built: a page-wide pane (a locale, a theme, a data set) that is linked to each frame of the
  canvas.

**Why the list comes from the graph.** The list is the same graph that a frame of the kit version
gets. So it cannot be older than the kit, and an agent learns each part before it writes code:
what exists, how to install it, a line that uses it, what it depends on, and the texts that it can
use again.

### The texts

The detail is in [SPEC-copy.md](SPEC-copy.md) § The texts of the team (rules 1 to 7). In short:

- Each kit version holds the texts of the team: one text for each text key, in `en`, and in `vi`
  if a person gave one. Kit version 1 holds `ui.empty` and `ui.close`.
- Only `texts.set` writes them. Each change makes a new kit version, as `look.set` does. No call
  removes a text key.
- A part gets its `t` from `say`. `say(["trial.start"])` gives the texts of the team only: this is
  the form of a ready frame. `say(texts)` gives the text of the team first, then the own text of
  the part: this is the form of an exploring frame.
- The kit message and the composed document carry the texts. So one `texts.set` reaches each live
  document in the same iframe, and each picture asks for the new kit version.
- The calls are `texts.list` and `texts.set`, the tools `list_texts` and `set_texts`, and the
  commands `easel texts ls` and `easel texts set`.

## Rules

The statecharts [kit-piece](docs/statecharts/kit-piece.md), [kit-look](docs/statecharts/kit-look.md),
[kit-look-unbound](docs/statecharts/kit-look-unbound.md),
[kit-look-hello-once](docs/statecharts/kit-look-hello-once.md),
[kit-app-frame](docs/statecharts/kit-app-frame.md) and
[kit-app-frame-no-close](docs/statecharts/kit-app-frame-no-close.md) check these rules.

### Fact rules (the code graph decides)

1. Every call above runs the `user` guard first.
2. Every operation that writes the look, a piece or a kit version calls one store operation:
   `saveLook`, `undoLook`, `savePiece` or `seedKit`.
3. The page and the picture draw make the shown document only with `compose`. No other module adds
   the look, the kit or made CSS to a document.
4. Only `make` makes CSS. `frame.put`, `kit.put` and `seedKit` call it; `look.set`, `look.undo`,
   the page and the picture draw do not. A show reads only stored CSS.
5. `make` imports one pinned version of `tailwindcss`, and makes a new compiler in each call.
6. `frame.put`, `kit.check` and `kit.put` find with the one `check`. `look.set`, `kit.put` and
   `seedKit` measure with the one `contrast`.
7. No operation reads the seed except `seedKit`, and `seedKit` writes only when the store has no
   kit version.
8. The CLI and MCP print the guide from `kit.guide` only. No other text lists the pieces.
9. The check of an app frame reads the TSX only with the one `oxc-parser` of the pin
   (`src/kit/oxc.server.ts`), and finds each class with the one walk of the class places
   (`src/kit/places.ts`, run by `placesOf`). The Oxlint JS plugin of `kit/class-built`
   (`src/kit/lint.server.ts`, the rule `easel/class-built`) parses with that `oxc-parser` and runs
   that `placesOf` too.
10. The release binary and `dist/server` load the native file of `oxc-parser` with a static
    `require` for each release target, as they load Lightning CSS.
11. Only `buildRuntime` (`src/kit/runtime.server.ts`) builds a runtime, and only `runtimeOf`
    writes one to a kit version. `kit.check`, a show and a picture read the stored runtime only;
    the route `/api/runtime/...` answers only stored bytes.
12. The CLI and the MCP list the capsules of the kit from `kit.capsules` only, and `kit.capsules`
    reads them only from the scope of the kit's capsules (`kitCapsules`). No other text lists a
    capsule, its config or its exports.
13. Only easel's own code draws with `react-dom/server` or `react-dom/static`
    (`src/kit/capsules/render.server.tsx`): the kit's capsules and the tests. The code of an agent
    draws only in its sandboxed iframe or in the Chromium of the pictures.

### Judged rules (need reading the code)

1. A `stale`, `gone`, `taken`, `offLook`, `unreadable`, `tooBig`, `unchanged` or `none` answer
   writes nothing.
2. A change of a piece or of the look is one conditional write, as `frame.put`: one statement
   checks the base, compares the text and raises the revision, with no await between. In the same
   transaction, it writes the next kit version with its made CSS. Of two writes on one revision,
   the first wins and the other answers `stale`, so no change is lost (K14). The make runs before
   the transaction, not in it.
3. The kit version goes up by one on each change of the look or of a piece, and only then.
4. A kit version never changes after it is written, and nothing removes it while the easel lives.
   It holds all that `compose` needs: the look, the kit's made CSS and the templates. The one
   exception is its runtime: `runtimeOf` sets it one time, from null, at the first use by an app
   frame; then it never changes. `kit.accept` changes no stored kit version: it writes the next
   one.
5. Made CSS is never made again for a stored kit version or frame version. An update of easel with
   a new engine changes no stored made CSS, so each frame shows the same document, byte for byte
   (K11).
6. A write saves its rows before it sets the board's cells, from the rows as stored at that moment.
   The board never shows a kit version that is not stored, and never goes back to an older one.
7. No stored look, in any kit version, has a text pair under 4.5:1 (WCAG 2.2 1.4.3) or an edge
   pair under 3:1 (1.4.11), with the WCAG relative luminance. A pair is: each kit rule that sets
   `color` and `background` or `background-color` from look values; each text color of the kit on
   `--background`, `--card` and `--muted`; `--input` and `--ring` on `--background`. A color with alpha is first laid on its surface.
8. `look.undo` writes the look of the kit version before the last change of the look, as a new kit
   version. It removes no kit version.
9. `compose` adds only stored text and the piece script. The piece script holds no color, size or
   font.
10. The piece script expands only into the light DOM, puts each `{attr}` in as text (never as
    HTML), and answers only messages from its parent. It sends only the hello to its parent, and
    nothing else.
11. A piece's CSS uses only look values: `check` on it finds nothing (else `offLook`).
12. The check finds, and only finds:
    - a class that gives no CSS and is not a kit class (`kit/class`; a palette color is
      `look/color`), with the nearest kit or look name as the fix;
    - an arbitrary color (`bg-[#f00]`) or an arbitrary font size (`text-[13px]`) (`look/color`,
      `look/size`); arbitrary layout values (`w-[420px]`, `grid-cols-[2fr_1fr]`) are allowed;
    - a color literal (hex, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`,
      `color()`, or a named color) in a `<style>`, a `style` attribute, or an SVG `fill`,
      `stroke` or `stop-color`, with the nearest look color by OKLab distance as the fix. In
      each color fix, the distance to a chart color (`chart-1` to `chart-5`) counts 2.5 times:
      the chart colors are for data, so a semantic color (`destructive`, `success`, ...) wins when
      the distances are near (`text-red-500` gives `text-destructive`);
    - a frame rule that sets a look value (`look/override`);
    - a `k-` element that is not in the kit (`kit/piece`);
    - a write of a class in a frame script or an `on*` attribute: `classList.add`, `remove`,
      `toggle` or `replace`, a write of `className`, or `setAttribute("class", ...)`
      (`kit/script`). The make step reads only the class attributes, so a class that a script
      adds gets no CSS. The fix: keep the state in `hidden`, `aria-*` or `data-state`, and style
      each state with a variant (`aria-expanded:bg-muted`, `data-[state=open]:flex`).
      `transparent`, `currentColor`, `inherit`, `white`, `black` and `var()` of a look value are
      allowed. A frame with `<meta name="easel-kit" content="off">` gets no finding.
13. The guide lists how to style, the color names of the look, and each piece of the current kit
    version in name order, from its `doc:` and `use:` lines. It also tells that the sandbox of a
    frame never fires `submit`: a button of a form uses `type="button"` and a click handler.
14. In an app frame, the check takes class names only from the class places (§ App frames), and
    finds each other expression in a class place as `kit/class-built`. Each class name gets the
    verdict of judged rule 12. The make step gets only the class names of the fixed text.
15. A fix by position changes only the text of its class name (and one space next to a removed
    one). The fixed text parses, and its class places are the same places.
16. An app frame imports only the packages of its kit version's runtime. Each state of a frame is
    a Tinker cell; its `View` holds no React state and no effect.
17. The page removes the iframe of an app frame only after its `closed`, or after 200 ms with no
    `closed`. Then it ends its own work on that frame's port (the chart kit-app-frame).
18. The picture of an app frame is drawn in Chromium from the document that a tab gets. No frame
    code runs in the server process.

## Success Criteria

- An agent runs each journey above through the CLI with `--json`.
- Each contract kind and refusal is reached by a test; `tinker check` is OK.
- K3: `tests/kit/screens/` holds the reference briefs (a form, a list, a dashboard) and the
  no-kit guide. A script on the host runs each with the reference agent (Claude Sonnet) 3 times,
  with the guide and with no kit. The median time with the kit is under 20 s and under half the
  time with no kit. The put shows the frame within 1 s after. It runs before each change of the
  seed, not in CI. (Measure of 2026-11-21: `notes.md`.)
- K2: a new agent with only `easel kit` writes each reference screen with no finding, 3 times of 3.
- K5: a test puts a document with each kind of finding and reads each one, with its line and its
  fix. A test puts each seed fixture and finds nothing.
- K6: on a board of 200 frames from the kit, the viewer still meets `docs/canvas-speed.md`. A
  browser test loads 12 live documents from the kit and finds each painted within the paint cap.
- K7, K13: a browser test changes `color.primary` and finds the new color in each live document
  within 1 s, with no new iframe. A browser test finds that each other frame in view asks for the
  picture of the new kit version in the same img. A test with a real Chromium draws the 20
  pictures of the new kit version, asked at once, in less than 5 s. (Measure of 2026-11-22: 12
  live documents of 20 in view in 21 ms; the 20 pictures in 1 s.) A test changes a piece's template and finds each live document
  that uses it reloaded, with its picture on top until it paints.
- K8: a test sets a look that fails each kind of pair and reads `unreadable` with that pair; the
  seed passes.
- K9, K10: a test changes the look, undoes it, and finds the Before, After and When asked pictures
  drawn with the kit version that each one keeps.
- K11: a test composes the seed fixtures with kit version 1, and compares them byte for byte with
  the stored output. A test makes a frame's CSS with a second engine version and finds the stored
  made CSS unchanged.
- The make step: a test makes the CSS of the same frame twice, after two other frames in two
  orders, and finds the same bytes. A test makes two frames in turn and finds no class of the
  first in the CSS of the second.
- The check: a test document with one of each finding (`tests/kit/k5-bad.html`) gives each one,
  with its line and column. A test holds the answers of `candidatesToCss` that the check uses, so
  a new pin that changes them fails.
- The speed budget: a test makes the 3 reference screens and a frame of 1 MiB, and each chain
  takes less than 50 ms.
- K14: a test makes two `kit.put` calls on one revision; the second answers `stale`.
- Each rule of the six statecharts is reached by a test that replays its path.
- App frames: a test reads a TSX frame with each form of each class place, and with each form
  of `kit/class-built`, and finds each one at its line and column. A test applies the fixes and
  finds the fixed text parses and has the class names of the look. The two-order test passes on
  TSX frames. A compiled binary checks a TSX frame (`tests/kit-binary.test.ts`).
- The check of an app frame: a usual TSX frame and a TSX frame of 256 KiB each take less than the
  50 ms of the speed budget.
- A browser test with 12 live app frames: one goes live in less than 150 ms (p95); a new look
  reaches each one in 1 s; a removed frame posts `closed` before its iframe goes.

## Out of Scope (Deferred)

From [E8](docs/epics.md#e8-one-look-fast): a look for each canvas, a dark theme, a look taken from
a web site or a design file, a page that shows the kit to people, and images, icons and a team's
own fonts kept in easel. easel holds only the two fonts of the seed (§ The seed).

Also deferred:

- New names in the look (a new color name). They need the CSS of each frame made again. Add it to
  `kit.accept` (§ App frames) when a team asks for it.
- Removing a piece. Add it when a team asks. Until then, a team changes a piece, and K5 finds a
  frame that uses a piece in a wrong way.
- A new seed or a new engine major version for an easel that has a kit. An easel keeps the kit and
  the made CSS that it has (K11). `kit.accept` takes only the runtime of this easel. Add the seed
  and the made CSS to it when a team asks for them.
- Loops or expressions in templates. A piece with a list takes its rows as children.
- Expanding `k-` tags on the server. The frame's piece script expands them, so no server step
  changes a stored document. If a server step needs it later: `HTMLRewriter` fills the default
  slot only; parse5 is for documents with named slots.
- Undo of a piece. An agent gets the piece `--at` an older kit version and puts it again.
