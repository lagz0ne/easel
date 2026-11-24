import { operation, resource } from "@tinkered/core";
import type { Node } from "oxc-parser";
import { z } from "zod";

import { uiTexts } from "@/kit/capsules/ui-texts";
import { oxc } from "@/kit/oxc.server";
import { sayWalk } from "@/kit/say.server";
import { entryFile, folderOf } from "@/kit/schema";

export type FrameTexts = { keys: string[]; own: string[] };

const namedCharacters = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["middot", "·"],
  ["bull", "•"],
  ["hellip", "…"],
  ["mdash", "—"],
  ["ndash", "–"],
  ["lsquo", "‘"],
  ["rsquo", "’"],
  ["ldquo", "“"],
  ["rdquo", "”"],
  ["laquo", "«"],
  ["raquo", "»"],
  ["larr", "←"],
  ["rarr", "→"],
  ["uarr", "↑"],
  ["darr", "↓"],
  ["times", "×"],
  ["copy", "©"],
  ["reg", "®"],
  ["trade", "™"],
  ["deg", "°"],
]);

const characterReference = /&(?:#x([0-9a-f]{1,6})|#([0-9]{1,7})|([a-z][a-z0-9]{1,31}));?/gi;

export const plainText = operation({
  label: "words.plainText",
  input: z.string(),
  run: (_, { input }) =>
    input
      .replace(characterReference, (whole, hex?: string, decimal?: string, name?: string) => {
        const code = hex ? Number.parseInt(hex, 16) : decimal ? Number(decimal) : null;
        if (code !== null) return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        return namedCharacters.get((name ?? "").toLowerCase()) ?? whole;
      })
      .replace(/\s+/g, " ")
      .trim(),
});

const letter = /\p{L}/u;

export const readTextAttributes = new Set(["placeholder", "title", "alt", "aria-label"]);

const phraseElements = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "dfn",
  "em",
  "i",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);

const skippedElements = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
]);

const voidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const markupToken =
  /<!--[\s\S]*?(?:-->|$)|<[!?][^>]*>?|<\/([a-zA-Z][^\t\n\f\r />]*)[^>]*>?|<([a-zA-Z][^\t\n\f\r />]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

const attributePair = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

export const markupAttributes = operation({
  label: "words.markupAttributes",
  input: z.string(),
  run: (_, { input }) =>
    new Map(
      [...input.matchAll(attributePair)].map((pair) => [
        (pair[1] ?? "").toLowerCase(),
        pair[2] ?? pair[3] ?? pair[4] ?? "",
      ]),
    ),
});

type Walked = { keys: Set<string>; own: Set<string>; words: string; tag: string; depth: number };

export const markupWalk = resource({
  label: "words.markupWalk",
  target: "scope",
  depends: { plainText, markupAttributes },
  factory: ({ plainText, markupAttributes }) => {
    let at: Walked = { keys: new Set(), own: new Set(), words: "", tag: "", depth: 0 };

    const walk = {
      begin: () => {
        at = { keys: new Set(), own: new Set(), words: "", tag: "", depth: 0 };
      },
      keep: (raw: string) => {
        const text = plainText.run({ input: raw });
        if (letter.test(text)) at.own.add(text);
      },
      flush: () => {
        if (at.depth === 0) walk.keep(at.words);
        at.words = "";
      },
      text: (raw: string) => {
        if (at.depth === 0) at.words += raw;
      },
      closed: (name: string) => {
        if (at.depth > 0 && at.tag === name) at.depth--;
        if (!phraseElements.has(name)) walk.flush();
      },
      opened: (name: string, rest: string, whole: string) => {
        if (at.depth > 0 && at.tag === name) at.depth++;
        if (!phraseElements.has(name)) walk.flush();
        if (skippedElements.has(name)) return;

        const attributes = markupAttributes.run({ input: rest });
        if (at.depth > 0) return;
        for (const [key, value] of attributes) if (readTextAttributes.has(key)) walk.keep(value);
        walk.keyed(name, attributes.get("data-easel-text"), whole);
      },
      keyed: (name: string, key: string | undefined, whole: string) => {
        if (key === undefined) return;
        at.keys.add(key.trim());
        if (!voidElements.has(name) && !whole.endsWith("/>")) at = { ...at, tag: name, depth: 1 };
      },
      skipped: (html: string, name: string, from: number) => {
        if (!skippedElements.has(name)) return from;
        const end = new RegExp(`</${name}[\\t\\n\\f\\r />]`, "gi");
        end.lastIndex = from;
        const found = end.exec(html);
        return found ? html.indexOf(">", found.index) + 1 || html.length : html.length;
      },
      end: (): FrameTexts => {
        walk.flush();
        return { keys: [...at.keys], own: [...at.own] };
      },
    };
    return walk;
  },
});

export const htmlTexts = operation({
  label: "words.htmlTexts",
  input: z.string(),
  depends: { walk: markupWalk },
  run: ({ walk }, { input: html }): FrameTexts => {
    walk.begin();
    const token = new RegExp(markupToken);
    let at = 0;

    for (let found = token.exec(html); found; found = token.exec(html)) {
      walk.text(html.slice(at, found.index));
      const [whole, closed, opened, rest = ""] = found;
      const name = (opened ?? closed ?? "").toLowerCase();
      if (closed !== undefined) walk.closed(name);
      if (opened !== undefined) walk.opened(name, rest, whole);

      at = walk.skipped(html, opened === undefined ? "" : name, token.lastIndex);
      token.lastIndex = at;
    }

    walk.text(html.slice(at));
    return walk.end();
  },
});

const uiKeys = Object.keys(uiTexts.en);

const usesUi = /\bui\s*\.\s*(?:pieces|text)\b/;

export const jsxWalk = resource({
  label: "words.jsxWalk",
  target: "scope",
  depends: { plainText },
  factory: ({ plainText }) => {
    const own = new Set<string>();
    const walk = {
      own,
      keep: (raw: string) => {
        const text = plainText.run({ input: raw });
        if (letter.test(text)) own.add(text);
      },
      visitor: {
        JSXText: (node: Node) => {
          if (node.type === "JSXText") walk.keep(node.value);
        },
        JSXAttribute: (node: Node) => {
          if (node.type !== "JSXAttribute" || node.name.type !== "JSXIdentifier") return;
          if (!readTextAttributes.has(node.name.name)) return;
          const value = node.value;
          if (value?.type === "Literal" && typeof value.value === "string") walk.keep(value.value);
        },
      },
    };
    return walk;
  },
});

const scriptFile = /\.(tsx|ts|jsx|js)$/;

export const appTexts = operation({
  label: "words.appTexts",
  input: z.string(),
  depends: { oxc, say: sayWalk, jsx: jsxWalk },
  run: ({ oxc, say, jsx }, { input: source }): FrameTexts => {
    const keys = new Set<string>();
    jsx.own.clear();
    const files = Object.entries(folderOf.parse(source) ?? { [entryFile]: source });

    for (const [path, text] of files.filter(([name]) => scriptFile.test(name))) {
      const parsed = oxc.parseSync(path, text, { lang: "tsx", sourceType: "module" });
      say.begin(text);
      oxc.visit({ ...say.visitor, ...jsx.visitor }, parsed.program);

      const said = say.end();
      for (const one of [...said.used, ...said.own]) keys.add(one.key);
      if (usesUi.test(text)) for (const key of uiKeys) keys.add(key);
    }

    return { keys: [...keys], own: [...jsx.own] };
  },
});
