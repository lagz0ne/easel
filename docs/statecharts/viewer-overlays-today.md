# viewer: the overlays of the page before 2026-11-24, on a phone

This chart has the model of [viewer-overlays](viewer-overlays.md) with
[ViewerOverlaysToday.cfg](models/viewer/ViewerOverlaysToday.cfg) (`Design = "today"`, a phone
only). It is the page that the user reported on 2026-11-24: "The dock, and the mailbox is way too
big on mobile view, and those overlapping each other leading to deadend and have to do refresh to
clean state." Each menu opens and closes only by its own button or a pick, the list has no
`Close`, and on a phone the card covers the dock. TLC finds that `OnePressClosesTheTop` breaks in
1 step:

1. On a phone, a press on `Requests` opens the list. The list covers the dock, so `Requests` is
   under it, and the head of the list has no `Close`. No press closes the list.

The other rules break too: a press out of a menu does not close it, Escape does not close a menu,
and the menus `Pages` and `Open or Done` open together. So the menus are the Menu of Base UI, the
list has `Close`, and on a phone the card stops above the dock (SPEC-viewer.md § The page,
item 5).

```mermaid
---
title: "viewer: the menus, Find and the card Requests, on a phone and on a wide screen"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: no card
    lg1: the list
    lg2: a request
    lg3: Breaks AnOutsidePressClosesAMenu or EscapeClosesTheTop or OneMenuAtMost or OnePressClosesTheTop or TheDockIsFree or TheStickIsFree
    lg4: Path to the AnOutsidePressClosesAMenu or EscapeClosesTheTop or OneMenuAtMost or OnePressClosesTheTop or TheDockIsFree or TheStickIsFree bug
  }
  class lg0 tan
  class lg1 teal
  class lg2 blue
  class lg3 breaks
  class lg4 bugPath
  s0: Phone: no card
  s1: Phone: no card, menu Pages
  s2: Phone: no card, Find
  s3: Phone: the list
  s4: Phone: the list, menu Open or Done
  s5: Phone: no card, menu Pages, Find
  s6: Phone: the list, menu Pages
  s7: Phone: a request
  s8: Phone: no card, menu Open or Done kept, not shown
  s9: Phone: a request, menu More
  s10: Phone: the list, menu Pages, menu Open or Done
  s11: Phone: a request, menu Pages
  s12: Phone: no card, menu Open or Done kept, not shown, Find
  s13: Phone: no card, menu Pages, menu Open or Done kept, not shown
  s14: Phone: a request, menu Pages, menu More
  s15: Phone: no card, menu Pages, menu Open or Done kept, not shown, Find
  [*] --> s0
  s0 --> s1: a press on Pages: its menu opens
  s0 --> s2: a press on Find: Find opens
  s0 --> s3: a press on Requests: the list opens
  s1 --> s0: a pick in the menu: it closes or a press on Pages: its menu closes
  s1 --> s5: a press on Find: Find opens
  s1 --> s6: a press on Requests: the list opens
  s2 --> s0: Escape: the top closes or a press on Find: Find closes or a press out of it: it closes
  s2 --> s1: a press on Pages: its menu opens
  s2 --> s3: a press on Requests: the list opens
  s3 --> s0: Escape: the top closes
  s3 --> s4: a press on Open: its menu opens
  s3 --> s7: a press on a row: its request opens
  s4 --> s3: a pick in the menu: it closes or a press on Open: its menu closes
  s4 --> s7: a press on a row: its request opens
  s4 --> s8: Escape: the top closes
  s5 --> s0: a press on Pages: its menu closes
  s5 --> s1: Escape: the top closes or a press on Find: Find closes or a press out of it: it closes
  s5 --> s2: a pick in the menu: it closes
  s5 --> s6: a press on Requests: the list opens
  s6 --> s1: Escape: the top closes
  s6 --> s3: a pick in the menu: it closes
  s6 --> s10: a press on Open: its menu opens
  s6 --> s11: a press on a row: its request opens
  s7 --> s0: a press on Close: the card closes
  s7 --> s3: Escape: the top closes or a press on All requests: the list again
  s7 --> s9: a press on More: its menu opens
  s8 --> s0: a pick in the menu: it closes
  s8 --> s4: a press on Requests: the list opens
  s8 --> s12: a press on Find: Find opens
  s8 --> s13: a press on Pages: its menu opens
  s9 --> s0: a press on Close: the card closes
  s9 --> s3: Escape: the top closes or a press on All requests: the list again
  s9 --> s7: a pick in the menu: it closes or a press on More: its menu closes
  s10 --> s4: a pick in the menu: it closes
  s10 --> s6: a pick in the menu: it closes or a press on Open: its menu closes
  s10 --> s11: a press on a row: its request opens
  s10 --> s13: Escape: the top closes
  s11 --> s1: a press on Close: the card closes
  s11 --> s6: Escape: the top closes or a press on All requests: the list again
  s11 --> s7: a pick in the menu: it closes
  s11 --> s14: a press on More: its menu opens
  s12 --> s2: a pick in the menu: it closes
  s12 --> s4: a press on Requests: the list opens
  s12 --> s8: Escape: the top closes or a press on Find: Find closes or a press out of it: it closes
  s12 --> s13: a press on Pages: its menu opens
  s13 --> s1: a pick in the menu: it closes
  s13 --> s8: a pick in the menu: it closes or a press on Pages: its menu closes
  s13 --> s10: a press on Requests: the list opens
  s13 --> s15: a press on Find: Find opens
  s14 --> s1: a press on Close: the card closes
  s14 --> s6: Escape: the top closes or a press on All requests: the list again
  s14 --> s9: a pick in the menu: it closes
  s14 --> s11: a pick in the menu: it closes or a press on More: its menu closes
  s15 --> s5: a pick in the menu: it closes
  s15 --> s8: a press on Pages: its menu closes
  s15 --> s10: a press on Requests: the list opens
  s15 --> s12: a pick in the menu: it closes
  s15 --> s13: Escape: the top closes or a press on Find: Find closes or a press out of it: it closes
  classDef breaks fill:#ffecee,stroke:#e72e3b,stroke-width:2.5px,color:#cd2834
  class s0 tan
  class s0 bugPath
  class s1 tan
  class s1 breaks
  class s1 bugPath
  class s2 tan
  class s3 teal
  class s3 breaks
  class s3 bugPath
  class s4 teal
  class s4 breaks
  class s5 tan
  class s5 breaks
  class s6 teal
  class s6 breaks
  class s6 bugPath
  class s7 blue
  class s7 breaks
  class s8 tan
  class s8 breaks
  class s9 blue
  class s9 breaks
  class s10 teal
  class s10 breaks
  class s10 bugPath
  class s11 blue
  class s11 breaks
  class s12 tan
  class s12 breaks
  class s13 tan
  class s13 breaks
  class s14 blue
  class s14 breaks
  class s15 tan
  class s15 breaks
```
