# viewer: open a share link, with passwords and unshare

The same tab as [viewer-gate](viewer-gate.md), as the share-passwords ship builds it: a link may
ask a password, and `easel unshare` ends a link. The canvas has the three controls that have
shipped, Zoom in, Zoom out and Fit; requests are not built, so this chart leaves out the Request
button and the Requests region that [viewer-gate](viewer-gate.md) lists. Every other step is the
full chart's. The model is [models/viewer/ViewerGate.tla](models/viewer/ViewerGate.tla) with
[ViewerGatePassword.cfg](models/viewer/ViewerGatePassword.cfg). TLC checks every rule below on
all 132 of its states, and each one holds.

```mermaid
---
title: "Viewer: open a share link, and the link ends"
---
stateDiagram-v2
  direction LR
  state "Legend" as legend {
    lg0: gate
    lg1: in
    lg2: ended
  }
  class lg0 yellow
  class lg1 teal
  class lg2 pink
  state "At the same time" as all {
    state "Page" as r0 {
      s0: Opening the link
      s1: Canvas
      s2: Asks the password
      s3: Page: this link has ended
      s4: Canvas, status Reconnecting
      s5: Alert: wait a minute
      [*] --> s0
      s0 --> s1: you open the link [when Link, no password]
      s0 --> s2: you open the link [when Link with a password]
      s0 --> s3: you open the link [when Link ended or Unknown link]
      s1 --> s2: a user sets or changes the password (passes end)
      s1 --> s4: the socket drops
      s1 --> s0: you reload
      s1 --> s3: a user unshares the canvas
      s2 --> s1: you enter the right password [when Link with a password]
      s3 --> s0: you reload
      s2 --> s3: you press Open [when Link ended]
      s4 --> s1: the socket is back [unless Link ended]
      s2 --> s5: you press Open [after 5 wrong tries in a minute: slow]
      s4 --> s3: the socket is back, its read is refused: ended [when Link ended]
      s4 --> s2: the socket is back, its read is refused: locked [when Link with a password]
      s4 --> s0: the socket is back, its read is refused: ended (your pass was the link's oldest past 1000), so the page opens the link again [unless Link ended]
      s5 --> s3: you press Open [when Link ended]
      s5 --> s2: a minute passes from the 5th wrong try
    }
    --
    state "Link" as r1 {
      s6: Link, no password
      s7: Link with a password
      s8: Unknown link
      s9: Link ended
      [*] --> s6
      [*] --> s7
      [*] --> s8
      s6 --> s7: a user sets or changes the password (passes end)
      s6 --> s9: a user unshares the canvas
      s7 --> s9: a user unshares the canvas
    }
  }
  class s0 yellow
  class s1 teal
  class s2 yellow
  class s3 pink
  class s4 teal
  class s5 yellow
```

## Rules

| Rule                             | In plain words                                                                                                                                                                                                                  | Spec line                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `TypeOK`                         | Each value is one the tab or the server can hold.                                                                                                                                                                               | (model)                                                                               |
| `NoFrameControl`                 | No page of the gate or the canvas shows a control that changes a frame: the canvas has only Zoom in, Zoom out and Fit. By construction (judged in code).                                                                        | SPEC-viewer.md § Objective                                                            |
| `EndedPageOnly`                  | An ended or unknown link shows a page that says so, and no control. By construction (judged in code).                                                                                                                           | SPEC-viewer.md § When the link ends; § Contract                                       |
| `WaitMeansWait`                  | While the page says to wait, even the right password does not open the canvas.                                                                                                                                                  | SPEC-viewer.md § Open the link, step 2 (the gate: SPEC-frames.md § Open a share link) |
| `TheLockLastsAMinute`            | The lock lasts a minute from the 5th wrong try, not from the first: the canvas never opens within a minute of a 5th wrong try. The model counts time in ticks, so a lock that ends a minute from the first wrong try breaks it. | SPEC-frames.md § Open a share link, step 2; § Inputs; judged rule 14                  |
| `NameNotAtTheGate`               | No page of the gate asks for the name: the page sends `share.open` at once. The first request asks for it ([viewer-pin-post](viewer-pin-post.md)). By construction (judged in code).                                            | SPEC-viewer.md § Open the link, step 1; § Contract                                    |
| `EndPushedAtOnce`                | A tab with a live socket shows the ended page as soon as the link ends.                                                                                                                                                         | SPEC-viewer.md § When the link ends, step 1; § Contract                               |
| `EndedStaysEnded`                | Once a tab is told its link ended, it never shows the canvas or a gate again.                                                                                                                                                   | SPEC-viewer.md § When the link ends, step 2                                           |
| `LockPushedAtOnce`               | A tab with a live socket goes back to the password page as soon as a password set or changed ends its pass.                                                                                                                     | SPEC-viewer.md "When a password is set", contract                                     |
| `EndedOnlyWhenGone`              | The ended page shows only for a link that is gone: a tab whose pass was trimmed past 1000 opens the live link again.                                                                                                            | SPEC-frames.md § Inputs (the 1000-pass cap)                                           |
| `OpenWithoutPasswordIsNeverSlow` | Opening a password link with no password shows the password page, never the alert to wait.                                                                                                                                      | SPEC-viewer.md § Open the link, step 2 (the gate: SPEC-frames.md § Open a share link) |
| `NoDeadlock`                     | There is always a next step.                                                                                                                                                                                                    | (model)                                                                               |

## What the model leaves out

- Everything [viewer-gate](viewer-gate.md) leaves out, and the requests, until they ship.
- A pass that `mayRead` turns away while the link is live and the new one is turned away too:
  the page asks once more, then shows the ended page, so a bug on the server cannot loop it.
  tests/browser/viewer-gate.test.tsx checks it.
- The flood limit (SPEC-frames judged rule 14): past 30 opens a minute from one address,
  `share.open` answers `slow`. On "Opening the link" the page stays there and calls again after
  `retryIn`, never the wait page, so `OpenWithoutPasswordIsNeverSlow` holds as stated. A password
  try past the flood limit says to wait, as a try past 5 wrong ones does.
- While the page says to wait, Open still calls: the server answers `slow` until a minute from the
  5th wrong try has passed, or `gone` once the link has ended ("you press Open" from "Alert: wait a minute").

## Steps the chart hides

- The steps [viewer-gate](viewer-gate.md) hides.

## Make it again

```sh
scripts/statecharts.sh viewer-gate-password          # rewrite this page's mermaid block in place if it differs
scripts/statecharts.sh --check viewer-gate-password  # change nothing; compare the block and the verdict in charts.tsv
```
