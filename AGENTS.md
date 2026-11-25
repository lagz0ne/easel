# Working on this app

This app runs on Tinker: `@tinkered/core`,
`@tinkered/react`, `@tinkered/bun`.
The rules for Tinker code ship inside those
packages as skills. A skill has the version of
the code you have installed.

## Leads and missions

The person starts a few leads, and gives each lead one mission (the user decided this on
2026-11-25). A lead does all that its mission needs, in each part of the code. Load the skill
`mission-lead` at the start. The terms are in `docs/glossary.md`.

- **Name.** The title of a lead is `m: <mission>`, for example `m: cases`.
- **Lead.** It plans, gives the work to workers (its subagents), reviews each diff of a worker,
  verifies, and ships. A worker never runs `scripts/ship.sh`, `git add`, `git commit` or `git push`.
- **Mission file.** `tasks/<mission>.md`. Its top has 4 short parts: Mission, Success, Nono (Not
  in, Must not) and Verify. Then come "Touching" (the paths that the mission changes now) and the
  plan. Fill the top from Socratic questions to the person. The person accepts it one time. Do
  not build before that.
- **Leads talk**, because they share one checkout. At the start, run `ListAgents` and read the
  open mission files in `tasks/`. Send each other lead one short message: your mission, and what
  you touch. Before you change a file that another open mission touches, message its lead and
  agree. After a ship that changes a thing that another mission uses, tell its lead. Keep
  "Touching" current.
- **Easel only.** The other leads are the agents that work in this repo (`~/dev/easel`).
  `ListAgents` also lists sessions of other projects: ignore them. When a name does not tell the
  repo, read the field `cwd` of `~/.paseo/agents/<workspace>/<id>.json`.
- **Gates.** Stop for the person only for these: to accept the top of the mission file; when the
  work needs a Nono item; when the mission must change; before an action that cannot be undone or
  that goes outside the repo (delete data, use a secret, change the machine through the hub).
  Bring your recommendation and its reason; for a design decision, bring 2 or 3 variations on the
  design canvas and your pick. Decide all other things yourself, and put them in the report.
- **Session life.** A lead session ends when its mission is done. At its second compaction,
  hand over to a new session (skill `paseo-handoff`): the mission file is the memory.
- **Done.** When `/api/version` shows the change live and "Verify" is done, send the person one
  short report: each success check with its evidence, and what is open.
- **Request agent.** An agent that a request on the live easel starts does that one request and
  ships it. It does not change a file that an open mission touches: it tells that lead.

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

`main` is the only branch. No feature branches, no PRs, no worktrees. Several agents share this
one checkout.

- Land work with `scripts/ship.sh -m "<type>(<scope>): <msg>" -- <paths>`. Name only your own
  paths. Ship gates that exact tree on HEAD, then commits and pushes it. A red gate commits
  nothing and prints its log.
- Never `git add -A`, `git commit` or `git push` by hand. The pre-push hook refuses a push to
  main that did not come from ship.
- Ship small and often: each ship is one unit that ends green. Hide unfinished work behind a route
  that nothing links to, or a flag. Never use a branch for it.
- File rights go by the "Touching" lists of the open missions (`tasks/`), not by session. A dirty
  file that your mission does not touch belongs to another mission. Do not edit, format, revert
  or stash it.
- For a file that two missions touch, or a shared file (such as `package.json`), agree with the
  other lead first (`ListAgents`, `SendMessage`). Ship your hunks with `ship.sh -p <patch>`.
- After a restart or a killed session, each lead lists the dirty files of its mission first. Ship
  them or start them again within 1 hour. A dirty file that no mission touches goes to the person.
- `scripts/ship.sh` waits for a load below 10, at most 10 min, and formats your named files first. It
  adds one line for each run to `~/.cache/ship/easel/runs.jsonl`. Before a test that load can fail,
  wait for a load below 10: `awk '{exit !($1<10)}' /proc/loadavg`. A red from timeouts under load
  is not a bug of the code. Wait, then run it again.
- Deploy first (the user chose it on 2026-11-23): a push is live in about 1 minute. The ship gate
  is fast: `check:style` and `typecheck`. A docs-only ship (`*.md`) runs `check:style` only, and
  does not deploy.
- Before the push, run the tests of your change yourself. Use `ship.sh --full` for a risky change:
  it adds `check:plain`, `build`, `bun run smoke` and, for `SPEC*.md` or `docs/statecharts/`,
  `scripts/statecharts.sh --check`.
- After the push, CI `gates` runs all of these and the speed gate. A red main puts the live site
  back on the last green commit and opens a `trunk-red` issue. The line stops: only
  `ship.sh --fix` (fix forward) or `ship.sh -r <sha>` (revert) ship until it closes. Fix or
  revert within 10 minutes.

## Browser smoke

`bun run smoke` starts the built binary and drives it in a real browser with `agent-browser`. It
proves what no cheaper test can: build, embedded client, server and socket work together. It is
the expensive test, so it holds only the critical paths:

- `boot`: `/` loads, its loader's rpc call returns, and the sign-in page shows.
- `live-todo`: an add goes over the socket, comes back on the live list, and survives a reload.
- `canvas`: the CLI signs in and makes a canvas, a frame and its picture. The sign-in link opens
  the home page, and the home page opens the canvas. The share link shows the frame in the look of
  the kit. Zoom and pan work. A new frame of the agent shows with no reload.

A new flow must name a path users cannot work without that `tests/` cannot prove. Prefer
replacing a flow to adding one. Keep all flows under 30 s.

To look at a UI change by hand, use your own session and close it after:
`agent-browser --session "$(agent-browser session id --scope worktree --prefix easel)" open <url>`.
Read `agent-browser skills get core` first. Put screenshots in `~/work/tmp/`, never in the repo.

## The easel tools (MCP)

`.mcp.json` gives each agent here the tools of the live easel: `easel mcp`, as the member
`vibea-claude` (its login is in `~/.config/easel-agent`). Owner tools are refused. An owner
revokes it with `easel users revoke vibea-claude`. After a deploy, run the install script again
(`curl -fsSL https://easel.vibea.dev/install.sh | sh`) to get the new `easel`.

Reply to a request on the live easel (`resolve_request`) only when the change is live. "Shipped"
is not sufficient. The change is live when `curl -s https://easel.vibea.dev/api/version` gives a
commit for which `git merge-base --is-ancestor <your sha> <live commit>` is true. Keep the claim
with `extend_request` while you wait.

## GitHub issues

File each issue, comment or label in a repo of `lagz0ne` as `lagz0ne`. Do not switch the active
`gh` account of the machine, and never print the token:
`GH_TOKEN="$(gh auth token --user lagz0ne)" gh issue create -R lagz0ne/easel ...`.

## agent-skills

Addy Osmani's agent-skills (MIT) is vendored at one pinned commit by
`scripts/agent-skills-sync.sh`: skills in `.claude/skills/`, their `.claude/references/`, four
`.claude/agents/`, and the commands as `/addy-*` (`/addy-spec`, `/addy-plan`, ...). Do not edit
them. To upgrade, change the commit in the script, run it, read the diff, and ship it. Three
skills are the project's own, and the sync script does not touch them: `mission-lead`,
`writing-requirements` and `epic-flow`. The skills load on their own; at these moments, make
sure the right one is loaded:

| Moment                                                    | Skill                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| A mission starts                                          | `mission-lead` (the project's own): the top of the mission file           |
| A task goes to a worker                                   | `mission-lead`: "Workers"                                                 |
| A feature with state (canvas modes, selection, drag)      | a TLA+ model and its chart (`scripts/statecharts.sh`), before UI or code  |
| Writing or changing a test; fixing a bug                  | `test-driven-development`                                                 |
| Splitting work into ships                                 | `planning-and-task-breakdown`, `incremental-implementation`               |
| Before you say "done"                                     | each line of "Verify" in the mission file; the smoke, or `agent-browser`  |
| A feature with state is verified                          | `scripts/statecharts.sh --check`, and the conformance review of its model |
| A design on the Doop canvas changes                       | `bun run design:proof` until it prints OK; show its output                |
| Docs and decisions                                        | `documentation-and-adrs`                                                  |
| Requirements: a round, an epic, a journey, a design check | `writing-requirements` (the project's own; method in `docs/method.md`)    |
| An agreed epic gets its design; prove it, pass by pass    | `epic-flow` (the project's own): a new reviewer each pass, 5 at most      |

### Overrides of vendored files

This file and the Tinker skills win over a vendored file. The known cases, with the lines at the
pinned commit:

- `.claude/commands/addy-spec.md:20` saves to `SPEC.md`. Write `SPEC-<slug>.md`.
- `.claude/commands/addy-build.md:33` asks for a clean baseline. It does not apply: the checkout
  is shared and dirty. Its `tasks/plan.md` is `tasks/<mission>.md` here.
- `spec-driven-development` has 4 human reviews (`SKILL.md:26-32`), and
  `.claude/references/definition-of-done.md:51` asks for a human approval before a deploy. Both
  yield to the gates above: the person accepts the top of the mission file, and the lead does
  the other reviews.
- `.claude/references/orchestration-patterns.md:80` and `:90` say that there is no orchestrator
  agent. That does not apply to a lead.
- `git-workflow-and-versioning` (branches and PRs) and `browser-testing-with-devtools` (Chrome
  DevTools MCP) are left out. Where a vendored file names them, or gives branch or PR advice, land
  work with `scripts/ship.sh` and test the browser with `agent-browser`.
