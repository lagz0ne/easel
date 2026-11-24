# Spec delta: `prototype`, the prototype is the product

Status: approved by the user on 2026-11-24 ("All yes"), for E12 J1 to J11. The user granted
autonomy for this round, so the agent decided the open points below. It replaces the drawn links of
[SPEC-flows](SPEC-flows.md) (rules 1 to 18, 27 to 30, the contract and the model `flows-links`).
The walk of SPEC-flows (rules 19 to 26) stays, with the change in "Ship 4" below.

It is the design of E12 in [docs/epics.md](docs/epics.md#e12-screens-and-flows). The exploration
is in `~/work/tmp/2026-11-24-prototype/EXPLORE.md`.

## Objective

The user rejected a prototype of pictures with links drawn by hand: "We don't want our prototyping
is just suck as all curent protoyping tool. Given with tinker, we actually build more like the app
already, we should be able to do much better than that. I meant, we need - screens as in some
methodlogical arrangement. Switchable state with data and backend even - composible to real
operstion that then can self documented via the static analysis - self wireable prototype thanks to
tags and operation dependency".

In a Tinker app, each state of a screen is a cell (frame-apps decision 10), each operation lists
its answers, and the backend is the config of a capsule. So easel can find the prototype in the
code. After this delta:

- easel finds each state of a screen and each move between them by a run of the code, with each
  answer of each call forced (J6);
- easel places the states by one fixed method (J7);
- each state shows as a frame of the real view, and each screen has a card from the code (J11);
- the person walks the real screens with the real operations (J1 to J5), on example answers or a
  live server (J10);
- a new answer with no designed screen is a finding (J8), and the maps are in one list (J9).

The first target is the screens of easel itself: the sign-in, the home page, and the requests on a
canvas.

## Words of this spec

The terms are in the [glossary](docs/glossary.md#prototype): **screen**, **state** (of a screen),
**action**, **answer**, **move**, **map**, **backend**. In this spec:

- A **press** is an action that a button of the screen runs (`useRun`). An **open** is an action
  that runs when the screen shows (`useData` of a resource).
- A **call** is a call of the server that an action makes: a member of an rpc capsule, such as
  `browser.start`.
- The **main answer** of a call is the first answer that its contract lists.
- A **trial** is one run of one action from one state, with one script of answers.
- A **stay** is a trial that ends in the state where it started.

## Prior art

| Tool                                                        | What we take                                                                                                         | What we leave                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Figma and ProtoPie prototypes (and SPEC-flows)              | A walk from a named start, one screen at a time, with Back and Restart.                                              | Pictures, and links that a person draws: they break when the product changes.                                 |
| Storybook with MSW                                          | The real components. One state of a screen is one picture. A fake network answers in the browser.                    | A story and a mock written by hand for each state: they drift from the server. No story knows the next story. |
| XState, `@xstate/graph`, model-based tests (GraphWalker)    | Find each state and the shortest path to it by a search of the code. The column of a state is its count of steps.    | A model beside the app. Here the app is the model: its cells and operations.                                  |
| Prism (Stoplight), MSW from OpenAPI                         | A fake server made from the contract: each answer of the schema, with an example made from the schema.               | No screens.                                                                                                   |
| Wireflows (NN/g), story maps (Patton), use cases (Cockburn) | One method to place screens: the steps from left to right, the main success scenario first, the extensions below it. | The places drawn by hand.                                                                                     |
| Swagger UI, tRPC panel                                      | The doc of each call comes from the contract.                                                                        | No screens and no flow.                                                                                       |

Each tool is strong where it reads a fact from the code, and weak where a person copies a fact by
hand. This delta copies no fact by hand.

## The decisions

1. **The prototype is the product.** A screen is a view of the code of the project, not a frame
   that an agent writes. The other options: keep drawn links (the user rejected them), or a frame
   with its own logic (a second copy of the app, as a Stately model is; deferred for a screen that
   the code does not have yet).
2. **The derivation runs in the project, not in the easel server.** It imports and runs the code of
   the project with the `@tinkered/core` of the project. A second copy of Tinker in the easel
   binary does not know the units of the project, and the easel server never runs the code of a
   team outside a sandbox. Storybook, `@xstate/graph` and Playwright run in the project for the
   same reasons. So the map is made by `bun scripts/map.ts` in the repository, and in the E11 job
   that makes the live screens after each deploy. The job sends the map to easel with the CLI, as
   it sends the takes now (ship 2).
3. **The states are the kinds of one cell.** A screen shows one cell of the code (here
   `home.signInStep`). A state is the `kind` of its value. Each value of a state that the run sees
   first is the sample of that state: ship 2 shows the state with it.
4. **The actions of a state come from the view, read with oxc.** `tinker.graph` has no line for a
   view ([lagz0ne/tinkered#58](https://github.com/lagz0ne/tinkered/issues/58)). Until it has one,
   easel parses the view with oxc, which it already uses for the texts and the places. The view is
   the `.tsx` file that reads the cell with `useData` and has a `switch` on its `kind`. For each
   case, easel follows the components that the case draws in the same file, and keeps each
   operation of a `useRun` (a press) and each resource of a `useData` (an open). An imported name
   is the export of its module. Other ways:
   - Try each operation that writes the cell from each state. It finds moves that no screen
     offers, such as `askAgain` from `code`. It stays only as the fallback when no view has the
     switch, and the map says so.
   - A list of the actions of each state, written by hand. It drifts.
5. **The calls come from the `depends` of each action.** The run walks `depends` at run time. A
   call is an operation whose capsule lists its label in `addresses`. `tinker.graph` shows `?` for
   these calls ([lagz0ne/tinkered#59](https://github.com/lagz0ne/tinkered/issues/59)), so the run
   does not read the graph for them.
6. **The answers of a call come from the output schema of its contract, in the order of the
   contract.** `rpc()` does not keep its contracts at run time
   ([lagz0ne/tinkered#54](https://github.com/lagz0ne/tinkered/issues/54)). The workaround of that
   issue: the contract file exports its literal (`browserContracts`), as `ownerContracts` and
   `queueContracts` do now. The run finds the literal in the exports of the modules that the
   actions import. Each answer gets a sample made from the JSON Schema of its variant. A sample
   must parse as the input of a later call, so an output field that a later input checks uses the
   same schema (`browser.start` gives a `request` of the `request` schema). This is the one fact
   that a person adds by hand: the export of the literal. #54 removes it.
7. **The run forces one fault of each call, `link`.** A lost connection is a fault, not an answer,
   and `tinker.graph` does not list faults
   ([lagz0ne/tinkered#60](https://github.com/lagz0ne/tinkered/issues/60)). The state `lost` of the
   sign-in comes only from it. Tinker has 7 faults; a screen of easel treats them the same, so the
   run forces one. With #60, the run forces each fault that the graph lists.
8. **A trial runs the real code in its own scope.** The scope has the test clock of Tinker, which
   never moves: a wait ends the trial, with no host time. The rpc capsules of the action get a
   backend that answers by a script. Each tag in the `depends` of the action gets a recorder that
   returns nothing; a call of it is an effect of the move (such as `home.postForm`). The cell starts
   at the sample of the state.
9. **The search is depth-first on the answers.** Each call takes the next answer of the script.
   A call with no answer in the script takes the main answer, and the search adds a trial for each
   other answer. A trial has 4 calls at most; a call after the fourth never answers. A trial ends
   when its run ends, or when nothing moves for 1000 microtask turns. The search starts at the
   start state, and runs the actions of each new state that a trial reaches.
10. **A move is each change of the cell to another state.** Its label is the action and the
    answer of the last call before the change, or no answer when no call came before it. A trial
    that ends in its first state is a stay. The card (ship 3) and the check (ship 6) use the stays.
11. **The placement method is fixed.** No person and no agent places a state of a map.
    - The column of a state is its count of moves from the start, by the shortest path (breadth
      first, as `@xstate/graph`).
    - The rank of a move is the place of its answer in the contract (the fault is last), then the
      place of its action in the view.
    - The main path starts at the start, and takes the move with the lowest rank to a state in the
      next column, until no such move is left. It is row 0 (the main success scenario).
    - Each other state, in the order of the ranks on its shortest path from the start, starts a
      new row, and its own main path continues on that row (an extension). So two runs on one code
      give the same places.

## Current behavior

- SPEC-flows (approved before) holds links that an agent draws between frames. Its server code was
  not shipped, and is not in the tree.
- The E11 job (`scripts/live-screens.ts`) takes the live screens of easel with Playwright steps
  for each screen, and puts each take on the page Live of `product`.
- No tool shows the states of a screen of the code, or the moves between them.

## New behavior, in 6 ships

Each ship ends green and live.

### Ship 1: the map of a cell (J6, J7)

1. `bun scripts/map.ts <cell label> [--json]` finds the cell in `src/`, its view, its actions, their
   calls and the answers of each call. It runs the search and prints the map: the places as a
   table (the steps as columns, the rows), then each move and each stay.
2. `--json` prints the map as JSON (the contract below).
3. Exit 0 with a map. Exit 1 when no module of `src/` exports a cell with that label, with the
   text `map: no cell <label> in src/`. Exit 64 with the usage text on a wrong argument.
4. The proof: the map of `home.signInStep` has its 7 states, `lost` included, and the places of
   EXPLORE.md §4.

Built on 2026-11-24 (00f36ec): `src/map/` and `scripts/map.ts`, proven by `tests/map.test.ts`.
`bun scripts/map.ts home.signInStep` prints:

```
map home.signInStep, start name, view src/home/home.tsx

         step 0   step 1   step 2
row 0    name     code     in
row 1                      denied
row 2                      expired
row 3             slow
row 4             lost
```

Then 15 moves, 4 stays and the 2 calls. The facts that a person added by hand, and the Tinker
issue that removes each:

| Fact added by hand                                                                | Removed by |
| --------------------------------------------------------------------------------- | ---------- |
| `src/access/contract.ts` exports `browserContracts`, the literal of the contract. | #54        |
| The view is read with oxc; it must `switch` on the `kind` of the cell.            | #58        |
| The run forces one fault, `link`, for each call.                                  | #60        |

### Ship 2: the map on the canvas (J7, J9)

5. The E11 job takes one frame for each state of each map: the real view with the sample of the
   state as a preset of the cell, not with Playwright steps. It puts the frames on a page of the
   map, at the places of rule 11. `src/live/screens.ts` names the cells, not the steps.
6. The maps of a canvas are in one list, with the first state and the count of states (J9).

Built on 2026-11-24 (decisions 12 to 18 below). `bun scripts/map-screens.ts` puts each map of
`src/live/screens.ts` on `product`; the job `screens` of `deploy.yml` runs it after the live
screens. The map of `home.signInStep` now has 10 states:

```
                                step 0                          step 1                          step 2
row 0                           name                            code                            in
row 1                                                                                           denied
row 2                                                                                           expired
row 3                                                                                           code · copyApproveCommand done
row 4                                                           slow
row 5                                                           lost
row 6                                                           name · askForCode pending
row 7                                                           name · askForCode failed
```

The ship 1 stay "name, askForCode, browser.start fault link" is now the move to
`name · askForCode failed`, and the stay "code, copyApproveCommand" is the move to
`code · copyApproveCommand done`. Two stays are left: `browser.start name` from `name`, by
`codeAtOnce` and by `askForCode`.

#### The decisions of ship 2

12. **A state of a run is a state of the screen.** The status of a press (`useRun`) is React
    state, not a cell. But the person sees it: the sign-in shows `No answer. Try again.` when
    `askForCode` fails. So the map has a **run state** `<state> · <action> <status>` when the view
    reads that status:
    - `.isPending` gives `pending`, `.error` or `.isError` gives `failed`, `.isSuccess` or `.data`
      gives `done`. easel reads them with oxc, on the handle of the `useRun` (also a destructured
      one), in the component of the hook, as it reads the `switch` (decision 4).
    - A press that makes a call gives `pending`. A trial that changes no state gives `failed` when
      the run throws, and `done` when it ends. Its move has the answer of the last call.
    - A run state is a leaf: its moves are the moves of its first state, and the search runs no
      action from it. Its moves rank after each answer of the contract, so it is never on the
      main path.

    Prior art: XState makes the error of an `invoke` a transition to a state, and
    `@xstate/graph` counts it; Storybook has one story for each loading and error state; the
    status of a React Query mutation is the model of `useRun`. Other ways: make the error a value
    of the cell (it changes the product for the map), or leave it out (the map then hides a
    screen that the person sees).

13. **The pictures come from a page of their own, not from the server.** `cmds/map-show.html` is
    built with `Bun.build` only by `scripts/map-screens.ts`, as Storybook builds
    `storybook-static` apart from the app. It is never a route of the production server: the
    server never runs the code of a team outside a sandbox (decision 2), the production bundle
    and its checks stay the same, and the presets of `@tinkered/core/testing` stay out of it.
    The job writes the module `map:units` for each map (the view, the cell, the actions, the plan
    of each state), as Storybook writes the index of its stories. The page makes one scope:
    - `preset(cell, sample)` of the state;
    - each rpc capsule of the actions on the example backend of decision 8. The plan gives each
      call its reply. A call with no reply waits, so a state stays as it is;
    - each tag of the actions is a recorder that does nothing.

    For a run state, the build marks each element that runs a press with `data-map-press` (oxc,
    in this build only, as a test-id plugin of Babel does). The page fills each field of the form
    with a sample of the input schema of the action and submits it, or clicks the element. Its
    calls get the answer of the move (a fault for `failed`), or no answer (`pending`).
    Each picture is 1024 × 768, light, with reduced motion, `en-US`, UTC, the clock of the page
    fixed at 2026-11-24 10:00 UTC, and the caret hidden. The times on these screens come from the
    samples.

14. **A sample takes the example of the contract first.** A field with `examples` in its JSON
    Schema (zod `.meta({ examples })`) gets the first example, as Prism and OpenAPI mocks do.
    `browser.start` gives an example code, `expiresAt` and `retryIn`, so `code` shows
    `KDWB-RTQM` and `slow` shows 30 s. An example is a part of the contract, not a fact beside it.
15. **The map on the canvas: a section, one column for each step.** Each map has the page
    `Map · <name>` and the section `<name>: the map of <cell>`. Each state is the image frame
    `<name> · <state>`. The arrange tools of SPEC-arrange place them: the first state with
    `--section`, the first state of each column `--after` the first state of the column before,
    each other state `--below` the state above it. A column holds its states in the order of
    their rows. A section column has no empty place (SPEC-arrange rule 6), so the canvas is the
    form of a story map (Patton: the steps as the backbone, the details of each step under it, in
    order). The fit criterion of J7 holds: the steps go from left to right, the main path is on
    the top row, each other outcome is below it, and two runs give the same places. The text of
    `bun scripts/map.ts` keeps the exact rows. Deferred to ship 4, with the arrows: a section
    with empty places (as `grid-row` of CSS grid).
16. **A second run changes only what changed.** The same pixels put nothing. Other pixels put a
    new version of the same frame (`--id --base`). A frame of a state that the map does not have
    now goes to the section `<name>: states that the map does not have now`; the job never
    deletes a frame. When `easel layout` shows other columns, `easel move` puts each frame back by
    its relation. Proven on a new local server: the second run put nothing and kept each id and
    version; a frame moved by hand came back.
17. **The moves are text under each picture, not arrows.** The viewer and SPEC-arrange have no
    arrow. A strip under each picture has the state, then one line for each move out of it:
    `askForCode · pending → code`, `askForCode · link fault → name · askForCode failed`,
    `askForCode · approved → in (postForm)`. A run state says `the moves of <first state>`; a
    state with no move says `no move: the end of the map`. The arrows come with the walk (ship 4),
    where the viewer draws the moves of the shown state.
18. **The list of maps (J9) is the frame `Maps` on the page `Live`.** It is an HTML frame with a
    row for each map: its page, its cell, its first state and its count of states. Each map has
    its own page, so the pages of the canvas list the maps too. The frame `Live · status` stays
    the frame of the E11 job, so two writers never write one frame. The walk from the list in
    one press comes with ship 4.

The writer is `vibea-claude` (the `EASEL_TOKEN` of the E11 job). Ship 2 has no model: the job is a
bounded run, and no person changes a state in it.

The facts that a person adds by hand in ship 2, and what removes each:

| Fact added by hand                                                                        | Removed by                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/live/screens.ts` `maps`: the name of the map, its cell, the exported view and props. | #58 names the view; the props become a fixture (SPEC-pieces) |

### Ship 3: the card (J11)

7. Beside each row, a card from the code: the state, its actions, each answer of each action and
   the state that it leads to, the effects, and from `tinker.graph` what each action reads,
   writes and calls. A line with `?` (#59) says "not known".

Built on 2026-11-24 (decisions 19 to 22 below). `bun scripts/map-screens.ts` puts a card beside
each picture of each map: `src/map/card.ts` makes it from the map and `tinker.graph`, and
`tests/map-card.test.ts` proves it. The card of `code`:

```
sign-in · code
The state code of the cell home.signInStep, in the view src/home/home.tsx.
Shows
  kind: code
  code: KDWB-RTQM
  expiresAt: 1795514700000
Action home.copyApproveCommand
  reads: nothing
  writes: nothing
  calls: nothing
  no call → code · copyApproveCommand done, effects: home.writeClipboard
Action home.codeAtOnce, from an earlier state
  browser.wait approved → in, effects: home.postForm
  browser.wait denied → denied
  browser.wait expired → expired
Action home.askForCode, from an earlier state
  (the same three answers)
```

#### The decisions of ship 3

19. **A card is a frame of its own, beside the picture of its state.** Each state has the HTML
    frame `<name> · <state> · card`. The cards of a step are a column of the section, after the
    column of the pictures of that step, in the same order. A card is as tall as the picture
    beside it, or taller when its lines need it, so each card is level with its picture. "Beside
    each row" of rule 7 is so "beside each state": the section has no rows (decision 15), and a
    row of rule 11 holds the states of several steps.

    Prior art: Swagger UI and the tRPC panel show the doc of each operation beside it, made from
    its contract; Storybook Docs (autodocs) puts a table made from the types of a component beside
    its story. Other ways: the card text in the strip of the picture (a picture: the text cannot
    be selected or found, and each change of the code makes new pixels), one card for each row
    of rule 11 (it does not sit beside one screen), or a card written by hand (it drifts).

20. **The card is a use case of the state, from the code.** In this order:
    - the title `<name> · <state>`, and the cell and the view of the state;
    - `Shows`: each field of the sample of the state (decision 3);
    - one section `Action <label>` for each action of the state, in the order of the view. It has
      the graph lines (decision 21), then each answer and the state that it leads to, with the
      effects: `browser.start slow → slow`, `browser.start name → stays on name`,
      `no answer yet → name · askForCode pending`, `no call → name`. The answers are in the order
      of the contract, the fault last, and an answer with no call after them, as the ranks of
      decision 11;
    - one section `Action <label>, from an earlier state` for each move out of the state by an
      action that it does not offer: the run of `askForCode` goes on in `code` and waits for the
      approval;
    - `Moves: no move: the end of the map` when the state has no action and no move;
    - for a run state (decision 12): the press and its status, the graph lines of its action, the
      answer that led to it, and `the moves of <first state>: see the card of <first state>`.

    Prior art: a use case of Cockburn (the main success scenario, then each extension with its
    condition and where it goes), which the rows of the map already follow (decision 11); the
    status codes of an operation in Swagger UI, each with its schema. Other ways: one line for
    each trial (it repeats each answer for each path), or only the moves of the caption (it does
    not say what the state shows, or what an action reads and writes).

21. **The graph lines come from `tinker.graph` of the commit.** The job reads `tinker.graph` of
    the repository (the file that `tinker check` keeps). An action gets `reads`, `writes` and
    `calls` from its line, and an empty list is `nothing`. A `?` in a list is `not known`, and
    the card then has the section `Not known` that names #59. An action with no line (an open,
    such as `home.codeAtOnce`, is a resource and the graph lists operations) gets one line:
    `reads, writes, calls: not known: tinker.graph has no line for <label>`. The run of decision 5
    finds the calls that the graph does not know; the card shows them as answers.

22. **A second run puts nothing, and the map has room for the frame names.**
    - A card with the same text and the same size puts nothing. Other text puts a new version
      (`--id --base`); another size is `easel move --size`. A card of a state that the map does
      not have now goes to the section of decision 16 with its picture.
    - The viewer keeps a frame name at one size on the screen (SPEC-arrange rule 13), about 24 px
      high with its buttons. At 10% zoom the gap of 80 px of a section is 8 px on the screen, so
      the name of a frame covered the strip of the frame above it. The section of a map has the
      gap 320 (`easel section --gap`): (24 + 8) / 0.1, so at 10% zoom the name and 8 px of space
      fit between two frames. Figma keeps a frame name at one size on the screen too, and hides
      it when the frame is too small; that is a change of the viewer for each canvas, so it waits
      for a case that the gap does not fix.
    - The strip draws the arrow `→` apart from the text, with its middle on the middle of an `x`
      of the same font (from `measureText`), so the arrow does not sit low.

    Proven on a new local server: the first run put 10 pictures and 10 cards and set the gap 320;
    a run with no change put nothing. At 10% zoom the frame names are 24 px high and cover no
    strip. The card uses the classes of the kit (`bg-card`, `text-sm/5`, `font-semibold`), so it
    has the look of the kit, as each frame has. Two runs under load put a new picture of
    `name · askForCode pending` and `name · askForCode failed`: the press of decision 13 waits a
    fixed 200 ms, so the picture can come before or after the run settles. That is ship 2 code;
    it is left open.

### Ship 4: the walk (J1 to J5)

8. A press on a screen runs the real operation in the board worker (frame-apps build-order item
   7). The next screen shows because the cell changed. The viewer never goes where a frame says.
9. The model `viewer-walk` stays. Ship 4 changes its rule "the walk shows only a screen that a link
   of the shown screen reaches" to "the walk shows only a state that a move of the map from the
   shown state reaches"; the twin `viewer-walk-any-post` keeps its meaning.

### Ship 5: the backend switch (J10)

10. One switch of the board: example answers, or a live server. With example answers, the person
    picks the answer of each call (the backend of rule 8 in the browser). The live server is a
    server of the build on a new database, as the E11 job starts one. This ship has state that a
    person changes, so it gets a model and its chart first.

### Ship 6: the check (J8)

11. The check fails when an answer of an action has no state on the map, or when a state has no
    designed frame. A new answer in the code is a finding, as a new exit with no test is a finding
    of `tinker check`. It replaces the model `flows-links`: no drawn link is left to break.

## Contract (ship 1 to ship 3)

```ts
type Answer = { call: string; kind: string; fault: boolean }
type MapJson = {
  cell: string
  start: string
  view: string | null
  calls: { call: string; answers: string[] }[]
  states: {
    state: string; column: number; row: number; sample: unknown; actions: string[]
    run: { from: string; action: string; press: string; status: "pending" | "failed" | "done" } | null
  }[]
  moves: { from: string; to: string; action: string; answer: Answer | null; effects: string[] }[]
  stays: { state: string; action: string; answer: Answer | null; effects: string[] }[]
}
```

- `view` is the path of the view, or null when the search used the fallback of decision 4.
- `answers` lists the answers in the order of the contract, then `link`.
- `actions` of a state are in the order of the view.
- `run` is null for a state of the cell. For a run state (decision 12) it names the first state,
  the action, the import name of the press in the view, and the status.

The card (ship 3) is made from this contract and `tinker.graph`, and adds nothing to it:

```ts
type MapCard = { title: string; about: string; sections: { head: string; lines: string[] }[] }
```

## Models

- Ship 1 has no model. The search is a bounded computation, and no person changes a state in it.
  Its proof is a test that reaches the 7 states of the sign-in.
- `viewer-walk` and its twin stay (ship 4).
- `flows-links` and `flows-links-unchecked` go with this delta: the links that they model are not
  in the design now. Ship 6 has the check that replaces them.
- Ship 5 gets a model of the switch and the live server before its code.

## Success criteria

1. **J6, J7.** `bun scripts/map.ts home.signInStep` prints the 7 states of the sign-in: `name` in
   step 0; `code`, `slow` and `lost` in step 1; `in`, `denied` and `expired` in step 2. Row 0 is
   `name`, `code`, `in`. A test proves it on the code of `src/home/signin.ts` and
   `src/home/home.tsx`.
2. **J6.** A test proves that a change of the code changes the map, with no other change: a cell
   with one more answer gets one more state.
3. `tinker check` is OK: a test reaches each exit of each new operation.

## Boundaries

- Always: each fact of a map comes from the code. A fact that a person adds is named here with the
  Tinker issue that removes it.
- Always: the derivation runs the code of the project in the project.
- Never: the easel server imports or runs the code of a project.

## Out of scope (deferred)

- **A screen that the code does not have yet.** An app frame with its own logic. Add it when a
  journey must be reviewed before its code is written.
- **A tag that gives a value.** The recorder returns nothing, so an action that reads a value of a
  tag (such as `home.readSite`) gets none. Add a sample of the tag when a screen needs it.
- **Actions with an input that `{}` does not satisfy.** The run gives `{}` as the input. Add an
  input from the input schema when a press needs one.
- **The other 6 faults of Tinker.** Add them with #60.
