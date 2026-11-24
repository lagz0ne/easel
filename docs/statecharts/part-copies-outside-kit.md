# pieces: a part that is not in the kit version

This chart has the model of [part-copies](part-copies.md) with
[PartCopiesOutsideKit.cfg](models/pieces/PartCopiesOutsideKit.cfg) (`PartsInKit = FALSE`): easel
keeps only the newest part, so a picture takes the part of the current kit version. TLC finds
that `ARequestShowsThePartOfItsKit` breaks in 3 steps:

1. A person asks for a change on frame `a`. The request keeps Kit 1, with P at revision 1.
2. An agent puts a new main of P on `design-system`.
3. The publish makes Kit 2, with P at revision 2. The picture of the request now shows revision 2,
   which the person did not see.

So each kit version keeps the revision of each part, and a picture uses the part of the kit
version in its address ([SPEC-pieces-base](../../SPEC-pieces-base.md), § New, rule 2).

```mermaid
---
title: "pieces: a change of a part reaches each copy"
---
stateDiagram-v2
  direction LR
  state "Legend" as legend {
    lg0: Breaks ARequestShowsThePartOfItsKit in some cases
    lg1: Path to the ARequestShowsThePartOfItsKit bug
  }
  class lg0 mayBreak
  class lg1 bugPath
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
  classDef mayBreak fill:#fff3e6,stroke:#e8730c,stroke-width:2.5px,color:#b85a06
  class s0 bugPath
  class s1 bugPath
  class s5 mayBreak
  class s5 bugPath
  class s7 mayBreak
  class s8 bugPath
  class s10 mayBreak
  class s10 bugPath
  class s11 mayBreak
  class s12 mayBreak
  class s13 mayBreak
  class s13 bugPath
  class s14 bugPath
  class s15 mayBreak
  class s15 bugPath
  class s16 mayBreak
```
