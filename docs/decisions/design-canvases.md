# The design canvases: a library canvas and a product canvas in one workspace

Date: 2026-11-20. Status: accepted; done (2026-11-20). Workspace `easel` (`wEwPhtO4I6`): library `zPdfXgdRrQ`,
product `xFJSTXA-v5`. The rules are in [../design-canvas.md](../design-canvas.md).

## What the user said

- "look at how create organize there design systems and material, let's organize ours (easel)
  onto its corresponding workspace with meaningful separation and guidelines"

## The problem

- **One canvas holds three kinds of material.** `easel — design` (`zPdfXgdRrQ`) has 57 frames: 30
  component mains, the Foundations frame and 27 E4 screens and sheets. The mains are on two pages
  (`Design system`, `Components`) by the date they were made, not by what they are.
- **A screen changes while a part is in review.** The screens use the mains on the same canvas. A
  change to a main goes to each screen at once, before anyone reviews it.
- **No workspace.** Both easel canvases are personal. A canvas outside a workspace cannot publish a
  library, and other members cannot find it.
- **Old material looks current.** `easel — viewer design` (`3Io4CqJYjF`) has the first viewer
  design, with parts (Alert, Panel, CommentRow, GateCard) that the system does not have now.

## Precedent

- **create (the sibling project, same machine, same Doop).** The workspace `create` has
  `create · Design system` (`1AvW5pok0v`): tokens, 66 parts on pages by level (Foundations, Atoms,
  Molecules, Organisms, Specimens, Archive), a `0 · Read me` frame, published as the workspace
  library. It also has `create · Product design` (`QFPVMD9htX`): a `0 · Read me` page, one
  `Work · E<n> <title>` page for each epic, and `Archive · E<n> (concluded)`. The old material stays
  on its own canvas, `Creative tool`. Their reasons are in the create repo,
  `docs/canvas-organization.md` and `docs/design-canvas.md`.
- **Figma team libraries.** The system is its own file, published to the team. Other files accept
  an update when they choose, so a part in review does not change a screen.
- **thoughtbot's Figma files.** One file for the truth, explorations kept apart, and an archive
  page. Material is split by kind and by lifecycle.
- **Brad Frost, Atomic Design; Nathan Curtis, design-system contribution.** Parts are in levels.
  One owner changes the library; the others propose.
- **Miro.** A table-of-contents board is the front door of a large board.

## Decision

- One Doop workspace `easel`, with two canvases: **easel · Design system** (the library) and
  **easel · Product design** (one page for each epic). The old viewer canvas is renamed
  `easel · Archive · viewer v0`, and nobody designs there.
- `zPdfXgdRrQ` becomes the library canvas. The mains, the tokens and the guide stay where they are,
  so their IDs do not change. The E4 frames are copied to the product canvas. All 27 are `draft`
  and have no open comment, so the copy loses no review state.
- The library pages use easel's own levels (Primitives, Patterns, Layout), which the guide
  `easel-system` already uses, not create's Atoms, Molecules and Organisms.
- Each canvas has a `0 · Read me` frame. `docs/design-canvas.md` is its source.

## Options not taken

- **Pages on one canvas.** It is less work, but a part still goes to the screens before its review,
  and there is no library for a later canvas (E5, E6).
- **A new canvas for the library, and the E4 screens stay.** The mains would be copied, and each
  screen would have to change from a local part to the library part. That is more work and more
  risk than to copy 27 draft frames.
- **One canvas for each epic.** Doop prototype links work only in one canvas, and create's
  experience is that one product canvas with a page for each epic is enough.
- **No Specimens page yet.** create has one. easel adds it when a part needs more than its main to
  show its variants.

## Consequences

- `scripts/design-proof.ts` reads two canvases: the library pages for the mains, the product
  canvas for the E4 frames. The E4 frame IDs changed once.
- Doop does not share tokens through a library: a new canvas has none. As in create, the product
  canvas has a copy of the library tokens. The copy can drift, so the proof checks it (S13).
- An instance that links to the library keeps the library's component ID, so the proof's list of
  parts is the same for both canvases.
- A change to a part is: change the main, run the proof, publish, pull. The rule is in
  `docs/design-canvas.md`.
- The agent key cannot make a workspace or move a canvas. The hub did it with a session of the
  agent account (2026-11-20), so the workspace has the same owner as `create`.
