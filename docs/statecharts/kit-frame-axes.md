# kit: a person picks the locale and the data state of the capsule frames

The chart shows the capsule frames of one canvas in one tab (SPEC-kit.md § The capsules, "The axes in the viewer"). A capsule frame tells the page what it can show: when it gets its port, it posts its axes, the locales and the values of its capsule's config. The locale is one pick for the canvas, and the data state is a pick for each frame. The page composes a frame with the picks only after that frame version posted its axes, and only with the values that it posted. A pick that differs from the live document gives a new document, so the frame draws in a new scope. A frame that posts no axes is never composed again for a pick. A new version can drop a data state: a pick of it falls back to the frame's default. The model is [models/kit/FrameAxes.tla](models/kit/FrameAxes.tla) with [FrameAxes.cfg](models/kit/FrameAxes.cfg).

```mermaid
---
title: "kit: a person picks the locale and the data state of the capsule frames"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: away
    lg1: starting
    lg2: shows
    lg3: behind
  }
  class lg0 tan
  class lg1 yellow
  class lg2 teal
  class lg3 blue
  s0: Version 1: the capsule frame is not live
  s1: Version 2: the capsule frame is not live
  s2: Version 1: the capsule frame is live and has posted no axes yet
  s3: Version 2: the capsule frame is live and has posted no axes yet
  s4: Version 1: the capsule frame shows the picks
  s5: Version 2: the capsule frame shows the picks
  s6: Version 1: the capsule frame shows other axes than the picks
  s7: Version 2: the capsule frame shows other axes than the picks
  [*] --> s0
  s0 --> s1: an agent puts version 2: it has no data state empty
  s0 --> s2: the capsule frame comes into view: the page composes it with the picks
  s1 --> s3: the capsule frame comes into view: the page composes it with the picks
  s2 --> s0: the capsule frame leaves the view
  s2 --> s3: an agent puts version 2: it has no data state empty
  s2 --> s4: the capsule frame gets its port and posts its axes
  s3 --> s1: the capsule frame leaves the view
  s3 --> s5: the capsule frame gets its port and posts its axes
  s4 --> s3: an agent puts version 2: it has no data state empty
  s4 --> s0: the capsule frame leaves the view
  s4 --> s6: the person picks Vietnamese or the person picks the data state empty or the person picks the data state many or the person picks English
  s0 --> s4: the capsule frame comes into view: the page composes it with the picks
  s5 --> s1: the capsule frame leaves the view
  s5 --> s7: the person picks Vietnamese or the person picks the data state many or the person picks English
  s6 --> s4: the person picks English or the page composes the capsule frame again: a new scope or the person picks Vietnamese or the person picks the data state many or the person picks the data state empty
  s6 --> s3: an agent puts version 2: it has no data state empty
  s6 --> s0: the capsule frame leaves the view
  s3 --> s7: the capsule frame gets its port and posts its axes
  s1 --> s5: the capsule frame comes into view: the page composes it with the picks
  s7 --> s5: the person picks English or the page composes the capsule frame again: a new scope or the person picks Vietnamese
  s7 --> s1: the capsule frame leaves the view
  class s0 tan
  class s1 tan
  class s2 yellow
  class s3 yellow
  class s4 teal
  class s5 teal
  class s6 blue
  class s7 blue
```

## Rules

- **APlainFrameIgnoresThePicks:** a frame that posts no axes is never composed again for a pick, so a pick does not reload it.
- **ADocumentShowsOnlyOfferedValues:** a document shows only a data state that its version posted.
- **APickIsAValueOfTheVersion:** the pick of a data state is always one that the current version has, or none.
- **ALiveFrameComesToShowThePicks:** a live frame whose document differs from the picks comes to show them, unless it leaves the view first.

## What the model leaves out

- The close of the old document before the new one goes. That is the chart [kit-app-frame](kit-app-frame.md), and the page does not do it yet (SPEC-kit § The capsules, "The axes in the viewer").
- The picture of a frame that is not live. It shows the frame's default axes.
- More than two locales, more than one config key, and other tabs: each tab keeps its own picks.
