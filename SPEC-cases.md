# Spec delta: `cases`, each case of a frame is a frame, in one group with two views

Status: approved by the user on 2026-11-25, with both picks of the open questions. The user agreed
to the design on 2026-11-25: the picks D5 to D7 on the page `regroup-the-controller` of the canvas
`product` (groups 4 and 5). This delta adds to
[SPEC-pieces](SPEC-pieces.md) rules 10 to 16 (switches, fixtures, matrix) and to
[SPEC-arrange](SPEC-arrange.md) (sections). It is the design of E10.3 in
[docs/epics.md](docs/epics.md).

## Objective

The user, 2026-11-25:

> given the screen is a component (or composed one, of some short). Surely, the "frame" to put on
> the page is the snapshot of a specific state composiion. And we'll want to manage and having all
> of "those"

> giving those the group view of screens off the list of switches. As such, they can be snapshot
> view (everything out, can comment on each), or can be grouped, and be controlled by the
> controller

The example is a list of users. A review needs these cases of the one screen: empty, few, long
names, many (with the pager), the first load, the next page, a refresh, and a fault. Today, the
parts exist in three places that do not connect: the fixtures (the data), the map (the answers
of the calls), and the matrix (side by side). No place keeps "many users, and page 2 waits" as
one named thing that a person can review and comment on.

After this delta:

- a frame has a list of named cases. A case is a set of values: a fixture, the value of some
  switches, and (ship 3) the answer of each call (X12, X15);
- easel shows each case as its own frame, in one section for the frame (X12);
- a change of the code of the frame shows in each case, with no step for each case (X17);
- a request goes on one case, in each view (X13);
- one button changes the group between the spread view and the stack view. In the stack view,
  the panel Controls picks the case (X14);
- the person keeps the values on the screen as a new case, with no agent (X16).

## Prior art

| Tool                             | What we take                                                                                                                           | What we leave                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Storybook stories (CSF)          | A story is one named set of values for a component: its args, its globals and its loaders. Each state of a review has a name.          | A story is code. Here a case is data, so a person adds one with no agent (E10: "with no agent"). |
| `msw-storybook-addon`            | Each story names the answers of its calls (`parameters.msw`). A wait is a handler that does not answer (`delay('infinite')`).          | Handlers written by hand. Here the answers come from the contracts of the calls (ship 3).        |
| Storybook 8, save from Controls  | The person sets the controls, then keeps the values as a new story.                                                                    | The write into a source file.                                                                    |
| Chromatic modes                  | The theme and the language apply to each story. They do not make the list longer.                                                      | The service.                                                                                     |
| Figma component set and instance | The set shows each variant at one time. An instance shows one variant, and its property panel changes it. A comment is on one variant. | Variants drawn by hand.                                                                          |
| React Cosmos fixtures            | The UI lists the named cases of a component, and a click shows one.                                                                    | A file for each case.                                                                            |
| [SPEC-arrange](SPEC-arrange.md)  | A section is a named set of frames that easel places together.                                                                         | Nothing: the group of the cases is a section.                                                    |

## Words of this spec

| Term         | Type | Definition                                                                                                                           |
| ------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------ |
| case         | noun | A named set of values for a frame: a fixture, the value of each switch that it sets, and the answer of each call that it sets.       |
| source frame | noun | The frame that has the code and the list of cases.                                                                                   |
| case frame   | noun | The frame that shows one case of a source frame. It has no files: it shows the code of its source frame with the values of its case. |
| case group   | noun | The section of a page that holds a source frame and its case frames.                                                                 |
| spread view  | noun | The view of a case group that shows each case frame.                                                                                 |
| stack view   | noun | The view of a case group that shows only the source frame. The panel Controls picks the case.                                        |

Two terms of the glossary are taken. A "state of a screen" (SPEC-prototype) is one kind of the
value of a cell; a case gives the data and the answers that bring a screen to a state. A "pin" is
the mark of a request; so the button is `Keep as a case`. The mock on the page says "named
states" and "Pin"; this spec replaces both words.

## The decisions

1. **A case is data, not code.** easel keeps the list of cases of each source frame, as it keeps
   the fixtures (SPEC-pieces rule 15). `cases.set` writes the whole list with a base, and refuses
   with `changed` when the list changed after the read. Reason: E10 says "with no agent", and a
   case that the person keeps (decision 9) must not need a change of code. The mock of group 4
   shows an export `frameStates`; this decision replaces it.
2. **The shape of a case:** `{ name, fixture?, switches?, answers? }`.
   - `name`: 1 to 40 characters, a slug (`next-page`, `long-names`). It is unique in the list.
   - `fixture`: a name of `fixtures.list` for a cell of the source frame, or no fixture.
   - `switches`: for each switch that the source frame takes, a value that its `parse` accepts.
   - `answers` (ship 3): for each call that the source frame depends on, a kind of its output, a
     fault, or `none` (no answer: the call waits).
   - A list has 36 cases at most, as a matrix (rule 16). More refuses with `CasesTooMany`.
   - The server checks what it knows: the shape, the names, and that the fixture is a name of
     `fixtures.list`. A value that does not check refuses the whole write with `CaseInvalid`, its
     case, its field and the reason.
   - Only the frame knows its switches, when it runs (its offer, rule 12). So the server does not
     check a switch value. A value that the `parse` of the tag refuses gets the default of the
     tag, as a bad value of the address does today, and its row in Controls shows the default.
   - A fixture that goes after the write: the case frame shows its own data, as the switch
     `fixture` does today (rule 15).
3. **easel makes the case frames.** For each case, easel keeps one case frame in the case group of
   the source frame. The section has the name `<source frame name> · cases`, with the name of the
   frame cut to fit the 80 characters of a section name. If a section of the page has that name
   and is not this case group, easel adds the id of the source frame to the name. The source
   frame is its first column. The case frames follow in the order of the list.
   - The first write makes the case group at the place of the source frame (`at`, SPEC-arrange
     rule 10). So the source frame stays where it was, and its cases go to its right.
   - A case frame has its own id, the name `<source frame name> · <case name>`, and the size of
     its source frame. Its version is the version of its source frame.
   - A case frame keeps the build of its source frame (`html`, `css`, `kit`, `js`). easel writes
     it in the same write as the new version of the source frame, and only easel writes it. So the
     document, the pictures and the old versions that a request keeps work as for each frame.
   - easel adds, renames and removes case frames in the same write as `cases.set` or as a new
     version of the source frame. Then easel computes the places again (SPEC-arrange rule 11).
   - A write of the files of a case frame refuses with `CaseFrame`, and names the source frame.
   - A case frame that goes takes its open requests with it, as a removed frame does today (E4,
     N8).
4. **A case frame draws the code of its source frame with the values of its case.** The fixture
   goes into its cell before the first draw (rule 15). Each switch of the case is the frame value
   (rule 12). A switch that the case does not set follows the board value, so one pick of `dark`
   or `vi` still changes each case frame (X6; the modes of Chromatic).
   - The order of a value: the frame value of the tab (a pick of the person on the case frame),
     then the value of the case, then the board value. `Use the board` on a case frame gives back
     the value of the case.
5. **A request is on one case frame.** It is a request on that frame, with no change of the
   request record (`frameId`, `version`, `x`, `y` in `src/queue/cells.ts`). A new version of the
   source frame can make it outdated, as for each frame today (E4, M18).
6. **Two views of a case group, kept by the tab.** The view is of the tab and in the address, as a
   switch value is (rule 13): `cases.<source frame id>=stack`. With no value, the view is the
   spread view (D5). A button `Spread | Stack` is on the head of the section.
   - In the spread view, each case frame shows.
   - In the stack view, the viewer hides the case frames of the group. The source frame shows two
     edges behind it, and the name `<case name> · <n> of <count>`.
   - The section keeps its box in the stack view. The places are of the server (SPEC-arrange rule
     11), so no frame moves for another person, and each pin stays at its place.
7. **The panel Controls of a source frame has a section `Cases` at the top.** It has one row for
   each case, with the count of its open requests. A click gives the source frame the values of
   that case, as frame values. The row of the values on the screen is marked. A change in a row
   of Data, of a switch or (ship 3) of Calls can give values that are no case: then no row is
   marked.
8. **A request in the stack view goes on the case on the screen.** A request that the person
   writes on the source frame while it shows case C goes on the case frame of C, at the same
   point (D6). With values that are no case, the request goes on the source frame, as today. The
   form says: `These values are not a case. Keep them as a case to comment on that case.`
9. **Keep as a case** (ship 4). The section `Cases` has the button `Keep as a case` and a name
   field. It writes `cases.set` with the base, and easel adds the case frame. Only a member with a
   write right sees it, as for `fixtures.set`. A name that is in the list refuses with
   `CaseExists`.
10. **The answers of the calls** (ship 3). A case frame runs the example backend of the walk
    (SPEC-prototype ship 5, `backend` = `examples`) in its own scope. Each call gets the answer
    that the case sets, or the first example of its contract. `none` gives no answer, so the
    screen shows its wait. The kinds come from the output schema of the contract. This ship needs
    the frame scope of E3 (the calls of the controller) first.
11. **The tools.** `easel cases ls <canvas> <frame>` and
    `easel cases set <canvas> <frame> <file.json> [--base <rev>]`; MCP `list_cases` and
    `set_cases`. The file is the whole list, in order.
12. **The matrix stays.** A matrix shows one part in each value of its switches, in one frame
    (X11). A case group is for a screen: each case is a frame, with its own requests. A frame can
    have both.

## Current behavior

- Fixtures: named data for a real cell, `fixtures.set`, the switch `fixture` (rule 15, X10).
- Switches: the board value, and the frame value with `Use the board`, both in the address (rules
  11 to 13, X6 to X8).
- The matrix: one frame shows the View in each value of its switches (rule 16, X11). Its cells
  have no names of their own, no answers of calls, and no requests of their own.
- The map forces each answer of each action (SPEC-prototype ship 2), but it does not use the
  fixtures. `src/map/` has no fixture.
- The example backend of the walk runs in the walk of the viewer (`src/viewer/walk-backend.ts`),
  not in the scope of a frame.
- A request holds `frameId`, `version`, `x` and `y`, and no values of switches.
- Sections place a named set of frames (SPEC-arrange).

## New behavior, in 4 ships

Each ship lands green and live. A ship with state gets its TLA+ model and its chart first
(AGENTS.md).

### Ship 1: cases with a fixture and switches (X12, X17)

Decisions 1 to 5, 11 and 12. The cases set a fixture and switches, but no `answers`.

- Proof: a test writes the 4 data cases of the list of users (`empty`, `few`, `long-names`,
  `many`). easel makes 4 case frames in the section `users list · cases`, after the source frame.
  Each shows its fixture.
- Proof: a new version of the source frame gives each case frame the new version, in one write.
  A new value of a fixture shows in each case frame that uses it.
- Proof: each refusal (`CaseInvalid`, `CasesTooMany`, `CaseFrame`, `changed`) has a test.

### Ship 2: the two views, the section `Cases`, a request in the stack view (X13, X14)

Decisions 6 to 8. The model first: the view of each group, the case on the screen, and the
request form.

- Proof (browser test): `Stack` hides the case frames, and no other frame moves. The address has
  `cases.<id>=stack`. A second browser that opens the address shows the stack view.
- Proof: a click on the row `many` of `Cases` gives the source frame the fixture `many`. A request
  that is written then is on the case frame `many`, and shows there in the spread view.

### Ship 3: the answers of the calls (X15)

Decision 10, after the frame scope of E3.

- Proof: the cases `first-load` (`users.list` = `none`), `next-page` (`many`, `users.list` = `none`
  on page 2) and `failed` (a fault) each show their screen. A test reaches each kind of the
  output of `users.list`.

### Ship 4: Keep as a case (X16)

Decision 9.

- Proof: the person sets `few` and `users.list` = `none`, then keeps it as `refresh`. The list
  has 1 more case, its case frame shows at once, and the other viewers see it within 1 second.
- Proof: a viewer with no write right does not see the button. `CaseExists` has a test.

## Success criteria

1. The 8 cases of the list of users show as 8 case frames with the source frame in one section.
   Each case frame has its name and shows its values (X12).
2. One new version of the source frame shows in each case frame. No step for each case is
   necessary (X17).
3. A request on a case frame shows on that case frame in the spread view, and its count shows in
   the row of `Cases` in the stack view (X13).
4. One click changes a group between the spread view and the stack view. No frame of the page
   moves, the address keeps the view, and the view of another person does not change (X14).
5. A case can make a call wait or fail, and its screen shows the wait or the fault (X15).
6. A person keeps a new case with no agent, and its case frame shows within 1 second (X16).
7. What must not change: the matrix (X11), the board value and the frame value (X6, X7), the
   request record, and the frames that are not in a case group.

## Boundaries

- Always: easel alone makes, renames and removes case frames. Each write of cases has a base.
- Always: a case frame shows the build of its source frame. Only easel writes it, in the same
  write as the source frame (decision 3).
- Ask first: a change of the request record. This delta needs none.
- Never: a case as code in the files of a frame (decision 1).

## Out of scope (deferred)

- **A request on values that are no case** keeps those values. Add it when a person asks for it;
  today the form says to keep a case first (decision 8).
- **A stack view that gives its space back.** It needs places for each tab. Add it when the empty
  box of a stacked group is a problem on a real page.
- **The check of the map against the cases:** an answer of the map with no case is a finding. It
  needs the map to use the fixtures.
- **Cases made by easel from the map.** Add them after the check.
- **The page filter (C9):** a switch of one frame hides frames of the page. It is the next step
  of the controller, not of this delta.
- **A case of several frames at one time** (a flow). Add it when a review needs it.

## Decided questions

1. **The word "case"** (the user, 2026-11-25). "State" and "pin" are taken in the glossary, and a
   Storybook "story" is code.
2. **The box of a group in the stack view stays** (the user, 2026-11-25). The layout stays the
   one of the server for each person, and no pin moves (decision 6).
