import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { operation } from "@tinkered/core";
import { z } from "zod";

import geist from "./fonts/Geist-Variable.woff2" with { type: "file" };
import geistMono from "./fonts/GeistMono-Variable.woff2" with { type: "file" };
import interLatinExt from "./fonts/inter-latin-ext-wght-normal.woff2" with { type: "file" };
import interLatin from "./fonts/inter-latin-wght-normal.woff2" with { type: "file" };
import interVietnamese from "./fonts/inter-vietnamese-wght-normal.woff2" with { type: "file" };

export const fontPrefix = "/api/fonts/";

const geistPath = existsSync(geist)
  ? geist
  : fileURLToPath(new URL("./fonts/Geist-Variable.woff2", import.meta.url));

const geistMonoPath = existsSync(geistMono)
  ? geistMono
  : fileURLToPath(new URL("./fonts/GeistMono-Variable.woff2", import.meta.url));

const interVietnamesePath = existsSync(interVietnamese)
  ? interVietnamese
  : fileURLToPath(new URL("./fonts/inter-vietnamese-wght-normal.woff2", import.meta.url));

const interLatinExtPath = existsSync(interLatinExt)
  ? interLatinExt
  : fileURLToPath(new URL("./fonts/inter-latin-ext-wght-normal.woff2", import.meta.url));

const interLatinPath = existsSync(interLatin)
  ? interLatin
  : fileURLToPath(new URL("./fonts/inter-latin-wght-normal.woff2", import.meta.url));

const interRange = {
  latin:
    "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  latinExt:
    "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  vietnamese:
    "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
};

export const heldFonts: ReadonlyArray<{
  family: string;
  file: string;
  path: string;
  range?: string;
}> = [
  {
    family: "Geist",
    file: "geist-1.9.2/Geist-Variable.woff2",
    path: geistPath,
  },
  {
    family: "Geist Mono",
    file: "geist-1.9.2/GeistMono-Variable.woff2",
    path: geistMonoPath,
  },
  {
    family: "Inter",
    file: "inter-5.3.0/inter-vietnamese-wght-normal.woff2",
    path: interVietnamesePath,
    range: interRange.vietnamese,
  },
  {
    family: "Inter",
    file: "inter-5.3.0/inter-latin-ext-wght-normal.woff2",
    path: interLatinExtPath,
    range: interRange.latinExt,
  },
  {
    family: "Inter",
    file: "inter-5.3.0/inter-latin-wght-normal.woff2",
    path: interLatinPath,
    range: interRange.latin,
  },
];

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
          `@font-face {\n  font-family: "${font.family}";\n  src: url("${fontPrefix}${font.file}") format("woff2");\n  font-weight: 100 900;\n  font-style: normal;\n  font-display: swap;\n${font.range ? `  unicode-range: ${font.range};\n` : ""}}\n`,
      )
      .join("");
  },
});

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
