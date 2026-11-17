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

| Chart                                               | Module | What it shows                                                                             |
| --------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| [access-login](access-login.md)                     | access | Logging in: the setup code, a login code, approve, deny, revoke                           |
| [frames-writes](frames-writes.md)                   | frames | Two writers on one frame: the first write on a version wins, the other gets `stale`       |
| [frames-writes-two-step](frames-writes-two-step.md) | frames | Why a save is one write: a check then a write saves on an old version                     |
| [frames-pictures](frames-pictures.md)               | frames | A frame's picture: rendered, current, old, and gone with its frame                        |
| [frames-share](frames-share.md)                     | frames | A share link: shared, password set or changed, passes, unshared                           |
| [queue-lease](queue-lease.md)                       | queue  | A comment: open, claimed, extended, released, resolved, stuck                             |
| [queue-two-step](queue-two-step.md)                 | queue  | Why a claim is one write: a pick then a write gives one comment to two agents             |
| [ops-issues](ops-issues.md)                         | ops    | An error group: open, resolved, regressed, evicted                                        |
| [fixer-claim-issue](fixer-claim-issue.md)           | fixer  | A fixer claims a group and opens one issue for it                                         |
| [fixer-claim-fix](fixer-claim-fix.md)               | fixer  | A fixer ships a fix, notes it, and gives up after two                                     |
| [fixer-probe](fixer-probe.md)                       | fixer  | The probe: it sees whether the fixer still ticks                                          |
| [fixer-claim-unsafe](fixer-claim-unsafe.md)         | fixer  | Why the fixer needs a guard: with neither, an orphaned `ship.sh` pushes without the claim |
| [viewer-gate](viewer-gate.md)                       | viewer | Opening a link: the password, the pass, an ended link                                     |
| [viewer-canvas](viewer-canvas.md)                   | viewer | The canvas: live frames, pan and zoom, reconnecting                                       |
| [viewer-pin-post](viewer-pin-post.md)               | viewer | Posting a comment: typed, sent, saved, or a fault                                         |
| [viewer-pin-link](viewer-pin-link.md)               | viewer | A pin when its link ends: the typed text stays to copy                                    |
| [viewer-queue](viewer-queue.md)                     | viewer | The queue panel: open, claimed, stuck, resolved                                           |

`queue-two-step`, `frames-writes-two-step` and `fixer-claim-unsafe` break on purpose. Each shows
the bug that a design prevents: one write for a claim or a save, and the fixer's two guards (the
process-group stop and the check again before the push). Its row in `charts.tsv` says `breaks`.

## Files

- `<chart>.md`: the chart's page.
- `models/<module>/`: each model's `<Name>.tla`, its configs (`<Name>.cfg`, or one per chart, such
  as `QueueTwoStep.cfg`) and its view module, the words on the chart. A view module's name varies:
  `view.mjs` (access, queue), `view-two-step.mjs` (queue-two-step), or `<Name>.view.mjs` (the
  others). Two charts may share one model and one view, with their own configs.
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

The script runs the statechart skill from the hub (`~/.claude/skills/statechart`), with Bun on
`PATH`. Its first run installs TLC and Java, so it needs the network once.

`scripts/ship.sh` runs `--check` as a gate, on this host, when a ship changes `docs/statecharts/`,
a `SPEC*.md` or `scripts/statecharts.sh`. A red check commits nothing. Without the skill, ship
refuses such a ship; it does not skip the check. CI does not run it: CI has no skill.
