# viewer: the person walks a flow in walk mode

The chart follows one tab while the person walks a flow ([SPEC-flows](../../SPEC-flows.md) rules
16 to 24, J1 to J4). The flow starts at screen a. Its links: `send` of a leads to b, `next` of b
leads to c, and `back` of b leads to a. Screen c has the action `done` with no link, and screen x
is on the page with no link to it. The person starts the flow, presses the actions, goes Back,
Restart and Leave, and asks for a change in the walk. The model is
[models/viewer/Walk.tla](models/viewer/Walk.tla) with [Walk.cfg](models/viewer/Walk.cfg)
(`TrustFramePost = FALSE`). TLC checks every rule below on all 16 of its states, and each one
holds. A walk has at most 3 steps in the model.

```mermaid
---
title: "viewer: the person walks a flow in walk mode"
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
  s1: Walk: screen a (the first step)
  s2: Walk: screen b (steps: a, b)
  s3: Walk: screen a (the first step), Comment on
  s4: Walk: screen a (steps: a, b, a)
  s5: Walk: screen c (steps: a, b, c)
  s6: Walk: screen b (steps: a, b), Comment on
  s7: Walk: screen a (the first step), a request open on the screen
  s8: Walk: screen c (steps: a, b, c), the bar says no screen comes after done
  s9: Walk: screen a (steps: a, b, a), Comment on
  s10: Walk: screen c (steps: a, b, c), Comment on
  s11: Walk: screen b (steps: a, b), a request open on the screen
  s12: Walk: screen c (steps: a, b, c), the bar says no screen comes after done, Comment on
  s13: Walk: screen a (steps: a, b, a), a request open on the screen
  s14: Walk: screen c (steps: a, b, c), a request open on the screen
  s15: Walk: screen c (steps: a, b, c), the bar says no screen comes after done, a request open on the screen
  [*] --> s0
  s0 --> s1: a press on the mark of the flow, or on the flow in the menu
  s1 --> s0: Escape: the walk ends or Leave
  s1 --> s2: a press on an action: screen b
  s1 --> s3: Comment
  s2 --> s0: Escape: the walk ends or Leave
  s2 --> s1: Back or Restart
  s2 --> s4: a press on an action: screen a
  s2 --> s5: a press on an action: screen c
  s2 --> s6: Comment
  s3 --> s0: Leave
  s3 --> s1: Comment or Escape: the request mode ends
  s3 --> s7: a press on the screen in the request mode
  s4 --> s0: Escape: the walk ends or Leave
  s4 --> s1: Restart
  s4 --> s2: Back
  s4 --> s9: Comment
  s5 --> s0: Escape: the walk ends or Leave
  s5 --> s1: Restart
  s5 --> s2: Back
  s5 --> s8: a press on done, which has no link
  s5 --> s10: Comment
  s6 --> s0: Leave
  s6 --> s2: Comment or Escape: the request mode ends
  s6 --> s11: a press on the screen in the request mode
  s7 --> s1: Escape: the request closes or Send
  s8 --> s0: Escape: the walk ends or Leave
  s8 --> s1: Restart
  s8 --> s2: Back
  s8 --> s12: Comment
  s8 --> s14: Ask for it
  s9 --> s0: Leave
  s9 --> s4: Comment or Escape: the request mode ends
  s9 --> s13: a press on the screen in the request mode
  s10 --> s0: Leave
  s10 --> s5: Comment or Escape: the request mode ends
  s10 --> s14: a press on the screen in the request mode
  s11 --> s2: Escape: the request closes or Send
  s12 --> s0: Leave
  s12 --> s8: Comment or Escape: the request mode ends
  s12 --> s14: Ask for it
  s12 --> s15: a press on the screen in the request mode
  s13 --> s4: Escape: the request closes or Send
  s14 --> s5: Escape: the request closes or Send
  s15 --> s8: Escape: the request closes or Send
  class s0 tan
  class s1 teal
  class s2 teal
  class s3 teal
  class s4 teal
  class s5 teal
  class s6 teal
  class s7 blue
  class s8 teal
  class s9 teal
  class s10 teal
  class s11 blue
  class s12 teal
  class s13 blue
  class s14 blue
  class s15 blue
```

| Rule                       | In plain words                                                                                       | Spec line                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `TypeOK`                   | Each value is one that the tab can hold. The canvas has no steps; the walk has one at least.         | (model)                                        |
| `EachStepIsALink`          | The walk starts at the first screen, and each next screen comes from a link of the screen before it. | SPEC-flows.md decision 5, rule 21; fact rule 3 |
| `BackShowsTheScreenBefore` | Back shows the screen of the step before.                                                            | SPEC-flows.md rule 20                          |
| `NoLinkKeepsTheScreen`     | A press on an action with no link keeps the screen, and the bar says so.                             | SPEC-flows.md rule 22                          |
| `ARequestStaysOnItsScreen` | While a request is open in the walk, no step changes the screen: the request is on that screen.      | SPEC-flows.md rule 24 (J4)                     |
| `NoLeaveWithARequestOpen`  | Escape with a request open closes the request, and the walk stays.                                   | SPEC-flows.md rule 20                          |
| `NoDeadlock`               | There is always a next step.                                                                         | (model)                                        |

## What the model leaves out

- The outline of the linked actions after a press off each action (rule 23): it changes no state.
- The address of the walk and a reload (rule 18): a reload opens the same steps.
- The time to show the next screen (rule 21): a browser test measures it.
- The locale and the picks of each screen (rule 25): the walk draws as the canvas does.
- A link that breaks while the person walks: [flows-links](flows-links.md) shows the links; a press
  on a broken link acts as a press on an action with no link.

## What the chart shows

- Only a press on an action with a link, Back and Restart change the screen.
- A request opens on the screen that shows, and the walk takes no step until Send or Escape.
- [viewer-walk-any-post](viewer-walk-any-post.md) shows why the viewer takes only an action name
  from the frame.
