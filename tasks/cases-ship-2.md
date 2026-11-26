# Mission: cases ship 2

Lead: easel-95 (paseo a639d46b, `m: cases ship 2`; started by fdcbcfb9 for the person). Accepted: waiting for the person. Done: open.

## Mission

A person changes a case group between the spread view and the stack view with one click. In the
stack view, the section `Cases` of Controls picks the case, and a request goes on the case on the
screen. (E10.3: X13, X14; SPEC-cases decisions 6 to 8, ship 2.)

## Success

- On the page `regroup-the-controller`, the head of the section `users list · cases` has
  `Spread | Stack`. A click on `Stack` hides the 4 case frames. The source frame shows 2 edges
  behind it and `<case> · <n> of 4`. No frame of the page moves, and the section keeps its box.
- The address then has `cases.02dc75f14fbf=stack`. A second browser that opens it shows the stack
  view. A second browser that is open on the page with no such address stays in the spread view.
- In the stack view, Controls of the source frame has the section `Cases` at the top: 4 rows,
  each with the count of the open requests of its case frame. A click on `many` shows the fixture
  `many`, and the row `many` is marked. A value that no case has marks no row.
- In the stack view with `many` on the screen, a new request on the source frame goes on the case
  frame `many`, at the same point. It shows on `many` in the spread view, and the count of the
  row `many` goes up by 1. With values that are no case, the request goes on the source frame,
  and the form says `These values are not a case. Keep them as a case to comment on that case.`
- The open items of ship 1: `cases.set` with no `base` refuses. A move and a mark (ready,
  exploring) of a case frame refuse with `CaseFrame`. The States menu of a case frame marks
  `Use the board` only when the tab has no pick of its own. A case frame does not show the data
  of its source frame before its own data.

## Nono

- Not in: the answers of calls in a case (ship 3, X15), and `Keep as a case` (ship 4, X16).
  Back when the person starts that ship.
- Not in: a stack view that gives its space back (SPEC-cases, Out of scope). Back when the empty
  box of a stacked group is a problem on a real page.
- Not in: a request that keeps values that are no case. Back when a person asks for it.
- Not in: a fixture only of a cell of the source frame, and the `easel kit check` finding for
  `fixtures` beside a function `View` (ship 1 report). Back when a case meets one of them.
- Must not: change the request record (`frameId`, `version`, `x`, `y`), the places of the
  server (SPEC-arrange rule 11), the matrix (X11), or the board value and the frame value (X6, X7).
- Must not: let the view of one tab change the view of another tab or another person.

## Verify

- The chart `viewer-cases` (the view of each group, the case on the screen, the request form):
  `scripts/statecharts.sh --check` prints that it holds, and a conformance review of the model.
- `offload -- bun --bun vp test tests/cases.test.ts tests/cli-cases.test.ts tests/viewer-cases.test.ts tests/browser/viewer-cases.test.tsx`
  passes. The browser test proves: `Stack` hides the case frames and no box moves; the address
  has `cases.<id>=stack`; a second browser opens it in the stack view; a click on `many`, then a
  request, puts the request on the case frame `many`.
- `bun run check:plain` prints `tinker check: OK`, and `bun run smoke` passes.
- A look with `agent-browser` at the live page `regroup-the-controller`: each success line,
  with a screenshot in `~/work/tmp/`.
- A new reviewer subagent that did not build the work gives `proven` for each success line.
- Live: `/api/version` shows the ship. Confirms: the person, on the page `regroup-the-controller`.

## Open choice for the person

The stack view shows the source frame. Its values on the screen can be no case (for example, its
own data). SPEC-cases does not say what `Stack` shows then.

- A (pick): `Stack` gives the source frame the values of the first case, as a click on its row
  does. Reason: the stack view always shows a case, so a request in it always goes on a case.
- B: `Stack` keeps the values on the screen, and the head says `not a case · 4 cases`. A request
  goes on the source frame until the person picks a row.

The look is agreed: the mocks `users list · Stack` (c303ce3ce92e) and `users list · Spread`
(1e5d8de2996e), groups 4 and 5 of the page. So no new design is necessary.

## Touching

- `tasks/cases-ship-2.md`, `SPEC-cases.md` (decisions 6 to 8 only)
- `docs/statecharts/models/cases/` (new), `docs/statecharts/charts.tsv` (one row),
  `docs/statecharts/viewer-cases*.md` (generated)
- `src/viewer/canvas.tsx` (`SectionNames`, `ControlsPanel`, the hide of case frames; not
  `viewer.frameScheme` or the picture card props of fast open)
- `src/viewer/cases.ts`, `src/viewer/switches.ts` (the address key `cases.<id>`),
  `src/viewer/switch-pick.tsx` (`Use the board` of a case frame), `src/viewer/draft.ts`,
  `src/viewer/request.tsx` (the frame of a new request, and the form text)
- `src/frames/cases.ts`, `src/frames/cases.server.ts`, `src/frames/contract.ts`,
  `src/frames/store.server.ts` (refuse a move), `src/frames/ops.server.ts` (refuse a mark; agree
  with fast open first, its T2 adds a call in `savePut`), `src/cli/cases.ts` (`--base` required)
- `tests/cases.test.ts`, `tests/cli-cases.test.ts`, `tests/viewer-cases.test.ts`,
  `tests/browser/viewer-cases.test.tsx`
- `tinker.graph` (the lines `viewer.case*` and `cases.*` only, ship with `-p`)

## Plan

Each task lands green with `scripts/ship.sh`. One worker writes one task, on its paths.

- [ ] **T0 · The model.** A TLA+ model and its chart `viewer-cases`: the view of each group for
      each tab, the case on the screen, and the frame of a new request. Invariants: no box moves;
      a request in the stack view with a case on the screen is on that case frame; one tab does
      not change the view of another.
  - Verify: `scripts/statecharts.sh --check`.
- [ ] **T1 · Ship 1 fixes on the server.** `base` required on `cases.set` and `easel cases set`;
      `CaseFrame` for a move and a mark of a case frame.
  - Verify: `offload -- bun --bun vp test tests/cases.test.ts tests/cli-cases.test.ts`, then
    `check:plain`.
- [ ] **T2 · The two views.** `Spread | Stack` on the head of a case group; the address key
      `cases.<id>=stack`; the hide of the case frames; the 2 edges and `<case> · <n> of <count>`.
  - Verify: the browser test of the views, then `bun run smoke`.
- [ ] **T3 · The section `Cases`.** The rows, the counts of open requests, the click that gives
      the frame values, the marked row. Also `Use the board` and the first draw of a case frame.
  - Verify: the browser test of the section, then `check:plain`.
- [ ] **T4 · A request in the stack view.** The draft goes on the case frame of the case on the
      screen; the form text for values that are no case.
  - Verify: the browser test of the request, then `bun run smoke`.
- [ ] **Review and live proof.** A new reviewer subagent; the look with `agent-browser` on the
      live page.

## Risks

- `src/viewer/canvas.tsx` is large (1045 lines) and fast open may need one hunk in it.
  Mitigation: small named components in `src/viewer/cases.ts` or a new `case-group.tsx`, and
  `ship.sh -p` for each hunk.
- A required `base` breaks a caller with no base. Mitigation: `easel cases ls` gives the
  base, and the refusal line says the fix.
