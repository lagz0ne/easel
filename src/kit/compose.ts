import { operation } from "@tinkered/core";
import { z } from "zod";

import { runtimeLink } from "./runtime";

// The shared functions of the kit (SPEC-kit.md § compose): the page and the server both use them,
// so this file imports no server code.

/** What `compose` needs of a kit version: the look as a `:root` block, and the kit's made CSS. */
export const composeKit = z.object({ look: z.string(), css: z.string() });

/**
 * The piece script (SPEC-kit.md § compose; judged rules 9, 10), at most 3 KiB. A document can
 * start before the page listens, so it says hello to its parent at once and again each 50 ms,
 * until a message from its parent gives it a `MessagePort` (as penpal does). That message, and
 * each later one on the port, is `{ easel: "kit", kit, look, css }`: the script replaces the text
 * of the two `<style>` elements `easel-look` and `easel-kit`. Two hellos can be in flight before the
 * first answer: the page answers each with a new port and closes the one before, so the script
 * takes each port its parent gives and keeps the newest. It sends nothing but the hello, and
 * holds no color, size or font. Element pieces (`k-`) come with the pieces (build order step 4).
 */
export const pieceScript = `<script>(()=>{let p=null;const s=(d)=>{if(!d||d.easel!=="kit"||typeof d.look!=="string"||typeof d.css!=="string")return;const l=document.getElementById("easel-look"),k=document.getElementById("easel-kit");if(l)l.textContent=d.look;if(k)k.textContent=d.css};const h=()=>{if(p)return;parent.postMessage({easel:"hello"},"*");setTimeout(h,50)};addEventListener("message",(e)=>{if(e.source!==parent||!e.ports[0])return;if(p)p.close();p=e.ports[0];p.onmessage=(m)=>s(m.data);s(e.data)});h()})()</script>`;

/** A style text cannot end its own element: `</style` in CSS is written `<\/style`. */
const styleEnd = /<\/(style)/gi;

/**
 * `compose`: the document that a frame shows (fact rule 3). `css` is the made CSS of the frame
 * version; `null` says it has none: the frame turns the kit off (`<meta name="easel-kit"
 * content="off">`, which the check found at its put), or it was stored before the kit. Then the
 * document is the frame's, as it is. Else: `<!doctype html>`, the look, the kit's made CSS, the
 * frame's made CSS, the piece script, then the frame without its own doctype. It adds only stored
 * text and the piece script (judged rule 9), so the same inputs give the same bytes.
 */
export const compose = operation({
  label: "kit.compose",
  input: z.object({ html: z.string(), css: z.string().nullable(), kit: composeKit }),
  run: (_, { input: { html, css, kit } }) => {
    if (css === null) return html;

    const [look, made, own] = [kit.look, kit.css, css].map((text) =>
      text.replace(styleEnd, "<\\/$1"),
    );
    const frame = html.replace(/^\uFEFF?\s*<!doctype[^>]*>/i, "");
    return (
      `<!doctype html>\n<style id="easel-look">${look}</style>\n` +
      `<style id="easel-kit">${made}</style>\n` +
      `<style id="easel-frame">${own}</style>\n${pieceScript}\n${frame}`
    );
  },
});

/** A script text cannot end its own element, or start a comment that hides its end tag. */
const scriptEnd = /<(\/script|!--)/gi;

/**
 * The axes of a capsule frame (SPEC-kit.md § The capsules, "A capsule frame"): the locale and the
 * config of the frame's own capsule (its data state). Another pick is another document, so the
 * frame draws in a new scope.
 */
export const frameAxes = z.object({
  locale: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

/**
 * `compose` of an app frame (SPEC-kit.md § App frames, "compose of an app frame"; fact rule 3):
 * `<!doctype html>`, the three `<style>` elements of an HTML frame (the look, the kit's made CSS,
 * the frame version's made CSS), an import map that points each name of the runtime to its file
 * at `runtime.address`, the frame's `axes` as JSON (`easel-axes`), and the frame's JS as one
 * module script, which mounts its `View` (`appBundle` gives it its call of `mount`). A capsule
 * frame draws with the axes. The body is empty: the mount renders into it. In the JS, `</script`
 * is written `<\/script` and `<!--` is written `<\!--`: the same text in a string, a template or
 * a regular expression. In the import map and the axes, `<` is `\u003c`. So no stored text can
 * end its element.
 */
export const composeApp = operation({
  label: "kit.composeApp",
  input: z.object({
    js: z.string(),
    css: z.string(),
    kit: composeKit,
    runtime: runtimeLink,
    axes: frameAxes.optional(),
  }),
  run: (_, { input: { js, css, kit, runtime, axes } }) => {
    const [look, made, own] = [kit.look, kit.css, css].map((text) =>
      text.replace(styleEnd, "<\\/$1"),
    );

    const imports = Object.fromEntries(
      Object.entries(runtime.imports).map(([name, file]) => [name, `${runtime.address}${file}`]),
    );
    // In JSON, `<` is `\u003c`, so the map cannot end its element.
    const map = JSON.stringify({ imports }).replaceAll("<", "\\u003c");
    // The JS calls the mount itself (`appBundle`); the mount reads the axes of this document.
    const shown = JSON.stringify(axes ?? {}).replaceAll("<", "\\u003c");
    const code = js.replace(scriptEnd, (_, end: string) =>
      end === "!--" ? "<\\!--" : "<\\/script",
    );

    return (
      `<!doctype html>\n<style id="easel-look">${look}</style>\n` +
      `<style id="easel-kit">${made}</style>\n` +
      `<style id="easel-frame">${own}</style>\n` +
      `<script type="importmap">${map}</script>\n` +
      `<script type="application/json" id="easel-axes">${shown}</script>\n` +
      `<script type="module">\n${code}\n</script>\n`
    );
  },
});

/** One pair of K8 (judged rule 7): a text or an edge color on a surface, and its ratio. */
export const pair = z.object({
  text: z.string(),
  on: z.string(),
  ratio: z.number(),
  min: z.number(),
  where: z.string(),
});

export type Pair = z.infer<typeof pair>;

/** The text colors of the kit that each sit on `--background`, `--card` and `--muted` (the study's K8). */
const textColors = [
  "foreground",
  "muted-foreground",
  "primary",
  "success",
  "warning",
  "destructive",
  "accent-foreground",
];

/** A `#rgb[a]` or `#rrggbb[aa]` color as its four channels from 0 to 1; null for any other text. */
export const channels = operation({
  label: "kit.channels",
  input: z.string(),
  run: (_, { input }) => {
    const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input.trim())?.[1];
    if (!hex) return null;

    const full = hex.length <= 4 ? hex.replace(/./g, "$&$&") : hex;
    return [0, 2, 4, 6].map((at) =>
      at < full.length ? Number.parseInt(full.slice(at, at + 2), 16) / 255 : 1,
    );
  },
});

/** The WCAG 2.2 relative luminance of an sRGB color (its channels from 0 to 1). */
export const luminance = operation({
  label: "kit.luminance",
  input: z.array(z.number()),
  run: (_, { input }) => {
    const [r = 0, g = 0, b = 0] = input.map((v) =>
      v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  },
});

/** The WCAG 2.2 contrast ratio of a text color on a surface; the text's alpha is laid on the surface first. */
export const ratioOf = operation({
  label: "kit.ratioOf",
  input: z.object({ text: z.string(), on: z.string() }),
  depends: { channels, luminance },
  run: ({ channels, luminance }, { input }) => {
    const fg = channels.run({ input: input.text });
    const bg = channels.run({ input: input.on });
    // A color that is not a plain sRGB color cannot be measured: it fails.
    if (!fg || !bg) return 0;

    const alpha = fg[3] ?? 1;
    const laid = [0, 1, 2].map((i) => (fg[i] ?? 0) * alpha + (bg[i] ?? 0) * (1 - alpha));
    const lights = [luminance.run({ input: laid }), luminance.run({ input: bg })];
    const [high = 0, low = 0] = lights.sort((a, b) => b - a);
    return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
  },
});

/** The pairs of the kit's own rules: each rule that sets `color` and a background from look values. */
export const kitPairs = operation({
  label: "kit.kitPairs",
  input: z.string(),
  run: (_, { input: css }) => {
    const pairs: Array<Omit<Pair, "ratio">> = [];
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = rule[2] ?? "";
      const text = /(?:^|[;\s])color\s*:\s*var\(--([a-z0-9-]+)\)/.exec(body)?.[1];
      const on = /(?:^|[;\s])background(?:-color)?\s*:\s*var\(--([a-z0-9-]+)\)/.exec(body)?.[1];
      const where = `the kit rule ${(rule[1] ?? "").trim()}`;
      if (text && on) pairs.push({ text, on, min: 4.5, where });
    }
    return pairs;
  },
});

/**
 * `contrast(look, kit)`: the pairs of K8 and their ratios (judged rule 7). Each kit rule that
 * sets `color` and `background` (or `background-color`) from look values; each text color of the
 * kit on `--background`, `--card` and `--muted`; `--input` and `--ring` on `--background` (3:1, a
 * field edge and the focus ring). `look` is by CSS name; `css` is the kit's own CSS.
 */
export const contrast = operation({
  label: "kit.contrast",
  input: z.object({ look: z.record(z.string(), z.string()), css: z.string() }),
  depends: { kitPairs, ratioOf },
  run: ({ kitPairs, ratioOf }, { input: { look, css } }) => {
    const asked = [...kitPairs.run({ input: css })];
    for (const text of textColors) {
      for (const on of ["background", "card", "muted"]) {
        asked.push({ text, on, min: 4.5, where: `text on --${on}` });
      }
    }
    asked.push({ text: "input", on: "background", min: 3, where: "a field edge" });
    asked.push({ text: "ring", on: "background", min: 3, where: "the focus ring" });

    // One pair is measured once: the first place that asks for it names it.
    const once = new Map<string, Omit<Pair, "ratio">>();
    for (const p of asked) if (!once.has(`${p.text} ${p.on}`)) once.set(`${p.text} ${p.on}`, p);
    return [...once.values()].map((p) => {
      const colors = { text: look[`--${p.text}`] ?? "", on: look[`--${p.on}`] ?? "" };
      return { ...p, ratio: ratioOf.run({ input: colors }) };
    });
  },
});
