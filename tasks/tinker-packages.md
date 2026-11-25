# Mission: each package of easel runs on Tinker

Lead: f45e95a (paseo name easel-95). Accepted: waiting for the person. The person approved the
7 steps on 2026-11-25 ("Go ahead with the plan."). Done: open.

## Mission

Each script, adapter and setting of easel is a Tinker unit, so each step is a span and
`tinker check` covers it, and an install can change each constant through its tag. (The ask of
the person, 2026-11-25: packages to primitives, constants to tags, scripts to cmds.)

## Success

- `scripts/` has no Bun script that a job or a person runs: each one is a cmd in `cmds/` with
  `defineMain`. Only the shell scripts and the Vite plugin `scripts/client-meta.ts` stay.
- Each cmd that the deploy runs (`live-screens`, `map-screens`, `speed`, `build-binary`) prints
  the same last line as before, and the job is green.
- Each constant in the lists of the plan is a tag with its old default. A test changes the tag
  in a scope and sees the new value.
- `bun run check:plain` prints `tinker check: OK`, with each exit of the new operations reached.

## Nono

- Not in: the 23 limits of the wire (sizes and counts in the contracts). Back when a spec for
  them is accepted, because a change there changes the contract of the clients.
- Not in: a change of what a script does. Back when the person asks for it.
- Must not: change a default value, a flag, an exit code or an output line of a script.
- Must not: edit the uncommitted "dark look B" files (`scripts/design-proof.ts`, `src/kit/*`,
  `src/cli/look.ts` and their tests) until the person gives them to an owner.

## Verify

- `bun run check:plain`, `bun run check:style` and the tests of each step on `offload`: all
  green.
- The real path of each cmd once, with telemetry (a dry run on `offload`): exit 0. A caught
  throw fails a cmd under telemetry, and the tests do not show it.
- After the ship: the deploy job `screens` and the CI `gates` are green on the commit.
- A new reviewer subagent that did not build the work reads the diff and this file.
- Live: `/api/version` shows the ship. Confirms: the green deploy job, and the person.

## Touching

- (nothing now)

## Plan

- [x] 1. The Paseo adapter is a capsule. `src/paseo-adapter/`, `cmds/paseo-adapter.ts`. 09dea46.
- [x] 2. The small scripts are cmds (build scripts). 62f955a.
- [x] 3. `map` and `map-check` are cmds. e0e9b7a.
- [x] 4. `build-binary` is a cmd. 62f955a.
- [x] 5. `speed`, `map-screens` and `live-screens` are cmds. 3e06548, 0bb8566, f271fb4.
- [ ] 6. `design-proof` is a cmd: `scripts/design-proof.ts` to `cmds/design-proof.ts`,
      `package.json` (`design:proof`). Waits: the file has the dirty "dark look B" edit.
- [x] 7a. Tags: sign-in (524f731), share links, passwords and pictures (c7b50ee), error sink
      and dispatch (1d60d43).
- [ ] 7b. Tags: the CLI `shotTries` and `callDeadline`. `src/cli/`. Check: a test in a scope.
- [ ] 7c. Tags: the limits of the queue and of the starts. `src/queue/`, `src/paseo-adapter/`.
- [ ] 7d. Tags: `frameGap` and the arrange values. `src/frames/` (the cases mission touches it:
      agree with its lead first).
- [ ] 7e. Tags: the values of `src/kit` and `src/mcp`. Waits for "dark look B" and the cases
      mission.
- [ ] 7f. Tags: the 36 values of the viewer, in the browser scope. `src/viewer/`.
- [ ] 8. A small noise limit for the pixel compare of `live-screens` (8 of 255, as `map-screens`),
      so raster noise does not give a false `differs`. `src/live/takes.server.ts`.
