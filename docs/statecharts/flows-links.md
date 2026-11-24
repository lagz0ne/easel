# flows: the links of a flow, and the changes that break them

The chart follows two links of a flow while an agent changes its screens
([SPEC-flows](../../SPEC-flows.md) rules 1 to 11, J6 and J8). The action `send` of screen a leads
to screen b, and the action `next` of b leads to c. The agent puts a version of a with no `send`,
and one with it again; moves c to page 2 and back; and deletes c. After each change, easel finds
the state of each link of the screen and to it again, and the answer names each link that the
change broke. The model is [models/flows/Links.tla](models/flows/Links.tla) with
[Links.cfg](models/flows/Links.cfg) (`CheckActions = TRUE`). TLC checks every rule below on all 14
of its states, and each one holds.

```mermaid
---
title: "flows: the links of a flow, and the changes that break them"
---
stateDiagram-v2
  direction LR
  state "At the same time" as all {
    state "The link send of a to b" as r0 {
      s0: whole
      s1: broken: no action send
      [*] --> s0
      s0 --> s1: a put of a with no action send
      s1 --> s0: a put of a with the action send
    }
    --
    state "The link next of b to c" as r1 {
      s2: whole
      s3: broken: the screen is on another page
      s4: broken: the screen is gone
      [*] --> s2
      s2 --> s3: a move of c to page 2
      s2 --> s4: a delete of c
      s3 --> s2: a move of c to page 1
      s3 --> s4: a delete of c
    }
    --
    state "The screens" as r2 {
      s5: a has send, c on page 1
      s6: a has no send, c on page 1
      s7: a has send, c on page 2
      s8: a has send, c is gone
      s9: a has no send, c on page 2
      s10: a has no send, c is gone
      [*] --> s5
      s5 --> s6: a put of a with no action send
      s5 --> s7: a move of c to page 2
      s5 --> s8: a delete of c
      s6 --> s5: a put of a with the action send
      s6 --> s9: a move of c to page 2
      s6 --> s10: a delete of c
      s7 --> s5: a move of c to page 1
      s7 --> s9: a put of a with no action send
      s7 --> s8: a delete of c
      s8 --> s10: a put of a with no action send
      s9 --> s6: a move of c to page 1
      s9 --> s10: a delete of c
      s9 --> s7: a put of a with the action send
      s10 --> s8: a put of a with the action send
    }
    --
    state "The answer of the last change" as r3 {
      s11: no broken link
      s12: broken: send of a to b
      s13: broken: next of b to c
      [*] --> s11
      s11 --> s12: a put of a with no action send [when The link send of a to b is whole and The screens is none of a has no send, c is gone, a has no send, c on page 1]
      s11 --> s13: a move of c to page 2 or a delete of c [when The link next of b to c is whole and The screens is one of a has no send, c on page 1, a has send, c on page 1]
      s12 --> s11: a put of a with the action send
      s12 --> s13: a move of c to page 2 or a delete of c [when The link next of b to c is whole and The screens is a has no send, c on page 1]
      s13 --> s11: a move of c to page 1 or a delete of c [when The link next of b to c is broken: the screen is on another page and The screens is one of a has no send, c on page 2, a has send, c on page 2]
      s13 --> s12: a put of a with no action send [when The link send of a to b is whole and The screens is one of a has send, c is gone, a has send, c on page 2]
      s13 --> s11: a put of a with the action send [when The link send of a to b is broken: no action send and The screens is one of a has no send, c is gone, a has no send, c on page 2]
      s12 --> s11: a move of c to page 1 or a delete of c [when The link next of b to c is broken: the screen is on another page and The screens is a has no send, c on page 2]
    }
  }
```

| Rule                    | In plain words                                                                                               | Spec line                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| `TypeOK`                | Each value is one that the server can hold.                                                                  | (model)                                |
| `EachLinkShowsItsCause` | Each link is whole, or marked broken with its true cause: the screen is gone, on another page, or no action. | SPEC-flows.md rule 9; fact rule 2 (J8) |
| `EachBreakIsTold`       | The answer of a change names each link that the change broke.                                                | SPEC-flows.md rule 10 (J8)             |
| `NoBreakWithNoCause`    | A link breaks only with a cause: a move on one page, or a version that keeps the action, keeps it whole.     | SPEC-flows.md rule 4 (J6)              |

## What the model leaves out

- A move on one page and a new size: they change no state of a link (rule 4).
- `link.set`, `link.remove` and the flows: they change a link, but break none.
- A delete of a screen with links: its links go with it (rule 9). Here c has no link.
- The map: it draws the state that easel keeps, so a mark is true when the state is true.

## What the chart shows

- A put of a version with no `send` breaks the link `send`, and a put with it mends it.
- A move of c to page 2 breaks `next`; a move back mends it. A delete of c breaks it for good.
- [flows-links-unchecked](flows-links-unchecked.md) shows why a put looks at the actions.
