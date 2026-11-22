import { operation } from "@tinkered/core";
import { z } from "zod";

// The seed (SPEC-kit.md § Terms): the look and the kit that the binary holds. The first start
// writes them as kit version 1 (`seedKit`, fact rule 7). Only `seedKit` reads this file.
//
// A START, NOT THE LOOK OF EASEL. The look values come from the shadcn/ui theme (MIT; its color
// names and the values of its base color "neutral", converted from oklch to sRGB), with
// Tailwind's scales (MIT) for the rest, as the user decided on 2026-11-22. Where a shadcn/ui value
// fails K8 (judged rule 7), the value here is the nearest one that passes, and its
// `$description` says so. A later design ship on Doop (ADR kit-on-tailwind, build order step 5,
// default 8) picks easel's own base color, font and radius, so that a frame does not look like a
// template. The kit's pieces are those of the E8 study (A+T).

/** The colors of the look: name, sRGB hex, and why it is not the shadcn/ui value, if it is not. */
export const seedColors: ReadonlyArray<readonly [string, string, string?]> = [
  ["background", "#ffffff"],
  ["foreground", "#0a0a0a"],
  ["card", "#ffffff"],
  ["card-foreground", "#0a0a0a"],
  ["popover", "#ffffff"],
  ["popover-foreground", "#0a0a0a"],
  ["primary", "#171717"],
  ["primary-foreground", "#fafafa"],
  ["secondary", "#f5f5f5"],
  ["secondary-foreground", "#171717"],
  ["muted", "#f5f5f5"],
  [
    "muted-foreground",
    "#6f6f6f",
    "shadcn/ui has oklch(0.556 0 0), 4.35:1 on muted; oklch(0.54 0 0) gives 4.61:1 (K8)",
  ],
  ["accent", "#f5f5f5"],
  ["accent-foreground", "#171717"],
  [
    "destructive",
    "#bf0010",
    "shadcn/ui has oklch(0.577 0.245 27.325), 4.47:1 on muted; Tailwind red-700 gives 5.98:1 (K8)",
  ],
  ["destructive-soft", "#ffe2e2", "not in shadcn/ui: Tailwind red-100"],
  ["success", "#00813a", "not in shadcn/ui: Tailwind green-700"],
  ["success-soft", "#dcfce7", "not in shadcn/ui: Tailwind green-100"],
  ["warning", "#8a5a00", "not in shadcn/ui: 5.44:1 on muted (K8; the study's amber gave 4.48:1)"],
  ["warning-soft", "#fef3c6", "not in shadcn/ui: Tailwind amber-100"],
  ["border", "#e5e5e5"],
  [
    "input",
    "#8a8a8a",
    "shadcn/ui has oklch(0.922 0 0), 1.26:1 on background; a field edge needs 3:1 (K8)",
  ],
  [
    "ring",
    "#8a8a8a",
    "shadcn/ui has oklch(0.708 0 0), 2.58:1 on background; the focus ring needs 3:1 (K8)",
  ],
  ["chart-1", "#ec5600"],
  ["chart-2", "#009488"],
  ["chart-3", "#104e64"],
  ["chart-4", "#fabc00"],
  ["chart-5", "#f69e00"],
  ["white", "#ffffff"],
  ["black", "#000000"],
];

/** Tailwind's font stacks: a system font stack, as easel keeps no fonts (SPEC-kit § Out of Scope). */
const sans = [
  "ui-sans-serif",
  "system-ui",
  "sans-serif",
  "Apple Color Emoji",
  "Segoe UI Emoji",
  "Segoe UI Symbol",
  "Noto Color Emoji",
];

const mono = [
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Monaco",
  "Consolas",
  "Liberation Mono",
  "Courier New",
  "monospace",
];

/** Tailwind's type scale, in rem. */
const textSizes: ReadonlyArray<readonly [string, number]> = [
  ["xs", 0.75],
  ["sm", 0.875],
  ["base", 1],
  ["lg", 1.125],
  ["xl", 1.25],
  ["2xl", 1.5],
  ["3xl", 1.875],
  ["4xl", 2.25],
  ["5xl", 3],
  ["6xl", 3.75],
  ["7xl", 4.5],
  ["8xl", 6],
  ["9xl", 8],
];

/** shadcn/ui's radii: `--radius` 0.625rem (10px), and sm, md and xl from it, in px. */
const radii: ReadonlyArray<readonly [string, number]> = [
  ["sm", 6],
  ["md", 8],
  ["lg", 10],
  ["xl", 14],
];

/** Tailwind's shadows: each layer is x, y, blur, spread (px) and the alpha of black. */
const shadows: ReadonlyArray<readonly [string, ReadonlyArray<readonly number[]>]> = [
  ["2xs", [[0, 1, 0, 0, 0.05]]],
  ["xs", [[0, 1, 2, 0, 0.05]]],
  [
    "sm",
    [
      [0, 1, 3, 0, 0.1],
      [0, 1, 2, -1, 0.1],
    ],
  ],
  [
    "md",
    [
      [0, 4, 6, -1, 0.1],
      [0, 2, 4, -2, 0.1],
    ],
  ],
  [
    "lg",
    [
      [0, 10, 15, -3, 0.1],
      [0, 4, 6, -4, 0.1],
    ],
  ],
  [
    "xl",
    [
      [0, 20, 25, -5, 0.1],
      [0, 8, 10, -6, 0.1],
    ],
  ],
  ["2xl", [[0, 25, 50, -12, 0.25]]],
];

/** A DTCG 2025.10 sRGB color of a hex, with its alpha when it is not opaque. */
export const srgbOf = operation({
  label: "kit.srgbOf",
  input: z.object({ hex: z.string(), alpha: z.number().optional() }),
  run: (_, { input: { hex, alpha = 1 } }) => ({
    colorSpace: "srgb",
    components: [1, 3, 5].map(
      (at) => Math.round((Number.parseInt(hex.slice(at, at + 2), 16) / 255) * 10_000) / 10_000,
    ),
    ...(alpha === 1 ? {} : { alpha }),
    hex,
  }),
});

/** A DTCG group of one type: each row is a name and its `$value`. */
export const groupOf = operation({
  label: "kit.groupOf",
  input: z.object({ type: z.string(), rows: z.array(z.tuple([z.string(), z.unknown()])) }),
  run: (_, { input: { type, rows } }) => ({
    $type: type,
    ...Object.fromEntries(rows.map(([name, value]) => [name, { $value: value }])),
  }),
});

/**
 * The seed look in the DTCG format 2025.10: a color is `{ colorSpace: "srgb", components, hex }`,
 * a dimension `{ value, unit }`, a font family a list of names, a shadow a list of layers.
 */
export const seedLook = operation({
  label: "kit.seedLook",
  depends: { srgbOf, groupOf },
  run: ({ srgbOf, groupOf }) => ({
    $schema: "https://www.designtokens.org/schemas/2025.10/format.json",
    $description:
      "The look of one easel. Each look value is a CSS custom property: a color has its shadcn/ui name (color.primary is --primary), the others their Tailwind name (--text-sm, --radius-md, --spacing). The seed values are a start: a design ship picks easel's own.",
    color: {
      $type: "color",
      ...Object.fromEntries(
        seedColors.map(([name, hex, why]) => [
          name,
          { $value: srgbOf.run({ input: { hex } }), ...(why ? { $description: why } : {}) },
        ]),
      ),
    },
    font: {
      $type: "fontFamily",
      sans: { $value: sans },
      mono: { $value: mono },
      display: { $value: "{font.sans}" },
    },
    text: groupOf.run({
      input: {
        type: "dimension",
        rows: textSizes.map(([name, rem]) => [name, { value: rem, unit: "rem" }]),
      },
    }),
    radius: groupOf.run({
      input: {
        type: "dimension",
        rows: radii.map(([name, value]) => [name, { value, unit: "px" }]),
      },
    }),
    shadow: groupOf.run({
      input: {
        type: "shadow",
        rows: shadows.map(([name, layers]) => [
          name,
          layers.map(([x = 0, y = 0, blur = 0, spread = 0, alpha = 1]) => ({
            color: srgbOf.run({ input: { hex: "#000000", alpha } }),
            offsetX: { value: x, unit: "px" },
            offsetY: { value: y, unit: "px" },
            blur: { value: blur, unit: "px" },
            spread: { value: spread, unit: "px" },
          })),
        ]),
      },
    }),
    spacing: { $type: "dimension", $value: { value: 0.25, unit: "rem" } },
  }),
});

/**
 * The kit's own CSS: its base rules (`@layer base`) and its class pieces (`@layer components`),
 * in Tailwind's syntax, as in the E8 study (A+T). Each uses only look values (judged rule 11).
 */
export const seedKitCss = `@layer base {
  html {
    color-scheme: light;
  }
  body {
    background: var(--background);
    color: var(--foreground);
    font: 400 var(--text-sm)/1.5 var(--font-sans);
    -webkit-font-smoothing: antialiased;
  }
  h1,
  h2,
  h3,
  h4 {
    font-family: var(--font-display);
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  h1 {
    font-size: var(--text-2xl);
  }
  h2 {
    font-size: var(--text-xl);
  }
  h3 {
    font-size: var(--text-base);
  }
  a {
    color: var(--primary);
  }
  small {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 500;
  }
  label:has(> input[type="checkbox"], > input[type="radio"]) {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    font-weight: 400;
  }
  input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),
  select,
  textarea {
    width: 100%;
    height: 36px;
    padding: 0 12px;
    border: 1px solid var(--input);
    border-radius: var(--radius-md);
    background: var(--background);
  }
  textarea {
    height: auto;
    min-height: 80px;
    padding: 8px 12px;
  }
  input::placeholder,
  textarea::placeholder {
    color: var(--muted-foreground);
  }
  input[type="checkbox"],
  input[type="radio"] {
    width: 16px;
    height: 16px;
    accent-color: var(--primary);
  }
  :focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  table {
    width: 100%;
  }
  th {
    text-align: left;
    font-weight: 500;
    font-size: var(--text-xs);
    color: var(--muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  th,
  td {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  tr:last-child td {
    border-bottom: 0;
  }
  progress {
    width: 100%;
    height: 8px;
    appearance: none;
    border-radius: 9999px;
    background: var(--muted);
    overflow: hidden;
  }
  progress::-webkit-progress-bar {
    background: var(--muted);
  }
  progress::-webkit-progress-value {
    background: var(--primary);
  }
}

@layer components {
  .navbar {
    display: flex;
    align-items: center;
    gap: 24px;
    height: 56px;
    padding: 0 24px;
    border-bottom: 1px solid var(--border);
    background: var(--card);
  }
  .navbar > :first-child {
    font-weight: 600;
    font-size: var(--text-base);
  }
  .navbar nav {
    display: flex;
    gap: 4px;
  }
  .navbar nav a {
    color: var(--muted-foreground);
    padding: 4px 12px;
    border-radius: var(--radius-md);
    font-weight: 500;
  }
  .navbar nav a[aria-current] {
    color: var(--accent-foreground);
    background: var(--accent);
  }
  .card {
    background: var(--card);
    color: var(--card-foreground);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .card > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .card > footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid var(--border);
    margin: 0 -24px -24px;
    padding: 16px 24px;
  }
  .card-flush {
    padding: 0;
    gap: 0;
  }
  .card-flush > header {
    padding: 16px 24px;
    border-bottom: 1px solid var(--border);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 36px;
    padding: 0 16px;
    border-radius: var(--radius-md);
    border: 1px solid var(--input);
    background: var(--card);
    color: var(--foreground);
    font: 500 var(--text-sm)/1 var(--font-sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .btn:hover {
    background: var(--muted);
  }
  .btn-primary {
    background: var(--primary);
    border-color: var(--primary);
    color: var(--primary-foreground);
  }
  .btn-primary:hover {
    background: var(--primary);
    filter: brightness(1.1);
  }
  .btn-ghost {
    background: transparent;
    border-color: transparent;
  }
  .btn-danger {
    background: var(--destructive);
    border-color: var(--destructive);
    color: var(--primary-foreground);
  }
  .btn-sm {
    height: 28px;
    padding: 0 12px;
    font-size: var(--text-xs);
  }
  .btn-lg {
    height: 44px;
    padding: 0 24px;
    font-size: var(--text-base);
  }
  .hint,
  .error {
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--muted-foreground);
  }
  .error {
    color: var(--destructive);
  }
  label:has(.error) :is(input, select) {
    border-color: var(--destructive);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    border-radius: 9999px;
    font-size: var(--text-xs);
    font-weight: 500;
    background: var(--secondary);
    color: var(--secondary-foreground);
  }
  .badge-success {
    background: var(--success-soft);
    color: var(--success);
  }
  .badge-warning {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .badge-danger {
    background: var(--destructive-soft);
    color: var(--destructive);
  }
  .badge-info {
    background: var(--accent);
    color: var(--accent-foreground);
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .stat-label {
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
  .stat-value {
    font-size: var(--text-3xl);
    font-weight: 600;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .stat-up {
    color: var(--success);
    font-size: var(--text-xs);
  }
  .stat-down {
    color: var(--destructive);
    font-size: var(--text-xs);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 9999px;
    background: var(--accent);
    color: var(--accent-foreground);
    display: inline-grid;
    place-items: center;
    font-size: var(--text-xs);
    font-weight: 600;
    flex: none;
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    height: 200px;
    border-bottom: 1px solid var(--border);
  }
  .bars > i {
    flex: 1;
    height: var(--v, 50%);
    background: var(--primary);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  }
  .alert {
    display: flex;
    gap: 12px;
    padding: 12px 16px;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--accent-foreground);
  }
  .alert-success {
    background: var(--success-soft);
    color: var(--success);
  }
  .alert-warning {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .alert-danger {
    background: var(--destructive-soft);
    color: var(--destructive);
  }
  .tabs {
    display: flex;
    gap: 16px;
    border-bottom: 1px solid var(--border);
  }
  .tabs > a {
    color: var(--muted-foreground);
    padding: 8px 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    font-weight: 500;
  }
  .tabs > a[aria-current] {
    color: var(--foreground);
    border-color: var(--primary);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 48px;
    color: var(--muted-foreground);
    text-align: center;
  }
}
`;
