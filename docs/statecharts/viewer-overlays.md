# viewer: the menus, Find and the card Requests, on a phone and on a wide screen

The chart follows what lies over the canvas in one tab (SPEC-viewer.md § The page, item 5; the user's report of 2026-11-24). The dock holds `Requests`, `Find` and `Pages`. The card `Requests` shows the list or one request. Three menus open from a button: `Pages` in the dock, the list menu (`Open` or `Done`) in the head of the list, and `More` in the head of a request. The menus are the Menu of Base UI: one menu at a time, and a press out of a menu or Escape closes it. The list has a `Close` button. On a phone (a screen narrower than 640 px) the card stops above the dock, and `Find` closes the card. The model is [models/viewer/ViewerOverlays.tla](models/viewer/ViewerOverlays.tla) with [ViewerOverlays.cfg](models/viewer/ViewerOverlays.cfg).

```mermaid
---
title: "viewer: the menus, Find and the card Requests, on a phone and on a wide screen"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: no card
    lg1: the list
    lg2: a request
  }
  class lg0 tan
  class lg1 teal
  class lg2 blue
  s0: Phone: no card
  s1: Wide: no card
  s2: Phone: no card, menu Pages
  s3: Wide: no card, menu Pages
  s4: Phone: no card, Find
  s5: Wide: no card, Find
  s6: Phone: the list
  s7: Wide: the list
  s8: Phone: the list, menu Open or Done
  s9: Wide: the list, menu Open or Done
  s10: Phone: the list, menu Pages
  s11: Wide: the list, menu Pages
  s12: Phone: a request
  s13: Wide: a request
  s14: Wide: the list, Find
  s15: Phone: a request, menu More
  s16: Wide: a request, menu More
  s17: Phone: a request, menu Pages
  s18: Wide: a request, menu Pages
  s19: Wide: a request, Find
  [*] --> s0
  [*] --> s1
  s0 --> s2: a press on Pages: its menu opens
  s0 --> s4: a press on Find: Find opens
  s0 --> s6: a press on Requests: the list opens
  s1 --> s3: a press on Pages: its menu opens
  s1 --> s5: a press on Find: Find opens
  s1 --> s7: a press on Requests: the list opens
  s2 --> s0: Escape: the top closes or a pick in the menu: it closes or a press out of it: it closes or a press on Pages: its menu closes
  s2 --> s4: a press on Find: Find opens
  s2 --> s6: a press on Requests: the list opens
  s3 --> s1: Escape: the top closes or a pick in the menu: it closes or a press out of it: it closes or a press on Pages: its menu closes
  s3 --> s5: a press on Find: Find opens
  s3 --> s7: a press on Requests: the list opens
  s4 --> s0: Escape: the top closes or a press on Find: Find closes or a press out of it: it closes
  s4 --> s2: a press on Pages: its menu opens
  s4 --> s6: a press on Requests: the list opens
  s5 --> s1: Escape: the top closes or a press on Find: Find closes or a press out of it: it closes
  s5 --> s3: a press on Pages: its menu opens
  s5 --> s7: a press on Requests: the list opens
  s6 --> s0: Escape: the top closes or a press on Close: the card closes or a press on Requests: the card closes
  s6 --> s4: a press on Find: Find opens
  s6 --> s8: a press on Open: its menu opens
  s6 --> s10: a press on Pages: its menu opens
  s6 --> s12: a press on a row: its request opens
  s7 --> s1: Escape: the top closes or a press on Close: the card closes or a press on Requests: the card closes
  s7 --> s9: a press on Open: its menu opens
  s7 --> s11: a press on Pages: its menu opens
  s7 --> s13: a press on a row: its request opens
  s7 --> s14: a press on Find: Find opens
  s8 --> s0: a press on Close: the card closes or a press on Requests: the card closes
  s8 --> s4: a press on Find: Find opens
  s8 --> s6: Escape: the top closes or a pick in the menu: it closes or a press on Open: its menu closes or a press out of it: it closes
  s8 --> s10: a press on Pages: its menu opens
  s8 --> s12: a press on a row: its request opens
  s9 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s9 --> s7: Escape: the top closes or a pick in the menu: it closes or a press on Open: its menu closes or a press out of it: it closes
  s9 --> s11: a press on Pages: its menu opens
  s9 --> s13: a press on a row: its request opens
  s9 --> s14: a press on Find: Find opens
  s10 --> s0: a press on Close: the card closes or a press on Requests: the card closes
  s10 --> s4: a press on Find: Find opens
  s10 --> s6: Escape: the top closes or a pick in the menu: it closes or a press out of it: it closes or a press on Pages: its menu closes
  s10 --> s8: a press on Open: its menu opens
  s10 --> s12: a press on a row: its request opens
  s11 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s11 --> s7: Escape: the top closes or a pick in the menu: it closes or a press out of it: it closes or a press on Pages: its menu closes
  s11 --> s9: a press on Open: its menu opens
  s11 --> s13: a press on a row: its request opens
  s11 --> s14: a press on Find: Find opens
  s12 --> s0: a press on Close: the card closes or a press on Requests: the card closes
  s12 --> s4: a press on Find: Find opens
  s12 --> s6: Escape: the top closes or a press on All requests: the list again
  s12 --> s15: a press on More: its menu opens
  s12 --> s17: a press on Pages: its menu opens
  s13 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s13 --> s7: Escape: the top closes or a press on All requests: the list again
  s13 --> s16: a press on More: its menu opens
  s13 --> s18: a press on Pages: its menu opens
  s13 --> s19: a press on Find: Find opens
  s14 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s14 --> s7: Escape: the top closes or a press on Find: Find closes or a press out of it: it closes
  s14 --> s9: a press on Open: its menu opens
  s14 --> s11: a press on Pages: its menu opens
  s14 --> s13: a press on a row: its request opens
  s15 --> s0: a press on Close: the card closes or a press on Requests: the card closes
  s15 --> s4: a press on Find: Find opens
  s15 --> s6: a press on All requests: the list again
  s15 --> s12: Escape: the top closes or a pick in the menu: it closes or a press on More: its menu closes or a press out of it: it closes
  s15 --> s17: a press on Pages: its menu opens
  s16 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s16 --> s7: a press on All requests: the list again
  s16 --> s13: Escape: the top closes or a pick in the menu: it closes or a press on More: its menu closes or a press out of it: it closes
  s16 --> s18: a press on Pages: its menu opens
  s16 --> s19: a press on Find: Find opens
  s17 --> s0: a press on Close: the card closes or a press on Requests: the card closes
  s17 --> s4: a press on Find: Find opens
  s17 --> s6: a press on All requests: the list again
  s17 --> s12: Escape: the top closes or a pick in the menu: it closes or a press out of it: it closes or a press on Pages: its menu closes
  s17 --> s15: a press on More: its menu opens
  s18 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s18 --> s7: a press on All requests: the list again
  s18 --> s13: Escape: the top closes or a pick in the menu: it closes or a press out of it: it closes or a press on Pages: its menu closes
  s18 --> s16: a press on More: its menu opens
  s18 --> s19: a press on Find: Find opens
  s19 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s19 --> s7: a press on All requests: the list again
  s19 --> s13: Escape: the top closes or a press on Find: Find closes or a press out of it: it closes
  s19 --> s16: a press on More: its menu opens
  s19 --> s18: a press on Pages: its menu opens
  class s0 tan
  class s1 tan
  class s2 tan
  class s3 tan
  class s4 tan
  class s5 tan
  class s6 teal
  class s7 teal
  class s8 teal
  class s9 teal
  class s10 teal
  class s11 teal
  class s12 blue
  class s13 blue
  class s14 teal
  class s15 blue
  class s16 blue
  class s17 blue
  class s18 blue
  class s19 blue
```

## The rules

- **OnePressClosesTheTop**: from each state, one press closes the top overlay. No state is a dead end.
- **EscapeClosesTheTop**: Escape closes the top overlay: a menu, Find, a request (back to the list), then the list.
- **TheDockIsFree**: no overlay covers the dock, so each of its buttons can be pressed.
- **OneMenuAtMost**: one menu at most is open.
- **AnOutsidePressClosesAMenu**: a press out of an open menu closes it.
- **FindAndTheCardDoNotStackOnAPhone**: on a phone, Find and the card never show together.
- **APickClosesItsMenu**: a pick in a menu closes that menu.

## What the model leaves out

- The request mode and its draft: they cover nothing. Escape ends them after each overlay: [viewer-card](viewer-card.md).
- What a pick does: a page ([viewer-pages](viewer-pages.md)), a list, or an act on a request ([viewer-queue](viewer-queue.md)).
- The words of Find and its take: [viewer-find](viewer-find.md).
- The panel `Controls` of an app frame: it has its own `Close`, and on a phone it stops above the dock too.
