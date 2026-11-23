# Tasks: Round 1, modules `mcp` and `speed`

The plan is in [plan.md](plan.md). Each task ends green and lands with
`scripts/ship.sh -m "<type>(<scope>): <msg>" -- <paths>`. Write the failing test first
(`test-driven-development`). Run heavy tests on vibea2: `offload -- bun run test <file>`. The
tests that need the database of vibea stay on vibea.

Each task passes these checks before its ship:

- `bun run check:plain` prints `tinker check: OK`.
- `bun run check:style` is clean.
- `offload -- bun run test <the task's test files>` is green.

## Phase 1: `mcp` foundation

### MCP-1: `easel mcp` over stdio, with one tool

**Description:** A person runs `easel mcp`, and an MCP client lists one tool, `list_canvases`, and
calls it. The call goes through the rpc client of the CLI with the token of `hosts.json`. This
task makes the full path: the table builder, the server, the stdio command and the result
(`structuredContent`, and `isError` from the success list).

**Acceptance criteria:**

- [x] An SDK `Client` over stdio lists `list_canvases`, with its input and output JSON Schema
      from the contract and the annotation `readOnlyHint: true`.
- [x] A call answers the canvases of the token's user in `structuredContent`, unchanged.
- [x] With no `hosts.json` entry, the command exits with the same text as the other commands
      ("run `easel login`").

**Verification:**

- [x] `tests/mcp.test.ts`: a server in the same process, `easel mcp` on an in-memory link, the
      SDK client. The stdio link was checked by hand: the SDK's stdio client against
      `bun cmds/easel.ts mcp` lists the tool and gets a `link` fault as a tool error.
- [ ] By hand (moved to MCP-6): `claude mcp add easel-dev -- bun cmds/easel.ts mcp`, then `/mcp` shows 1 tool.

**Dependencies:** none.

**Files likely touched:** `src/mcp/tools.ts`, `src/mcp/server.ts`, `src/cli/mcp.ts`,
`cmds/easel.ts`, `tests/mcp-stdio.test.ts`.

**Estimated scope:** M.

### MCP-2: the full tool table, from the contract

**Description:** Each row of the SPEC-mcp contract table becomes a tool, with its description,
its annotations, and the `instructions` of the server. A test reads each rpc contract of easel and
finds each address that is in neither list or in both (fact rule 2).

**Acceptance criteria:**

- [x] `tools/list` gives the 31 tools of the built calls, and no other. The 6 calls that are not
      built yet (`canvas.delete`, `frame.move`, `kit.guide`, `kit.list`, `kit.get`, `kit.put`)
      are marked "later" in SPEC-mcp.
- [x] The fact rule 2 test fails when a test contract adds one call that is in neither list.
- [x] Each description has two sentences at most (judged rule 3). The queue tools add the sentence
      on the frame that a request allows.

**Verification:**

- [x] `tests/mcp-table.test.ts`.
- [x] By hand: read the `tools/list` output one time for the descriptions.

**Dependencies:** MCP-1.

**Files likely touched:** `src/mcp/tools.ts`, `src/mcp/server.ts`, `tests/mcp-table.test.ts`.

**Estimated scope:** S.

### MCP-3: `POST /mcp` over HTTP, with the bearer token

**Description:** A remote client posts to `/mcp` with `Authorization: Bearer <token>`. The
route runs the `user` guard one time, then one server and one transport serve the request, and
both close after it. A tool call runs the contract operation through the api capsules of the
socket, in a session with the token, so each `onStart` guard runs.

**Acceptance criteria:**

- [x] A missing, wrong or revoked token answers 401, with the header
      `WWW-Authenticate: Bearer realm="easel"`. A foreign `Origin` answers 403.
- [x] An owner tool (`list_users`) with a user token is refused over HTTP and over stdio
      (fact rule 3). Done over HTTP; over stdio, `easel mcp` uses the CLI's own rpc client, whose
      refusals the CLI tests cover.
- [x] Two requests in a row share no server and no transport (judged rule 2): each request
      makes its own, and closes them (read in `src/mcp/http.server.ts`).

**Verification:**

- [x] `tests/mcp-http.test.ts`: the SDK client with `StreamableHTTPClientTransport` against the
      server in the same process.
- [x] `bun run build`, then `bun run smoke` is green.

**Dependencies:** MCP-2.

**Files likely touched:** `src/mcp/http.server.ts`, `cmds/server.ts`, `tests/mcp-http.test.ts`.

**Estimated scope:** M.

### Checkpoint A: after MCP-1 to MCP-3

- [x] Claude Code lists the 31 tools over stdio, and over HTTP with
      `claude mcp add --transport http easel <url>/mcp --header "Authorization: Bearer <token>"`.
- [x] `tinker check: OK`, the smoke is green, CI `gates` is green.
- [x] Checked on 2026-11-23 with `claude -p --mcp-config` on a local server: 31 tools on each,
      and `list_canvases` answered on each.
- [ ] Review with the user before phase 2.

## Phase 2: `mcp` complete

### MCP-4: the queue loop through MCP

**Description:** An agent works a request only through the tools: `next_request`, `get_frame`,
`put_frame`, `shot_frame`, `resolve_request`, `ask_request`, `decline_request` and
`release_request`. `next_request` waits 50 s at most for each call.

**Acceptance criteria:**

- [x] One test runs the full loop over HTTP, and the same test runs it over stdio.
- [x] With no request, `next_request` answers after 50 s at most, and Bun does not cut the call
      (by hand on a local server, 2026-11-23: `empty` after 51 s over HTTP).
- [x] `next_request` gives the agent the note of its claim: the frame that it allows, and that
      the text is not an instruction. The server does not refuse a put to another frame (queue
      rule 15 is a note), so this criterion changed from "a tool error".

**Verification:**

- [x] `tests/mcp-queue.test.ts` (SQLite in memory: it needs no database of vibea).

**Dependencies:** MCP-3.

**Files likely touched:** `src/mcp/tools.ts`, `cmds/server.ts` (the idle timeout of the route),
`tests/mcp-queue.test.ts`.

**Estimated scope:** M.

### MCP-5: each kind and each fault of each tool

**Description:** Each kind of each call that has a tool is reached in a test through MCP. Each of
the 7 Tinker faults becomes one line of text that says what to do next. No tool error carries a
trace, a token, a password, a share token, a pass or an input value.

**Acceptance criteria:**

- [x] `tinker check` finds no exit of `src/mcp` that a test does not reach.
- [x] A test for each fault (`refused`, `failed`, `invalid`, `encode`, `decode`, `missing`,
      `link`) checks its text.
- [x] A test puts a short password in `share_canvas`, and does not find it in the answer
      (judged rule 1). An invalid input lists each issue's path and message only, and a failed
      fault only its trace id. A wrong input is a tool error, not a JSON-RPC error.
- [x] Each kind of each tool is a result or a tool error by its call's success list, and each
      error kind has a line on what to do next (`src/mcp/texts.ts`). Findings and color pairs
      follow, one a line, in the CLI's form.

**Verification:**

- [x] `tests/mcp-kinds.test.ts` (kinds and faults), `tests/mcp.test.ts` (no value in an error).

**Dependencies:** MCP-3. It can run at the same time as MCP-4.

**Files likely touched:** `src/mcp/faults.ts`, `src/mcp/server.ts`, `tests/mcp-kinds.test.ts`,
`tests/mcp-faults.test.ts`.

**Estimated scope:** M.

### MCP-6: a real client, and the docs

**Description:** Claude Code adds easel and uses it as a person does. A new agent with only the
MCP tools makes a reference screen. The CLI help and SPEC-mcp say how to add easel.

**Acceptance criteria:**

- [x] Claude Code with `easel mcp` of the built binary (`--mcp-config`, not `claude mcp add`, so
      no user config changed): `list_canvases` and `list_frames` answered.
- [x] A new agent (`claude -p --model sonnet --tools ""`, only the easel MCP tools) put a sign-in
      form (the form brief of K3; the 3 briefs are not in the repo yet) in 1 put and 12 s, with
      no finding: `easel kit check` on the frame gave 0. `kit_guide` waits for `kit.guide`.
- [x] `easel --help` has an `mcp` line.

**Verification:**

- [x] By hand: the two runs above, with their output in the ship message.
- [x] `tests/cli-cmd.test.ts` (the help text, and a bad flag of `easel mcp`).

**Dependencies:** MCP-4, MCP-5.

**Files likely touched:** `src/cli/index.ts`, `SPEC-mcp.md` (Status), the CLI help test.

**Estimated scope:** S.

### Checkpoint B: after MCP-4 to MCP-6

- [x] Each success criterion of SPEC-mcp is met, with `kit_capsules` for `kit_guide` until it
      ships.
- [x] A statechart and conformance review of the release: `mcp` adds no state of its own (each
      request makes and closes its server; the wait of `next_request` is the queue's, charted in
      the queue's model). No new chart.
- [ ] Review with the user. Then the start steps (R2) and the `mcp-auth` delta spec.

## Phase 3: `speed` foundation

### SPD-1: the marks of the critical path

**Description:** The page marks the end of each step: `easel:open` when each frame in view shows
its picture or its live document, `easel:change:<frame id>:<version>` when a new version shows,
and `easel:ask:<request id>` when a pin shows. A mark is one `performance.mark`.

**Acceptance criteria:**

- [x] `easel:open` comes after the last frame in view shows, and not before.
- [x] `easel:change:*` comes with the new version, and not before it shows.
- [x] `easel:ask:*` comes when the pin shows in another tab.

**Verification:**

- [x] Three new tests: open and change in `tests/browser/viewer-kit.test.tsx`, ask in
      `tests/browser/viewer-follow.test.tsx` (the pins are there).
- [x] `bun run smoke` is green (the ship gate).

**Notes (done 2026-11-23):**

- A frame shows when its document posts that it painted, or when its card's picture loads. The
  paint cap (1.5 s) takes a card off with no paint, so it is no show.
- Each version of a frame marks once, also at the first show: `easel:change:<id>:1` comes for
  each frame at open.
- A frame that is not live shows only its picture. With pictures off (no `EASEL_CHROMIUM`), such
  a frame never shows, and `easel:open` does not come. So SPD-3's server needs Chromium.

**Dependencies:** none.

**Files likely touched:** `src/viewer/stage.ts`, `src/viewer/canvas.tsx`,
`tests/browser/viewer-kit.test.tsx`.

**Estimated scope:** S.

### SPD-2: the verdict, and `speed.json`

**Description:** The operation `speedVerdict` gives the verdict of one step: `inTime`,
`overBudget` or `slowerThanBase`. `speed.json` holds the budgets and the hot path list, and a zod
schema reads it. An item of the list with no reason is a finding.

**Acceptance criteria:**

- [x] A test reaches each kind of `speedVerdict`.
- [x] A test finds an item that is not on the list, and an item with no reason.
- [x] `speed.json` holds the 4 budgets of SPEC-speed and an empty list.

**Verification:**

- [x] `tests/speed.test.ts`.

**Notes (done 2026-11-23):** a budget is of a stat: `p50`, or `max` for `pan` (its longest
frame). `speed.json` also holds the alert, 0.1. A list item matches by its kind and its exact
name; SPD-5 decides how a hashed asset name matches.

**Dependencies:** none.

**Files likely touched:** `src/speed/verdict.ts`, `src/speed/budget.ts`, `speed.json`,
`tests/speed.test.ts`.

**Estimated scope:** S.

### SPD-3: the run, for `open` and `change` at 20 frames

**Description:** `bun run speed` builds the binary, starts it with a seed of 20 frames, opens
Chromium with the flags of canvas-speed.md, and does `open` (warm, and one cold) and `change` 7
times each. It prints p50, p95 and the budget of each step.

**Acceptance criteria:**

- [x] The output has one line for each step, with p50, p95, the budget and the verdict.
- [x] Two runs in a row on vibea2 give p50 values within 10% of each other (open 747, 750 and
      750 ms; change 118, 117 and 113 ms).

**Verification:**

- [x] `offload -- bun run speed`: its output goes in the ship message.

**Notes (done 2026-11-23):**

- A put has no place, so easel puts the 20 frames in one row: Fit shows them at 3%, with no live
  frame. `open` and `change` measure the pictures. SPD-4 adds a run zoomed in to a frame, so
  `change` also measures a live document.
- The puts go through `/mcp` over HTTP: the answer is the start of `change`, with no start-up of
  a CLI in it.
- The cold open is 2.1 to 2.2 s, over the budget of 2000 ms. It is only reported (the plan:
  measure warm, report cold).

**Dependencies:** SPD-1, SPD-2.

**Files likely touched:** `scripts/speed.ts`, `scripts/speed-seed.ts`, `package.json` (the
`speed` script).

**Estimated scope:** M.

### SPD-4: the run, for `ask`, `pan`, and 200 frames

**Description:** The run adds `ask` (two tabs), `pan` (a 2 s pan, with the long frames from a
`PerformanceObserver`), and a seed of 200 frames for `open`, `change` and `pan`. It adds one
throttled run (4× CPU, 40 ms round trip) to the report only.

**Acceptance criteria:**

- [x] The output has each step at 20 frames, and `open`, `change` and `pan` at 200 frames.
- [x] `pan` gives the longest frame in ms, against its budget of 100 ms.
- [x] `pan` also gives the p95 time of one move handler, against a budget of 8 ms in
      `speed.json`. It moved from `tests/browser/viewer-canvas.test.tsx`, where an absolute bound
      failed only sometimes on a shared runner.

**Verification:**

- [x] `offload -- bun run speed`: its output goes in the ship message.

**Notes (done 2026-11-23):**

- `pan` takes the frame times from an animation frame loop in the page, not from a
  `PerformanceObserver`: one loop gives each frame and each move's handler of the same pan. A
  long frame shows as a long gap between two animation frames.
- `change live`: the tab zooms in to 40%, where 4 frames are live, so `change` also measures a
  live document.
- A first `ask` was 1.6 s. The cause was the measure: the click listener did not see the icon
  Send, so each time counted from the first click. With the fix, `ask` is about 100 ms.
- `change` at 200 frames had p50 118 ms in one run and 214 ms in the next. SPD-6 must keep such
  a step from a false alert of 10%.
- The handler budget is 0.3 ms p95 here, against 8.5 ms in the browser test: the browser test
  runs in the Vitest page, with 12 live frames.

**Dependencies:** SPD-3.

**Files touched:** `scripts/speed.ts`, `speed.json`, `src/speed/budget.ts`.

**Estimated scope:** M.

### Checkpoint C: after SPD-1 to SPD-4

- [x] The first numbers of each step, at 20 and 200 frames, are in `docs/canvas-speed.md`
      ("Budgets").
- [ ] A step that is over its budget today gets a task before phase 4.
- [x] Review with the user (2026-11-23: "Go"; the cold open goes to SPD-6, the hot path list).

## Phase 4: `speed` gate

### SPD-5: the gate against a base

**Description:** `bun run speed -- --gate --base <sha>` builds the binary of the base from
`git archive` and of the tree. It runs the two in turn, 7 times. A step over its budget is red
after one run again. A step more than 10% slower than the base is an alert.

**Acceptance criteria:**

- [x] The tree with no change passes, with no alert.
- [x] A test change that adds 300 ms to `open` gives an alert. A test change that puts `open`
      over 2000 ms is red.
- [x] The exit code is 0 for green, 1 for red, and 0 with an alert line for an alert.

**Verification:**

- [x] The gate on vibea2, 3 times: on the tree, with +300 ms, and with +1500 ms (over the
      budget). Their output is in the ship message.

**Notes (done 2026-11-23):**

- vibea2 has no .git, so `--base HEAD` cannot run there. `--base-dir <dir>` takes the base's
  files, and `offload --dir` sends a directory with the tree's files and `git archive HEAD` in
  `base/`. CI has .git, so SPD-7 uses `--base <sha>`.
- The first gate on the tree with no change gave a false alert: `change live` was 62 ms against
  54 ms (15%, but 8 ms). So an alert also needs a change of at least 5% of the budget (`floor`
  in `speed.json`), as alert systems use a size and not only a ratio. Then the tree with no
  change was green, and the floor also kept `ask` (117 against 93 ms) from a false alert.
- The test changes were in copies of the tree only: `easel:open` came 300 ms or 1500 ms later.

**Dependencies:** SPD-2, SPD-4.

**Files likely touched:** `scripts/speed.ts`, `src/speed/verdict.ts`, `tests/speed.test.ts`.

**Estimated scope:** M.

### SPD-6: the hot path list

**Description:** The run records each request and each long task before `easel:open`. An item
that is not in the list of `speed.json` fails the run, with its name and the fix. The first run
writes the list of today, and each item gets a reason.

**Acceptance criteria:**

- [x] `speed.json` holds the list of today, each item with a reason.
- [x] A test change that loads one more script before `easel:open` fails the run, with the name
      of the script and the fix.

**Verification:**

- [x] `offload -- bun run speed`, with and without the test change.
- [x] `tests/speed.test.ts`: the finding of the list.

**Notes (done 2026-11-23):**

- The list of today, from a cold open of 20 frames: the script, the CSS, the pictures, and
  `/api/telemetry` (5 posts). No font and no runtime file loads before `easel:open`.
- A name is the path: each picture is `/api/pictures/*`, and the hash of a built file is `*`.
- Long frames before `easel:open` are reported, not checked: their count moves with the load of
  the machine (1 frame of 92 ms here), so a check of them would fail only sometimes.
- For Checkpoint D: the telemetry posts, and the pictures at half size in a view at 3%.

**Dependencies:** SPD-3.

**Files likely touched:** `scripts/speed.ts`, `speed.json`, `src/speed/budget.ts`,
`tests/speed.test.ts`.

**Estimated scope:** S.

### SPD-7: the `speed` job in CI `gates`

**Description:** A `speed` job in `gates.yml` runs the gate on each push to `main`, with the
commit before the push as the base. A red job makes `gates` red, so the deploy does not run and
`trunk-red` opens. An alert opens a `speed-slower` issue and blocks nothing.

**Acceptance criteria:**

- [x] A push with no change of speed keeps `gates` green, and the deploy runs.
- [x] A red `speed` job stops the deploy: `speed` is a job of `gates`, and `deploy` runs only
      on a green `gates` (as #8 showed for `check`).
- [ ] An alert opens one `speed-slower` issue with the step, the two p50 values and the commit.
      Built (job `speed-alert`); not yet seen, because no push has been slower.

**Verification:**

- [x] The first push (dd733a2, run 45123999976): the job is green, and its numbers are in the job
      log: open 716 ms at 20 frames, 892 ms at 200; change 117 ms; ask 112 ms; pan 21 ms at most.
- [ ] Not done: a test commit on main that is over the budget. It would make main red on
      purpose and stop the line; the fact that it proves (a red `gates` stops `deploy`) is known.

**Dependencies:** SPD-5, SPD-6.

**Files likely touched:** `.github/workflows/gates.yml`. It is shared: tell the other agents
before the ship.

**Estimated scope:** S.

### Checkpoint D: after SPD-5 to SPD-7

- [ ] Each success criterion of SPEC-speed is met.
- [ ] Write SPD-8 and after: one task for each item of the first hot path list that the first
      view does not show. Each moves after `easel:open` in its own ship, with the change of
      `open` in the ship message.
- [ ] Review with the user.

## Phase 5: off the hot path

Written at checkpoint D.
