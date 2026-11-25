# Implementation plan: Round 1, modules `mcp` and `speed`

> This file is the old shared plan of Round 1. It is a record: do not add a plan or a task here.
> A new plan goes to `tasks/<slug>.md`, one file for each feature (`AGENTS.md`, "A feature: from
> start to done"). The items that wait are in [backlog.md](backlog.md).

Source specs: [SPEC-mcp.md](../SPEC-mcp.md) (V1), [SPEC-speed.md](../SPEC-speed.md) (V1, approved
2026-11-23: no throttle; the gate is a CI job, option B). Map: [MAP-round-1.md](../MAP-round-1.md). The task list is
[todo.md](todo.md).

## Overview

Two modules of the map, with no code in common, so two agents can build them at the same time.
`mcp` gives an agent each action of the CLI as an MCP tool, over stdio (`easel mcp`) and over
HTTP (`POST /mcp`), with the bearer token of `easel login`: Claude Code works with it, local and
remote. `speed` gives each step of the critical path a mark in the page, a budget, a run that
measures it, and a gate that stops a slower change, and it lists the work before the first view.

## Architecture decisions

- **One table, from the contract.** `src/mcp/tools.ts` maps each contract address to its tool
  name, annotations and description, or puts it on the no-tool list. A test reads every rpc
  contract of easel (not the starter's `issues` and `todo`) and fails on an address that is in
  neither list, or in both (SPEC-mcp fact rule 2). The input schema of a tool is its contract
  input, as JSON Schema (`z.toJSONSchema`); its output schema is the contract output.
- **One wire.** A tool call runs the contract operation through the rpc client: `easel mcp` with
  the ws client of the CLI and the token of `hosts.json` (fact rule 4), `/mcp` with the same api
  capsules that the socket uses, in a session with the request's token, so the `onStart` guards
  run as they do on the socket (fact rule 3). No tool has logic of its own (fact rule 1).
- **Stateless HTTP.** `/mcp` is one route of the `routes` table. Its handler runs the `user` guard
  one time, answers 401 or 403 itself, then makes one SDK server and one
  `WebStandardStreamableHTTPServerTransport` for the request (Bun's `Request` in, `Response`
  out) and closes them after it (judged rule 2).
- **isError from the success lists** of the contracts (fact rule 5), the lists that `cli/exit.ts`
  reads. The seven Tinker faults become one line of text each (SPEC-mcp § Built on Tinker).
- **Marks, not probes.** The page marks the end of each step with `performance.mark`
  (`easel:open`, `easel:change:<id>:<v>`, `easel:ask:<id>`). The run reads the marks with
  Playwright; the page has no other code for the measure.
- **Measure warm, report cold.** The pictures of a new canvas are drawn on the first open. The
  gate measures `open` with the pictures drawn (the usual case of a review); the report shows the
  first, cold open too.
- **The gate builds the base from git.** `git archive <base>` into a temp folder, then the build,
  as `scripts/smoke.sh` builds a tree. The base and the tree run one after the other, 7 times.
- **The gate is a CI job, not a ship step.** Q2 needs that a slower change does not reach the
  teams, and the deploy waits for `gates`. The budget fails the job, so the deploy stops and
  `trunk-red` opens. The 10% check against the base opens a `speed-slower` issue and blocks
  nothing (prior art: Chromium and Mozilla Perfherder alert after the commit; Lighthouse CI fails
  on a budget). `scripts/ship.sh` does not change.

## Dependency graph

```
mcp:   MCP-1 stdio + one tool ──> MCP-2 the full table ──> MCP-3 HTTP /mcp ──> MCP-4 the queue loop
                                                                        └──> MCP-5 faults and exits
                                                       MCP-4, MCP-5 ──> MCP-6 a real client, the docs
speed: SPD-1 marks ──> SPD-3 the run (open, change) ──> SPD-4 the run (ask, pan, 200 frames)
       SPD-2 verdict + speed.json ──────────────────────> SPD-5 the gate ──> SPD-7 the speed job in CI
                                          SPD-3 ──> SPD-6 the hot path list ──> SPD-8.. off the path
```

## Task list

See [todo.md](todo.md). Phases:

1. `mcp` foundation: MCP-1 to MCP-3. Checkpoint A: Claude Code lists the tools over stdio and
   over HTTP.
2. `mcp` complete: MCP-4 to MCP-6. Checkpoint B: the SPEC-mcp success criteria.
3. `speed` foundation: SPD-1 to SPD-4. Checkpoint C: the first numbers, at 20 and 200 frames.
4. `speed` gate: SPD-5 to SPD-7. Checkpoint D: the gate stops a slower change.
5. Off the hot path: SPD-8 and after, one task for each item of the first list, written at
   checkpoint D.

## Parallel work

- `mcp` and `speed` touch no file in common, except `package.json` (one script each: `speed`; the
  `mcp` command is in `cmds/easel.ts`). The agent that ships second rebases its one line.
- `.github/workflows/gates.yml` (SPD-7) is shared by each agent: say so to the other agents
  before the ship, and ship it alone.

## Risks and mitigations

| Risk                                                                    | Impact | Mitigation                                                                                            |
| ----------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| The SDK's stateless HTTP transport and Bun's `Request` do not agree.    | Medium | MCP-3 starts with one test over the SDK client; fall back to the Node transport with a small adapter. |
| A guard that the socket runs is not run on `/mcp`.                      | High   | A test calls an owner tool with a user token over HTTP and over stdio: both refuse.                   |
| `next_request` holds a request for 50 s and Bun's idle timeout cuts it. | Medium | The route sets its own timeout for `/mcp`, as `/rpc` does; a test waits 50 s with no work.            |
| The numbers of the run move with the load of vibea2.                    | Medium | Interleave base and tree; one run again before red; the gate compares, the budget is the ceiling.     |
| A cold open waits for pictures, so `open` is not stable.                | Medium | Measure warm in the gate; report cold apart.                                                          |
| A GitHub runner is slower or noisier than the reference laptop.         | Medium | The budget fails the job; the 10% check only alerts. Record the runner's numbers next to vibea2's.    |
| A slow change lands on `main` before the job is red.                    | Low    | The deploy waits for `gates`, so the change does not go live; fix or revert in 10 minutes.            |

## Open questions

None now. SPD-8 and after are written at checkpoint D, from the first hot path list.

## Module `copy` (added 2026-11-23)

The spec is [SPEC-copy.md](../SPEC-copy.md) (approved on 2026-11-23). The texts of the team go in
the kit version, as the look: one more column, one more field of the kit cell and of the kit
message. So the live path of K7 and the pictures carry them with no new message. The status of a
frame is one more column of the frame. The check of app frames gets three rules.

Order: the model (CP-1), the texts on the server with their calls (CP-2), the texts live in the
frames (CP-3), the status and the settle rules (CP-4), then the mark, the agent check and the
docs (CP-5). Each task ends green and ships alone.

Risks:

- The kit cell is on the board that a share link opens, so the texts are on the critical path.
  The texts are 64 KiB at most. CP-3 runs `bun run speed` before and after.
- An exploring put keeps a color off the look. The made CSS must have its class, or the frame does
  not show it. CP-4 tests a frame with `bg-[#f00]`.
