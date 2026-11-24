# viewer: the person walks a map of the code

The chart follows one tab while the person walks a map ([SPEC-prototype](../../SPEC-prototype.md)
ship 4, rules 8 and 9, E12 J1 to J5; the walk of [SPEC-flows](../../SPEC-flows.md) rules 19 to
24). The map starts at the state `name`. Its moves: `name` to `code`, `code` to `in`, `code` to
`denied`, and `denied` to `name`. The state `x` is a state that the code can reach and the map does
not have. The screen runs the real code, so a press can change the cell to any state. The person
starts the walk, goes Back, Restart and Leave, and asks for a change in the walk. The model is
[models/viewer/Walk.tla](models/viewer/Walk.tla) with [Walk.cfg](models/viewer/Walk.cfg)
(`TrustFramePost = FALSE`). TLC checks every rule below on all 19 of its states, and each one
holds. A walk has at most 3 steps in the model.

```mermaid
---
title: "viewer: the person walks a map of the code"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: canvas
    lg1: walk
    lg2: request
  }
  class lg0 tan
  class lg1 teal
  class lg2 blue
  s0: The canvas
  s1: Walk: state name (the first step)
  s2: Walk: state code (steps: name, code)
  s3: Walk: state name (the first step), Comment on
  s4: Walk: state name (the first step), the bar says the map has no such move
  s5: Walk: state denied (steps: name, code, denied)
  s6: Walk: state in (steps: name, code, in)
  s7: Walk: state code (steps: name, code), Comment on
  s8: Walk: state name (the first step), a request open on the screen
  s9: Walk: state code (steps: name, code), the bar says the map has no such move
  s10: Walk: state name (the first step), the bar says the map has no such move, Comment on
  s11: Walk: state denied (steps: name, code, denied), Comment on
  s12: Walk: state in (steps: name, code, in), Comment on
  s13: Walk: state code (steps: name, code), a request open on the screen
  s14: Walk: state code (steps: name, code), the bar says the map has no such move, Comment on
  s15: Walk: state name (the first step), the bar says the map has no such move, a request open on the screen
  s16: Walk: state denied (steps: name, code, denied), a request open on the screen
  s17: Walk: state in (steps: name, code, in), a request open on the screen
  s18: Walk: state code (steps: name, code), the bar says the map has no such move, a request open on the screen
  [*] --> s0
  s0 --> s1: a press on the mark of the walk frame, or on the map in the list Maps
  s1 --> s0: Escape: the walk ends or Leave
  s1 --> s2: the code changes the cell: state code
  s1 --> s3: Comment
  s1 --> s4: the code changes the cell to a state off the map
  s2 --> s0: Escape: the walk ends or Leave
  s2 --> s1: Back or Restart
  s2 --> s5: the code changes the cell: state denied
  s2 --> s6: the code changes the cell: state in
  s2 --> s7: Comment
  s2 --> s9: the code changes the cell to a state off the map
  s3 --> s0: Leave
  s3 --> s1: Comment or Escape: the request mode ends
  s3 --> s8: a press on the screen in the request mode
  s4 --> s0: Escape: the walk ends or Leave
  s4 --> s2: the code changes the cell: state code
  s4 --> s8: Ask for it
  s4 --> s10: Comment
  s5 --> s0: Escape: the walk ends or Leave
  s5 --> s1: Restart
  s5 --> s2: Back
  s5 --> s11: Comment
  s6 --> s0: Escape: the walk ends or Leave
  s6 --> s1: Restart
  s6 --> s2: Back
  s6 --> s12: Comment
  s7 --> s0: Leave
  s7 --> s2: Comment or Escape: the request mode ends
  s7 --> s13: a press on the screen in the request mode
  s8 --> s1: Escape: the request closes or Send
  s9 --> s0: Escape: the walk ends or Leave
  s9 --> s1: Back or Restart
  s9 --> s5: the code changes the cell: state denied
  s9 --> s6: the code changes the cell: state in
  s9 --> s13: Ask for it
  s9 --> s14: Comment
  s10 --> s0: Leave
  s10 --> s4: Comment or Escape: the request mode ends
  s10 --> s8: Ask for it
  s10 --> s15: a press on the screen in the request mode
  s11 --> s0: Leave
  s11 --> s5: Comment or Escape: the request mode ends
  s11 --> s16: a press on the screen in the request mode
  s12 --> s0: Leave
  s12 --> s6: Comment or Escape: the request mode ends
  s12 --> s17: a press on the screen in the request mode
  s13 --> s2: Escape: the request closes or Send
  s14 --> s0: Leave
  s14 --> s9: Comment or Escape: the request mode ends
  s14 --> s13: Ask for it
  s14 --> s18: a press on the screen in the request mode
  s15 --> s4: Escape: the request closes or Send
  s16 --> s5: Escape: the request closes or Send
  s17 --> s6: Escape: the request closes or Send
  s18 --> s9: Escape: the request closes or Send
  class s0 tan
  class s1 teal
  class s2 teal
  class s3 teal
  class s4 teal
  class s5 teal
  class s6 teal
  class s7 teal
  class s8 blue
  class s9 teal
  class s10 teal
  class s11 teal
  class s12 teal
  class s13 blue
  class s14 teal
  class s15 blue
  class s16 blue
  class s17 blue
  class s18 blue
```

| Rule                       | In plain words                                                                                                 | Spec line                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `TypeOK`                   | Each value is one that the tab can hold. The canvas has no steps; the walk has one at least.                   | (model)                            |
| `EachStepIsAMove`          | The walk starts at the first state, and each next state comes from a move of the map from the state before it. | SPEC-prototype.md rule 9           |
| `BackShowsTheStateBefore`  | Back shows the state of the step before.                                                                       | SPEC-flows.md rule 20              |
| `OffMapKeepsTheState`      | When the code reaches a state that no move of the map reaches, the shown state stays, and the bar says so.     | SPEC-prototype.md decision 26 (J8) |
| `ARequestStaysOnItsScreen` | While a request is open in the walk, no step changes the screen: the request is on that screen.                | SPEC-flows.md rule 24 (J4)         |
| `NoLeaveWithARequestOpen`  | Escape with a request open closes the request, and the walk stays.                                             | SPEC-flows.md rule 20              |
| `NoDeadlock`               | There is always a next step.                                                                                   | (model)                            |

## What the model leaves out

- The run states (`pending`, `failed`, `done`): they are React state of a press, not a value of
  the cell, so they are not steps (SPEC-prototype decision 24).
- The pick of an answer of a call that waits: it is one way for the code to change the cell, as a
  press is.
- The address of the walk and a reload: deferred.
- The time to show the next state: the code changes the cell in the same document, with no load.
- The locale and the picks of each screen (J5): the walk draws as the canvas draws.

## What the chart shows

- Only a change of the cell to a state that a move of the map reaches, Back and Restart change
  the screen.
- A state off the map keeps the screen, and "Ask for it" opens a request there.
- A request opens on the screen that shows, and the walk takes no step until Send or Escape.
- [viewer-walk-any-post](viewer-walk-any-post.md) shows why the viewer checks each posted state
  against the map.
