# viewer: open a share link, and the link ends

The chart shows a tab from the moment it opens a share link until it shows the canvas or the ended page. The page asks for no name: it calls `share.open` with the link at once, and sends the viewer's name too if the browser kept one. The first request asks for the name ([viewer-pin-post](viewer-pin-post.md)). A password link always asks for the password first: opening it never answers `slow`. Within a minute, password tries 1 to 5 that are wrong answer `wrong`, and any try after 5 wrong ones answers `slow`, even the right password. When a user unshares the canvas, the server pushes the refusal `{ ended: true }` to each tab on the link with a live socket. When a user sets or changes the password, every pass ends, and the server pushes `{ locked: true }`: the tab goes back to the password page. A tab whose socket was down learns either from its read when the socket is back. A link keeps at most 1000 passes, and an open past that ends the link's oldest pass with no push: that tab learns it from its read when the socket is back, and opens the link again. The model is [models/viewer/ViewerGate.tla](models/viewer/ViewerGate.tla) with [ViewerGate.cfg](models/viewer/ViewerGate.cfg). TLC checks every rule below on all 86 of its states, and each one holds.

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
      s4 --> s3: the socket is back, its read is refused: ended [when Link ended]
      s4 --> s2: the socket is back, its read is refused: locked [when Link with a password]
      s2 --> s5: you press Open [after 5 wrong tries in a minute: slow]
      s4 --> s0: the socket is back, its read is refused: ended (your pass was the link's oldest past 1000), so the page opens the link again [unless Link ended]
      s5 --> s2: a minute passes
      s5 --> s3: you press Open [when Link ended]
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

| Rule                             | In plain words                                                                                                                                                                       | Spec line                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `TypeOK`                         | Each value is one the tab or the server can hold.                                                                                                                                    | (model)                                                                               |
| `NoFrameControl`                 | No page of the gate or the canvas shows a control that changes a frame. By construction (judged in code).                                                                            | SPEC-viewer.md § Objective                                                            |
| `EndedPageOnly`                  | An ended or unknown link shows a page that says so, and no control. By construction (judged in code).                                                                                | SPEC-viewer.md § When the link ends; § Contract                                       |
| `WaitMeansWait`                  | While the page says to wait, even the right password does not open the canvas.                                                                                                       | SPEC-viewer.md § Open the link, step 2 (the gate: SPEC-frames.md § Open a share link) |
| `NameNotAtTheGate`               | No page of the gate asks for the name: the page sends `share.open` at once. The first request asks for it ([viewer-pin-post](viewer-pin-post.md)). By construction (judged in code). | SPEC-viewer.md § Open the link, step 1; § Contract                                    |
| `EndPushedAtOnce`                | A tab with a live socket shows the ended page as soon as the link ends.                                                                                                              | SPEC-viewer.md § When the link ends, step 1; § Contract                               |
| `EndedStaysEnded`                | Once a tab is told its link ended, it never shows the canvas or a gate again.                                                                                                        | SPEC-viewer.md § When the link ends, step 2                                           |
| `LockPushedAtOnce`               | A tab with a live socket goes back to the password page as soon as a password set or changed ends its pass.                                                                          | SPEC-viewer.md "When a password is set", contract                                     |
| `EndedOnlyWhenGone`              | The ended page shows only for a link that is gone: a tab whose pass was trimmed past 1000 opens the live link again.                                                                 | SPEC-frames.md § Inputs (the 1000-pass cap)                                           |
| `OpenWithoutPasswordIsNeverSlow` | Opening a password link with no password shows the password page, never the alert to wait.                                                                                           | SPEC-viewer.md § Open the link, step 2 (the gate: SPEC-frames.md § Open a share link) |
| `NoDeadlock`                     | There is always a next step.                                                                                                                                                         | (model)                                                                               |

## What the model leaves out

- The text the page shows on each page, and the `alert` text.
- The name this browser kept: it goes with `share.open`, and changes nothing the tab shows.
- Time, except as "a minute passes": the lockout is 2 wrong tries in the model, 5 in the spec.
- Many tabs: the model has one tab. Each tab on the link acts the same.
- Removing the password, which ends no pass: the tab stays as it is.
- Atomicity: the server's push of `{ ended: true }` or `{ locked: true }` to a tab with a live socket is one step with the write that ends the link or the pass. The code must push in the same request, before it answers.
- `NoFrameControl` and `EndedPageOnly` hold by construction: the model lists each page's controls, and no variant breaks them. The code is judged against them.
- A link shared again after it ended: it is a new link, so a new run of this chart.
- The canvas itself: [viewer-canvas](viewer-canvas.md), [viewer-pin-post](viewer-pin-post.md), [viewer-pin-link](viewer-pin-link.md) and [viewer-queue](viewer-queue.md).

## Steps the chart hides

- "you reload" from a gate page and from "Canvas, status Reconnecting". Each goes back to "Opening the link", which the reload from the canvas and the ended page already shows.
- Steps that stay in one chart state are not drawn: a wrong try 1 to 5 in a minute (it answers `wrong`; the `alert` shows on "Asks the password"), a password set or changed while the tab is not on the connected canvas, a minute passing on a page that is not waiting, and the server trimming the tab's pass (it shows nothing until the socket is back).

## Make it again

```sh
scripts/statecharts.sh viewer-gate          # rewrite this page's mermaid block in place if it differs
scripts/statecharts.sh --check viewer-gate  # change nothing; compare the block and the verdict in charts.tsv
```
