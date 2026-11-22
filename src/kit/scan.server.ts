import { operation, resource } from "@tinkered/core";
import { z } from "zod";

// The parts of a document that the K5 check reads (SPEC-kit.md § compose, `check`). It reads the
// start tags as the HTML tokenizer does (WHATWG HTML § 13.2.5): a comment, a doctype and an end
// tag hold no attribute, and the text of `script`, `style` and the other raw text elements holds
// no tag. So a class name in a text or a comment is no class name. Each part keeps its offset in
// the source, for the line and the column of a finding; character references are not decoded.
// Bun's HTMLRewriter (lol-html) gives no offsets, so the check does not use it.

/** A text of the document and the offset where it starts. */
export type Part = { text: string; at: number };

/** The parts of a document, each in document order. */
export type Parts = {
  off: boolean;
  classes: Part[];
  styles: Part[];
  paints: Part[];
  sheets: Part[];
  scripts: Part[];
  pieces: Part[];
};

/** The attributes of a start tag, the first of each name, with their lowercase names. */
type Attributes = Array<Part & { key: string }>;

/** The parts that hold the attributes that the check reads; `on`: each event handler. */
const lists = new Map<string, "classes" | "styles" | "paints" | "scripts">([
  ["class", "classes"],
  ["style", "styles"],
  ["fill", "paints"],
  ["stroke", "paints"],
  ["stop-color", "paints"],
  ["on", "scripts"],
]);

/** What comes next: a comment, a doctype or an end tag (skipped), or a start tag and its name. */
const token = /<!--[\s\S]*?(?:-->|$)|<[!?/][^>]*>?|<([a-zA-Z][^\t\n\f\r />]*)/g;

/**
 * One attribute, read where the last one ended: the space before it, its name, then `=` and a
 * quoted value (its quote, its text) or an unquoted one.
 */
const attribute =
  /[\t\n\f\r /]*([^\t\n\f\r />][^\t\n\f\r />=]*)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:(["'])([\s\S]*?)(?:\2|$)|([^\t\n\f\r >]*)))?/y;

/** The end of a start tag. */
const tagEnd = /[\t\n\f\r /]*>?/y;

/** The elements whose text is raw, with the end tag that ends each. */
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

/** The elements that tell more than their attributes: the raw text elements and `meta`. */
const tells = new Set(["meta", ...rawText.keys()]);

/** The script types that run as JavaScript. */
const scriptTypes = new Set([undefined, "", "module", "text/javascript", "application/javascript"]);

/**
 * The reader of start tags. A resource, not an operation: it runs for each tag of a document,
 * and a span for each tag would cost more than the read of the tag.
 */
export const tagReader = resource({
  label: "kit.tagReader",
  target: "scope",
  factory: () => {
    return {
      /**
       * The attributes of the start tag whose name ends at `at`; each one that the check reads
       * goes into its part. `end`: the offset after the tag.
       */
      attributes: (parts: Parts, html: string, at: number) => {
        const attributes: Attributes = [];
        // Shared sticky expressions: a read is sync, so no other read moves them.
        attribute.lastIndex = at;

        for (let match = attribute.exec(html); match; match = attribute.exec(html)) {
          const key = `${match[1]}`.toLowerCase();
          const value = match[3] ?? match[4] ?? "";
          // The value ends the match, or stands just before its closing quote.
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

/** The text of a raw text element: a `<style>` or a JavaScript `<script>` goes into its part. */
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

/** What an element itself tells: the kit is off, a piece, the text of a raw text element. */
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

/** The parts of a document that the check reads. */
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
