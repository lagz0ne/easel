# Spec delta: `design-loop`, easel designs itself in easel

Status: proposed (2026-11-24).

## Objective

The user, 2026-11-24: "We then need to create a loop on design easel itself, so we have screens
for easel, design system for easel and we can do continuous design and feedback".

This is the end goal of Round 1 (the user, 2026-11-23): move the design from Doop to easel, and
develop it further in easel. After this delta, the team does all design work for easel in easel.
Doop is not necessary for easel any more.

The loop has four steps, and each step happens in easel:

1. A person or an agent proposes a design: a frame on a canvas of easel.
2. A person gives feedback: a request on the frame.
3. An agent takes the request, changes the design or the code, and ships it.
4. The board shows what shipped beside what was proposed, and a check proves that they agree.

Prior art:

- **Storybook with Chromatic.** Each component and each state is a story of the real code. A
  review shows each change as a picture beside the last one, and a person approves it or comments.
- **Figma Dev Mode with Code Connect.** A design component links to its code, so the design and
  the code do not drift.
- **Linear feedback.** A comment becomes an issue that a person or an agent takes, and it closes
  when the change ships.

## Current behavior

- The canvas `design-system` has the 31 frames of the Doop library, at their Doop places, all in
  exploring (SPEC-pages, criterion 1). They are HTML copies. The viewer does not use them: its own
  controls are in `src/design` and `src/viewer`.
- SPEC-design names the Doop canvases as the source of the design system and of the screens.
- The screens of easel (Read me, E3, E4, E8) are only on the Doop canvas `easel · Product design`.
- `bun run design:proof` reads the Doop canvases.
- A request on a frame of easel goes to the queue. No agent claims the requests of easel's own
  canvases.
- Nothing shows the screens of easel as they are live.

## New behavior

### The canvases

1. The canvas `design-system` is the source of easel's design system. SPEC-design names it, not
   Doop.
2. A canvas `product` holds the screens of easel, one page for each epic (Read me, E3, E4, E8), at
   their places from Doop. The 3 open Doop comments become requests on it.
3. A page `Live` on `product` shows the screens of easel as they are live. A deploy writes them
   again. Each screen of a proposal has its live screen with the same name, so a person sees both.
   The states, the sizes (phone 390×844, desktop 1440×900) and the themes (light, dark) are fixed,
   so two writes of the same build give the same pictures.

### The loop

4. A request on a frame of `design-system` or `product` reaches an agent of easel's design. The
   agent claims it within 5 minutes during the hours that the user sets.
5. The agent changes the frame (a new version), or the code, or both. It resolves the request only
   when `/api/version` shows the build with the change.
6. A change of the code that changes a screen writes its live screen again. The request says
   which build has it.
7. A change of the design system (a value of the look, or a component) shows on each frame that
   uses it (SPEC-pieces, rule 18).

### The proof

8. `bun run design:proof` reads the canvases of easel, not Doop. It prints OK only if each rule of
   its check holds: the contrast table, each screen of a proposal has its live screen, and no live
   screen uses a value that is not in the design system.

## Success criteria

1. **No Doop.** For one week of design work on easel, nobody opens Doop for easel. SPEC-design and
   `docs/design-canvas.md` name only the canvases of easel.
2. **The screens.** `product` has the pages Read me, E3, E4 and E8, with each frame of Doop at its
   place, and the 3 Doop comments as open requests.
3. **Live beside proposed.** After a deploy that changes the dock, the `Live` page shows the new
   dock in phone and desktop, light and dark, within 10 minutes of the deploy.
4. **One loop.** A person writes a request on a frame of `product` ("make the dock smaller on a
   phone"). An agent claims it, ships the change, and resolves it with the build number. The
   `Live` page shows the change. No step happens outside easel and the repository.
5. **The proof.** `bun run design:proof` prints OK against the canvases of easel, and it fails if
   a live screen uses a color that is not in the design system.

## Boundaries

- Always: a write to the live easel by the loop goes through the CLI or MCP as the member
  `vibea-claude`, not as an owner.
- Always: a frame that a person marked ready changes only through a request.
- Ask first: a change of the look of the design system (it changes each frame of the team).
- Ask first: the hours when the design agent runs, and its cost limit.
- Never: the loop deletes a frame or a canvas.

## Out of scope (deferred)

- **The design system as code capsules** (SPEC-pieces: `design/` capsules, brands, the typecheck
  on each put). This delta works with the HTML frames of today. Add it with `pieces`.
- **A prototype that runs the screens in order.** Add it with the flows of screens.
- **An approval step before a change of code** (a person approves a proposal first). Add it when
  a change ships that the user did not want.

## Open questions

1. **Who runs the design agent?** I recommend a scheduled Paseo agent that runs `easel next
--canvas product --canvas design-system --wait` in its work hours. The GitHub channel is the
   other way: each request becomes an issue, and an agent takes the issue. That adds one more
   place to look, so I do not recommend it.
2. **How does a live screen get on the board?** I recommend a job after each deploy. It opens
   easel with a fixed fixture canvas in a browser, takes each state as a picture, and puts it as a
   frame on `Live`. The other way is a frame that embeds the live page. A frame has no origin and
   no login, so it cannot show the real page.
3. **The canvas names.** I recommend `design-system` (it exists) and `product`. Doop had
   `easel · Design system` and `easel · Product design`.
