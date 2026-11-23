# viewer: a new version of the page, and Reload

The chart follows one tab when easel deploys a new version of the page (SPEC-viewer.md § The page 4; request #12, 2026-11-23). The board's cell `client` names the client of the server's build. The tab keeps the first name that it reads. After a deploy the socket connects again, and a new name says that a new version is ready: a bar shows with `Reload`, as Linear and Slack do. The tab never reloads by itself. While text is typed, the bar asks the viewer to send it first, so a reload loses no text. The model is [models/viewer/NewVersion.tla](models/viewer/NewVersion.tla) with [NewVersion.cfg](models/viewer/NewVersion.cfg).

```mermaid
---
title: "viewer: a new version of the page, and Reload"
---
stateDiagram-v2
  state "Legend" as legend {
    lg0: none
    lg1: reload
    lg2: sendFirst
  }
  class lg0 tan
  class lg1 teal
  class lg2 blue
  s0: No bar, the tab has build 1, the server gives build 1, not read yet
  s1: No bar, the tab has build 1, the server gives build 2, not read yet
  s2: No bar, the tab has build 1, the server gives build 1, the board says build 1
  s3: No bar, the tab has build 1, the server gives build 1, not read yet, text typed
  s4: No bar, the tab has build 1, the server gives build 2, the board says build 1
  s5: Bar: a new version is ready, Reload, the tab has build 1, the server gives build 2, the board says build 2
  s6: No bar, the tab has build 1, the server gives build 2, not read yet, text typed
  s7: No bar, the tab has build 1, the server gives build 1, the board says build 1, text typed
  s8: No bar, the tab has build 2, the server gives build 2, not read yet
  s9: No bar, the tab has build 1, the server gives build 2, the board says build 1, text typed
  s10: Bar: a new version is ready, send your text first, the tab has build 1, the server gives build 2, the board says build 2, text typed
  s11: No bar, the tab has build 2, the server gives build 2, the board says build 2
  s12: No bar, the tab has build 2, the server gives build 2, not read yet, text typed
  s13: No bar, the tab has build 2, the server gives build 2, the board says build 2, text typed
  [*] --> s0
  s0 --> s1: a deploy: the server gives a new page
  s0 --> s2: the tab reads the board (at the start, or when the socket connects again)
  s0 --> s3: the viewer types a text
  s1 --> s5: the tab reads the board (at the start, or when the socket connects again)
  s1 --> s6: the viewer types a text
  s2 --> s4: a deploy: the server gives a new page
  s2 --> s7: the viewer types a text
  s3 --> s0: the viewer sends or clears the text
  s3 --> s6: a deploy: the server gives a new page
  s3 --> s7: the tab reads the board (at the start, or when the socket connects again)
  s4 --> s5: the tab reads the board (at the start, or when the socket connects again)
  s4 --> s9: the viewer types a text
  s5 --> s8: the viewer presses Reload: the tab loads the new page
  s5 --> s10: the viewer types a text
  s6 --> s1: the viewer sends or clears the text
  s6 --> s10: the tab reads the board (at the start, or when the socket connects again)
  s7 --> s2: the viewer sends or clears the text
  s7 --> s9: a deploy: the server gives a new page
  s8 --> s11: the tab reads the board (at the start, or when the socket connects again)
  s8 --> s12: the viewer types a text
  s9 --> s4: the viewer sends or clears the text
  s9 --> s10: the tab reads the board (at the start, or when the socket connects again)
  s10 --> s5: the viewer sends or clears the text
  s11 --> s13: the viewer types a text
  s12 --> s8: the viewer sends or clears the text
  s12 --> s13: the tab reads the board (at the start, or when the socket connects again)
  s13 --> s11: the viewer sends or clears the text
  class s0 tan
  class s1 tan
  class s2 tan
  class s3 tan
  class s4 tan
  class s5 teal
  class s6 tan
  class s7 tan
  class s8 tan
  class s9 tan
  class s10 blue
  class s11 tan
  class s12 tan
  class s13 tan
```

## The rules

- **TheBarMeansNewer**: the bar shows only when the board names a page that is not the one in the tab.
- **NoTextLost**: a reload happens only with no typed text.
- **OnlyTheViewerReloads**: the tab never reloads by itself. Only the button `Reload` loads a new page.

## What the model leaves out

- A deploy while the page loads: the tab may read the new name first, and then it misses that one version. The next deploy shows the bar.
- The server code alone: a deploy that does not change the page keeps its name, so no bar shows.
