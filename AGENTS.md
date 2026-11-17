# Working on this app

This app runs on Tinker: `@tinkered/core`,
`@tinkered/react`, `@tinkered/bun`.
The rules for Tinker code ship inside those
packages as skills. A skill has the version of
the code you have installed.

<!-- intent-skills:start -->

## Skill Loading

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before editing files for a substantial task:

- Run `bunx --no-install --package @tanstack/intent intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx --no-install --package @tanstack/intent intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.

<!-- intent-skills:end -->

## After you edit: run the check

1. `bun run check:plain` runs `tinker check`.
   It runs four stages: types, rules, tests,
   then exits. An exit is one way out of an
   operation: each `kind` of its answer, a
   refusal, or a plain return. A test must reach
   each one.
   A finding is one line, then its fix:
   `<file>:<line> <rule id> <what is there>`.
   The last line says what to do next.
   Fix each finding, then run it again.
   Only `tinker check: OK` says the code is done.
2. `bun run check:style`: format and lint.
3. `bun run check`: types, tests, build.

No cast: no `as` but `as const`, no `!`, no `any`.
A `switch` on a call's `kind` has a case for
each kind, and no `default`.

A test scope lists `exits` first, so the check
sees what the test reached:
`exits({ file: process.env.TINKER_EXITS })` in a
server test, `exits({ store: localStorage })` in
a browser test.

An exception to a rule goes in `tinker.json`,
with its reason.
Do not add one to make a check pass.

## Trunk: how work lands

`main` is the only branch. No feature branches,
no PRs, no worktrees. Several agents share this
one checkout.

- Land work with
  `scripts/ship.sh -m "<type>(<scope>): <msg>" -- <paths>`.
  Name only your own paths. Ship gates that exact
  tree on HEAD, then commits and pushes it.
  A red gate commits nothing and prints its log.
- Never `git add -A`, `git commit` or `git push`
  by hand. The pre-push hook refuses a push to
  main that did not come from ship.
- Ship small and often: each ship is one unit
  that ends green. Hide unfinished work behind a
  route that nothing links to, or a flag. Never
  use a branch for it.
- A dirty file you did not change belongs to
  another agent. Do not edit, format, revert or
  stash it. Agree on a shared file (such as
  `package.json`) with its owner first
  (`ListAgents`, `SendMessage`).
- The gate: `check:style`, `check:plain`, `build`,
  then `bun run smoke`. A docs-only ship
  (`*.md`) runs `check:style` only; a ship
  touching `SPEC*.md` or `docs/statecharts/`
  also runs `scripts/statecharts.sh --check`.
- After the push, CI `gates` runs. A red main
  opens a `trunk-red` issue. The line stops: only
  `ship.sh --fix` (fix forward) or
  `ship.sh -r <sha>` (revert) ship until it
  closes. Fix or revert within 10 minutes.

## Browser smoke

`bun run smoke` starts the built binary and
drives it in a real browser with `agent-browser`.
It proves what no cheaper test can: build,
embedded client, server and socket work
together. It is the expensive test, so it holds
only the critical paths:

- `boot`: `/` loads, and its loader's rpc call
  returns.
- `live-todo`: an add goes over the socket,
  comes back on the live list, and survives a
  reload.

A new flow must name a path users cannot work
without that `tests/` cannot prove. Prefer
replacing a flow to adding one. Keep all flows
under 30 s. When the canvas lands, it gets one
flow: open a board, frames show, pan and zoom.

To look at a UI change by hand, use your own
session and close it after:
`agent-browser --session "$(agent-browser session id --scope worktree --prefix easel)" open <url>`.
Read `agent-browser skills get core` first. Put
screenshots in `~/work/tmp/`, never in the repo.

## pstack skills

pstack (MIT, github.com/backnotprop/pstack) is
vendored in `.claude/skills/` at one pinned
commit by `scripts/pstack-sync.sh`. Do not edit
those folders. To upgrade, change the commit in
the script, run it, read the diff, and ship it.
`statechart` comes from the hub
(`~/.claude/skills/statechart`). The human runs
any of them as `/<name>`, for example
`/poteto-mode`. Agents cannot invoke them, so
read the `SKILL.md` at these moments:

| Moment                                                     | Read                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A feature with state (canvas modes, selection, drag)       | `statechart`, before UI or code                                                       |
| Writing or changing a test                                 | `principle-test-behavior-not-implementation`; `tdd` for a bug with a cheap local test |
| Splitting work into ships                                  | `principle-sequence-verifiable-units`                                                 |
| A ship you do not fully trust (shared code, socket, build) | `blast-radius`                                                                        |
| Before you say "done"                                      | `principle-prove-it-works`: run the smoke, or look with `agent-browser`               |
| Editing `.ts` or `.tsx`                                    | `typescript-best-practices`                                                           |
| Docs and commit messages                                   | `unslop`                                                                              |

Trunk rules (this file) override any branch, PR
or worktree advice in them (for example the
`poteto-mode` playbooks `opening-a-pr`,
`babysit` and `worktree-cleanup`). Where pstack
disagrees with this file or a Tinker skill, this
file and Tinker win.
