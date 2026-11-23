# viewer: the pages of a canvas, a frame that moves, and the picks of a tab

The chart shows one tab of the viewer on a canvas with two pages
([SPEC-pages](../../SPEC-pages.md#the-viewer), rules 7-10). Frame `s` stays on Page 1. Frame `m`
starts on Page 2, and an agent moves it from page to page at any time. The tab loads the frames of
one page only. A move reaches the tab as an event on the socket, a little later. A person picks a
page in the list, picks the request on `m` in the Requests panel, picks a frame in Find, or
reloads. A pick of a frame asks the server for the frame: the answer gives the page where the
frame is now and the frames of that page, in one read. The model is
[models/pages/ViewerPages.tla](models/pages/ViewerPages.tla) with
[ViewerPages.cfg](models/pages/ViewerPages.cfg) (`RequestPick = "byFrame"`). TLC checks every
rule below on all 66 of its states, and each one holds. The chart draws 12 of them: it does not
show on which page `m` is.

```mermaid
---
title: "viewer: the pages of a canvas, a frame that moves, and the picks of a tab"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: shows the page
    lg1: loads a page
    lg2: asks for a frame
  }
  class lg0 teal
  class lg1 tan
  class lg2 yellow
  state "Page 1" as s0 {
    s1: loading its frames
    s2: asks for the picked frame
    s3: each frame of the page
    s4: a move not shown yet
    s5: each frame of the page, the picked frame marked
    s6: a move not shown yet, the picked frame marked
  }
  state "Page 2" as s7 {
    s8: loading its frames
    s9: asks for the picked frame
    s10: each frame of the page, the picked frame marked
    s11: each frame of the page
    s12: a move not shown yet, the picked frame marked
    s13: a move not shown yet
  }
  [*] --> s1
  s1 --> s2: a pick in Find or a pick of the request on m
  s1 --> s3: the answer comes
  s2 --> s1: a pick of Page 1 in the list or a reload
  s2 --> s10: the answer comes
  s3 --> s1: a pick of Page 1 in the list or a reload
  s3 --> s2: a pick in Find or a pick of the request on m
  s3 --> s4: an agent moves m to the other page
  s8 --> s9: a pick in Find or a pick of the request on m
  s8 --> s11: the answer comes
  s2 --> s5: the answer comes
  s9 --> s8: a pick of Page 2 in the list or a reload
  s9 --> s10: the answer comes
  s10 --> s8: a pick of Page 2 in the list or a reload
  s10 --> s9: a pick in Find or a pick of the request on m
  s10 --> s12: an agent moves m to the other page
  s4 --> s1: a pick of Page 1 in the list or a reload
  s4 --> s3: the move reaches the tab
  s4 --> s2: a pick in Find or a pick of the request on m
  s11 --> s8: a pick of Page 2 in the list or a reload
  s11 --> s9: a pick in Find or a pick of the request on m
  s11 --> s13: an agent moves m to the other page
  s9 --> s5: the answer comes
  s5 --> s1: a pick of Page 1 in the list or a reload
  s5 --> s2: a pick in Find or a pick of the request on m
  s5 --> s6: an agent moves m to the other page
  s12 --> s8: a pick of Page 2 in the list or a reload
  s12 --> s11: the move reaches the tab
  s12 --> s9: a pick in Find or a pick of the request on m
  s13 --> s8: a pick of Page 2 in the list or a reload
  s13 --> s11: the move reaches the tab
  s13 --> s9: a pick in Find or a pick of the request on m
  s6 --> s1: a pick of Page 1 in the list or a reload
  s6 --> s2: a pick in Find or a pick of the request on m
  s6 --> s5: the move reaches the tab
  s12 --> s10: the move reaches the tab
  s6 --> s3: the move reaches the tab
  s0 --> s8: a pick of Page 2 in the list
  s7 --> s1: a pick of Page 1 in the list
  class s1 tan
  class s2 yellow
  class s3 teal
  class s4 teal
  class s5 teal
  class s6 teal
  class s8 tan
  class s9 yellow
  class s10 teal
  class s11 teal
  class s12 teal
  class s13 teal
```

| Rule                                 | In plain words                                                                                                                          | Spec anchor                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `TypeOK`                             | Each frame is on one page; `s` stays on Page 1. The tab holds one page.                                                                 | SPEC-pages.md § Fact rules, rule 1                         |
| `ATabShowsOnePageAndEachOfItsFrames` | When the tab has its answer and each move, it draws exactly the frames of its page: no frame of the other page, and no frame missing.   | § The viewer, rules 7 and 12; § Model, rule 1; criterion 2 |
| `APickShowsThePageOfTheFrame`        | After a pick of the request or of a found frame, the tab shows the page where the frame is now, and marks the frame. Also after a move. | § The viewer, rules 9 and 10; § Model, rule 2; criterion 3 |
| `AReloadShowsTheSamePage`            | A reload shows the page that the tab showed before it, also during a pick. The address names that page.                                 | § The viewer, rule 8; § Model, rule 3; criterion 4         |
| `TheTabCatchesUp`                    | Each load ends, and each move reaches the tab (with fairness on the answer and on the event of a move).                                 | § The place of a frame, rule 5; criterion 2                |
| `NoDeadlock`                         | There is always a next step.                                                                                                            | (model)                                                    |

## What the model leaves out

- More frames and more pages. One frame that moves and one that stays show each case of a page:
  a frame comes, a frame goes, a frame stays.
- More tabs. Each tab loads and gets the events on its own.
- The place (`x`, `y`) of a frame, pan and zoom, and Fit. A move in the same page changes no page.
- The create, rename, order and delete of pages. A delete of a page with frames is refused, so
  the page of a tab always has its frames.
- An event that comes during a load: the answer of the load is newer, so the tab applies the
  event again with no change.
- The list of Find and the Requests panel: [viewer-find](viewer-find.md) and
  [viewer-queue](viewer-queue.md) prove them. Here a pick is one step.

## What the chart shows

- A pick of a page loads its frames. The pick of a frame keeps the old page on the screen until
  the answer, then shows the page of the frame, with the frame marked.
- When a move takes the marked frame off the page, the tab stays on its page, and the mark ends.
  The tab does not follow the frame.
- A reload goes to "loading its frames" in the same page. The mark is not in the address, so it
  ends.
- [viewer-pages-old-page](viewer-pages-old-page.md) shows why the pick of a request asks for the
  frame, and does not open the page that the request names.
