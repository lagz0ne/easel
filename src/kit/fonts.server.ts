import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { operation } from "@tinkered/core";
import { z } from "zod";

import geist from "./fonts/Geist-Variable.woff2" with { type: "file" };
import geistMono from "./fonts/GeistMono-Variable.woff2" with { type: "file" };

// The fonts that the binary holds (SPEC-kit.md § The seed): Geist and Geist Mono 1.9.2 by Vercel
// (OFL-1.1, `fonts/OFL.txt`), the fonts of ui.shadcn.com. A look that names one gets its
// `@font-face` in `easel-look`. The version is in the address, so a file never changes there.

/** Where the font files are: `/api/fonts/<dir>/<file>`. */
export const fontPrefix = "/api/fonts/";

// The path of each font file. Bun gives the path of the import (in the binary, a path inside it,
// so the build keeps the file). Vite, which runs the tests, gives an address from the project root
// instead; then the file is in `fonts/`, next to this one.
const geistPath = existsSync(geist)
  ? geist
  : fileURLToPath(new URL("./fonts/Geist-Variable.woff2", import.meta.url));

const geistMonoPath = existsSync(geistMono)
  ? geistMono
  : fileURLToPath(new URL("./fonts/GeistMono-Variable.woff2", import.meta.url));

/** Each held font: its family, its address under `fontPrefix`, and the path of its file. */
export const heldFonts: ReadonlyArray<{ family: string; file: string; path: string }> = [
  { family: "Geist", file: "geist-1.9.2/Geist-Variable.woff2", path: geistPath },
  { family: "Geist Mono", file: "geist-1.9.2/GeistMono-Variable.woff2", path: geistMonoPath },
];

/**
 * The `@font-face` rules of the held fonts that a look names, in the order of `heldFonts`. A
 * frame's origin is `null`, so its document gets the file from the easel's origin (its `srcdoc`
 * has the base address of the page). Each file is variable: one file has weights 100 to 900.
 */
export const fontFaces = operation({
  label: "kit.fontFaces",
  input: z.record(z.string(), z.string()),
  run: (_, { input }) => {
    const named = new Set(
      Object.entries(input)
        .filter(([name]) => name.startsWith("--font-"))
        .flatMap(([, value]) => value.split(",").map((part) => part.trim().replace(/^"|"$/g, ""))),
    );
    return heldFonts
      .filter((font) => named.has(font.family))
      .map(
        (font) =>
          `@font-face {\n  font-family: "${font.family}";\n  src: url("${fontPrefix}${font.file}") format("woff2");\n  font-weight: 100 900;\n  font-style: normal;\n  font-display: swap;\n}\n`,
      )
      .join("");
  },
});

/**
 * A look's text with each held font's address replaced by the file itself, as a `data:` URL. A
 * picture is drawn from `about:blank` with no route to the easel (SPEC-frames § Pictures), so an
 * address there reaches nothing; with this, a picture shows the font that the live frame shows.
 */
export const inlineFonts = operation({
  label: "kit.inlineFonts",
  input: z.string(),
  run: (_, { input }) =>
    heldFonts.reduce((text, font) => {
      const address = `url("${fontPrefix}${font.file}")`;
      if (!text.includes(address)) return text;
      const data = readFileSync(font.path).toString("base64");
      return text.replaceAll(address, `url("data:font/woff2;base64,${data}")`);
    }, input),
});

const fontHeaders = {
  "Content-Type": "font/woff2",
  "Cache-Control": "public, max-age=31536000, immutable",
  "Access-Control-Allow-Origin": "*",
};

/**
 * `GET /api/fonts/{dir}/{file}`: one held font file. No user and no pass: the files are the same
 * for each team. Any origin may load one, as a frame's origin is `null`. Another address answers
 * 404.
 */
export const fontRoute = operation({
  label: "kit.fontRoute",
  input: z.object({ dir: z.string(), file: z.string() }),
  run: (_, { input }) => {
    const font = heldFonts.find((held) => held.file === `${input.dir}/${input.file}`);
    if (font === undefined) {
      return new Response("not found", {
        status: 404,
        headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
      });
    }
    return new Response(Bun.file(font.path), { headers: fontHeaders });
  },
});
