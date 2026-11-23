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

## Writing: ASD-STE100

ASD-STE100 (Simplified Technical English,
Issue 9) is the official rule for all writing
in this project: replies to the user, docs,
specs, ADRs, commit messages, and the text that easel shows (CLI, errors,
pages). The user decided this on 2026-11-22.

- Keep a sentence short: 20 words at most for
  an instruction, 25 for a description.
- Write one instruction in each sentence. Use
  the imperative for an instruction.
- Use the active voice and simple tenses
  (present, past, future).
- Give each word one meaning. Use the terms of
  `docs/glossary.md` (Rule 1.8). Do not use a
  technical noun as a verb (Rule 1.7).
- Use common words. Do not use slang, idioms or
  long chains of nouns. Keep the articles.
- Do not use an `-ing` word as a noun.
- Put 6 sentences at most in a paragraph, on
  one topic. Write steps as a numbered list.
- Keep code, paths, IDs and quotes exact.
  Quotes of the user stay as the user wrote
  them.

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

## Code has no comments

The code itself explains what it does and why
(the user decided this on 2026-11-23). This
rule has no exception: no comment, no JSDoc,
no `@ts-expect-error`, no lint directive.

- Give the reason in a name: a function, a
  variable, a type or a test title.
- Split a long step into a function with a
  name that says its purpose.
- Prove a rule of the types with
  `expectTypeOf`, not with a directive.
- Put a usage text in a `--help` output.
- Put a decision in an ADR, a spec or the
  commit message.

A comment in a test fixture or a string is
data, not a comment. Vendored code
(`vendor/`, `.claude/`) keeps its comments.

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
- Deploy first (the user chose it on
  2026-11-23): a push is live in about 1 minute.
  The ship gate is fast: `check:style` and
  `typecheck`. A docs-only ship (`*.md`) runs
  `check:style` only, and does not deploy.
- Before the push, run the tests of your change
  yourself. Use `ship.sh --full` for a risky
  change: it adds `check:plain`, `build`,
  `bun run smoke` and, for `SPEC*.md` or
  `docs/statecharts/`, `scripts/statecharts.sh --check`.
- After the push, CI `gates` runs all of these
  and the speed gate. A red main puts the live
  site back on the last green commit and opens a
  `trunk-red` issue. The line stops: only
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

## The easel tools (MCP)

`.mcp.json` gives each agent here the tools of the
live easel: `easel mcp`, as the member
`vibea-claude` (its login is in
`~/.config/easel-agent`). Owner tools are refused.
An owner revokes it with
`easel users revoke vibea-claude`. After a
deploy, run the install script again
(`curl -fsSL https://easel.vibea.dev/install.sh | sh`)
to get the new `easel`.

## agent-skills

Addy Osmani's agent-skills (MIT) is vendored
at one pinned commit by
`scripts/agent-skills-sync.sh`: skills in
`.claude/skills/`, their `.claude/references/`,
four `.claude/agents/`, and the commands as
`/addy-*` (`/addy-spec`, `/addy-plan`, ...).
Do not edit them. To upgrade, change the commit
in the script, run it, read the diff, and ship
it. These skills load on their own; at these
moments, make sure the right one is loaded:

| Moment                                                    | Skill                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| A feature with state (canvas modes, selection, drag)      | a TLA+ model and its chart (`scripts/statecharts.sh`), before UI or code |
| Writing or changing a test; fixing a bug                  | `test-driven-development`                                                |
| Splitting work into ships                                 | `planning-and-task-breakdown`, `incremental-implementation`              |
| Before you say "done"                                     | run the smoke, or look with `agent-browser`                              |
| A design on the Doop canvas changes                       | `bun run design:proof` until it prints OK; show its output               |
| Docs and decisions                                        | `documentation-and-adrs`                                                 |
| Requirements: a round, an epic, a journey, a design check | `writing-requirements` (the project's own; method in `docs/method.md`)   |
| An agreed epic gets its design; prove it, round by round  | `epic-flow` (the project's own): a fresh reviewer each round, 5 at most  |

Two skills are the project's own, not Addy's:
`writing-requirements` and `epic-flow`. The sync
script does not touch them.

Two are left out because they contradict this
file: `git-workflow-and-versioning` (branches
and PRs) and `browser-testing-with-devtools`
(Chrome DevTools MCP). Where a vendored file
still names them, land work with
`scripts/ship.sh` and test the browser with
`agent-browser`.

Trunk rules (this file) override any branch or
PR advice in them. Where they disagree with this
file or a Tinker skill, this file and Tinker win.
