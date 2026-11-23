# Statecharts

Each flow in easel that has state has a statechart. A statechart is a TLA+ model, checked with TLC,
and drawn as a Mermaid chart. GitHub renders the charts on each page.

## They are the oracle

- Each rule in a chart is a test target. The module's tests reach each rule.
- The code must behave as the chart shows. When the code and a chart disagree, the code is wrong,
  or the chart and its spec change together.
- A chart changes only with its spec, in the same ship.
- `scripts/statecharts.sh --check` must be clean: each chart is as committed, and each rule holds
  or breaks as the chart's row says.

## How to read a chart

- A state is what a person sees, such as "Waiting, code pending".
- An arrow is what happens, such as "the owner approves".
- Text in [brackets] at the end of an arrow is the condition for it, such as "[while the code is
  live]".
- A box drawn around states groups them. "At the same time" splits the chart into parts that move
  on their own.
- A state marked `breaks` breaks a rule. The legend names the rule. Only a chart whose row says
  `breaks` may have one.

Each chart's page has the chart, its rules in plain words, and what the model leaves out.

## Charts

| Chart                                               | Module | What it shows                                                                                  |
| --------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| [access-login](access-login.md)                     | access | Logging in: the setup code, a login code, approve, deny, revoke                                |
| [frames-writes](frames-writes.md)                   | frames | Two writers on one frame: the first write on a version wins, the other gets `stale`            |
| [frames-writes-two-step](frames-writes-two-step.md) | frames | Why a save is one write: a check then a write saves on an old version                          |
| [frames-pictures](frames-pictures.md)               | frames | A frame's picture: rendered, current, old, and gone with its frame                             |
| [frames-share](frames-share.md)                     | frames | A share link: shared, password set or changed, passes, unshared                                |
| [frames-share-open](frames-share-open.md)           | frames | The first slice: a share link with no password, that nothing ends yet                          |
| [queue-lease](queue-lease.md)                       | queue  | A request in the queue: waiting, in work, released, an outcome, needs a person                 |
| [queue-two-step](queue-two-step.md)                 | queue  | Why a claim is one write: a find then a write gives one request to two agents                  |
| [request-life](request-life.md)                     | queue  | One request: question, result, accept, open again, edit, close, needs a person                 |
| [queue-dispatch](queue-dispatch.md)                 | queue  | The dispatcher: one delivery for each waiting period, GitHub and pull both on, one outcome     |
| [ops-issues](ops-issues.md)                         | ops    | An error group: open, resolved, regressed, evicted                                             |
| [ops-issues-person](ops-issues-person.md)           | ops    | An error group that an owner resolves or hands off by hand, with no claim                      |
| [fixer-claim-issue](fixer-claim-issue.md)           | fixer  | A fixer claims a group and opens one issue for it                                              |
| [fixer-claim-fix](fixer-claim-fix.md)               | fixer  | A fixer ships a fix, notes it, and gives up after two                                          |
| [fixer-probe](fixer-probe.md)                       | fixer  | The probe: it sees whether the fixer still ticks                                               |
| [fixer-claim-unsafe](fixer-claim-unsafe.md)         | fixer  | Why the fixer needs a guard: with neither, an orphaned `ship.sh` pushes without the claim      |
| [viewer-gate](viewer-gate.md)                       | viewer | Opening a link: the password, the pass, an ended link                                          |
| [viewer-gate-open](viewer-gate-open.md)             | viewer | The first slice: a link with no password, an unknown link                                      |
| [viewer-gate-password](viewer-gate-password.md)     | viewer | The shipped gate: passwords, the wait, unshare; the canvas with no requests yet                |
| [viewer-canvas](viewer-canvas.md)                   | viewer | The canvas: live frames, pan and zoom, reconnecting                                            |
| [viewer-pin-post](viewer-pin-post.md)               | viewer | Sending a request: typed, sent, saved, or a fault                                              |
| [viewer-pin-link](viewer-pin-link.md)               | viewer | A request when its link ends or its frame goes: the typed text stays                           |
| [viewer-queue](viewer-queue.md)                     | viewer | The Requests panel: each state, the count for a viewer, the Changed mark                       |
| [viewer-card](viewer-card.md)                       | viewer | The card of the Requests, docked at the right: list, thread, Back, Close, Escape               |
| [viewer-find](viewer-find.md)                       | viewer | Find a frame by its name, from the dock: the list, the take, the mark                          |
| [viewer-hover](viewer-hover.md)                     | viewer | The outline of the part under the pointer, in the request mode                                 |
| [viewer-version](viewer-version.md)                 | viewer | A new version of the page: the bar, Reload, and no text lost                                   |
| [viewer-pages](viewer-pages.md)                     | viewer | The pages of a canvas in a tab: a pick of a page, of a request, of Find, a move, a reload      |
| [viewer-pages-old-page](viewer-pages-old-page.md)   | viewer | Why the pick of a request asks for its frame: the page of the request is old after a move      |
| [kit-piece](kit-piece.md)                           | kit    | Two agents change one piece: the first change on a revision wins, the other gets `stale`       |
| [kit-look](kit-look.md)                             | kit    | The look: a change, a refused unreadable look, one step back, and what a viewer saw            |
| [kit-look-unbound](kit-look-unbound.md)             | kit    | Why a request keeps its kit version: with the frame version only, its Before is wrong          |
| [copy-status](copy-status.md)                       | copy   | The status of an app frame: exploring, then ready when its texts and colors are settled        |
| [copy-status-remove](copy-status-remove.md)         | copy   | Why no call removes a text key: a ready frame would use a text key that the team does not have |
| [kit-look-hello-once](kit-look-hello-once.md)       | kit    | Why the piece script says hello again: one hello before the page listens is lost               |
| [kit-app-frame](kit-app-frame.md)                   | kit    | An app frame: live, the hello and the port, a new look, close, closed, removed                 |
| [kit-app-frame-no-close](kit-app-frame-no-close.md) | kit    | Why the page posts close first: an iframe removed at once never runs the app's ends            |
| [kit-frame-axes](kit-frame-axes.md)                 | kit    | The locale and data state picks of capsule frames: posted, offered, composed again             |
| [kit-frame-controls](kit-frame-controls.md)         | kit    | The controls of an app frame: posted, drawn in the panel, run in the live scope                |
| [kit-control-link](kit-control-link.md)             | kit    | A pane of a frame in its own scope: linked to each scope, a mirror of its cells, calls         |
| [kit-runtime](kit-runtime.md)                       | kit    | The runtime of a kit version: kept after an update, accepted by the team, put again            |
| [kit-runtime-same-text](kit-runtime-same-text.md)   | kit    | Why the same TSX on another runtime is a new version: else a put after an accept is lost       |

`queue-two-step`, `frames-writes-two-step`, `fixer-claim-unsafe`, `kit-look-unbound`,
`kit-look-hello-once`, `kit-app-frame-no-close`, `kit-runtime-same-text` and `viewer-pages-old-page` break on purpose. Each shows the bug that a
design prevents: one write for a claim or a save, the fixer's two guards (the process-group stop
and the check again before the push), a request that keeps its kit version, a piece script that
says hello until it gets a port, a page that posts `close` before it removes an app frame, a put that compares the runtime too, and a pick of a request that asks for the frame, not for an old page. Its row in `charts.tsv` says `breaks`.

## Files

- `<chart>.md`: the chart's page.
- `models/<module>/`: each model's `<Name>.tla`, its configs (`<Name>.cfg`, or one per chart, such
  as `QueueTwoStep.cfg`) and its view module, the words on the chart. A view module's name varies:
  `view.mjs` (access, queue-lease), `view-two-step.mjs` (queue-two-step), or `<Name>.view.mjs`
  (the others). Two charts may share one model and one view, with their own configs.
- `charts.tsv`: one row per chart: `chart`, `tla`, `cfg`, `view`, `expect` (`holds` or `breaks`).
  Paths are relative to this folder. It is the source of each chart's files: the table above lists
  every row of it, and changes with it in the same ship.

## Make the charts again, or check them

```sh
scripts/statecharts.sh --check              # change nothing; fail on a difference
scripts/statecharts.sh                      # rewrite each chart that differs
scripts/statecharts.sh --check queue-lease  # only the charts named
```

For each row of `charts.tsv`, it runs TLC on the model and makes the chart. With no flag, it
rewrites the one `mermaid` code block in the chart's page, in place, when the block differs; the
rest of the page stays. With `--check`, it changes nothing: it compares the block with the chart it
made, and fails on a difference.

It prints one line per chart: `ok`, `DIFF` or `BROKE`. `BROKE` means TLC's verdict is not the one
in `charts.tsv`, or the chart could not be made.

The script runs easel's own copy of the generator, `vendor/statechart` (the `statechart` script of
[pstack](https://github.com/backnotprop/pstack), MIT, pinned by `scripts/statechart-sync.sh`), with
Bun on `PATH`. The hub removed its machine tool on 2026-11-21, so easel keeps this copy.
`scripts/tlc.sh` gets Java (Temurin JRE) and TLC (`tla2tools.jar`) at pinned SHA-256 into
`~/.cache/easel/tlc` on its first run, so it needs the network once.

`scripts/ship.sh` runs `--check` as a gate, on this host, when a ship changes `docs/statecharts/`,
a `SPEC*.md`, `vendor/statechart/`, `scripts/statecharts.sh` or `scripts/tlc.sh`. A red check
commits nothing; ship never skips the check. CI does not run it yet.
