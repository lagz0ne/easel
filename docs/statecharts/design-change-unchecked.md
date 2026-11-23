# pieces: a change of the design system that does not check the ready frames

This chart has the model of [design-change](design-change.md) with
[DesignChangeUnchecked.cfg](models/pieces/DesignChangeUnchecked.cfg) (`CheckReady = FALSE`): a
`design.put` checks the new folder, but not the ready frames that depend on a changed capsule. TLC
finds that `NoReadyFrameHasATypeError` breaks in 2 steps:

1. An agent sends a folder that changes C. Frame `r` is ready, and it is written for the old shape
   of C.
2. The write makes a new kit version. Frame `r` is ready, and it has a type error.

So `design.put` type-checks each ready frame that depends on a changed capsule, and answers
`breaks` (SPEC-pieces.md § A change of the design system, rule 17). The model has 612 states, more
than the 500 of a chart, so the chart draws only the path to the break.

```mermaid
---
title: "pieces: a change of the design system reaches the frames that depend on it"
---
stateDiagram-v2
  direction LR
  state "Legend" as legend {
    lg0: Breaks NoReadyFrameHasATypeError
    lg1: Path to the NoReadyFrameHasATypeError bug
  }
  class lg0 breaks
  class lg1 bugPath
  state "At the same time" as all {
    state "The design system" as r0 {
      s0: Kit 1, no design.put
      s1: Kit 1, a design.put that changes C
      s2: Kit 2, no design.put
      [*] --> s0
      s0 --> s1: an agent sends a folder that changes C: easel checks it
      s1 --> s2: the write: a new kit version
    }
    --
    state "Frame r, on C" as r1 {
      s3: ready, no type error, draws the current kit
      s4: ready, a type error, draws its last good document
      [*] --> s3
      s3 --> s4: the write: a new kit version [when The design system is Kit 1, a design.put that changes C]
    }
    --
    state "Frame e, on C" as r2 {
      s5: exploring, no type error, draws the current kit
      s6: exploring, a type error, draws its last good document
      [*] --> s5
      s5 --> s6: the write: a new kit version [when The design system is Kit 1, a design.put that changes C]
    }
    --
    state "Frame o, not on C" as r3 {
      s7: draws Kit 1
      [*] --> s7
    }
  }
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 bugPath
  class s1 bugPath
  class s2 breaks
  class s2 bugPath
  class s3 bugPath
  class s4 breaks
  class s4 bugPath
  class s5 bugPath
  class s6 breaks
  class s6 bugPath
  class s7 bugPath
```

| Rule                                                                 | In plain words                                                          | Spec anchor                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `NoReadyFrameHasATypeError`                                          | Breaks: a ready frame has a type error against the current kit version. | SPEC-pieces.md § A change of the design system, rule 17 |
| `TypeOK`, `EachFrameOnCShowsTheNewKit`, `AFrameOffCKeepsItsDocument` | Hold.                                                                   | [design-change](design-change.md)                       |

## What the model leaves out

The same as [design-change](design-change.md).
