# viewer: the card of the Requests, docked at the right edge of the view

The chart follows the card of the Requests in one tab (SPEC-viewer.md § Follow the requests; docs/epics.md E4.4, decided on 2026-11-23). The card is docked at the right edge of the view, over the canvas. It shows the list of the requests, or one request with its thread. It does not move when the canvas pans, and the canvas does not move when the card opens or changes. A press on a pin opens its request in the card. A press on a row opens its request and moves the canvas to its place. All requests goes back to the list, Close closes the card, and Escape closes the top: the thread goes back to the list, and the list goes. A new request is typed in a draft by its pin, not in the card: Send saves it and opens it in the card. The model is [models/viewer/ViewerCard.tla](models/viewer/ViewerCard.tla) with [ViewerCard.cfg](models/viewer/ViewerCard.cfg).

```mermaid
---
title: "viewer: the card of the Requests, docked at the right edge of the view"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: closed
    lg1: list
    lg2: thread
  }
  class lg0 tan
  class lg1 teal
  class lg2 blue
  s0: Card closed: no draft, view mode
  s1: Card closed: no draft, request mode
  s2: Card shows the list: no draft, view mode
  s3: Card shows one request: no draft, view mode
  s4: Card closed: a new request is typed by its pin, request mode
  s5: Card shows the list: no draft, request mode
  s6: Card shows one request: no draft, request mode
  s7: Card shows the list: a new request is typed by its pin, request mode
  s8: Card shows one request: a new request is typed by its pin, request mode
  [*] --> s0
  s0 --> s1: the viewer presses Request: request mode
  s0 --> s2: the viewer presses Requests: the card opens
  s0 --> s3: the viewer presses a pin: its request opens in the card, and the canvas stays
  s1 --> s0: the viewer presses Request again: view mode
  s1 --> s4: a click on a place: a draft by its pin
  s1 --> s5: the viewer presses Requests: the card opens
  s2 --> s0: the viewer presses Close: the card closes or Escape: the card closes or the viewer presses Requests: the card closes
  s2 --> s3: the viewer presses a pin: its request opens in the card, and the canvas stays or the viewer presses a row: its request opens, and the canvas moves to its place
  s2 --> s5: the viewer presses Request: request mode
  s3 --> s0: the viewer presses Close: the card closes or the viewer presses Requests: the card closes
  s3 --> s2: the viewer presses All requests: the list again or Escape: the thread goes back to the list
  s3 --> s6: the viewer presses Request: request mode
  s4 --> s0: Escape in the draft: nothing is sent, and the request mode ends or the viewer presses Request again: view mode
  s4 --> s7: the viewer presses Requests: the card opens
  s4 --> s3: Send: the request is saved, and it opens in the card
  s5 --> s1: the viewer presses Close: the card closes or Escape: the card closes or the viewer presses Requests: the card closes
  s5 --> s2: the viewer presses Request again: view mode
  s5 --> s7: a click on a place: a draft by its pin
  s5 --> s6: the viewer presses a row: its request opens, and the canvas moves to its place
  s6 --> s1: the viewer presses Close: the card closes or the viewer presses Requests: the card closes
  s6 --> s3: the viewer presses Request again: view mode
  s6 --> s5: the viewer presses All requests: the list again or Escape: the thread goes back to the list
  s6 --> s8: a click on a place: a draft by its pin
  s7 --> s2: Escape in the draft: nothing is sent, and the request mode ends or the viewer presses Request again: view mode
  s7 --> s4: the viewer presses Close: the card closes or the viewer presses Requests: the card closes
  s7 --> s3: Send: the request is saved, and it opens in the card
  s7 --> s8: the viewer presses a row: its request opens, and the canvas moves to its place
  s8 --> s3: Escape in the draft: nothing is sent, and the request mode ends or the viewer presses Request again: view mode or Send: the request is saved, and it opens in the card
  s8 --> s4: the viewer presses Close: the card closes or the viewer presses Requests: the card closes
  s8 --> s7: the viewer presses All requests: the list again
  class s0 tan
  class s1 tan
  class s2 teal
  class s3 blue
  class s4 tan
  class s5 teal
  class s6 blue
  class s7 teal
  class s8 blue
```

## The rules

- **AThreadHasItsRequest**: the card shows a thread only with its request, and that request is saved.
- **ADraftIsInRequestMode**: a new request is typed only in the request mode.
- **APanLeavesTheCard**: a pan or a zoom moves only the canvas: the card and its request stay.
- **OnlyARowOrAPanMovesTheCanvas**: the canvas moves only for a pan or a press on a row. A press on a pin, Requests, All requests, Close, Escape and Send never move it.

## What the model leaves out

- The state of each request (waiting, a question, a result): [viewer-queue](viewer-queue.md).
- A link that ends or a frame that goes while a draft is typed: [viewer-pin-link](viewer-pin-link.md).
- The text and the sending of a request: [viewer-pin-post](viewer-pin-post.md).
