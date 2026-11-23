# viewer: the pick of a request that opens the page of the request

This chart has the model of [viewer-pages](viewer-pages.md) with
[ViewerPagesOldPage.cfg](models/pages/ViewerPagesOldPage.cfg) (`RequestPick = "byOldPage"`): the
pick of a request opens the page that the request names, the page of the frame when the request
was made. TLC finds that `APickShowsThePageOfTheFrame` breaks in 3 steps:

1. The tab shows Page 1. A person picks the request on `m`. The tab loads Page 2, the page of the
   request.
2. An agent moves `m` to Page 1.
3. The answer comes. The tab shows Page 2, and `m` is not there.

A move before the pick breaks it too, in 4 steps. So the pick of a request asks the server for its
frame, and the answer gives the page where the frame is now (SPEC-pages.md § The viewer, rule 10).
The name of the page in the Requests panel is only a label.

```mermaid
---
title: "viewer: the pages of a canvas, a frame that moves, and the picks of a tab"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: shows the page
    lg1: loads a page
    lg2: asks for a frame
    lg3: Breaks APickShowsThePageOfTheFrame
    lg4: Path to the APickShowsThePageOfTheFrame bug
  }
  class lg0 teal
  class lg1 tan
  class lg2 yellow
  class lg3 breaks
  class lg4 bugPath
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
    s12: each frame of the page, the picked frame not there
    s13: a move not shown yet, the picked frame marked
    s14: a move not shown yet
    s15: a move not shown yet, the picked frame not there
  }
  [*] --> s1
  s1 --> s2: a pick in Find
  s1 --> s3: the answer comes
  s2 --> s1: a pick of Page 1 in the list or a reload
  s2 --> s10: the answer comes
  s8 --> s9: a pick in Find
  s8 --> s10: the answer comes
  s8 --> s8: an agent moves m to the other page
  s3 --> s1: a pick of Page 1 in the list or a reload
  s3 --> s2: a pick in Find
  s3 --> s4: an agent moves m to the other page
  s8 --> s11: the answer comes
  s2 --> s5: the answer comes
  s9 --> s8: a pick of the request on m or a pick of Page 2 in the list or a reload
  s9 --> s10: the answer comes
  s10 --> s8: a pick of the request on m or a pick of Page 2 in the list or a reload
  s10 --> s9: a pick in Find
  s10 --> s13: an agent moves m to the other page
  s8 --> s12: the answer comes
  s4 --> s1: a pick of Page 1 in the list or a reload
  s4 --> s3: the move reaches the tab
  s4 --> s2: a pick in Find
  s11 --> s8: a pick of the request on m or a pick of Page 2 in the list or a reload
  s11 --> s9: a pick in Find
  s11 --> s14: an agent moves m to the other page
  s9 --> s5: the answer comes
  s5 --> s1: a pick of Page 1 in the list or a reload
  s5 --> s2: a pick in Find
  s5 --> s6: an agent moves m to the other page
  s12 --> s8: a pick of the request on m or a pick of Page 2 in the list or a reload
  s12 --> s9: a pick in Find
  s12 --> s15: an agent moves m to the other page
  s13 --> s8: a pick of the request on m or a pick of Page 2 in the list or a reload
  s13 --> s11: the move reaches the tab
  s13 --> s9: a pick in Find
  s14 --> s8: a pick of the request on m or a pick of Page 2 in the list or a reload
  s14 --> s11: the move reaches the tab
  s14 --> s9: a pick in Find
  s6 --> s1: a pick of Page 1 in the list or a reload
  s6 --> s2: a pick in Find
  s6 --> s5: the move reaches the tab
  s13 --> s10: the move reaches the tab
  s6 --> s3: the move reaches the tab
  s15 --> s8: a reload or a pick of the request on m or a pick of Page 2 in the list
  s15 --> s9: a pick in Find
  s15 --> s12: the move reaches the tab
  s15 --> s11: the move reaches the tab
  s0 --> s8: a pick of the request on m or a pick of Page 2 in the list
  s7 --> s1: a pick of Page 1 in the list
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s1 tan
  class s1 bugPath
  class s2 yellow
  class s3 teal
  class s4 teal
  class s5 teal
  class s6 teal
  class s8 tan
  class s8 bugPath
  class s9 yellow
  class s10 teal
  class s11 teal
  class s12 teal
  class s12 breaks
  class s12 bugPath
  class s13 teal
  class s14 teal
  class s15 teal
```

| Rule                                                                                         | In plain words                                                               | Spec anchor                                      |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| `APickShowsThePageOfTheFrame`                                                                | Breaks: the tab shows the old page of the frame, and the frame is not there. | SPEC-pages.md § The viewer, rule 10; criterion 3 |
| `TypeOK`, `ATabShowsOnePageAndEachOfItsFrames`, `AReloadShowsTheSamePage`, `TheTabCatchesUp` | Hold.                                                                        | [viewer-pages](viewer-pages.md)                  |

## What the model leaves out

The same as [viewer-pages](viewer-pages.md). TLC checks this config on 76 states.
