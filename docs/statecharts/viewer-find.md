# viewer: find a frame by its name, from the dock

The chart follows Find in one tab (SPEC-viewer.md § Find a frame; docs/epics.md E3 S15, option A, decided on 2026-11-23). The button `Find` in the dock, or the key `/`, opens a list of frame names over the dock, as Miro and Excalidraw do. The viewer types a part of a name, and the list shows the names that have it. Enter or a click takes the selected name: the list closes, the canvas shows that frame, and the frame is marked. Escape or `Find` closes the list with no change. A pan or a zoom ends the mark. The model is [models/viewer/FindFrame.tla](models/viewer/FindFrame.tla) with [FindFrame.cfg](models/viewer/FindFrame.cfg).

```mermaid
---
title: "viewer: find a frame by its name, from the dock"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: closed
    lg1: open
  }
  class lg0 tan
  class lg1 teal
  s0: List closed, the canvas shows another place
  s1: List open, names match, the canvas shows another place
  s2: List closed, the frame is marked, the canvas shows the frame
  s3: List open, no name matches, the canvas shows another place
  s4: List open, names match, the frame is marked, the canvas shows the frame
  s5: List open, no name matches, the frame is marked, the canvas shows the frame
  [*] --> s0
  s0 --> s1: the viewer presses Find, or the key /: the list opens with all names
  s1 --> s0: Escape, or Find again: the list closes
  s1 --> s2: Enter, or a click on a name: the canvas shows the frame, and marks it
  s1 --> s3: the viewer types: no name has the text
  s2 --> s0: the viewer pans or zooms: the mark ends
  s2 --> s4: the viewer presses Find, or the key /: the list opens with all names
  s3 --> s1: the viewer types: some names have the text
  s3 --> s0: Escape, or Find again: the list closes
  s4 --> s2: Escape, or Find again: the list closes or Enter, or a click on a name: the canvas shows the frame, and marks it
  s4 --> s1: the viewer pans or zooms: the mark ends
  s4 --> s5: the viewer types: no name has the text
  s5 --> s4: the viewer types: some names have the text
  s5 --> s3: the viewer pans or zooms: the mark ends
  s5 --> s2: Escape, or Find again: the list closes
  class s0 tan
  class s1 teal
  class s2 tan
  class s3 teal
  class s4 teal
  class s5 teal
```

## The rules

- **AMarkIsInView**: a frame is marked only while the canvas shows it.
- **ATakeNeedsAName**: the list takes a name only when the typed text matches one.
- **OnlyATakeOrAPanMovesTheCanvas**: the canvas moves only for a take or a pan. Opening the list, typing and closing it never move it.

## What the model leaves out

- Which names match, and their order: the page tests prove it (SPEC-viewer.md § Find a frame).
- A frame that an agent adds or removes while the list is open: the list reads the board each time.
