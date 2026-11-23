# pieces: an address that holds the board value only

This chart has the model of [board-switch](board-switch.md) with
[BoardSwitchBoardOnly.cfg](models/pieces/BoardSwitchBoardOnly.cfg) (`FrameInAddress = FALSE`):
the address holds the board value, but not the frame values. TLC finds that
`AReloadShowsEachFrameAsBefore` breaks in 2 steps:

1. The board is `light`. A person picks `dark` in the controls of frame `x`.
2. A reload. Frame `x` uses the board value again, and shows `light`.

So the address holds each frame value too (`?theme=dark&f.<frame>.theme=light`, SPEC-pieces.md §
Switches, rule 13).

```mermaid
---
title: "pieces: the theme switch of the board and of one frame, and a reload"
---
stateDiagram-v2
  direction LR
  state "Legend" as legend {
    lg0: Path to the AReloadShowsEachFrameAsBefore bug
  }
  class lg0 bugPath
  state "At the same time" as all {
    state "The board" as r0 {
      s0: Board light
      s1: Board dark
      [*] --> s0
      s0 --> s1: a pick of dark in the dock
      s1 --> s0: a pick of light in the dock
    }
    --
    state "Frame x (y is the same)" as r1 {
      s2: the board value light, drawn
      s3: its own value dark, draws again
      s4: its own value light, drawn
      s5: the board value dark, draws again
      s6: the board value light, draws again
      s7: its own value dark, drawn
      s8: its own value light, draws again
      s9: the board value dark, drawn
      [*] --> s2
      s2 --> s3: a pick in the controls of the frame
      s2 --> s4: a pick in the controls of the frame
      s2 --> s5: a pick of dark in the dock
      s2 --> s6: a reload
      s3 --> s6: a reload or Use the board [when The board is Board light]
      s3 --> s7: the frame draws in a new scope
      s3 --> s8: a pick in the controls of the frame
      s4 --> s2: Use the board [when The board is Board light]
      s4 --> s3: a pick in the controls of the frame
      s4 --> s6: a reload [when The board is Board light]
      s5 --> s3: a pick in the controls of the frame
      s5 --> s8: a pick in the controls of the frame
      s5 --> s9: the frame draws in a new scope
      s5 --> s6: a pick of light in the dock
      s6 --> s3: a pick in the controls of the frame
      s6 --> s8: a pick in the controls of the frame
      s6 --> s5: a pick of dark in the dock
      s6 --> s2: the frame draws in a new scope
      s3 --> s5: Use the board or a reload [when The board is Board dark]
      s7 --> s8: a pick in the controls of the frame
      s7 --> s6: a reload or Use the board [when The board is Board light]
      s8 --> s5: Use the board or a reload [when The board is Board dark]
      s8 --> s3: a pick in the controls of the frame
      s8 --> s4: the frame draws in a new scope
      s4 --> s5: Use the board or a reload [when The board is Board dark]
      s8 --> s6: a reload or Use the board [when The board is Board light]
      s9 --> s7: a pick in the controls of the frame
      s9 --> s8: a pick in the controls of the frame
      s9 --> s5: a reload
      s9 --> s6: a pick of light in the dock
      s7 --> s9: Use the board [when The board is Board dark]
      s7 --> s5: a reload [when The board is Board dark]
    }
    --
    state "Frame z, no switch" as r2 {
      s10: drawn
      s11: draws again
      [*] --> s10
      s10 --> s11: a reload
      s11 --> s10: the frame draws in a new scope
    }
  }
  class s0 bugPath
  class s2 bugPath
  class s3 bugPath
  class s6 bugPath
  class s10 bugPath
  class s11 bugPath
```

| Rule                                                                                         | In plain words                               | Spec anchor                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------- |
| `AReloadShowsEachFrameAsBefore`                                                              | Breaks: a reload loses the value of a frame. | SPEC-pieces.md § Switches, rule 13 |
| `TypeOK`, `EachFrameShowsItsValue`, `AFrameOffTheSwitchNeverDraws`, `EachFrameDrawsInTheEnd` | Hold.                                        | [board-switch](board-switch.md)    |

## What the model leaves out

The same as [board-switch](board-switch.md). TLC checks this config on 324 states.
