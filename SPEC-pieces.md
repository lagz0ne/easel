# Spec: `pieces`, the design system of the team as code

Status: approved (user, 2026-11-23: "Yes"), with the new look names of open question 1. It replaces
SPEC-kit § Add to the kit (E8.3): pieces as HTML templates (`kit.put`, `kit.get`, `kit.list`).
That section is not built.

## Objective

The end goal of Round 1 (the user, 2026-11-23): "we can move the design from doop over to easel
and be able to use easel to further develop it". A design is built from a design system. On Doop
ours has 52 tokens, 30 components and 2 389 instances of them. easel has no place for the design
system of a team. So a moved design is a set of copies, and a change of a component does not reach
the frames that use it.

After this spec, the design system of a team is code in its kit: many Tinker capsules (the look,
the texts, primitives, patterns, layouts), each with its dependencies, and re-exported by
capsules. A frame depends on them. The code is the source of truth: the TypeScript check and the
capsule graph control how frames use the design system, and show the effect of each change.

The user decided on 2026-11-23:

- "with tinker primitives, we are upper hand control the code to be written, and we can use the
  code as source of truth". "For color, a tag or data of the shape can be imported to the code, and
  the typecheck will tell the wrong use". "Same to components and pages, they can use dependency
  and reexported by capsule".
- "We don't expect to have a single capsule tho, we expect many capsules".
- "Explore meant you can use some exceptions, not typecheck error. For example, you can use custom
  class or you can use inline texts".
- "we need to do control, or at least branded type for controlling those design system
  primitives. Good thing that we don't need to rigidly limited. We can do shadcn style, or daisy
  etc. tooling to check for duplication, weird styling etc would not be hard to have".
- "codes are real code, can be and should be checked".
- A change of the design system that breaks a frame shows its effect, as a design system change is
  expected to (answer 2 of the brainstorm).

Prior art:

- **Figma libraries.** A team publishes its components, and a change reaches each instance. Here
  the kit version is the library version, as for the look.
- **shadcn/ui and daisyUI.** Components and class names on CSS variables, with variants
  (`class-variance-authority`). The kit runtime has `cva`, `clsx` and `tailwind-merge` now.
- **Branded types** (TypeScript `string & { __brand }`, as Zod `.brand()`). A value of a brand
  comes only from its maker, so the type check finds a raw value where a token must be.
- **A monorepo with project references and CI** (Nx `affected`, Turborepo). A change of a package
  checks each package that depends on it, before the change lands.
- **Storybook.** A component in each of its states, with controls (E10).

## Decisions

1. **Values are data, shapes are code, the types join them.** The values (a color value, the
   words of a text) stay data in the kit version: `look.set` and `texts.set` change them live, with
   no type check. The shapes (the color names, the text keys, the capsules, the props) are code.
   easel makes the types of each kit version from both.
2. **The code lives in easel, in the kit version.** The design system is one folder of files in
   each kit version (`design/`), with many capsules in it. A change is one put of the folder, with
   a base. A team that wants Git keeps the folder in Git and runs `easel design put <dir>` from it.
   Why easel holds it: the live change, the check of each frame that depends on it, and the
   pictures of old kit versions need each version in one place. A Git sync is deferred (as
   GitHub is in Round 1).
3. **The type check runs on each put**, of a frame and of the design system. A type error refuses
   the put in each mode. Measured on 2026-11-23 on this host: one app frame with React, Tinker and
   the kit (185 files, about 100 000 lines) takes 0.28 s with TypeScript 7 (`tsc`), of which the
   check is 0.10 s. A put is not on the critical path of a viewer.
4. **The dark look is a second context of the look, in the DTCG Resolver Module.** The user picked
   the dark look `B · lifted grey` on 2026-11-25 (canvas `design-system`, page `Look · dark`). The
   look stays one DTCG document:
   - With no dark values, the look is the token file of today, with no change.
   - With dark values, the look is a resolver document of DTCG 2025.10 (Resolver Module). The set
     `look` has one inline source: the token file of today, the `light` values. The modifier
     `theme` has the contexts `light` (`[]`, no change) and `dark` (one inline source with only
     the colors that change, on the same paths), and the default `light`. The `resolutionOrder`
     is `#/sets/look`, then `#/modifiers/theme`.
   - What we followed in the text of the module: `version` is `2025.10`; a context is an array of
     sources; a later source wins over an earlier one; a context can be an empty array
     (Example 7); `default` is a key of `contexts`.
   - Prior art: Figma variable modes (one collection, one value for each mode), Tokens Studio
     themes (a base set and a set that overrides it), Style Dictionary (one build for each theme,
     from the base and its overrides), and shadcn/ui (`:root`, then `.dark` with the same names).
   - Not `$extensions`: a tool that does not know the key of easel cannot read it. The resolver
     is the standard form, so a DTCG tool reads the dark values too.
5. **The CSS of a dark value is `light-dark()`.** The `:root` block of the look writes
   `--name: light-dark(<light>, <dark>)` for each color that changes. The same block sets
   `color-scheme: light dark`. Rule 16 needs it: a matrix cell sets its own `color-scheme`, and each
   element resolves `light-dark()` with its own scheme. A `prefers-color-scheme` block reads the
   document, so all cells share one value.
   - The line `color-scheme` is in the look block, which is not in a layer. So it wins over
     `html { color-scheme: light }` in the `base` layer of the kit. An easel keeps its kit CSS
     (K11), so a change of the seed does not reach it; the look block does.
   - The viewer sets the `color-scheme` of the iframe of each frame that takes `theme` (rule 14),
     with the default `light`. So a frame with no pick shows the light values.
   - A look with no dark values writes the same block as today: no `light-dark()`, no
     `color-scheme`.
   - Prior art: CSS Color 5 `light-dark()` (Chrome 123, Firefox 120, Safari 17.5), and the
     `color-scheme` property of CSS Color Adjustment 1.
6. **K8 checks each context.** The pairs of K8 are measured on the `light` values, then on the
   `dark` values, before the `:root` block is written. A pair that fails names its context:
   `dark: input on background: 1.47:1, needs 3:1 (a field edge)`. A look with no dark values has
   one context, and its pairs name no context, as today.
7. **The dark values are data, not state, so no new model.** A person changes the dark values only
   with `look.set` and `look.undo`, as the other look values: a new kit version on a base. The
   state is the theme switch (rule 14), and the model `board-switch` holds it.

## New behavior

### The design system is capsules

1. The folder `design/` of a kit version holds TS and TSX files (64 files, 512 KiB at most). Each
   file may declare capsules (`capsule` of `@tinkered/core`), resources and tags. A capsule
   depends on other capsules of the folder and on the capsules of `@easel/kit` (`look`, `copy`,
   `ui`), and can re-export them.
2. The entry `design/index.ts` names the capsules that frames may use. A frame imports them from
   `@easel/design`: `import { primitives, patterns } from "@easel/design"`, and names their
   exports in `depends` (`depends: { ui: patterns.pieces }`).
3. The capsule graph (`kit.capsules`, SPEC-kit § The capsules) lists each capsule of the folder,
   what it exports, and what it depends on. The graph also lists the frames that depend on each
   capsule. So "where is `StateBadge` used" is one read.

### Branded types

4. The look gives its names as types, from the shape of the look: `ColorName`, `SpaceName`,
   `RadiusName`, `SizeName`. A class of the design system is a brand, `Cls`, made only by the
   helpers of the kit: `cls`, the variants of `cva`, and the classes that the kit makes from the
   look (`bg-primary`, `p-4`). A component of the design system takes `className?: Cls`. So a raw
   string where a class of the design system must be is a type error.
5. A text of the design system is a brand, `Said`, made only by `t` of a part
   (`say(["trial.start"])`). `TextKey` is the union of the text keys of the kit version. A
   component takes `label: Said`, so a raw string is a type error, and a typo in a text key is a
   type error.
6. easel makes `@easel/kit` types for each kit version: the look names and the text keys of that
   version, and the types of `design/`. An agent gets them with `easel design types -o <dir>`, so
   its editor checks as easel does.

### Exploring and ready (SPEC-copy, changed)

7. An exploring frame may use **exceptions**. An exception is an explicit call of
   `@easel/explore`: `custom("bg-[#f00]")` gives a `Cls` for any class, and `inline("Start free
trial")` gives a `Said` for any text. The code still passes the type check.
8. A ready frame imports nothing from `@easel/explore`. That is the whole rule of ready for
   classes and texts. The settle rules of SPEC-copy (`copy/text`, `copy/own`, `copy/key`,
   `look/color`, `look/size`) become this rule plus the type check.
9. The design system itself has no exceptions: `design/` does not import `@easel/explore`.

### Switches: one state for one frame or for all frames

The user asked on 2026-11-23: "we'll want to add some controls to all frames. For example the
control to turn dark mode or white mode for specific frame or every. Use of fixture and show them
in a specific component or page. Change of localization." Prior art: the toolbar globals of
Storybook (one theme and one locale for each story on the page) and the parameters of one story
that change them for that story only; the matrix of Chromatic (one story in each mode).

10. **A switch is a plain Tinker tag** with a fixed list of values in its `parse`:
    `tag({ label: "theme", parse: z.enum(["light", "dark"]), default: "light" })`. There is no
    `switch()` helper. The name of the switch is the label of the tag. The values of its control
    come from the schema of the parse (`z.toJSONSchema(parse).enum`), and its first value is the
    default when the tag has no default. A frame takes a switch in the config of its capsule, as
    it takes an axis now (`config: { theme, fixture, plan }`). easel gives three switches:
    `locale` (`en`, `vi`), `theme` (`light`, `dark`) and `fixture` (rule 15). A tag of the team
    with a fixed list of values is a switch of the team (X9), with no code of easel.
    - Decided by the coordinator on 2026-11-24, under the direction "the prototype is the app"
      (SPEC-prototype). Reason: the app declares its configuration as tags for its own logic, so a
      kind of state of the team (a billing plan) gets a control with no code of easel. A new kind
      of switch of a later ship (the backend, the answer of a call: SPEC-prototype ship 5) is one
      more tag, not a second control system.
    - Where the value comes from (Tinker, measured on 0.34.7). Each frame is its own scope in its
      own iframe, so one frame has one value for each switch. The viewer finds it: the frame
      value (rule 12), else the board value (rule 11), else the default of the tag. The frame
      gets it in the call of its capsule (`frame({ theme: "dark" })`). Tinker's own levels do not
      give this rule in one frame: a tag of the scope (`createScope({ tags })`) wins over the call
      of a capsule, and a namespace tag reaches an operation but not a resource that the scope
      builds (a View). So one level is enough, and the viewer holds the rule.
11. **The board value.** The dock of the viewer shows each switch that a frame on the board takes,
    one control for each. A pick gives the value to each frame that takes the switch, and each
    live document draws again in a new scope, as a pick of the locale does now. A frame that does
    not take the switch does not change. A frame with its own value (rule 12) keeps it, and does
    not draw again. The locale pick of the dock becomes the `locale` switch. Each switch is in
    one menu, `States`, one group for each, and `locale` is the first group. A switch gets no
    button of its own (product#27, 2026-11-25). `States` is not in the dock: it is in the stick
    `Switches`, which stays at the top right of the screen. The controls of the canvas to come go
    into this stick, so the dock keeps only the tools (product#27, opened again on 2026-11-25).
    Prior art: a language is a variable mode in Figma, as light and dark are.
12. **The frame value.** The controls of a frame (E10) show each switch that it takes. A pick there
    is for that frame only, and the control says that the frame has its own value.
    `Use the board` gives the frame the board value again. Prior art: the variable mode of a frame in
    Figma, which is `Auto` (the mode of its parent) until a person picks a mode.
13. **Where a value is kept.** The board values and the frame values are of the tab, as the locale
    pick is now. They are in the address of the page (`?theme=dark&locale=vi&f.<frame>.theme=light`,
    with the name of the switch), so a link opens the board in the same state, and a reload keeps
    it. A pick writes no frame and no kit version.
14. **Theme.** A frame takes `theme` when its CSS follows the color scheme: `prefers-color-scheme`
    or `light-dark()`, as the CSS of easel itself (`src/design/tokens.css`). easel sets the
    `color-scheme` of the iframe of the frame, and the `prefers-color-scheme` of a document in an
    iframe follows it (CSS Color Adjustment 1; measured in Chrome 158). So an HTML frame shows the
    theme with no new document. An app frame with `theme` in the config of its capsule also gets
    the value, and draws again in a new scope. The look gets a value for each theme: the `light`
    values are the look of today, and the `dark` values are the same names with other values. The
    `:root` block of the look writes `light-dark(<light>, <dark>)` for each color that changes, so
    a matrix cell follows its own theme (rule 16; decisions 4 to 7). The `dark` values of the look
    are not written until the user gives them: an agent does not change a look value. The user
    gave them on 2026-11-25: the dark look `B · lifted grey`.
15. **Fixtures: the shape is a real cell, the values are data** (as the texts; decision 1). The
    user asked on 2026-11-23 for fixtures to be "a part of the tooling".
    - The shape is the `parse` of a real cell of the app or of the frame: no copy of a shape that
      can drift from the cell. Decided by the coordinator on 2026-11-24 (it replaces
      `fixtureShape`).
    - A frame names the cells that take a fixture: `mount({ View, frame, fixtures: { requests } })`.
      The key is the label of the cell.
    - The values are data in the kit version: each cell has named fixtures (`empty`, `one`,
      `many`, `error`). `fixtures.set` writes them with a base, makes a new kit version, and
      reaches each live frame as a new text does. No frame and no code changes.
    - The check: no code runs on the server. easel keeps the value as JSON. The frame parses it
      with the `parse` of the cell at its start, and gives it to the cell before the first draw
      (as a preset of Tinker). A fixture that does not parse shows the refusal of the frame,
      `FixtureInvalid`, with the cell, the name and the issues. A check at the write, by the type
      of the cell, comes with the type check of decision 3.
    - The `fixture` switch has the names of the fixtures of the cells that the frame names. The
      board value shows each frame with that fixture, if a cell of the frame has it; a frame with
      no fixture of that name shows its own data, and its control says so.
    - The tools: `easel fixtures ls`, `easel fixtures get <cell> [<name>]`,
      `easel fixtures set <cell> <name> <file.json> [--base <rev>]`; MCP `list_fixtures`,
      `set_fixtures`. `fixtures.list` gives each cell and the names of its fixtures.
16. **Show a component in each state.** `matrix({ of: StateBadge, by: { theme, state } })` makes a
    frame that shows one component in each value of the switches and props that it names, side by
    side, with a label for each (the Chromatic matrix). A page of the design system is a frame of
    matrices. The same works for a frame: `matrix({ of: RequestsView, by: { fixture } })`.
    - Built in ship 4 as an export of the frame, as `controls` and `panes`:
      `export const matrix = frameMatrix({ by: { sample, theme }, fixture: true })`. The `of` is
      the View of the frame. Each key of `by` is a tag: its values come from its parse, so a new
      value shows with no change to the frame (X11). `fixture: true` adds `initial` and each
      fixture name of the cells of the frame. `@easel/frame` exports the `theme` tag.
    - Each cell is its own scope, as a frame is: a refusal (`SampleInvalid`, `FixtureInvalid`)
      shows in its cell only, and a click in one cell does not change another. The cell sets its
      `color-scheme`, so a `light-dark()` color follows the theme of the cell. A
      `prefers-color-scheme` block does not: it reads the document, and the cells share one. The
      cell also sets `background: var(--background)` and `color: var(--foreground)`: an element
      gets the color of its parent as a value that is already resolved, so a cell that only
      inherits shows the theme of the document.
    - 36 cells at most; more refuses the start with `MatrixTooBig`. A frame of several matrices
      waits for a real case (rule of the smallest scope).

The switches land in small ships, each green and live (E10.2):

1. The board value of `theme`, `locale` and each tag of a frame, in the address (X6, X8, X9).
2. The frame value, with `Use the board`, in the address (X7, X8).
3. Fixtures: `fixtures.set`, `fixtures.list`, the `fixture` switch (X10).
4. `matrix()` (X11).

### A change of the design system

17. `design.put` checks the new folder, then type-checks each frame that depends on a capsule that
    changed (from the graph), against the new types.
    - A ready frame with a type error refuses the put: the answer `breaks` names each frame, its
      file, line and error. Nothing is written. The team changes the frames first, or marks them
      exploring.
    - An exploring frame with a type error does not stop the put. The answer lists it as
      `exploringBroken`, and the frame shows its last good version until a put fixes it.
    - The write is for the frames that the check read. If one of them changed after the check (a
      new version, or a mark of ready), the put checks again before it writes.
18. After the put, each live document of a frame that depends on a changed capsule gets a new
    document, as for a new frame version (the page keeps the old iframe until the new one draws).
    A frame that depends on no changed capsule keeps its document. Each picture of a frame that
    depends on a changed capsule is made again for the new kit version.
19. A request keeps the kit version that its viewer saw, so its picture shows the design system as
    it was.

### Checks of styling

20. Two checks of the design system, as findings that do not stop a put (a later version can make
    them stop it):
    - **duplicate**: a frame repeats one list of classes, or one JSX shape, that a component of
      the design system has. The fix names the component.
    - **arbitrary**: an arbitrary value (`p-[13px]`) in `design/`, or an exception in a frame that
      is ready to be marked. The fix names the class of the look.

## Contract

```ts
type DesignFinding = Finding & { frame?: { canvas: string; id: string } }

"design.get":   { kind: "found"; kit: number; rev: number; files: Record<string, string> }
"design.put":   { kind: "updated" | "unchanged"; rev: number; kit: number;
                  exploringBroken: DesignFinding[]; findings: DesignFinding[] }
              | { kind: "stale"; rev: number; kit: number }
              | { kind: "offKit"; findings: DesignFinding[]; more: number }
              | { kind: "breaks"; findings: DesignFinding[]; more: number }
              | { kind: "tooBig"; maxBytes: number }
"design.types": { kind: "found"; kit: number; files: Record<string, string> }
"fixtures.list": { kind: "found"; kit: number; rev: number;
                   cells: { label: string; names: string[] }[] }
"fixtures.set":  { kind: "updated" | "unchanged"; rev: number; kit: number }
               | { kind: "stale"; rev: number; kit: number }
               | { kind: "invalid"; findings: Finding[] } | { kind: "tooBig"; maxBytes: number }
```

- `design.put` takes `{ files: Record<string, string>, base: number }`. `rev` starts at 0 (no
  design system) and each change adds 1.
- A frame put gets the finding rule `type` for a type error, with the error of TypeScript.
- The switches of a board are read from the frames (`kit.capsules` lists the switches that each
  frame takes). A pick is not a call: it changes the address of the page and the axes of the
  documents.
- `fixtures.set` takes `{ cell, fixtures: Record<name, unknown>, base? }`. The fixtures of a kit
  version are 256 KiB at most. A fixture with the value `null` is removed.
- MCP: `get_design`, `put_design`, `design_types`. CLI: `easel design get -o <dir>`,
  `easel design put <dir> --base <rev>`, `easel design types -o <dir>`.

## Model

A change of the design system moves the documents of the live frames that depend on it, and can be
refused by a ready frame. That is new state. So a TLA+ model and its chart come first
(`design-change`): two frames (ready and exploring) that depend on one capsule, a third that does
not, a `design.put` that breaks or not, a frame put at the same time, and the old iframe until the
new one draws. Its rules:

- No ready frame has a type error against the current kit version.
- Each live frame that depends on a changed capsule shows the new kit version in the end. The
  exception is an exploring frame with a type error (rule 17): it shows its last good version.
- A frame that depends on no changed capsule keeps its document.

A second model, `board-switch`: two frames that take a switch, one that does not, a board pick, a
frame pick, `Use the board`, and a reload. Its rules:

- Each frame that takes a switch shows its own value if it has one, else the board value.
- A frame that does not take the switch never draws again for a pick.
- A reload shows each frame as before the reload.

The charts are [design-change](docs/statecharts/design-change.md) (384 states, each rule holds)
and [board-switch](docs/statecharts/board-switch.md) (324 states, each rule holds).
[design-change-unchecked](docs/statecharts/design-change-unchecked.md) and
[board-switch-board-only](docs/statecharts/board-switch-board-only.md) break on purpose: a
`design.put` that does not check the ready frames, and an address with no frame values.

## Fact rules

1. Only `design.put` writes `design/`. A kit version never changes.
2. A change of the design system writes no frame and no frame version.
3. Each ready frame passes the type check against the current kit version, and imports nothing
   from `@easel/explore`.
4. The type check and the capsule graph read the code. Nothing of a frame or of `design/` runs on
   the server.

## Success criteria

1. **The move.** The design system of the Doop canvas `easel · Design system` is `design/`: its
   tokens as look values, and its 29 components in capsules (primitives, patterns, layout). Each
   component has a frame that shows it with controls for its variants (E10). Each frame looks as
   its copy from Doop: SSIM 0.95 or more on `easel shot` at scale 0.5.
2. **A screen from the design system.** The E4 popover of `easel · Product design` is a ready app
   frame. It uses only `@easel/design`, the look and the texts, and it matches its Doop copy as in
   criterion 1.
3. **A change reaches each frame.** After one `design.put` that changes `StateBadge`, each live
   frame that depends on it shows the change within 2 seconds, and each picture in view within
   10 seconds. No frame version changed.
4. **A change shows its effect.** A `design.put` that renames a prop of `StateBadge` is refused
   `breaks`, with each ready frame that uses the old name.
5. **Exceptions.** An exploring frame with `custom("bg-[#f00]")` and `inline("Hi")` is created and
   shows both. `frame.ready` on it answers `unsettled`, with the two exceptions.
6. **The type check.** A frame put with a type error is refused with the line and the error. A put
   of a usual frame takes 0.5 s at most on this host.
7. **An agent finds the design system.** A new agent with only the MCP tools makes a frame with a
   request row. It uses `RequestRow` from the capsule list and writes no new row.
8. **Switches.** On a board of 20 frames, one pick of `theme` in the dock shows each frame that
   takes it in `dark` within 1 second; a frame with its own value `light` stays light. The same for
   `locale` and `fixture`. A reload keeps each value.
9. **A page of the design system.** The page Primitives of the Doop canvas is one frame of
   matrices: each component in each of its variants, in `light` and `dark`.
10. The models hold their rules. The speed gate stays green, and a frame that uses no design system
    loads no more bytes than today.

## Testing strategy

- A server test for each kind of the three calls and for the 4 fact rules.
- A test of the type check of a frame (a type error, a raw string for a `Said`, a raw class for a
  `Cls`, an exception in a ready frame), and of the effect check of `design.put`.
- A browser test: a `design.put` gives a new document to a live frame that depends on the changed
  capsule, within 2 seconds, and not to the other frames.
- `scripts/statecharts.sh --check design-change`.
- The move: a script puts `design/` and the frames, shots each frame, and compares it with its copy
  from Doop.
- `offload -- bun run speed`, before and after.

## Boundaries

- Always: the design system changes through the kit version, as the look and the texts do.
- Ask first: a second folder, or the design system of another team.
- Never: run the code of a frame or of `design/` on the server. Never let `design/` import
  `@easel/explore` or a frame.

## Out of scope (deferred)

- **HTML pieces** (SPEC-kit § Add to the kit). Capsules replace them. Add HTML pieces when an
  agent makes HTML frames that must share a part.
- **A frame that depends on another frame** (a flow of screens, the prototype clicks of Doop: 803
  on 82 frames). It needs the board worker (SPEC-kit § App frames, item 7). Add it when a reviewer
  asks for a flow of frames.
- **A Git sync of `design/`.** Add it when a team keeps its design system in Git and a put from CI
  is not enough.
- **A catalogue page** made by easel from the graph. Frames of matrices are the catalogue for
  Round 1.
- **Save a state as a fixture**: a person sets a frame with its controls, then keeps the data of
  that state as a new fixture. Add it when writing a fixture by hand is slow for a team.
- **A switch value kept for all viewers** (a board that opens in dark for each person). Add it when
  a team asks for a default state of a board.
- **The duplicate and arbitrary checks as refusals.** Add them when a team asks for a strict design
  system.

## Open questions

1. **The 10 colors of our Doop design with no look name** (accent, on-accent, accent-bg, faint,
   divider, card, scrim, focus-halo, shadow-low, shadow-mid). I recommend new look names, in the
   pattern of `success` and `success-soft`. They change the look names, which SPEC-kit says are
   fixed. With the look names as types (rule 4), a team's own names are one more step: a later
   version can let `design/` add look names.
