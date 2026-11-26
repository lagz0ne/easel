# Mission: tests under load

Lead: easel-e4 (paseo 009665e7, `m: tests under load`). Accepted: 2026-11-26 02:29 UTC, "Accept the top of tasks/tests-under-load.md." Done: open.

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
- T2 (#15): `src/speed/verdict.ts`, `src/speed/steps.server.ts` (the base text of a row, and the
  pan samples of each run), `src/speed/settings.ts` (the default of `panRuns` only),
  `tests/speed.test.ts`, `tests/speed-run.test.ts`, `SPEC-speed.md` (the text of the alert only), `tinker.graph` (the lines
  `speed.*` only). The mission fast open has `src/speed/*` after this task (its T6).
- T4a: `tests/live-screens-run.test.ts`, `tests/map-screens.test.ts`, `tests/binary.test.ts`, `tests/kit-binary.test.ts`, `tests/build-binary.test.ts`, `tests/db-generate.test.ts`, `tests/build-checks.test.ts`, and `tests/speed-run.test.ts` (the timeouts only).
- T4b: `tests/body-limits.test.ts`, `tests/map-source.test.ts`, `tests/map-card.test.ts`, `tests/queue-pages.test.ts`, `tests/frames.test.ts`, `tests/pages.test.ts`, `tests/frames-ready.test.ts`, `tests/cli-frames.test.ts`, `tests/access-session-door.test.ts`, `tests/kit-lint.test.ts`, `tests/texts-live.test.ts`.
- T3: `tests/share.test.ts`, `tests/shutdown.test.ts`.
- T4c: `tests/frames-app.test.ts`, `tests/kit-store.test.ts`, `tests/pictures.test.ts` (the timeouts
  only; dark look B and fast open agreed).
- Not mine: (fast open T1 has it; I change "key names" after T1 ships),
  `tests/frames-app.test.ts` (dark look B).

## Plan

- [x] T0: the load harness, outside the repo: `~/work/tmp/2026-11-26-tests-under-load/batch.sh`. It
      starts 26 busy loops in the job slot on vibea2, waits 60 s, then runs each test of a list 10
      times, each in a new process, and prints the load and the count of passes. Probe: vibea2 has
      8 cores and a load of 21 to 25 from other jobs before the loops; 36 tasks run with the loops.
- [x] T1: the baseline on 5e49e37: each test of Evidence, alone (`-t`), passed 10 of 10 runs at a load
      of 20 to 50. So each fails only beside the full suite. A full `check:plain` on vibea2 (load about
      30 from other jobs) failed `share-password` (argon2id cost, 5 s), `viewer-kit` kit-control-fold,
      and `viewer-cases` decision 4 (a poll of 5 s). T3 uses full-suite runs.
- [ ] T2 (#15): the verdict against the base uses a statistic that is stable, not `max`. Prior
      art: Chromium Pinpoint and Mozilla Perfherder compare the samples of two sides with a
      statistical test (Mann-Whitney U, t-test), and never with the maximum. Check: `tests/speed.test.ts`;
      two gate runs of one tree against itself give `inTime` for each step.
- [ ] T3: each test of Evidence that fails in T1: find the cause and fix it, one worker for each cause.
- [ ] T4: T4b (11 server files) to 30 s or less; the restart tests on a file database keep 30 s, because
      the disk of vibea is slow (#17). T4a, T4c open.
      Each test with a timeout above 30 s (body-limits, map-source, build-checks, map-card,
      queue-pages, db-generate, frames, oauth): find the slow step; wait for a signal, not the clock.
- [ ] T5: Verify, then close #10, #15 and #17 with their commits.
