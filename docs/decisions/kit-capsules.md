# The kit as Tinker capsules: the look, the copy, the pieces and each frame

Date: 2026-11-22. Status: proposed; the capsules are in `src/kit/capsules/` and
`tests/kit-capsules.test.ts`, and a capsule frame draws in its iframe (`tests/frames-app.test.ts`). It changes how an app frame of
[frame-apps](frame-apps.md) gets the look, its texts and its data. The make step, the K5 check and
the kit versions of [kit-on-tailwind](kit-on-tailwind.md) stay.

## What the user said

- "Let's focus on expressing the design system, copywrites, i18n and components as capsules, each
  will be a standalone with correct dependency."
- "Naturally, the page created by such will always run well in a scope to render exactly what is
  expected."
- "If we have a backend and we want to render changes to i18n, we can do reactivity, but we can
  also simply recreate scope if needed."
- "In the normal design, a thing normally missed is actually the data entity. [...] the sooner we
  talk about entity the better it is."
- "Anytime, the mcp can tell how many capsules available and what can they do via exports."
- "Focus on what gain from the capsule and make a good use of that."

## Problem

An agent that makes a prototype guesses. It guesses the classes of the kit, the texts, and what
data a screen shows. A guess shows only when a person looks at the frame. A missing text, a look
that fails K8, or an empty list that nobody drew is found late, or never. The texts and the data
entities come last, but they change the design most.

## Precedent

- **Effect Layers, Angular providers, Dagger:** units that you put together by their declared
  dependencies. A missing dependency is an error before the app runs.
- **Shopify Polaris `AppProvider`, FormatJS `IntlProvider`:** the locale and the texts are config
  of the tree, not globals.
- **Storybook args and globals, Chromatic:** each story is drawn in each locale and theme, and
  each picture is a test.
- **`@mswjs/data`, Faker:** realistic data from a schema, in named states.
- **The shadcn/ui registry and its MCP server, Bit:** each part with its dependencies, which an
  agent can list before it writes code.

## Decision

The kit is three capsules of Tinker, and each frame is drawn from capsules:

| Capsule | Config                               | Exports                       | Its start stops the scope when      |
| ------- | ------------------------------------ | ----------------------------- | ----------------------------------- |
| `look`  | the look values and the kit's CSS    | `values`, `styles`            | (a value is not a CSS name: parse)  |
| `copy`  | the locale (`en`, `vi`)              | `say(texts)`, `format`        | (a part's `text` refuses a gap)     |
| `ui`    | none                                 | `pieces` (React), `text`      | the look fails K8                   |
| a frame | its data state (`empty`, `one`, ...) | `View`, its entities, its ops | a row of the state fails its schema |

A frame draws in a new scope of its install list:
`[look({ values, css }), copy({ locale }), ui(), frame({ sample })]`.
Another locale or another data state is another install list, so another scope. Reactivity stays
for the live look (K7).

### What each feature of a capsule gives

1. **Config with a schema.** The locale and the data state are config keys, each a tag with a zod
   schema. A required key that the install does not fill is a compile error that names the key.
   The schema lists the values, so a tool draws each locale and each data state with no list of
   its own.
2. **The start hook.** Each capsule checks what it needs before any frame draws. A failed start
   rejects `ready` with a kind and a payload (`CopyGaps`, `LookFailsK8`, `SampleInvalid`). So a
   frame that draws has a look that meets K8 and data that fits its schema.
3. **The dependency check of Tinker.** A unit of a capsule that the install does not have stops
   the start: `CapsuleMissing { unit: "copy.say", capsule: "copy" }`. easel writes no code for it.
4. **Exports.** An exported cell is read only outside its capsule (ADR 0123 of Tinker): another
   frame reads the plans of `pricing`, and only `pricing.choose` changes state. An export can be a
   plain value (`texts`) or React components (`pieces`).
5. **The scope's list of capsules (`scope.capsules`).** Each row has the label, the config as
   installed, the fixed tags and the exports. Each kit capsule has its own `<label>.about` tag,
   so the row says what the capsule and each export do. `describeCapsule` adds the schema of each
   config key and of each operation's input. This is the list that the MCP gives.

### `t` is a dependency

Each part (the pieces of the kit, each frame) declares its texts in each locale, and its own
`text` resource: `resource({ label: "pricing.text", depends: { say: copy.say }, factory: ({ say })
=> say(texts) })`. A component depends on it: `depends: { t: text }`. This gives three things:

1. **Typed keys.** `t("pricing.title")` takes only a key of the part, and each locale must have
   each key of the part (`Texts<K>`). An agent that type-checks its frame finds a gap at once.
2. **A check when the part builds.** `say` runs `textGaps` (a key with no text, a key with no
   English, a text with other parameters) and raises `CopyGaps`. easel does not type-check a put,
   so this check holds for each frame.
3. **The graph of the copy.** Each component names the texts that it uses. A tool lists the texts
   of each frame, and a change of one text names the frames that show it.

### What the agent writes

- **Form 1, a component:** a `resource` whose factory gives a React component. The factory body
  is the context: the component sees only its `depends` (the pieces, `t`, `format`, another
  component). Its own state is a cell at module level.
- **Form 2, a capsule with files:** `entities.ts` (the schema and the data states), `copy.ts`
  (the texts in each locale), `logic.ts` (the operations), `view.tsx` (the components, form 1),
  `index.ts` (the capsule: config, about, exports, start). Use it when a frame has entities or
  when other frames use its parts.

A component depends on another component in the same way as on the pieces
(`depends: { PlanCard }`), so the graph also holds the tree of components.

### In the frame's iframe

The kit's capsules are in the runtime of each kit version as `@easel/kit`, so their code is kept
with the kit version (K11). A capsule frame exports `View` (a resource) and, if it has one, its
own capsule `frame`. The mount of `@easel/frame` installs
`[look({ values, css }), copy({ locale }), ui(), frame(config)]` in a new scope, from the look in
the document and the axes in the document (SPEC-kit § The capsules, "A capsule frame"). A
refused start draws its kind and payload in place of the View. A first-form frame (`logic` and a
View component) draws as before.

## The proof

`tests/kit-capsules.test.ts` (8 tests) shows:

- form 1 and form 2 draw in `en` and `vi`, from the real seed look;
- form 2 draws 2 locales × 4 data states, and the same install gives the same HTML;
- a gap in the texts, a look that fails K8, and a missing capsule each stop the scope, with a
  kind and a payload;
- a missing required config key and a write to an exported cell are type errors;
- the list of capsules gives what each one does, its config with its schema (the data states
  are an `enum`), and its exports with their kinds.

## Other variations

- **One document of rules for the agent (a skill):** it costs less, but an agent can ignore a
  document. A start hook cannot be ignored.
- **Auto import of names (Nuxt, unplugin-auto-import):** tried and dropped on 2026-11-22. The
  `depends` of a unit is its import, and the list of capsules tells the agent what exists.
- **Short helpers that make operations (`setter`, `change`):** dropped. A function that makes
  units makes a graph that no tool can read (Tinker's capsule skill).
- **Reactivity for the locale and the data state:** possible, but a new scope is simpler, and it
  gives the same picture for the same install.

## Open

- **The file of a frame.** A frame that has more than one file needs a form for `frame.put`: one
  TSX file with the parts, or a folder.
- **The MCP.** `kit.capsules` and `easel kit capsules` are built (SPEC-kit § The capsules). The
  MCP tool `kit_capsules` comes with the MCP server.
- **Pictures.** Each install of the matrix (locale × data state) gets its picture in the Chromium
  of the pictures, as a story in Chromatic does. `renderFrame` (`react-dom/static`) draws only
  easel's own code: an agent's code must not run in the server process (SPEC-kit fact rule 13).
- **Texts from a backend.** A part's texts are in its code. A team that keeps texts elsewhere can
  give them as config of `copy` later (`copy({ locale, overrides })`); `say` merges them.
- **Input checks.** An in-process run of Tinker does not parse the input of an operation; only the
  rpc door does. A frame's operation gets no input check from its schema.
