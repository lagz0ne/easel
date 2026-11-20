# Spec: design — V1

Module `design` of [SPEC.md](SPEC.md). Depends on nothing.

## Objective

easel's own small design system. The canvas belongs to the frames, so the controls around it stay
quiet: few colors, one typeface, clear focus. Everything here is written fresh: no tokens, names or
styles come from doop (clean room, see `docs/canvas-speed.md`).

The look takes ideas from the Doop canvas "Creative tool": a black primary action, soft hairlines,
fields with a real edge, Inter, a calm neutral grey. The values and the `--e-*` names are easel's
own. Blue (`--e-accent`) means only selected, live, or "waits for you", never "go". See
[docs/decisions/design-system-look.md](docs/decisions/design-system-look.md).

The source of the system is the Doop design canvas (`zPdfXgdRrQ`): its tokens and its components.
`src/design` follows it. Status: the canvas has the look of 2026-11-20; `src/design/tokens.css`
still has the values from before, and changes in its own ship (with Inter and the contrast test).

Prior art, as ideas only:

- Design tokens as CSS custom properties: the W3C Design Tokens format, and Open Props (MIT).
- Accessible color steps that pass contrast in light and dark: Radix Colors (MIT).
- Native elements over custom widgets: the WAI-ARIA Authoring Practices.

## Journeys

1. A person uses the viewer in a light or dark system theme. The page follows
   `prefers-color-scheme`.
2. A keyboard user reaches every control with Tab. A visible focus ring shows where they are.
3. A person who prefers less motion (`prefers-reduced-motion`) gets no animated pans or fades.

## Contract

- `src/design/tokens.css` defines the custom properties, light and dark:
  - color: `--e-bg`, `--e-surface`, `--e-card`, `--e-text`, `--e-muted`, `--e-faint` (placeholder
    and disabled text only), `--e-primary` and `--e-on-primary` (the main action), `--e-accent` and
    `--e-on-accent` (selected, live, waits), `--e-focus` (a mid grey) and `--e-focus-halo` (its
    soft halo on a field), `--e-line` (hairline), `--e-divider`,
    `--e-field` (the edge of a field), `--e-tint`, `--e-hover`, `--e-ok`, `--e-warn`,
    `--e-danger`, `--e-danger-bg`, `--e-scrim`, `--e-shadow-low`, `--e-shadow-mid`;
  - space: `--e-0` to `--e-7` (2, 4, 8, 12, 16, 24, 32, 48 px);
  - radius: `--e-radius-xs` 4, `-s` 6, `--e-radius` 8, `-l` 12, `-xl` 16, `-full`;
  - type: `--e-font` (Inter, then Noto Sans Thai, Noto Sans), `--e-size-0` to `--e-size-4` (11,
    12, 13, 15, 20 px), `--e-leading-1` to `--e-leading-4` (16, 20, 24, 28 px), weights 400, 500,
    600; and motion.
- The controls the viewer needs, as React components on native elements. Each one is first a
  component on the Doop canvas, with the same name: `Button` (with a pressed state), `TextField`,
  `Checkbox`, `Segmented`, `Tabs`, `Chip`, `Avatar`, `Toast`, `Dialog`, `EmptyState`, `Panel`
  (complementary), `Toolbar`, `Status` (live region), `Alert`, `Pin`, `Card`.

## Rules

### Fact rules (the code graph decides)

1. In CSS, a viewer module sets color, space and type only through `--e-*` properties. Outside
   `tokens.css`, these properties take no raw color (hex, `rgb()`, `hsl()`, a named color) and no
   px value:
   - color: `color`, `background-color`, `border-color`, `outline-color`, `fill`, `stroke`;
   - space: `margin*`, `padding*`, `gap`;
   - type: `font*`, `line-height`, `letter-spacing`.

   Other properties may use px, such as a border width or a frame's place on the canvas.

2. Each control renders a native element with its role: `button`, `input`, `aside`, `output`.

### Measured rules (a test measures them)

1. Each pair below meets its contrast ratio in both themes (WCAG 2.2 AA: 4.5:1 for text, 3:1 for
   control edges and focus).

   | Foreground       | Background      | What it is                   | At least |
   | ---------------- | --------------- | ---------------------------- | -------- |
   | `--e-text`       | `--e-bg`        | text on the canvas           | 4.5:1    |
   | `--e-text`       | `--e-surface`   | text on a panel              | 4.5:1    |
   | `--e-muted`      | `--e-bg`        | quiet text on the canvas     | 4.5:1    |
   | `--e-muted`      | `--e-surface`   | quiet text, control edges    | 4.5:1    |
   | `--e-accent`     | `--e-surface`   | pressed state, accent text   | 4.5:1    |
   | `--e-danger`     | `--e-surface`   | an alert's text              | 4.5:1    |
   | `--e-focus`      | `--e-bg`        | the focus ring on the canvas | 3:1      |
   | `--e-focus`      | `--e-surface`   | the focus ring on a panel    | 3:1      |
   | `--e-on-primary` | `--e-primary`   | the main action's label      | 4.5:1    |
   | `--e-primary`    | `--e-surface`   | the main action's shape      | 3:1      |
   | `--e-field`      | `--e-surface`   | the edge of a field          | 1.5:1    |
   | `--e-ok`         | `--e-surface`   | a status that is well        | 4.5:1    |
   | `--e-warn`       | `--e-surface`   | a status that needs care     | 4.5:1    |
   | `--e-danger`     | `--e-danger-bg` | an error on its fill         | 4.5:1    |

   `--e-faint` is exempt: WCAG 1.4.3 does not apply to disabled controls or to a placeholder,
   and those are its only uses. A field's edge is not the only cue: its label and its focus ring
   (3:1) say it is a field, so its edge has a lower bar.

   A new token pair that the page uses gets a row here before it ships.

2. Every control, when it has focus, shows an outline of `--e-focus` at least 2 px thick, with a
   gap of `--e-bg` around it, so it shows on a panel, on the canvas and over any frame. A field
   shows focus on its own edge: the edge turns `--e-focus` (3:1 on `--e-surface`), and a 3 px
   halo of `--e-focus-halo` goes around it. The halo is soft and is not the cue alone. This is the
   shadcn/ui and Vercel Geist pattern; a solid ink ring was too harsh.
3. Under `prefers-reduced-motion: reduce`, every transition and animation the page runs lasts 0 s,
   and a pan or zoom jumps to its end.

## Success Criteria

- Page tests reach each control by role and name in both themes.
- A test reads the tokens in both themes and checks each pair in the contrast table.
- A page test focuses each control in both themes and checks the outline's color and thickness.
- A page test with reduced motion checks that each transition and animation lasts 0 s.
- A style check finds no raw color and no px value in the properties of fact rule 1.

## Design on the canvas

- A draft frame is an exploration: it may break any rule.
- A frame that asks for sign-off (`needs_review`, `ready_for_dev`) uses the system. So do the E4
  frames and every frame on the Design system and Components pages. `bun run design:proof` checks
  them (S1 to S12, T1) and finds them through the Doop MCP.
- A new need becomes a token or a component on the canvas first; then a frame uses it.

## Out of Scope (Deferred)

- A component catalogue page (Storybook or the like).
- Themes beyond light and dark.
