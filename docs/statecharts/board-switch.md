# pieces: the theme switch of the board and of one frame, and a reload

The chart shows one switch, `theme` (`light` or `dark`), in one tab
([SPEC-pieces](../../SPEC-pieces.md#switches-one-state-for-one-frame-or-for-all-frames), rules
10-13). Frames `x` and `y` take the switch; frame `z` does not. A person picks a board value in the
dock, picks a value for one frame in its controls, gives a frame the board value again (`Use the
board`), or reloads. A pick writes the address of the page. Then each frame whose value changes
draws again in a new scope, a little later. A reload takes the values from the address, and each
frame draws again. The model is [models/pieces/BoardSwitch.tla](models/pieces/BoardSwitch.tla) with
[BoardSwitch.cfg](models/pieces/BoardSwitch.cfg) (`FrameInAddress = TRUE`). TLC checks every rule
below on all 324 of its states, and each one holds. The chart draws frame `x` only: frame `y` acts
the same.

```mermaid
---
title: "pieces: the theme switch of the board and of one frame, and a reload"
---
stateDiagram-v2
  direction LR
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
      s3 --> s7: the frame draws in a new scope
      s3 --> s8: a pick in the controls of the frame
      s3 --> s6: Use the board [when The board is Board light]
      s4 --> s2: Use the board [when The board is Board light]
      s4 --> s3: a pick in the controls of the frame
      s4 --> s8: a reload
      s5 --> s3: a pick in the controls of the frame
      s5 --> s8: a pick in the controls of the frame
      s5 --> s9: the frame draws in a new scope
      s5 --> s6: a pick of light in the dock
      s6 --> s3: a pick in the controls of the frame
      s6 --> s8: a pick in the controls of the frame
      s6 --> s5: a pick of dark in the dock
      s6 --> s2: the frame draws in a new scope
      s3 --> s5: Use the board [when The board is Board dark]
      s7 --> s3: a reload
      s7 --> s8: a pick in the controls of the frame
      s7 --> s6: Use the board [when The board is Board light]
      s8 --> s5: Use the board [when The board is Board dark]
      s8 --> s3: a pick in the controls of the frame
      s8 --> s4: the frame draws in a new scope
      s4 --> s5: Use the board [when The board is Board dark]
      s8 --> s6: Use the board [when The board is Board light]
      s9 --> s7: a pick in the controls of the frame
      s9 --> s8: a pick in the controls of the frame
      s9 --> s5: a reload
      s9 --> s6: a pick of light in the dock
      s7 --> s9: Use the board [when The board is Board dark]
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
```

| Rule                            | In plain words                                                                                                           | Spec anchor                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `TypeOK`                        | Each value is one that the tab can hold.                                                                                 | (model)                                                                 |
| `EachFrameShowsItsValue`        | When a frame that takes the switch drew after the last pick, it shows its own value if it has one, else the board value. | § Switches, rules 11 and 12; § Model, second model, rule 1; criterion 8 |
| `AFrameOffTheSwitchNeverDraws`  | Frame `z` draws again only for a reload, never for a pick.                                                               | § Switches, rule 11; § Model, second model, rule 2                      |
| `AReloadShowsEachFrameAsBefore` | After a reload, each frame shows the value that it showed before: the board value and each frame value.                  | § Switches, rule 13; § Model, second model, rule 3; criterion 8         |
| `EachFrameDrawsInTheEnd`        | Each frame that waits to draw again draws (with fairness on the draw).                                                   | § Switches, rule 11; criterion 8                                        |
| `NoDeadlock`                    | There is always a next step.                                                                                             | (model)                                                                 |

## What the model leaves out

- More switches and values. `locale` and `fixture` act as `theme` does. A frame with no fixture of
  the board name keeps its own value: that is a frame value here.
- More tabs. The values are of the tab, so each tab acts on its own.
- A link that opens with values in its address. It is a reload with those values.
- The pages of a canvas: a board value stays when the person goes to another page
  (SPEC-pages.md § The viewer, rule 13). [viewer-pages](viewer-pages.md) proves the page of a tab.
- The look of each theme, and how a frame draws: one new scope with the value.

## What the chart shows

- A board pick makes a frame draw again only when it uses the board value. A frame with its own
  value does not draw for a board pick.
- A frame pick and `Use the board` make only that frame draw again.
- A reload makes each frame draw again, frame `z` too, with the same values.
- [board-switch-board-only](board-switch-board-only.md) shows why the address holds the frame
  values.
