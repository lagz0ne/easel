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

### Ship 2: the map on the canvas (J7, J9)

5. The E11 job takes one frame for each state of each map: the real view with the sample of the
   state as a preset of the cell, not with Playwright steps. It puts the frames on a page of the
   map, at the places of rule 11. `src/live/screens.ts` names the cells, not the steps.
6. The maps of a canvas are in one list, with the first state and the count of states (J9).

### Ship 3: the card (J11)

7. Beside each row, a card from the code: the state, its actions, each answer of each action and
   the state that it leads to, the effects, and from `tinker.graph` what each action reads,
   writes and calls. A line with `?` (#59) says "not known".

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

## Contract (ship 1)

```ts
type Answer = { call: string; kind: string; fault: boolean }
type MapJson = {
  cell: string
  start: string
  view: string | null
  calls: { call: string; answers: string[] }[]
  states: { state: string; column: number; row: number; sample: unknown; actions: string[] }[]
  moves: { from: string; to: string; action: string; answer: Answer | null; effects: string[] }[]
  stays: { state: string; action: string; answer: Answer | null; effects: string[] }[]
}
```

- `view` is the path of the view, or null when the search used the fallback of decision 4.
- `answers` lists the answers in the order of the contract, then `link`.
- `actions` of a state are in the order of the view.

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
