import { operation } from "@tinkered/core";
import { z } from "zod";

import { runtimeLink } from "./runtime";

export const composeKit = z.object({ look: z.string(), css: z.string() });

export const pieceScript = `<script>(()=>{let p=null;const s=(d)=>{if(!d||d.easel!=="kit"||typeof d.look!=="string"||typeof d.css!=="string")return;const l=document.getElementById("easel-look"),k=document.getElementById("easel-kit");if(l)l.textContent=d.look;if(k)k.textContent=d.css};const h=()=>{if(p)return;parent.postMessage({easel:"hello"},"*");setTimeout(h,50)};addEventListener("message",(e)=>{if(e.source!==parent||!e.ports[0])return;if(p)p.close();p=e.ports[0];p.onmessage=(m)=>s(m.data);s(e.data)});h()})()</script>`;

const styleEnd = /<\/(style)/gi;

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

const scriptEnd = /<(\/script|!--)/gi;

export const frameAxes = z.object({
  locale: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

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
    const map = JSON.stringify({ imports }).replaceAll("<", "\\u003c");
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

export const pair = z.object({
  text: z.string(),
  on: z.string(),
  ratio: z.number(),
  min: z.number(),
  where: z.string(),
});

export type Pair = z.infer<typeof pair>;

const textColors = [
  "foreground",
  "muted-foreground",
  "primary",
  "success",
  "warning",
  "destructive",
  "accent-foreground",
];

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

export const ratioOf = operation({
  label: "kit.ratioOf",
  input: z.object({ text: z.string(), on: z.string() }),
  depends: { channels, luminance },
  run: ({ channels, luminance }, { input }) => {
    const fg = channels.run({ input: input.text });
    const bg = channels.run({ input: input.on });
    if (!fg || !bg) return 0;

    const alpha = fg[3] ?? 1;
    const laid = [0, 1, 2].map((i) => (fg[i] ?? 0) * alpha + (bg[i] ?? 0) * (1 - alpha));
    const lights = [luminance.run({ input: laid }), luminance.run({ input: bg })];
    const [high = 0, low = 0] = lights.sort((a, b) => b - a);
    return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
  },
});

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

    const once = new Map<string, Omit<Pair, "ratio">>();
    for (const p of asked) if (!once.has(`${p.text} ${p.on}`)) once.set(`${p.text} ${p.on}`, p);
    return [...once.values()].map((p) => {
      const colors = { text: look[`--${p.text}`] ?? "", on: look[`--${p.on}`] ?? "" };
      return { ...p, ratio: ratioOf.run({ input: colors }) };
    });
  },
});
