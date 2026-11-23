# Spec: `pieces`, the components of the team in the kit

Status: proposed (2026-11-23). It replaces SPEC-kit § Add to the kit (E8.3): pieces as HTML
templates (`kit.put`, `kit.get`, `kit.list`). That section is not built.

## Objective

The end goal of Round 1 (the user, 2026-11-23): "we can move the design from doop over to easel
and be able to use easel to further develop it". A design is built from components. On Doop our
design has 30 components and 2 389 instances of them. Today easel has no place for the components
of a team:

- `@easel/kit` gives an app frame 5 pieces of easel (`ui`: Button, Card, Badge, Stat, Empty). They
  are easel's code. A team cannot add to them.
- An app frame imports only the names of the runtime, and the files of its own folder. So a frame
  cannot use a component of another frame.
- So a moved design is a set of copies. A change of a component does not reach the frames that use
  it.

After this spec, a team keeps its components as pieces in its kit: React components in TSX, in one
folder, with a version in the kit version. Each app frame imports them from `@easel/pieces`. A
change of a piece reaches each frame that uses it, and no frame changes. Pieces use the look and the
texts of the team, as a ready frame does.

The user asked on 2026-11-23: "why do we need to copy. We have the whole capsule, full component
system and app behind the scene, no?". So the pieces are TSX components on the capsules of the
kit, not HTML templates.

Prior art:

- **Figma libraries.** A team publishes its components. Each file uses instances of them, and a
  change of a component reaches each instance. easel has no publish step: the kit version is the
  library version, as the look is.
- **Framer code components.** React components that all pages of a project share, live.
- **shadcn registry.** A component is a map of files (`files`), copied as source. The folder of
  pieces has the same form as a folder frame (SPEC-kit § App frames, "A folder").
- **Storybook.** One component in each of its states, with controls. Here a frame shows a piece,
  with controls (E10).
- **Import maps.** A browser loads a shared module by its name (`@easel/pieces`) from an address
  that the page gives. The runtime of the kit works this way now (SPEC-kit § The runtime).

## Assumptions

1. One easel is one team (R1). So each easel has one folder of pieces.
2. The pieces are code of the team. Each person with a share link can see them, as they can see
   the JS of each app frame now.
3. A piece follows the rules of a ready frame: classes of the look, texts of the team by text key
   (`say([...])`), and no React state (`kit/react-state`). The state of a piece comes from its
   props. The frame that uses it holds the state in its cells.
4. The 10 colors of our Doop design that have no look name get look names first (open question 1).

## Current behavior

- SPEC-kit § Add to the kit describes pieces as HTML templates with `{props}` and slots, and the
  calls `kit.put`, `kit.get` and `kit.list`. None is built. `kit_versions.pieces` is `[]` in each
  kit version.
- An app frame is a TSX module or a folder (64 files, 256 KiB). Its JS is one ES module. Its
  imports of runtime names stay imports, for the import map of its kit version.
- A new frame version of a live app frame gets a new document. The page keeps the old iframe,
  hidden, until the new one draws (charts `kit-app-frame`, `kit-app-frame-no-close`).

## New behavior

### The folder of pieces

1. The pieces of a team are one folder in the kit version: a map of paths to TSX texts, with the
   entry `index.tsx`, as a folder frame (64 files, 256 KiB at most). Each export of the entry that
   is a React component is one piece, by its name (`StateBadge`, `RequestRow`).
2. A piece imports runtime names, `@easel/kit`, and the files of the folder. It does not import
   `@easel/pieces`.
3. `pieces.put` writes the whole folder, with a base. It makes a new kit version, as `look.set`
   does. A change made on an old revision is refused `stale` (as K14).
4. The check of a piece is the check of a ready app frame (SPEC-kit § App frames, SPEC-copy
   § Exploring and ready): `kit/parse`, `kit/import`, `kit/react-state`, the settle rules, and the
   fixes by position. A finding with no fix refuses the put with `offKit`. Nothing is written.
5. The JS of the pieces is one ES module (`Bun.build`, as the JS of a frame). The import map of a
   kit version maps `@easel/pieces` to it, at
   `GET /api/pieces/<kit version>/<sha-256>/pieces.js`, as the runtime address.

### A frame that uses pieces

6. An app frame imports pieces by name: `import { StateBadge } from "@easel/pieces"`. The check
   finds each name that the pieces do not export (`kit/import`, with the names that they export).
7. An app frame that imports `@easel/pieces` loads the pieces of the current kit version, not of
   the kit version of its frame version. So a change of a piece reaches the frame with no put.
8. **Live.** After `pieces.put`, each live document that imports `@easel/pieces` gets a new
   document with the new import map. The page keeps the old iframe until the new one draws, as for
   a new frame version. A frame that does not import `@easel/pieces` keeps its document.
9. **Pictures.** A picture of a frame that imports `@easel/pieces` is of the current kit version.
   A request keeps the kit version that its viewer saw, so its picture shows the pieces as they
   were (as SPEC-copy fact rule 1).
10. **The runtime.** The pieces are built on the runtime of the current kit version. A frame whose
    kit version has another runtime gets the finding to put it again, as after `kit.accept`.

### The list for agents

11. `pieces.list` gives each piece: its name, its props (from its TypeScript type), and the text
    keys that it uses. `kit_capsules` and `easel kit capsules` show the pieces too, so an agent
    finds a piece before it writes one (K12).

## Contract

```ts
type PieceInfo = { name: string; props: string; texts: TextKey[] }

"pieces.list": { kind: "found"; kit: number; rev: number; pieces: PieceInfo[] }
"pieces.get":  { kind: "found"; kit: number; rev: number; files: Record<string, string> }
"pieces.put":  { kind: "updated" | "unchanged"; rev: number; kit: number; pieces: PieceInfo[] }
             | { kind: "stale"; rev: number; kit: number }
             | { kind: "offKit"; findings: Finding[]; more: number }
             | { kind: "tooBig"; maxBytes: number }
```

- `pieces.put` takes `{ files: Record<string, string>, base: number }`. `rev` is the revision of
  the pieces. It starts at 0 (no pieces), and each change adds 1.
- `props` is the type of the props of a piece as TypeScript text, for example
  `{ state: "open" | "done"; count?: number }`.
- The MCP gets `list_pieces`, `get_pieces` and `put_pieces`. The CLI gets `easel pieces ls`,
  `easel pieces get -o <dir>` and `easel pieces put <dir> --base <rev>`.

## Model

A change of a piece moves the document of each live frame that uses it. That is new state. So a
TLA+ model and its chart come first, as `pieces-live`: two frames (one uses the pieces, one does
not), a `pieces.put`, a new frame version at the same time, the old iframe until the new one draws,
and a closed tab. Its rules:

- Each live frame that uses the pieces shows the newest pieces in the end.
- A frame that does not use the pieces keeps its document.
- The page never shows two documents of one frame.

## Fact rules

1. Only `pieces.put` writes the pieces. A kit version never changes, so a request keeps the pieces
   that its viewer saw.
2. A change of the pieces writes no frame and no frame version.
3. The pieces of each kit version pass the check of a ready frame.

## Success criteria

1. **The move.** The 29 components of the Doop canvas `easel · Design system` are pieces. Each
   gets a frame that shows it with controls for its variants (E10). Each frame looks the same as
   its copy from Doop: SSIM 0.95 or more on `easel shot` at scale 0.5.
2. **A screen from pieces.** The E4 popover of `easel · Product design` is an app frame that uses
   only pieces, the look and the texts of the team. It is ready, and it matches its Doop copy as
   in criterion 1.
3. **A change reaches each frame.** After one `pieces.put` that changes `StateBadge`, each live
   frame that uses it shows the change within 2 seconds, and each picture in view within
   10 seconds. No frame version changed.
4. **An agent finds a piece.** A new agent with only the MCP tools makes a frame with a request
   row. It uses `RequestRow` from `list_pieces` and writes no new row.
5. A put of pieces with a color off the look, an own text, or a missing text key is refused with
   findings that name the file, the line and the fix.
6. The model holds its rules.
7. The speed gate stays green. A frame that uses no pieces loads no more bytes than today.

## Testing strategy

- A server test for each kind of the three calls, and for the 3 fact rules.
- A test of the check of pieces, and of a frame that imports a name that the pieces do not export.
- A browser test: a `pieces.put` gives a new document to a live frame that uses the pieces, in
  2 seconds, and not to a frame that does not.
- `scripts/statecharts.sh --check pieces-live`.
- The move (criteria 1 and 2): a script that puts the pieces and the frames, shots each one, and
  compares it with the copy from Doop.
- `offload -- bun run speed`, before and after.

## Boundaries

- Always: the pieces change through the kit version, as the look and the texts do.
- Ask first: a second folder of pieces, or pieces of another team.
- Never: run a piece on the server. Never let a piece import `@easel/pieces` or the files of a
  frame.

## Out of scope (deferred)

- **HTML pieces** (SPEC-kit § Add to the kit). TSX pieces replace them. Add HTML pieces when an
  agent makes HTML frames that must share a part.
- **A catalogue page** made by easel from the pieces. A frame of pieces with controls is the
  catalogue for Round 1. Add the page when a team has more pieces than one canvas can show.
- **A piece with its own React state.** Add it when a piece cannot take its state from props.
- **The prototype clicks of Doop** (803 on 82 frames). Add them when a reviewer asks for a flow of
  frames.
- **Many folders, or the pieces of another easel.** Add them when a team shares pieces with
  another team.

## Open questions

1. **The 10 colors with no look name** (accent, on-accent, accent-bg, faint, divider, card, scrim,
   focus-halo, shadow-low, shadow-mid). I recommend new look names, in the pattern of `success` and
   `success-soft`. They are a change of the look names (SPEC-kit § Out of scope says the names are
   fixed). Without them, 10 colors of the pieces are findings of `look/color`.
2. **The name of the import.** I recommend `@easel/pieces`. The other way: the pieces join
   `@easel/kit` next to `ui`. That is one import less, but a change of the pieces would then also
   change the module of easel's own capsules.
