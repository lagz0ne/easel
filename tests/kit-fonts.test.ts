import { readFileSync } from "node:fs";
import { join } from "node:path";

import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";

import { fontFaces, fontRoute, heldFonts, inlineFonts } from "@/kit/fonts.server";

// The fonts that easel holds (SPEC-kit.md § The seed): a look that names Geist or Geist Mono gets
// its `@font-face`, and `GET /api/fonts/{dir}/{file}` gives the file to any origin, as a frame's
// origin is `null`.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function scope() {
  const s = createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] });
  closers.push(() => s.close());
  return s;
}

test("a look that names a held font gets its face; a look with no held font gets none", async () => {
  const s = await scope();
  const both = await s.run(fontFaces, {
    input: {
      "--font-sans": "Geist, ui-sans-serif, sans-serif",
      "--font-mono": '"Geist Mono", ui-monospace, monospace',
      "--primary": "#171717",
    },
  });
  expect(both).toBe(
    '@font-face {\n  font-family: "Geist";\n  src: url("/api/fonts/geist-1.9.2/Geist-Variable.woff2") format("woff2");\n  font-weight: 100 900;\n  font-style: normal;\n  font-display: swap;\n}\n' +
      '@font-face {\n  font-family: "Geist Mono";\n  src: url("/api/fonts/geist-1.9.2/GeistMono-Variable.woff2") format("woff2");\n  font-weight: 100 900;\n  font-style: normal;\n  font-display: swap;\n}\n',
  );
  // A color named Geist is no font: only `--font-*` values count.
  const none = await s.run(fontFaces, {
    input: { "--font-sans": "Roboto, sans-serif", "--primary": "Geist" },
  });
  expect(none).toBe("");
});

test("GET /api/fonts gives a held font to any origin and keeps it a year; another file is 404", async () => {
  const s = await scope();
  for (const font of heldFonts) {
    const [dir = "", file = ""] = font.file.split("/");
    const res = await s.run(fontRoute, { input: { dir, file } });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("font/woff2");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const bytes = new Uint8Array(await res.arrayBuffer());

    // A WOFF2 file starts with "wOF2".
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("wOF2");
  }

  const missing = await s.run(fontRoute, { input: { dir: "geist-1.9.2", file: "Nope.woff2" } });
  expect(missing.status).toBe(404);
  expect(missing.headers.get("Access-Control-Allow-Origin")).toBe("*");
  const outside = await s.run(fontRoute, { input: { dir: "..", file: "OFL.txt" } });
  expect(outside.status).toBe(404);
});

test("a picture's look holds each named font as a data: URL; a look with no held font is kept", async () => {
  const s = await scope();
  const look = await s.run(fontFaces, { input: { "--font-sans": "Geist, sans-serif" } });
  const inline = await s.run(inlineFonts, { input: look });

  expect(inline).not.toContain("/api/fonts/");
  expect(inline).toContain('src: url("data:font/woff2;base64,d09GMg');

  expect(await s.run(inlineFonts, { input: ":root {}\n" })).toBe(":root {}\n");
});

test("Inter, the font of the viewer, is held in three files by range, as Google Fonts does; tokens.css has the same faces", async () => {
  const s = await scope();
  const faces = await s.run(fontFaces, { input: { "--e-font": '"Inter", sans-serif' } });
  const inter = await s.run(fontFaces, { input: { "--font-sans": '"Inter", sans-serif' } });

  // Only `--font-*` names a font of a look; the viewer's own faces are in tokens.css.
  expect(faces).toBe("");
  expect(inter.match(/font-family: "Inter";/g)).toHaveLength(3);
  expect(inter.match(/unicode-range: U\+/g)).toHaveLength(3);
  expect(inter).toContain('url("/api/fonts/inter-5.3.0/inter-latin-wght-normal.woff2")');
  expect(inter).toContain('url("/api/fonts/inter-5.3.0/inter-vietnamese-wght-normal.woff2")');

  const css = readFileSync(join(import.meta.dirname, "../src/design/tokens.css"), "utf8");
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  const inCss = [...css.matchAll(/@font-face \{[^}]*\}/g)].map((m) => m[0]).join("\n");
  expect(flat(inCss)).toBe(flat(inter));
});
