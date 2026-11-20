# The design system: the Creative tool look, easel's own values

Date: 2026-11-20. Status: accepted; on the canvas.
`src/design/tokens.css` follows in its own ship.

## What the user said

- "let's adopt to doop the design system from
  creative tool [...] make sure we use the
  design system and evolve as we go (explore
  should not go right off)"
- On the clean room: "yes, our own, but also
  make sure they are doop-first component so
  we can make use as component asap"
- On strictness: "exploration doesn't need to
  be strict, but when we want to change to
  "ready", we'l nedd to make sure they are
  using design system"

## Precedent

- **The Creative tool canvas (v2)**: a black
  primary action, soft hairlines, fields with
  a real edge, Inter, a neutral grey. Its
  values and names copy doop, so we take the
  ideas only (clean room,
  `docs/canvas-speed.md`).
- **Linear, Vercel Geist**: an ink primary;
  colour is kept for state.
- **Radix Themes, shadcn/ui**: the set of
  primitives (TextField, Checkbox, Segmented
  Control, Tabs, Toast, Dialog) and when to
  use each one.
- **Design-system governance** (Brad Frost,
  Atomic Design; Nathan Curtis, "Defining
  design system contributions"): explore
  freely, but a design that ships uses the
  system, and a new need becomes a component
  first.

## Decision

1. **Look.** The canvas tokens take the v2
   ideas with easel's own values and `--e-*`
   names. New roles: `--e-primary`,
   `--e-on-primary`, `--e-faint`, `--e-field`,
   `--e-divider`, `--e-tint`, `--e-warn`,
   `--e-danger-bg`, `--e-scrim`,
   `--e-radius-xl`. The list and the contrast
   table are in `SPEC-design.md`.
2. **Black is "go", blue is "state".** The
   main action is `--e-primary`. `--e-accent`
   means only selected, live, or "waits for
   you". The viewer shows many waiting
   requests in blue; a blue button would
   compete with them.
3. **Doop-first components.** Each part is a
   component on the canvas before a screen
   uses it. Added on 2026-11-20: TextField,
   Checkbox, Segmented (+ SegmentedItem), Tabs
   (+ Tab), Chip, Avatar, Toast, Dialog,
   EmptyState. Button and Composer changed to
   the black primary and the field edge.
4. **Explore free, ready strict.**
   `bun run design:proof` checks:
   - the E4 frames, always;
   - each frame on the Design system and
     Components pages, always;
   - each other frame that asks for sign-off
     (`needs_review`, `ready_for_dev`).

   Drafts are counted, not checked. The script
   reads the frame list and the status through
   the Doop MCP (`get_canvas`), because the
   HTTP API has no frame list for an agent
   key.

5. **The system grows.** A screen that needs a
   part or a value the system lacks adds a
   component or a token first, then uses it.

## Consequences

- A new component main on the Components page
  is in the proof at once. Its id must go into
  `COMPONENTS` in `scripts/design-proof.ts`,
  or its instances fail S7.
- Doop writes `padding:24px` on the `<body>`
  of a new main. Change it to `var(--e-5)`
  (S8).
- The proof cannot stop a person from marking
  a frame ready in Doop. It reports the
  frame on the next run. It is not in the ship
  gate, because CI has no Doop key.
- Trade-off: the field edge (`--e-field`) is
  1.66:1 on white (light) and 1.85:1 (dark),
  under the 3:1 of WCAG 1.4.11. The label and
  the focus edge (`--e-focus`, 3:1) identify a field, so
  the edge is not the only cue. If a test with
  users shows that people miss fields, darken
  `--e-field` to 3:1 (about `#949491` in
  light).
- `src/design/tokens.css` still has the old
  values. Its ship changes the values, loads
  Inter, and adds the contrast test from
  `SPEC-design.md`.
- Focus, changed the same day after a look: a
  solid ink ring was too harsh. `--e-focus` is
  now a mid grey (`#858582` light, `#7a7a77`
  dark; 3.3:1 and 3.7:1 light, 4.2:1 and 3.8:1
  dark). A control keeps a 2 px outline. A
  field's edge turns `--e-focus` with a 3 px
  `--e-focus-halo`, as in shadcn/ui
  (`border-ring ring-[3px] ring-ring/50`) and
  Vercel Geist inputs. An invalid field shows
  only its `--e-danger` edge.
- Rows and messages, changed the same day
  after the user's comments on the canvas:
  - A row has no fill for its state. A fill
    and a mark together said the same thing
    two times. The state mark goes after the
    time, behind a hairline separator. Only
    the selected row has a fill (`--e-hover`)
    and a 2 px ink bar on its left, as in the
    inboxes of Linear and GitHub.
  - What an agent attaches to its message
    (options, the before and after pictures)
    starts on the text column of the message,
    with a hairline rule on its left. Then a
    viewer sees that the options are the
    agent's, not their own.
  - The Before and After switch sits on the
    top edge of the picture, not on a row of
    its own, as the preview switches in Figma
    and Vercel do.
