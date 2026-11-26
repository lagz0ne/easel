# Mission: dark look B

Lead: easel-d7 (paseo 2e4e4b8a, `m: dark look B`; easel-da stopped before the accept). Accepted: 2026-11-26 02:29 UTC, "Accept the top of tasks/dark-look.md." Done: open.

## Mission

Each frame of easel that takes `theme` shows the dark look B, "lifted grey", when its theme is
`dark`, and the look of today when it is `light`. (E10.2, SPEC-pieces decisions 4 to 7, rules
14 and 16; the person picked B on 2026-11-25.)

## Success

- On the live canvas `product`, with `?theme=dark`, 3 real frames show the B values: the
  page background is `#121212` and a card is `#1e1e1e` (computed style in the frame).
- With `?theme=light`, the same 3 frames show the same pixels as before the ship.
- A matrix cell with `theme: dark` shows the dark values, and the cell next to it shows light.
- `easel look get` on the live easel gives a DTCG 2025.10 resolver document. Its context
  `dark` holds only the colors of B that change, each with its `$description` if B has one.
- A look with no dark values gives the same `:root` block as today, byte for byte.
- A dark value that fails K8 is refused, and the finding names its context:
  `dark: input on background: 1.47:1, needs 3:1 (a field edge)`.
- `bun run design:proof` prints OK.

## Nono

- Not in: a page or a control to edit the dark values. Back when a person asks to edit them
  without the CLI or MCP.
- Not in: dark values outside the group `color` (shadows, radii, fonts). Back when a frame
  needs one.
- Not in: a theme other than `light` and `dark` (SPEC-design, Out of scope).
- Not in: the removal of a dark value (SPEC-kit: `look.undo` does it in this version).
- Not in: the tokens of easel itself (`src/design/tokens.css`).
- Must not: change a light value of the live look.
- Must not: use the owner login. If the member `vibea-claude` cannot write the look, stop and
  give the person the command to run.
- Must not: delete the proposal frames on the page `Look · dark` of the canvas
  `design-system`.

## Verify

- `offload -- bun --bun vp test tests/kit-look.test.ts tests/cli-look.test.ts
tests/mcp-kinds.test.ts tests/kit-store.test.ts tests/kit-capsules.test.ts
tests/frames-app.test.ts tests/browser/viewer-switches.test.tsx`: all green.
- `bun run check:plain` prints `tinker check: OK`. `scripts/ship.sh --full` is green.
- After the ship: CI `gates` is green on the commit, and `/api/version` shows it.
- `easel look get` as `vibea-claude`, before and after the write: the revisions, and the
  context `dark` with the B values.
- `agent-browser`: pictures of the 3 frames in dark and in light, and the computed
  `background-color`, in `~/work/tmp/2026-11-25-dark-look/build/`. The light pictures
  are compared with pictures from before the write.
- `bun run design:proof` prints OK.
- A new reviewer subagent that did not build the work reads the diff and this file.
- Live: `/api/version` shows the ship. Confirms: the person, from the pictures.

## Touching

- `tasks/dark-look.md`
- The live look of easel (rev 3, kit 21, light only), as `vibea-claude`

## Plan

- [x] 1. The spec: rule 14 says `light-dark()`, as rule 16. 3583509.
- [x] 2. The code of the dark values, from the work that a closed session left (02:35 to 02:45).
      A worker reads the diff against the spec, runs the tests on `offload` and
      `check:plain`, and fixes each finding. Check: the Verify tests are green, and
      `tinker check: OK`.
- [x] 3. Ship 2 with `ship.sh --full -p` (only the hunks of this mission in the shared files).
      Tell b7c400ba, the lead of tinker-packages (design-proof.ts, look.ts) and the lead of cases (mcp texts). Check: CI `gates`
      green, `/api/version` shows it.
      The cases ship 1 is on main (a7711af): make the patches on it. The tool count in
      `tests/mcp*.test.ts` is now 49. The dirty `tinker.graph` is from 02:45: it drops 212 lines that
      later ships added. Ship only its `kit.*` hunks, with `-p`.
- [x] 3a. The walk frame keeps its theme on a dark viewer page. 8d9cf7a. Ship 2 is a6a5363, live as build 424.
- [x] 3b. Ship 1b (a0503ae, build 432) and the pane fix (c36b5be): the fixes of the review of a6a5363 (no resolver document for an empty dark patch,
      refuse the keys that the merge drops, the `set_look` text), and the `colorScheme` of a pane.
      Check: the tests of the worker, `ship.sh`, `/api/version`.
- [ ] 4. Write the dark set of B into the live look as `vibea-claude`, with a base revision. Tell
      easel-5c (fast open) before the write: a new look makes each picture cold.
      Check: `easel look get` gives the context `dark`; the light values are the same.
      Done 04:57:33Z: rev 1 kit 19 to rev 2 kit 20; the light set is the same as before (jq diff).
      Undone 05:08:38Z (rev 3, kit 21, light only): each live app frame refused with LookFailsK8.
      Its runtime is from before a6a5363 and its K8 check cannot read `light-dark()` (ratio 0, no
      `theme` key). After the undo, the app frames start again (proof/after-undo/).
      Waits for the person: A (light fallback for an old runtime), B (put each app frame again) or
      C (stop at kit HTML). The pick of the lead: A.
- [ ] 5. The proof on the live site: pictures in dark and in light, a matrix cell, and
      `bun run design:proof`. Check: each line of Success.
- [ ] 6. A new reviewer subagent; then the report to the person.
