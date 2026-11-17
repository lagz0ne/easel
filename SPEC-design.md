# Spec: design — V1

Module `design` of [SPEC.md](SPEC.md). Depends on nothing.

## Objective

easel's own small design system. The canvas belongs to the frames, so the controls around it stay
quiet: few colors, one typeface, clear focus. Everything here is written fresh: no tokens, names or
styles come from doop (clean room, see `docs/canvas-speed.md`).

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

- `src/design/tokens.css` defines the custom properties: color (`--e-bg`, `--e-surface`,
  `--e-text`, `--e-muted`, `--e-accent`, `--e-danger`, `--e-focus`), space (`--e-1` to `--e-6`, on a
  4 px grid), radius, shadow, type (`--e-font`, `--e-size-1` to `--e-size-4`) and motion.
- The controls the viewer needs, as React components on native elements: `Button` (with a pressed
  state), `TextField`, `Panel` (complementary), `Toolbar`, `Status` (live region), `Alert`, `Pin`,
  `Card`.

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

   | Foreground   | Background    | What it is                   | At least |
   | ------------ | ------------- | ---------------------------- | -------- |
   | `--e-text`   | `--e-bg`      | text on the canvas           | 4.5:1    |
   | `--e-text`   | `--e-surface` | text on a panel              | 4.5:1    |
   | `--e-muted`  | `--e-bg`      | quiet text on the canvas     | 4.5:1    |
   | `--e-muted`  | `--e-surface` | quiet text, control edges    | 4.5:1    |
   | `--e-accent` | `--e-surface` | pressed state, accent text   | 4.5:1    |
   | `--e-danger` | `--e-surface` | an alert's text              | 4.5:1    |
   | `--e-focus`  | `--e-bg`      | the focus ring on the canvas | 3:1      |
   | `--e-focus`  | `--e-surface` | the focus ring on a panel    | 3:1      |

   A new token pair that the page uses gets a row here before it ships.

2. Every control, when it has focus, shows an outline of `--e-focus` at least 2 px thick, with a
   gap of `--e-bg` around it, so it shows on a panel, on the canvas and over any frame.
3. Under `prefers-reduced-motion: reduce`, every transition and animation the page runs lasts 0 s,
   and a pan or zoom jumps to its end.

## Success Criteria

- Page tests reach each control by role and name in both themes.
- A test reads the tokens in both themes and checks each pair in the contrast table.
- A page test focuses each control in both themes and checks the outline's color and thickness.
- A page test with reduced motion checks that each transition and animation lasts 0 s.
- A style check finds no raw color and no px value in the properties of fact rule 1.

## Out of Scope (Deferred)

- A component catalogue page (Storybook or the like).
- Themes beyond light and dark.
