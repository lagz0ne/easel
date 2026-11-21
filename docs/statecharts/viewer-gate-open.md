# viewer: open a share link with no password (the first slice)

The same tab as [viewer-gate](viewer-gate.md), as the first slice builds it: every link opens
without a password, and nothing ends a link yet. The page asks for no name: `share.open` answers
`open` with a pass at once, or `gone` for an unknown link, and the page says it has ended. The canvas draws its frames from the live board, with three controls:
Zoom in, Zoom out and Fit, none of which changes a frame. A dropped socket shows "Reconnecting"; the pass is kept as its digest in
SQLite, so it reads again after a restart (decision C8). A link keeps at most 1000 passes: an
open past that ends the link's oldest pass. That tab learns it when its read starts again, on a
reconnect, is refused `{ ended: true }`, and opens the link once more, so it never shows the
ended page for a live link.

The model is [models/viewer/ViewerGate.tla](models/viewer/ViewerGate.tla) with
[ViewerGateOpen.cfg](models/viewer/ViewerGateOpen.cfg): `PasswordLinks = FALSE`,
`Unsharing = FALSE` and `CanvasControls = {"button Zoom in", "button Zoom out", "button Fit"}`. [ViewerGate.cfg](models/viewer/ViewerGate.cfg)
runs the same model with passwords, unshare and the canvas's controls. TLC checks every rule below
on all 10 states of this slice, and each one holds. A rule that no step of the slice reaches holds
with nothing to check: its plain words say what brings it into reach.

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
      s2: Page: this link has ended
      s3: Canvas, status Reconnecting
      [*] --> s0
      s0 --> s1: you open the link [when Link, no password]
      s0 --> s2: you open the link [when Unknown link]
      s1 --> s3: the socket drops
      s1 --> s0: you reload
      s2 --> s0: you reload
      s3 --> s1: the socket is back
      s3 --> s0: the socket is back, its read is refused: ended (your pass was the link's oldest past 1000), so the page opens the link again
    }
    --
    state "Link" as r1 {
      s4: Link, no password
      s5: Unknown link
      [*] --> s4
      [*] --> s5
    }
  }
  class s0 yellow
  class s1 teal
  class s2 pink
  class s3 teal
```

| Rule                             | In plain words                                                                                                                                                                       | Spec line                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `TypeOK`                         | Each value is one the tab or the server can hold.                                                                                                                                    | (model)                                                                               |
| `NoFrameControl`                 | No page of the gate or the canvas shows a control that changes a frame: the canvas has only Zoom in, Zoom out and Fit. By construction (judged in code).                             | SPEC-viewer.md § Objective                                                            |
| `EndedPageOnly`                  | An unknown link shows a page that says it has ended, and no control. By construction (judged in code).                                                                               | SPEC-viewer.md § When the link ends; § Contract                                       |
| `WaitMeansWait`                  | Unreached until passwords: no page says to wait.                                                                                                                                     | SPEC-viewer.md § Open the link, step 2 (the gate: SPEC-frames.md § Open a share link) |
| `NameNotAtTheGate`               | No page of the gate asks for the name: the page sends `share.open` at once. The first request asks for it ([viewer-pin-post](viewer-pin-post.md)). By construction (judged in code). | SPEC-viewer.md § Open the link, step 1; § Contract                                    |
| `EndPushedAtOnce`                | Unreached until `easel unshare` or `easel canvas rm`: no link ends in this slice.                                                                                                    | SPEC-viewer.md § When the link ends, step 1; § Contract                               |
| `EndedStaysEnded`                | Once a tab is told its link ended, it never shows the canvas or a gate again, until you reload.                                                                                      | SPEC-viewer.md § When the link ends, step 2                                           |
| `LockPushedAtOnce`               | Unreached until passwords: no password ends a pass. A pass trimmed past 1000 is not pushed; the tab finds out on its next read.                                                      | SPEC-viewer.md "When a password is set", contract                                     |
| `EndedOnlyWhenGone`              | The ended page shows only for a link that is gone: a tab whose pass was trimmed past 1000 opens the live link again.                                                                 | SPEC-frames.md § Inputs (the 1000-pass cap)                                           |
| `OpenWithoutPasswordIsNeverSlow` | Unreached until passwords: no link asks one.                                                                                                                                         | SPEC-viewer.md § Open the link, step 2 (the gate: SPEC-frames.md § Open a share link) |
| `NoDeadlock`                     | There is always a next step.                                                                                                                                                         | (model)                                                                               |

## What the model leaves out

- Everything [viewer-gate](viewer-gate.md) leaves out.
- A path under `/s/` that is not a link's shape: the page shows that it has ended without a call,
  as an unknown link does.
- A pass that `mayRead` turns away while the link is live and the new one is turned away too:
  the page asks once more, then shows the ended page, so a bug on the server cannot loop it.
  tests/browser/viewer-gate.test.tsx checks it.
- When the trim happens: the model trims only a pass the tab holds on the canvas, and lets the
  refusal come on the next reconnect. A read that starts another way (a reload) gets a new pass
  first.
- The flood limit (SPEC-frames judged rule 14): past 30 opens a minute from one address,
  `share.open` answers `slow`. The page stays on Opening and calls again after `retryIn`. That is
  a stutter in "Opening the link", never the wait page, so `OpenWithoutPasswordIsNeverSlow` holds
  as stated. tests/browser/viewer-gate.test.tsx checks the retry.

## Steps the chart hides

- "you reload" from "Canvas, status Reconnecting", as in [viewer-gate](viewer-gate.md).
- The server trimming the tab's pass: it shows nothing until the socket is back.

## Make it again

```sh
scripts/statecharts.sh viewer-gate-open          # rewrite this page's mermaid block in place if it differs
scripts/statecharts.sh --check viewer-gate-open  # change nothing; compare the block and the verdict in charts.tsv
```
