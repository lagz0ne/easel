# viewer: the menus, Find and the card Requests, on a phone and on a wide screen

The chart follows what lies over the canvas in one tab (SPEC-viewer.md § The page, item 5; the user's report of 2026-11-24). The dock holds `Requests`, `Find`, `Pages` and `Locale`. The card `Requests` shows the list or one request. Four menus open from a button: `Pages` and `Locale` in the dock, the list menu (`Open` or `Done`) in the head of the list, and `More` in the head of a request. The menus are the Menu of Base UI: one menu at a time, and a press out of a menu or Escape closes it. The list has a `Close` button. On a phone (a screen narrower than 640 px) the card stops above the dock, and `Find` closes the card. The model is [models/viewer/ViewerOverlays.tla](models/viewer/ViewerOverlays.tla) with [ViewerOverlays.cfg](models/viewer/ViewerOverlays.cfg).

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
  s2: Phone: no card, menu Locale
  s3: Wide: no card, menu Locale
  s4: Phone: no card, menu Pages
  s5: Wide: no card, menu Pages
  s6: Phone: no card, Find
  s7: Wide: no card, Find
  s8: Phone: the list
  s9: Wide: the list
  s10: Phone: the list, menu Open or Done
  s11: Wide: the list, menu Open or Done
  s12: Phone: the list, menu Locale
  s13: Wide: the list, menu Locale
  s14: Phone: the list, menu Pages
  s15: Wide: the list, menu Pages
  s16: Phone: a request
  s17: Wide: a request
  s18: Wide: the list, Find
  s19: Phone: a request, menu Locale
  s20: Wide: a request, menu Locale
  s21: Phone: a request, menu More
  s22: Wide: a request, menu More
  s23: Phone: a request, menu Pages
  s24: Wide: a request, menu Pages
  s25: Wide: a request, Find
  [*] --> s0
  [*] --> s1
  s0 --> s2: a press on Locale: its menu opens
  s0 --> s4: a press on Pages: its menu opens
  s0 --> s6: a press on Find: Find opens
  s0 --> s8: a press on Requests: the list opens
  s1 --> s3: a press on Locale: its menu opens
  s1 --> s5: a press on Pages: its menu opens
  s1 --> s7: a press on Find: Find opens
  s1 --> s9: a press on Requests: the list opens
  s2 --> s0: Escape: the top closes or a pick in the menu: it closes or a press on Locale: its menu closes or a press out of it: it closes
  s2 --> s4: a press on Pages: its menu opens
  s2 --> s6: a press on Find: Find opens
  s2 --> s8: a press on Requests: the list opens
  s3 --> s1: Escape: the top closes or a pick in the menu: it closes or a press on Locale: its menu closes or a press out of it: it closes
  s3 --> s5: a press on Pages: its menu opens
  s3 --> s7: a press on Find: Find opens
  s3 --> s9: a press on Requests: the list opens
  s4 --> s0: Escape: the top closes or a pick in the menu: it closes or a press out of it: it closes or a press on Pages: its menu closes
  s4 --> s2: a press on Locale: its menu opens
  s4 --> s6: a press on Find: Find opens
  s4 --> s8: a press on Requests: the list opens
  s5 --> s1: Escape: the top closes or a pick in the menu: it closes or a press out of it: it closes or a press on Pages: its menu closes
  s5 --> s3: a press on Locale: its menu opens
  s5 --> s7: a press on Find: Find opens
  s5 --> s9: a press on Requests: the list opens
  s6 --> s0: Escape: the top closes or a press on Find: Find closes or a press out of it: it closes
  s6 --> s2: a press on Locale: its menu opens
  s6 --> s4: a press on Pages: its menu opens
  s6 --> s8: a press on Requests: the list opens
  s7 --> s1: Escape: the top closes or a press on Find: Find closes or a press out of it: it closes
  s7 --> s3: a press on Locale: its menu opens
  s7 --> s5: a press on Pages: its menu opens
  s7 --> s9: a press on Requests: the list opens
  s8 --> s0: Escape: the top closes or a press on Close: the card closes or a press on Requests: the card closes
  s8 --> s6: a press on Find: Find opens
  s8 --> s10: a press on Open: its menu opens
  s8 --> s12: a press on Locale: its menu opens
  s8 --> s14: a press on Pages: its menu opens
  s8 --> s16: a press on a row: its request opens
  s9 --> s1: Escape: the top closes or a press on Close: the card closes or a press on Requests: the card closes
  s9 --> s11: a press on Open: its menu opens
  s9 --> s13: a press on Locale: its menu opens
  s9 --> s15: a press on Pages: its menu opens
  s9 --> s17: a press on a row: its request opens
  s9 --> s18: a press on Find: Find opens
  s10 --> s0: a press on Close: the card closes or a press on Requests: the card closes
  s10 --> s6: a press on Find: Find opens
  s10 --> s8: Escape: the top closes or a pick in the menu: it closes or a press on Open: its menu closes or a press out of it: it closes
  s10 --> s12: a press on Locale: its menu opens
  s10 --> s14: a press on Pages: its menu opens
  s10 --> s16: a press on a row: its request opens
  s11 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s11 --> s9: Escape: the top closes or a pick in the menu: it closes or a press on Open: its menu closes or a press out of it: it closes
  s11 --> s13: a press on Locale: its menu opens
  s11 --> s15: a press on Pages: its menu opens
  s11 --> s17: a press on a row: its request opens
  s11 --> s18: a press on Find: Find opens
  s12 --> s0: a press on Close: the card closes or a press on Requests: the card closes
  s12 --> s6: a press on Find: Find opens
  s12 --> s8: Escape: the top closes or a pick in the menu: it closes or a press on Locale: its menu closes or a press out of it: it closes
  s12 --> s10: a press on Open: its menu opens
  s12 --> s14: a press on Pages: its menu opens
  s12 --> s16: a press on a row: its request opens
  s13 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s13 --> s9: Escape: the top closes or a pick in the menu: it closes or a press on Locale: its menu closes or a press out of it: it closes
  s13 --> s11: a press on Open: its menu opens
  s13 --> s15: a press on Pages: its menu opens
  s13 --> s17: a press on a row: its request opens
  s13 --> s18: a press on Find: Find opens
  s14 --> s0: a press on Close: the card closes or a press on Requests: the card closes
  s14 --> s6: a press on Find: Find opens
  s14 --> s8: Escape: the top closes or a pick in the menu: it closes or a press out of it: it closes or a press on Pages: its menu closes
  s14 --> s10: a press on Open: its menu opens
  s14 --> s12: a press on Locale: its menu opens
  s14 --> s16: a press on a row: its request opens
  s15 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s15 --> s9: Escape: the top closes or a pick in the menu: it closes or a press out of it: it closes or a press on Pages: its menu closes
  s15 --> s11: a press on Open: its menu opens
  s15 --> s13: a press on Locale: its menu opens
  s15 --> s17: a press on a row: its request opens
  s15 --> s18: a press on Find: Find opens
  s16 --> s0: a press on Close: the card closes or a press on Requests: the card closes
  s16 --> s6: a press on Find: Find opens
  s16 --> s8: Escape: the top closes or a press on All requests: the list again
  s16 --> s19: a press on Locale: its menu opens
  s16 --> s21: a press on More: its menu opens
  s16 --> s23: a press on Pages: its menu opens
  s17 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s17 --> s9: Escape: the top closes or a press on All requests: the list again
  s17 --> s20: a press on Locale: its menu opens
  s17 --> s22: a press on More: its menu opens
  s17 --> s24: a press on Pages: its menu opens
  s17 --> s25: a press on Find: Find opens
  s18 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s18 --> s9: Escape: the top closes or a press on Find: Find closes or a press out of it: it closes
  s18 --> s11: a press on Open: its menu opens
  s18 --> s13: a press on Locale: its menu opens
  s18 --> s15: a press on Pages: its menu opens
  s18 --> s17: a press on a row: its request opens
  s19 --> s0: a press on Close: the card closes or a press on Requests: the card closes
  s19 --> s6: a press on Find: Find opens
  s19 --> s8: a press on All requests: the list again
  s19 --> s16: Escape: the top closes or a pick in the menu: it closes or a press on Locale: its menu closes or a press out of it: it closes
  s19 --> s21: a press on More: its menu opens
  s19 --> s23: a press on Pages: its menu opens
  s20 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s20 --> s9: a press on All requests: the list again
  s20 --> s17: Escape: the top closes or a pick in the menu: it closes or a press on Locale: its menu closes or a press out of it: it closes
  s20 --> s22: a press on More: its menu opens
  s20 --> s24: a press on Pages: its menu opens
  s20 --> s25: a press on Find: Find opens
  s21 --> s0: a press on Close: the card closes or a press on Requests: the card closes
  s21 --> s6: a press on Find: Find opens
  s21 --> s8: a press on All requests: the list again
  s21 --> s16: Escape: the top closes or a pick in the menu: it closes or a press on More: its menu closes or a press out of it: it closes
  s21 --> s19: a press on Locale: its menu opens
  s21 --> s23: a press on Pages: its menu opens
  s22 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s22 --> s9: a press on All requests: the list again
  s22 --> s17: Escape: the top closes or a pick in the menu: it closes or a press on More: its menu closes or a press out of it: it closes
  s22 --> s20: a press on Locale: its menu opens
  s22 --> s24: a press on Pages: its menu opens
  s22 --> s25: a press on Find: Find opens
  s23 --> s0: a press on Close: the card closes or a press on Requests: the card closes
  s23 --> s6: a press on Find: Find opens
  s23 --> s8: a press on All requests: the list again
  s23 --> s16: Escape: the top closes or a pick in the menu: it closes or a press out of it: it closes or a press on Pages: its menu closes
  s23 --> s19: a press on Locale: its menu opens
  s23 --> s21: a press on More: its menu opens
  s24 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s24 --> s9: a press on All requests: the list again
  s24 --> s17: Escape: the top closes or a pick in the menu: it closes or a press out of it: it closes or a press on Pages: its menu closes
  s24 --> s20: a press on Locale: its menu opens
  s24 --> s22: a press on More: its menu opens
  s24 --> s25: a press on Find: Find opens
  s25 --> s1: a press on Close: the card closes or a press on Requests: the card closes
  s25 --> s9: a press on All requests: the list again
  s25 --> s17: Escape: the top closes or a press on Find: Find closes or a press out of it: it closes
  s25 --> s20: a press on Locale: its menu opens
  s25 --> s22: a press on More: its menu opens
  s25 --> s24: a press on Pages: its menu opens
  class s0 tan
  class s1 tan
  class s2 tan
  class s3 tan
  class s4 tan
  class s5 tan
  class s6 tan
  class s7 tan
  class s8 teal
  class s9 teal
  class s10 teal
  class s11 teal
  class s12 teal
  class s13 teal
  class s14 teal
  class s15 teal
  class s16 blue
  class s17 blue
  class s18 teal
  class s19 blue
  class s20 blue
  class s21 blue
  class s22 blue
  class s23 blue
  class s24 blue
  class s25 blue
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
- What a pick does: a page ([viewer-pages](viewer-pages.md)), a locale ([kit-frame-axes](kit-frame-axes.md)), a list, or an act on a request ([viewer-queue](viewer-queue.md)).
- That `Locale` shows only when a capsule frame offers a locale: the model keeps it in the dock.
- The words of Find and its take: [viewer-find](viewer-find.md).
- The panel `Controls` of an app frame: it has its own `Close`, and on a phone it stops above the dock too.
