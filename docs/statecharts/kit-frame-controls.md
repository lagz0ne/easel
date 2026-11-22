# kit: a person changes the state of an app frame with its controls

The chart shows the controls of one app frame in one tab (SPEC-kit.md § The capsules, "The controls in the viewer"). The frame's file declares its controls: each one runs an operation of the frame, and it can show the value of a cell. When a document gets its port, it posts its controls with their values. After each change of a value, it posts the values again. The page draws the controls in a panel. A change in the panel goes on the port and runs the operation in the live scope, so the frame is not composed again. A new version, another pick of the axes, or a return into view gives a new document, whose values start again. The page takes posts only from the current document, and the port of an old document closes, so a message on it is lost. The model is [models/kit/FrameControls.tla](models/kit/FrameControls.tla) with [FrameControls.cfg](models/kit/FrameControls.cfg).

```mermaid
---
title: "kit: a person changes the state of an app frame with its controls"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: away
    lg1: waiting
    lg2: shows
    lg3: syncing
  }
  class lg0 tan
  class lg1 yellow
  class lg2 teal
  class lg3 blue
  s0: the frame is not live
  s1: the frame is live#59; its controls are on the way
  s2: the panel shows the controls and the value of the app
  s3: the panel shows the controls#59; a change is on the way
  [*] --> s0
  s0 --> s1: the frame comes into view: a new document
  s1 --> s0: the frame leaves the view: its port closes
  s1 --> s2: a post of the document reaches the panel
  s1 --> s3: a post of the document reaches the panel
  s2 --> s0: the frame leaves the view: its port closes
  s2 --> s1: a new version or another pick: a new document#59; the old port closes
  s2 --> s3: the person presses an action in the panel or the person sets the value in the panel or the app changes the value by itself, then posts its values
  s3 --> s0: the frame leaves the view: its port closes
  s3 --> s1: a new version or another pick: a new document#59; the old port closes
  s3 --> s2: a post of the document reaches the panel
  class s0 tan
  class s1 yellow
  class s2 teal
  class s3 blue
```

## The rules

- **TheControlsAreOfTheCurrentDocument**: the panel shows only the controls of the frame's current document.
- **AControlGoesOnlyToTheCurrentDocument**: a message from the page goes only to the current document, whose controls the panel shows.
- **WhenQuietThePanelShowsTheValue**: with no message on the way, the panel shows the value that the app has.
- **ThePanelComesToShowTheValue**: a panel that shows another value than the app comes to show it, unless the document goes first.
