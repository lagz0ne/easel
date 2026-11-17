# viewer: a comment while its link ends, its password changes, or its frame changes

The chart follows one comment from the button `Comment` to its pin, while an agent can write or delete the frame and a user can unshare the canvas or set its password. An agent's write leaves an open textbox as it is. An agent's delete leaves it until `Post`, which then answers `gone` and saves nothing. When the link ends, the server pushes the refusal `{ ended: true }`, and the tab shows the ended page at once. When a user sets or changes the password, every pass ends: the server pushes `{ locked: true }`, and the tab goes back to the password page at once. A comment being typed stays on either page, to copy: "not posted" while it was still being typed, "not known if it saved" once `Post` was pressed. The model is [models/viewer/ViewerPin.tla](models/viewer/ViewerPin.tla) with [ViewerPinLink.cfg](models/viewer/ViewerPinLink.cfg), where the link can end and the frame can change, and the socket stays up. TLC checks every rule below on all 122 of its states, and each one holds.

```mermaid
---
title: "Viewer: pin a comment while the link ends, its password changes, or the frame changes"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: idle
    lg1: draft
    lg2: ended
    lg3: locked
  }
  class lg0 teal
  class lg1 blue
  class lg2 pink
  class lg3 yellow
  s0: Comment off
  s1: Comment mode: click a frame
  s2: Ended page
  s3: Textbox open
  s4: Password page
  s5: Posting
  s6: Ended page, your text kept: not posted
  s7: Password page, your text kept: not posted
  s8: Pin Comment #35;n shows
  s9: Status: the frame is gone
  s10: Ended page, your text kept: not known if it saved
  s11: Password page, your text kept: not known if it saved
  s12: Frame gone, with its pin
  [*] --> s0
  s0 --> s1: you press Comment
  s0 --> s2: the pushed refusal arrives [the link ended]
  s1 --> s0: you press Escape or Cancel or an agent deletes the frame
  s1 --> s3: you click a place on the frame
  s0 --> s4: the pushed refusal arrives [a new password ended the pass]
  s1 --> s2: the pushed refusal arrives [the link ended]
  s3 --> s0: you press Escape or Cancel
  s3 --> s5: you press Post
  s1 --> s4: the pushed refusal arrives [a new password ended the pass]
  s3 --> s6: the pushed refusal arrives [the link ended]
  s5 --> s8: Post answers added
  s3 --> s7: the pushed refusal arrives [a new password ended the pass]
  s5 --> s10: the pushed refusal arrives [the link ended] or the call is refused [the link ended]
  s5 --> s9: Post answers gone [the frame was deleted]
  s5 --> s11: the pushed refusal arrives [a new password ended the pass] or the call is refused [a new password ended the pass]
  s8 --> s12: an agent deletes the frame
  s8 --> s2: the pushed refusal arrives [the link ended]
  s8 --> s4: the pushed refusal arrives [a new password ended the pass]
  s9 --> s2: the pushed refusal arrives [the link ended]
  s9 --> s4: the pushed refusal arrives [a new password ended the pass]
  s12 --> s2: the pushed refusal arrives [the link ended]
  s12 --> s4: the pushed refusal arrives [a new password ended the pass]
  class s0 teal
  class s1 blue
  class s2 pink
  class s3 blue
  class s4 yellow
  class s5 blue
  class s6 pink
  class s7 yellow
  class s8 teal
  class s9 teal
  class s10 pink
  class s11 yellow
  class s12 teal
```

| Rule                      | In plain words                                                                                           | Spec line                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `TypeOK`                  | Each value is one the tab or the server can hold.                                                        | (model)                                                                                      |
| `NoTextLost`              | Typed text is never thrown away unsaved: a frame update leaves the textbox, and the ended page keeps it. | SPEC-viewer.md § Pin a comment, step 5; § When the link ends, step 2                         |
| `OnePostOneComment`       | One comment is saved at most once, however often it is sent.                                             | SPEC-viewer.md § Pin a comment, steps 3, 6; judged rule 6                                    |
| `CancelPostsNothing`      | Escape, or the button `Cancel`, closes the textbox and posts nothing.                                    | SPEC-viewer.md § Pin a comment, step 4                                                       |
| `GonePostsNothing`        | If the frame was deleted meanwhile, nothing is posted, and a `status` says the frame is gone.            | SPEC-viewer.md § Pin a comment, step 5                                                       |
| `PinMeansSaved`           | The pin `Comment #<n>` shows only for a saved comment; a deleted frame takes its pins with it.           | SPEC-viewer.md § Watch an agent work, step 3; § Pin a comment, step 3                        |
| `TextboxSaysWhetherSaved` | A textbox that offers `Cancel` has saved nothing. When the page cannot know, the textbox says so.        | SPEC-viewer.md § Pin a comment, steps 6-7; judged rule 6                                     |
| `EndedPageOnly`           | The ended page, and the password page after `{ locked: true }`, show no textbox and no pin.              | SPEC-viewer.md § When the link ends, step 2; § When a password is set, step 2; § Contract    |
| `EndedPageKeepsText`      | The ended page and the password page never say "not posted" of a comment that saved.                     | SPEC-viewer.md § When the link ends, step 2; § When a password is set, step 2; judged rule 7 |
| `NoDeadlock`              | There is always a next step.                                                                             | (model)                                                                                      |

## What the model leaves out

- The socket: it stays up here. A tab whose socket is down learns of the end when it is back ([viewer-gate](viewer-gate.md)); posting with a fault is [viewer-pin-post](viewer-pin-post.md).
- The race between the pushed refusal and a `Post` in flight is in: either can reach the server first.
- An agent moving the frame: a pin's place is relative to its frame, so a move changes nothing here.
- More than one write to the frame: one write shows the rule.
- Other tabs, the comment's text and its number.
- What follows the password page: a right password opens the canvas again ([viewer-gate](viewer-gate.md)). Here the password page is an end, like the ended page.
- Removing the password, which ends no pass.

## Steps the chart hides

- The view hides no step.
- Steps that stay in one chart state are not drawn: "a user unshares the canvas" and "a user sets or changes the password" (the tab changes only when the pushed refusal arrives), "an agent writes the frame" (the textbox stays as it is), "an agent deletes the frame" while the textbox is open (it stays until `Post`), and "nothing more happens" on the ended page or after the comment closed.

## Make it again

```sh
scripts/statecharts.sh viewer-pin-link          # rewrite this page's mermaid block in place if it differs
scripts/statecharts.sh --check viewer-pin-link  # change nothing; compare the block and the verdict in charts.tsv
```
