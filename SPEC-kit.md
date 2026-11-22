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
  [docs/decisions/kit-on-tailwind.md](docs/decisions/kit-on-tailwind.md).
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
type Pair = { text: string; on: string; ratio: number; min: number; where: string }

"kit.guide": { kind: "found"; kit: number; text: string }
"kit.list":  { kind: "found"; kit: number; pieces: PieceInfo[] }
"kit.get":   { kind: "found"; kit: number; piece: Piece } | { kind: "gone" }
"kit.put":   { kind: "created" | "updated" | "unchanged"; name: string; rev: number; kit: number }
           | { kind: "stale"; rev: number; kit: number } | { kind: "taken"; rev: number }
           | { kind: "gone" } | { kind: "offLook"; findings: Finding[] }
           | { kind: "unreadable"; fails: Pair[] } | { kind: "tooBig"; maxBytes: number }
"kit.check": { kind: "checked"; kit: number; findings: Finding[]; more: number }
"look.get":  { kind: "found"; kit: number; rev: number; look: Dtcg } | { kind: "gone" }
"look.set":  { kind: "updated" | "unchanged"; rev: number; kit: number }
           | { kind: "stale"; rev: number; kit: number } | { kind: "unreadable"; fails: Pair[] }
"look.undo": { kind: "updated"; rev: number; kit: number } | { kind: "stale"; rev: number; kit: number }
           | { kind: "none" }
```

| Call                    | Success kinds                     |
| ----------------------- | --------------------------------- |
| `kit.guide`, `kit.list` | `found`                           |
| `kit.get`, `look.get`   | `found`                           |
| `kit.put`               | `created`, `updated`, `unchanged` |
| `kit.check`             | `checked`                         |
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
- `kit.check` takes `{ html }`, with the size limit of `frame.put`.
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

- The look comes from the shadcn/ui theme (MIT): its color names, and the values of its base
  color "neutral", from oklch to sRGB. The font stacks, the type scale, the shadows and `--spacing`
  are Tailwind's (MIT); the radii are those of shadcn/ui's `--radius` (10px).
- A shadcn/ui value that fails K8 is changed to the nearest value that passes, and its
  `$description` tells the change: `muted-foreground` (4.35:1 on `muted`), `destructive` (4.47:1
  on `muted`), `input` and `ring` (under 3:1 on `background`). The colors that shadcn/ui does not
  have (`success`, `warning`, the three `-soft` colors) come from Tailwind's palette, except
  `warning`, which is `#8a5a00` (5.44:1 on `muted`).
- The kit's pieces are those of the E8 study (A+T): `src/kit/seed.server.ts`.
- These values are a start, not the look of easel. A design ship on Doop (build order step 5 of
  the decision) picks easel's own base color, font and radius, so that a frame does not look like
  a template.

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
for the current kit. Each later kit message goes on that port. A kit message is
`{ easel: "kit", kit, look, css }`; the piece script then replaces the text of the two `<style>`
elements `easel-look` and `easel-kit`.

## Rules

The statecharts [kit-piece](docs/statecharts/kit-piece.md), [kit-look](docs/statecharts/kit-look.md),
[kit-look-unbound](docs/statecharts/kit-look-unbound.md) and
[kit-look-hello-once](docs/statecharts/kit-look-hello-once.md) check these rules.

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
   It holds all that `compose` needs: the look, the kit's made CSS and the templates.
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
  within 1 s, with no new iframe. A test changes a piece's template and finds each live document
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
- Each rule of the four statecharts is reached by a test that replays its path.

## Out of Scope (Deferred)

From [E8](docs/epics.md#e8-one-look-fast): a look for each canvas, a dark theme, a look taken from
a web site or a design file, a page that shows the kit to people, and images, icons and fonts kept
in easel. The seed uses a system font stack for that reason.

Also deferred:

- New names in the look (a new color name). They need the CSS of each frame made again. Add it with
  "accept the new kit" below.
- Removing a piece. Add it when a team asks. Until then, a team changes a piece, and K5 finds a
  frame that uses a piece in a wrong way.
- A new seed or a new engine major version for an easel that has a kit. An easel keeps the kit and
  the made CSS that it has (K11). Add an "accept the new kit" step, as Figma's library updates,
  when a team asks for it.
- Loops or expressions in templates. A piece with a list takes its rows as children.
- Expanding `k-` tags on the server. The frame's piece script expands them, so no server step
  changes a stored document. If a server step needs it later: `HTMLRewriter` fills the default
  slot only; parse5 is for documents with named slots.
- Undo of a piece. An agent gets the piece `--at` an older kit version and puts it again.
