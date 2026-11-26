# Mission: tests under load

Lead: none yet. The person starts one. Accepted: waiting for the person. Done: open.

## Mission

A gate gives the same result at a load of 25 as at a load of 2, so a red gate always names a
fault of the code. (Issues #10, #15, #17.)

## Evidence (2026-11-26)

- #10 and #17 are open since 2026-11-23. Fixed before: kit-make, kit-tsx, frames-app speed,
  kit-runtime `kit.check` and share-password (192b60c, ff6b4bf, e9a9058).
- Not fixed: `share.test.ts` "a link keeps its 1000 newest passes" (30 s at load 23); the restart
  tests of kit-texts and pictures "key names" (now 30 s, cause not found); `share-cli.test.ts:262`
  and `shutdown.test.ts:207` (#10); `viewer-act.test.tsx` did not start in 60 s at load 12.
- #15: in 7 speed runs, pan at 200 frames had p50 17 ms and p95 18 ms, but `max` gave
  `slowerThanBase` 5 times (max 22 to 42 ms, budget 100 ms). The last run (1130da7) gives
  `change` at 200 frames a p50 of 257 ms against a base of 191 ms.
- `runs.jsonl` (from 1046a7d): 2 of 19 ships stopped because the load was above 10.

## Success

- Each test named in Evidence passes 10 of 10 runs at a load of 25 or more, made with
  `stress-ng` or busy loops on vibea2. Each run uses a new process.
- No test in `tests/` has a timeout above 30 s. A test that waits for a server or a browser
  waits for a signal (a ready line, an event), not for the wall clock.
- Two speed runs on one commit give the same verdict for each step. A `max` of pan under its
  budget does not give `slowerThanBase`.
- #10, #15 and #17 are closed, each with the commit that closes it.

## Nono

- Not in: a faster host or new job slots for `offload`. Back when a test is green under load and
  the gate is still too slow.
- Not in: the speed of `open` cold. The mission "fast open" has it.
- Must not: delete a test, skip it, or lower what it proves, to make it pass.
- Must not: raise a budget of the speed gate, or a timeout, as a fix.
- Must not: change the code of the app only to make a test pass.

## Verify

- On vibea2, under the load of Success: 10 runs of each test of Evidence, with the count of passes.
- `offload -- bun run speed` two times on one commit: the verdicts are the same.
- `bun run check:plain` prints `tinker check: OK`.
- A new reviewer subagent that did not build the work reads each diff against "Must not".
- Live: CI `gates` is green on the last commit. Confirms: the next retro shows no red with the
  cause "load".

## Touching

- `tasks/tests-under-load.md`

## Plan

- [ ] Wait for the person to accept the top, and to start a lead.
