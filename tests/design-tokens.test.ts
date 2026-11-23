import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";

const css = readFileSync(join(import.meta.dirname, "../src/design/tokens.css"), "utf8");

function block(head: RegExp): Map<string, string> {
  const found = head.exec(css);
  if (!found) throw new Error(`no block ${head}`);

  const open = found.index + found[0].length;
  const body = css.slice(open, css.indexOf("}", open));

  const pairs = [...body.matchAll(/(--e-[\w-]+)\s*:\s*([^;]+);/g)];
  return new Map(pairs.map(([, name, value]) => [name ?? "", (value ?? "").trim()]));
}

const light = block(/:root,\s*\.e-light\s*\{/);

const dark = new Map([
  ...light,
  ...block(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{/),
]);

const themes = { light, dark };

const contract = [
  "bg",
  "surface",
  "card",
  "text",
  "muted",
  "faint",
  "primary",
  "on-primary",
  "accent",
  "on-accent",
  "accent-bg",
  "focus",
  "focus-halo",
  "line",
  "divider",
  "field",
  "tint",
  "hover",
  "ok",
  "warn",
  "danger",
  "danger-bg",
  "scrim",
  "shadow-low",
  "shadow-mid",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "radius-xs",
  "radius-s",
  "radius",
  "radius-l",
  "radius-xl",
  "radius-full",
  "font",
  "size-0",
  "size-1",
  "size-2",
  "size-3",
  "size-4",
  "leading-1",
  "leading-2",
  "leading-3",
  "leading-4",
  "w-normal",
  "w-medium",
  "w-strong",
].map((name) => `--e-${name}`);

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const pairs: [string, string, number][] = [
  ["text", "bg", 4.5],
  ["text", "surface", 4.5],
  ["muted", "bg", 4.5],
  ["muted", "surface", 4.5],
  ["accent", "surface", 4.5],
  ["danger", "surface", 4.5],
  ["focus", "bg", 3],
  ["focus", "surface", 3],
  ["on-primary", "primary", 4.5],
  ["primary", "surface", 3],
  ["field", "surface", 1.5],
  ["ok", "surface", 4.5],
  ["warn", "surface", 4.5],
  ["danger", "danger-bg", 4.5],
  ["accent", "accent-bg", 4.5],
  ["text", "hover", 4.5],
  ["muted", "hover", 4.5],
];

test("tokens.css has each token of the contract, in the light and the dark theme", () => {
  for (const [, tokens] of Object.entries(themes)) {
    expect(contract.filter((name) => !tokens.has(name))).toEqual([]);
  }
});

test("each pair of the contrast table meets its ratio in both themes (WCAG 2.2 AA)", () => {
  const short: string[] = [];
  for (const [theme, tokens] of Object.entries(themes)) {
    for (const [fg, bg, least] of pairs) {
      const a = tokens.get(`--e-${fg}`) ?? "";
      const b = tokens.get(`--e-${bg}`) ?? "";
      const got = ratio(a, b);
      if (!(got >= least)) short.push(`${theme} ${fg} on ${bg}: ${got.toFixed(2)} < ${least}`);
    }
  }
  expect(short).toEqual([]);
});
