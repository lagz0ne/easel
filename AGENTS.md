# Working on this app

This app runs on Tinker: `@tinkered/core`,
`@tinkered/react`, `@tinkered/bun`.
The rules for Tinker code ship inside those
packages as skills. A skill has the version of
the code you have installed.

## Roles

Each agent in this repo has one role (the user decided this on 2026-11-25). The terms are in
`docs/glossary.md`.

| Role          | Who                                              | What it does                                                                                                                       |
| ------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| feature lead  | A session that the person starts                 | The only agent in charge of one feature. It writes the feature brief, gives the work to workers, reviews, verifies and ships.      |
| worker        | A subagent of a feature lead                     | It does one worker brief, and gives back its diff and the evidence. It does not ship.                                              |
| request agent | An agent that a request on the live easel starts | It does that one request and ships it. It does not change a claimed path of a feature: it tells that feature lead (`SendMessage`). |

- A feature lead does not do the work itself. It edits only `*.md` files: the brief, the spec, the
  plan, the docs. Workers write the code, the tests and the frames.
- Only a feature lead or a request agent ships. A worker never runs `scripts/ship.sh`, `git add`,
  `git commit` or `git push`. The feature lead reviews each diff of a worker before it ships it.
- This workflow is for easel only. Your neighbours are the agents that work in this repo
  (`~/dev/easel`). `ListAgents` also lists sessions of other projects: ignore them, and do not
  coordinate with them. When a name does not tell the repo, read the field `cwd` of the paseo
  record `~/.paseo/agents/<workspace>/<id>.json`.
- All roles: "Writing", "After you edit", "Code has no comments", "Skill Loading", and the machine
  rules (`offload` for a heavy run, `work new` for temporary files). The other sections are for
  the roles that ship.

## A feature: from start to done

A feature is one journey, one spec delta or one fix. It has one outcome, and its feature lead is
responsible for all of it. Load the skill `feature-lead` at the start: it has the detail of each
step, the questions, the prompts and the stop rules. The form of a feature brief is in
[docs/features/README.md](docs/features/README.md).

1. Read the open briefs in `docs/features/`, and run `ListAgents`.
2. Write your brief `docs/features/<slug>.md` from Socratic questions. The person accepts it one
   time. Do not start the build before that.
3. Write the spec as `SPEC-<slug>.md` and the plan as `tasks/<slug>.md`. A new need goes through
   `writing-requirements` first.
4. Workers build. Only one worker at a time writes a set of paths. Do not use a worktree.
5. Verify: do each line of "Verification" in the brief. Run the checks yourself, and use a new
   reviewer subagent that did not build the work.
6. Ship, then wait until `/api/version` shows the change live.
7. The person confirms a feature on the live easel. A fix needs only the live proof.
8. Close the brief: set its status to `closed` and remove its claimed paths.

## Gates: what needs the person

Only these stop for the person. For each other decision: decide, write it in the decisions log of
the brief, and report it after.

- Accept the brief.
- Lift a "must not", or bring a "not in" into the feature.
- Change a definition of the brief: the outcome, success, not in, must not, should not,
  verification or confirmation.
- Confirm a feature.
- Do an action that cannot be undone, or that goes outside the repo: delete data, use a secret,
  change the machine (through the hub).

Bring each gate with your recommendation and its reason. A design decision comes with 2 or 3
variations on the design canvas, and your pick.

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
- File rights go by feature brief, not by session. A feature lead claims paths in its brief, and
  its workers share those paths.
- A dirty file on a path that your brief does not claim belongs to another feature. Do not edit,
  format, revert or stash it.
- For a path that two briefs claim, or a shared file (such as `package.json`), agree with the
  other feature lead first (`ListAgents`, `SendMessage`). Ship your hunks with `ship.sh -p <patch>`.
- Before a ship or a test that load can fail, wait for a load below 10:
  `awk '{exit !($1<10)}' /proc/loadavg && scripts/ship.sh ...`. A red from timeouts under load is
  not a bug of the code. Wait, then run it again.
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
skills are the project's own, and the sync script does not touch them: `feature-lead`,
`writing-requirements` and `epic-flow`. The skills load on their own; at these moments, make
sure the right one is loaded:

| Moment                                                    | Skill                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| A feature or a fix starts                                 | `feature-lead` (the project's own): the brief, then the person accepts it |
| A task goes to a worker                                   | `feature-lead`: the worker brief                                          |
| A feature with state (canvas modes, selection, drag)      | a TLA+ model and its chart (`scripts/statecharts.sh`), before UI or code  |
| Writing or changing a test; fixing a bug                  | `test-driven-development`                                                 |
| Splitting work into ships                                 | `planning-and-task-breakdown`, `incremental-implementation`               |
| Before you say "done"                                     | each line of "Verification" in the brief; the smoke, or `agent-browser`   |
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
  is shared and dirty. Its `tasks/plan.md` is `tasks/<slug>.md` here.
- `spec-driven-development` has 4 human reviews (`SKILL.md:26-32`), and
  `.claude/references/definition-of-done.md:51` asks for a human approval before a deploy. Both
  yield to "Gates": the person accepts the brief, and the feature lead does the other reviews.
- `.claude/references/orchestration-patterns.md:80` and `:90` say that there is no orchestrator
  agent. That does not apply to a feature lead.
- `git-workflow-and-versioning` (branches and PRs) and `browser-testing-with-devtools` (Chrome
  DevTools MCP) are left out. Where a vendored file names them, or gives branch or PR advice, land
  work with `scripts/ship.sh` and test the browser with `agent-browser`.
