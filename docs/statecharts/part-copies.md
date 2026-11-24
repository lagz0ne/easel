# pieces: a change of a part reaches each copy

The chart shows one part of the design system and its copies in HTML frames
([SPEC-pieces-base](../../SPEC-pieces-base.md)). The part P has one source frame, its main, on the
canvas `design-system`. Frame `a` on `product` holds a copy of P. Frame `o` holds no copy. A put of
the main and its publish are two writes, so a publish can come late; each start of easel publishes
a main that is not yet in the kit. A change of the look also makes a new kit version, with the
same revision of P. A request keeps the kit version of the tab. The model is
[models/pieces/PartCopies.tla](models/pieces/PartCopies.tla) with
[PartCopies.cfg](models/pieces/PartCopies.cfg) (`PartsInKit = TRUE`, `MaxKit = 3`, `MaxRev = 2`).
TLC checks every rule below on all 69 of its states, and each one holds.

```mermaid
---
title: "pieces: a change of a part reaches each copy"
---
stateDiagram-v2
  direction LR
  state "At the same time" as all {
    state "The design system" as r0 {
      s0: Kit 1, P at revision 1, the main is published
      s1: Kit 1, P at revision 1, a new main, not yet published
      s2: Kit 2, P at revision 1, the main is published
      s3: Kit 2, P at revision 1, a new main, not yet published
      s4: Kit 3, P at revision 1, the main is published
      s5: Kit 2, P at revision 2, the main is published
      s6: Kit 3, P at revision 1, a new main, not yet published
      s7: Kit 3, P at revision 2, the main is published
      [*] --> s0
      s0 --> s1: an agent puts a new main of P on design-system
      s0 --> s2: a person changes the look: a new kit version, the same P
      s1 --> s3: a person changes the look: a new kit version, the same P
      s1 --> s5: the publish: a new kit version with the next revision of P
      s2 --> s3: an agent puts a new main of P on design-system
      s2 --> s4: a person changes the look: a new kit version, the same P
      s3 --> s6: a person changes the look: a new kit version, the same P
      s3 --> s7: the publish: a new kit version with the next revision of P
      s4 --> s6: an agent puts a new main of P on design-system
      s5 --> s7: a person changes the look: a new kit version, the same P
    }
    --
    state "Frame a, with a copy of P" as r1 {
      s8: shows P at revision 1
      s9: shows P at revision 1, a new document with revision 1 loads
      s10: shows P at revision 1, a new document with revision 2 loads
      s11: shows P at revision 2
      s12: shows P at revision 2, a new document with revision 2 loads
      [*] --> s8
      s8 --> s9: an agent puts a new version of frame a
      s8 --> s10: the publish: a new kit version with the next revision of P [when The design system is one of Kit 1, P at revision 1, a new main, not yet published, Kit 2, P at revision 1, a new main, not yet published and A request on frame a is not keeps Kit 3, which has P at revision 1]
      s9 --> s8: the new iframe draws, the old one goes
      s9 --> s10: the publish: a new kit version with the next revision of P [when The design system is one of Kit 1, P at revision 1, a new main, not yet published, Kit 2, P at revision 1, a new main, not yet published and A request on frame a is not keeps Kit 3, which has P at revision 1]
      s10 --> s11: the new iframe draws, the old one goes
      s11 --> s12: an agent puts a new version of frame a
      s12 --> s11: the new iframe draws, the old one goes
    }
    --
    state "Frame o, with no copy" as r2 {
      s13: keeps its document
      [*] --> s13
    }
    --
    state "A request on frame a" as r3 {
      s14: no request
      s15: keeps Kit 1, which has P at revision 1
      s16: keeps Kit 2, which has P at revision 1
      s17: keeps Kit 3, which has P at revision 1
      s18: keeps Kit 2, which has P at revision 2
      s19: keeps Kit 3, which has P at revision 2
      [*] --> s14
      s14 --> s15: a person asks for a change on frame a [when The design system is one of Kit 1, P at revision 1, a new main, not yet published, Kit 1, P at revision 1, the main is published and Frame a, with a copy of P is one of shows P at revision 1, shows P at revision 1, a new document with revision 1 loads]
      s14 --> s16: a person asks for a change on frame a [when The design system is one of Kit 2, P at revision 1, a new main, not yet published, Kit 2, P at revision 1, the main is published and Frame a, with a copy of P is one of shows P at revision 1, shows P at revision 1, a new document with revision 1 loads]
      s14 --> s17: a person asks for a change on frame a [when The design system is one of Kit 3, P at revision 1, a new main, not yet published, Kit 3, P at revision 1, the main is published and Frame a, with a copy of P is one of shows P at revision 1, shows P at revision 1, a new document with revision 1 loads]
      s14 --> s18: a person asks for a change on frame a [when The design system is Kit 2, P at revision 2, the main is published and Frame a, with a copy of P is none of shows P at revision 1, shows P at revision 1, a new document with revision 1 loads]
      s14 --> s19: a person asks for a change on frame a [when The design system is Kit 3, P at revision 2, the main is published and Frame a, with a copy of P is none of shows P at revision 1, shows P at revision 1, a new document with revision 1 loads]
    }
  }
```

| Rule                               | In plain words                                                                                                                                        | Spec anchor                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `TypeOK`                           | Each value is one that easel or the page can hold.                                                                                                    | (model)                                     |
| `TheMainReachesThePart`            | In the end, the part in the current kit version is the main on `design-system`. Fairness: easel publishes each main, at the put or at the next start. | § New, rules 4 and 5                        |
| `EachCopyShowsTheCurrentPart`      | In the end, the copy in frame `a` shows the part of the current kit version. Fairness: the page draws each new document.                              | § New, rules 6 and 8; § Success criteria, 1 |
| `AFrameWithNoCopyKeepsItsDocument` | Frame `o` never gets a new document: no publish changes what it shows.                                                                                | § New, rule 8; § Success criteria, 3        |
| `ARequestShowsThePartOfItsKit`     | The picture of a request shows the copy with the part of the kit version that the request keeps, not of the current one.                              | § New, rules 2 and 9; § Success criteria, 4 |
| `NoDeadlock`                       | There is always a next step.                                                                                                                          | (model)                                     |

## What the model leaves out

- An edited copy (§ New, rule 7). It shows as it is written, and no publish changes it. Tests hold
  it: a copy with an edit outside its props, overrides and slots keeps each byte.
- More parts, more copies, and copies in a copy (a Count in the slot of the Dock). Each copy
  follows the same steps.
- The first link of a part (`parts.publish`): it is a publish with no revision before it.
- A put of the main with a base (`stale`): [frames-writes](frames-writes.md) proves it.

## What the chart shows

- After a put of the main, the part waits for the publish ("a new main, not yet published"). The
  publish makes a new kit version, and frame `a` loads a new document at the same step.
- A change of the look makes a new kit version, and frame `a` keeps its document: the look goes to
  the tab as a message.
- The old iframe stays until the new one draws ("a new document loads").
- [part-copies-outside-kit](part-copies-outside-kit.md) shows why the part is in the kit version.
