import { operation, resource } from "@tinkered/core";
import { z } from "zod";

export type Part = { text: string; at: number };

export type Parts = {
  off: boolean;
  classes: Part[];
  styles: Part[];
  paints: Part[];
  sheets: Part[];
  scripts: Part[];
  pieces: Part[];
};

type Attributes = Array<Part & { key: string }>;

const lists = new Map<string, "classes" | "styles" | "paints" | "scripts">([
  ["class", "classes"],
  ["style", "styles"],
  ["fill", "paints"],
  ["stroke", "paints"],
  ["stop-color", "paints"],
  ["on", "scripts"],
]);

const token = /<!--[\s\S]*?(?:-->|$)|<[!?/][^>]*>?|<([a-zA-Z][^\t\n\f\r />]*)/g;

const attribute =
  /[\t\n\f\r /]*([^\t\n\f\r />][^\t\n\f\r />=]*)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:(["'])([\s\S]*?)(?:\2|$)|([^\t\n\f\r >]*)))?/y;

const tagEnd = /[\t\n\f\r /]*>?/y;

const rawText = new Map<string, RegExp>();

for (const name of [
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
]) {
  rawText.set(name, new RegExp(`</${name}[\\t\\n\\f\\r />]`, "gi"));
}

const tells = new Set(["meta", ...rawText.keys()]);

const scriptTypes = new Set([undefined, "", "module", "text/javascript", "application/javascript"]);

export const tagReader = resource({
  label: "kit.tagReader",
  target: "scope",
  factory: () => {
    return {
      attributes: (parts: Parts, html: string, at: number) => {
        const attributes: Attributes = [];
        attribute.lastIndex = at;

        for (let match = attribute.exec(html); match; match = attribute.exec(html)) {
          const key = `${match[1]}`.toLowerCase();
          const value = match[3] ?? match[4] ?? "";
          const part = { text: value, at: match.index + match[0].lastIndexOf(value) };
          tagEnd.lastIndex = match.index + match[0].length;
          if (attributes.some((seen) => seen.key === key)) continue;

          attributes.push({ key, text: part.text, at: part.at });
          const list = lists.get(key) ?? lists.get(key.slice(0, 2));
          if (list) parts[list].push(part);
        }
        tagEnd.lastIndex = attributes.length ? tagEnd.lastIndex : at;
        tagEnd.exec(html);
        return { attributes, end: tagEnd.lastIndex };
      },
    };
  },
});

export const readRaw = operation({
  label: "kit.readRaw",
  input: z.custom<{ parts: Parts; html: string; name: string; type?: string; end: number }>(),
  run: (_, { input: { parts, html, name, type, end } }) => {
    const close = new RegExp(rawText.get(name) ?? /$/g);
    close.lastIndex = end;
    const stop = close.exec(html)?.index ?? html.length;
    const raw = { text: html.slice(end, stop), at: end };

    if (name === "style") parts.sheets.push(raw);
    if (name === "script" && scriptTypes.has(type)) parts.scripts.push(raw);
    return stop;
  },
});

export const sortElement = operation({
  label: "kit.sortElement",
  input: z.custom<{
    parts: Parts;
    html: string;
    name: string;
    attributes: Attributes;
    at: number;
    end: number;
  }>(),
  depends: { readRaw },
  run: ({ readRaw }, { input }) => {
    const { parts, name, attributes } = input;
    const said = ["name", "content", "type"].map(
      (key) => attributes.find((attribute) => attribute.key === key)?.text,
    );
    const [meta, content, type] = said.map((text) => text?.trim().toLowerCase());
    parts.off = parts.off || `${name} ${meta} ${content}` === "meta easel-kit off";

    if (name.startsWith("k-")) parts.pieces.push({ text: name, at: input.at });
    return rawText.has(name) ? readRaw.run({ input: { ...input, type } }) : input.end;
  },
});

export const scan = operation({
  label: "kit.scan",
  input: z.string(),
  depends: { reader: tagReader, sortElement },
  run: ({ reader, sortElement }, { input: html }): Parts => {
    const parts: Parts = {
      off: false,
      classes: [],
      styles: [],
      paints: [],
      sheets: [],
      scripts: [],
      pieces: [],
    };
    const next = new RegExp(token.source, "g");

    for (let match = next.exec(html); match; match = next.exec(html)) {
      const name = match[1]?.toLowerCase();
      if (!name) continue;

      const { attributes, end } = reader.attributes(parts, html, next.lastIndex);
      next.lastIndex =
        tells.has(name) || name.startsWith("k-")
          ? sortElement.run({ input: { parts, html, name, attributes, at: match.index, end } })
          : end;
    }
    return parts;
  },
});
