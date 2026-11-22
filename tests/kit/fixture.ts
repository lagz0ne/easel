// The kit of the tests: the look and the class pieces of the E8 study (A+T), as kit version 1.
// The seed of easel comes later (SPEC-kit.md § Build order, step 5); these tests do not need it.
const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();

/** The look values of look.css, by CSS name: `{ "--primary": "#4338ca", ... }`. */
export function lookOf(css: string) {
  return Object.fromEntries(
    [...css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]),
  );
}

export async function testKit(version = 1) {
  return {
    version,
    look: lookOf(await read("look.css")),
    css: await read("kit.css"),
    pieces: [],
  };
}

export const frame = (name: string) => read(`frames/${name}.html`);
export const bad = () => read("k5-bad.html");
