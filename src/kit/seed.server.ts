import { operation } from "@tinkered/core";
import { z } from "zod";

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
  ["chart-1", "#d4d4d4"],
  ["chart-2", "#737373"],
  ["chart-3", "#525252"],
  ["chart-4", "#404040"],
  ["chart-5", "#262626"],
  ["white", "#ffffff"],
  ["black", "#000000"],
];

const sans = [
  "Geist",
  "ui-sans-serif",
  "system-ui",
  "sans-serif",
  "Apple Color Emoji",
  "Segoe UI Emoji",
  "Segoe UI Symbol",
  "Noto Color Emoji",
];

const mono = [
  "Geist Mono",
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Monaco",
  "Consolas",
  "Liberation Mono",
  "Courier New",
  "monospace",
];

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

const radii: ReadonlyArray<readonly [string, number]> = [
  ["sm", 6],
  ["md", 8],
  ["lg", 10],
  ["xl", 14],
  ["2xl", 18],
  ["3xl", 22],
  ["4xl", 26],
];

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

export const srgbOf = operation({
  label: "kit.seedSrgbOf",
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

export const groupOf = operation({
  label: "kit.groupOf",
  input: z.object({ type: z.string(), rows: z.array(z.tuple([z.string(), z.unknown()])) }),
  run: (_, { input: { type, rows } }) => ({
    $type: type,
    ...Object.fromEntries(rows.map(([name, value]) => [name, { $value: value }])),
  }),
});

export const seedLook = operation({
  label: "kit.seedLook",
  depends: { srgbOf, groupOf },
  run: ({ srgbOf, groupOf }) => ({
    $schema: "https://www.designtokens.org/schemas/2025.10/format.json",
    $description:
      "The look of one easel. Each look value is a CSS custom property: a color has its shadcn/ui name (color.primary is --primary), the others their Tailwind name (--text-sm, --radius-md, --spacing). The seed is the look of ui.shadcn.com: the neutral base color, Geist and Geist Mono, and the radii of --radius 10px.",
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
    letter-spacing: -0.02em;
  }
  h3,
  h4 {
    font-weight: 500;
    letter-spacing: 0;
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
    border-radius: 9999px;
    background: var(--muted);
    color: var(--foreground);
  }
  textarea {
    height: auto;
    min-height: 80px;
    padding: 8px 12px;
    border-radius: var(--radius-xl);
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
    background: var(--chart-2);
    border-radius: 9999px;
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
    border-radius: 9999px;
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
    border-radius: var(--radius-3xl);
    box-shadow: var(--shadow-sm);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
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
    gap: 6px;
    height: 36px;
    padding: 0 12px;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--background);
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
    opacity: 0.8;
  }
  .btn-secondary {
    background: var(--secondary);
    border-color: var(--secondary);
    color: var(--secondary-foreground);
  }
  .btn-secondary:hover {
    background: var(--secondary);
    border-color: var(--border);
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
    height: 32px;
    padding: 0 12px;
    font-size: var(--text-xs);
  }
  .btn-lg {
    height: 40px;
    padding: 0 16px;
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
    background: var(--chart-2);
    border-radius: var(--radius-md) var(--radius-md) 0 0;
  }
  .alert {
    display: flex;
    gap: 12px;
    padding: 12px 16px;
    border-radius: var(--radius-2xl);
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
    display: inline-flex;
    align-self: flex-start;
    gap: 0;
    padding: 3px;
    border-radius: 9999px;
    background: var(--muted);
  }
  .tabs > a {
    color: var(--muted-foreground);
    padding: 4px 12px;
    border-radius: 9999px;
    font-weight: 500;
  }
  .tabs > a[aria-current] {
    color: var(--foreground);
    background: var(--background);
    box-shadow: var(--shadow-sm);
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
