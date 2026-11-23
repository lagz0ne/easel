# Spec: speed — V1

Status: proposed (2026-11-23), for review.

Module `speed` of [SPEC.md](SPEC.md). It measures the viewer ([viewer](SPEC-viewer.md)) and the
frames ([frames](SPEC-frames.md)), and changes them only to take work off the critical path. Map:
[MAP-round-1.md](MAP-round-1.md).

## Objective

The critical path of easel is fast, it stays fast, and it holds only the work that a person waits
for (Q1, Q2, Q3 in [epics.md](docs/epics.md#the-quality-of-the-round)). Today
[canvas-speed.md](docs/canvas-speed.md) holds what we learned and measured one time. Nothing gives
each step a budget, and nothing stops a change that makes a step slower.

The steps of the critical path:

| Step     | Starts                                      | Ends                                                                     | Budget (p50)         | Requirement |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------ | -------------------- | ----------- |
| `open`   | The browser starts to load a share link.    | Each frame in view shows its picture or its live document: no white box. | 2000 ms              | Q1, S8      |
| `change` | The server answers an agent's put.          | The new version shows in an open tab, with no reload.                    | 1000 ms              | Q1, S9      |
| `ask`    | A viewer sends a request.                   | Its pin shows in another open tab of the canvas.                         | 1000 ms              | Q1          |
| `pan`    | A 2 s pan starts on a canvas of 200 frames. | The pan ends.                                                            | no frame over 100 ms | Q2, S11     |

Each step is measured on a canvas of 20 frames, and `open`, `change` and `pan` also on a canvas of
200 frames (Q2).

Users: the team of easel (the gate stops a slower change before it reaches the teams), and each
person on the critical path, who waits less.

Prior art:

- Performance budgets (web.dev, "Use performance budgets"; Lighthouse CI assertions; `size-limit`):
  a number for each step, written in the repo, and a check that fails a change over it.
- User Timing (`performance.mark`, `performance.measure`): the page marks the end of each step.
  Playwright reads the marks, as the [smoke](scripts/smoke.sh) drives the built binary.
- Our own rule from [canvas-speed.md](docs/canvas-speed.md#how-to-measure): run A and B
  interleaved, because a loaded machine moves absolute numbers. Trust the comparison.
- RAIL (web.dev): 100 ms for a response, 1000 ms for a view.

## The design

1. **Marks.** The page marks the end of each step: `easel:open` when each frame in view shows,
   `easel:change:<frame id>:<version>` when a new version shows, and `easel:ask:<request id>` when a
   pin shows. A mark costs one `performance.mark`, so it stays in production. The page keeps no
   other code for the measure.
2. **The run.** `scripts/speed.ts` starts a built binary with a seed of 20 and of 200 frames,
   opens Chromium (with the flags of canvas-speed.md "How to measure"), and does each step 7
   times. It reads the marks and prints one line for each step: p50, p95 and the budget.
3. **The gate.** `bun run speed -- --gate --base <sha>` builds the binary of `<sha>` and of the
   tree, and runs the two interleaved. A step fails when its p50 is over its budget, or more than
   10% over the p50 of the base. A failed step runs one time again before the gate says red.
   The gate runs on vibea2 (`offload`), as the other heavy runs do.
4. **The hot path (Q3).** `speed.json` holds the budgets and the hot path list: each resource
   that the page may load, and each long task that it may run, before `easel:open`, each with
   its reason. The run records the requests (Playwright) and the long tasks (a
   `PerformanceObserver`) before `easel:open`. One that is not on the list fails the run, with
   its name and the fix: load it after `easel:open`, or add it to the list with a reason.
5. **The first list.** The first run writes what loads today before `easel:open`. Each item that
   the first view does not show moves after `easel:open` in its own ship, and each ship shows the
   change of `open`.

## Tech Stack

Bun, Playwright with the local Chromium (as `tests/frames-app.test.ts`), the built binary (as the
smoke), zod for `speed.json`.

## Commands

```
Measure:  bun run speed                         # each step on the tree, a table
Gate:     bun run speed -- --gate --base HEAD   # the tree against the base
On vibea2: offload -- bun run speed -- --gate --base HEAD
Check:    bun run check:plain                   # the tests of the gate's logic
```

## Project Structure

```
scripts/speed.ts       → the run and the gate (Bun, Playwright)
speed.json             → the budgets and the hot path list, with a reason for each item
src/viewer/            → the marks (stage.ts), and the work that moves off the critical path
tests/speed.test.ts    → the logic of the gate: p50, p95, the budget, the base, the list
docs/canvas-speed.md   → what we learned; a new section "Budgets" points to speed.json
```

## Code Style

As the rest of easel: Tinker operations for the logic of the gate (`speedVerdict`), so a test
reaches each exit; the script is the thin host around them, as `scripts/smoke.sh`.

```ts
/** A step's verdict: over its budget, slower than the base, or in time. */
export const speedVerdict = operation({
  label: "speed.verdict",
  input: z.object({ step: z.string(), runs: z.array(z.number()), base: z.array(z.number()).optional(), budget: z.number() }),
  run: (_, { input }) => { /* p50 against the budget, then against 1.10 × the base's p50 */ },
});
```

## Testing Strategy

- `tests/speed.test.ts` (Vitest, server): each kind of `speedVerdict` (`inTime`, `overBudget`,
  `slowerThanBase`), and each finding of the hot path list (an item not on the list, an item
  with no reason).
- The marks: `tests/browser/viewer-kit.test.tsx` checks that `easel:open` comes after each frame
  in view shows, and that `easel:change:*` comes with the new version, not before.
- The run itself is proven by its use: the first `bun run speed` output goes into the ship that
  adds it.

## Boundaries

- Always: interleave the base and the tree; run the gate on vibea2; give each item of the hot
  path list its reason; show the change of each step in the ship that moves work off the path.
- Ask first: add the gate to `scripts/ship.sh` (all agents use it, and it adds time to each
  ship); change a budget; change the reference flags of Chromium.
- Never: make a step faster by a change that the person sees as worse (a white box, a late
  picture, a lost pin); raise a budget to make the gate green; measure on vibea while it runs
  the live apps.

## Success Criteria

- `bun run speed` prints p50 and p95 of each step at 20 and 200 frames, against its budget.
- `open` is at most 2000 ms, `change` and `ask` at most 1000 ms, and a 2 s pan on 200 frames has
  no frame over 100 ms (Q1, Q2).
- The gate fails a test change that adds 300 ms to `open`, and passes the tree with no change.
- Before `easel:open`, the page loads only what the hot path list holds, each with a reason (Q3).
  A test change that loads one more script before `easel:open` fails the run.
- `tinker check` is OK.

## Out of Scope (Deferred)

- Field data from real tabs (RUM). Add it when a team says the canvas is slow and the gate is green.
- A step for an agent's work (time from a request to its result): the agent's model sets most of
  it. Add it when easel's part of that time is over 1 s.
- Budgets for the size of each chunk (`size-limit`). Add it when `open` fails because of the
  download.

## Open Questions

1. The reference: Chromium on vibea2 with no CPU or network throttle, or with a throttle that
   is like a laptop of the team (for example 4× CPU, 40 ms round trip)? I recommend no throttle
   for the gate (stable numbers, compared with the base), and one throttled run in the report.
2. The gate in `scripts/ship.sh` for each ship that changes `src/`: it adds about 3 minutes on
   vibea2. I recommend it for each ship that changes `src/viewer`, `src/frames` or `src/kit`, and
   not for the others.
