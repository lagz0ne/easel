import { operation, resource } from "@tinkered/core";
import type { Node, Program } from "oxc-parser";
import { z } from "zod";

import { locales, type Locale } from "./capsules/copy";
import type { Found } from "./check.server";
import { oxc } from "./oxc.server";
import type { TeamTexts, Text } from "./texts";

type OwnText = { key: string; locale: Locale; text: Text | null; at: number };

type UsedKey = { key: string; at: number };

type Loose = { text: string; at: number };

type Said = { used: UsedKey[]; own: OwnText[]; loose: Loose[] };

type Reader = (node: Node) => boolean;

type SayWalk = {
  bare: (node: Node) => Node;
  stringOf: (node: Node) => string | null;
  formsOf: (node: Node) => Text | null;
  textOf: (node: Node) => Text | null;
  keyOf: (prop: Node) => string | null;
  isSay: (callee: Node) => boolean;
  hasEn: (node: Node | null | undefined) => boolean;
  localeParts: (node: Node) => Array<{ locale: Locale; value: Node }>;
  ownTexts: Reader;
  oneKey: Reader;
  keyList: Reader;
  importedName: Reader;
  namedTexts: Reader;
  namedKeys: Reader;
  argument: (node: Node) => void;
  loose: (node: Node) => void;
  begin: (text: string) => void;
  visitor: Record<
    "VariableDeclarator" | "ImportSpecifier" | "ImportDefaultSpecifier" | "CallExpression",
    (node: Node) => void
  >;
  end: () => Said;
};

export const sayWalk = resource({
  label: "kit.sayWalk",
  target: "scope",
  factory: () => {
    const wrappers = new Set<string>([
      "ParenthesizedExpression",
      "TSAsExpression",
      "TSSatisfiesExpression",
      "TSNonNullExpression",
    ]);

    const sayNames = new Set(["say"]);
    let source = "";
    let said: Said = { used: [], own: [], loose: [] };
    const consts = new Map<string, Node>();
    const imported = new Set<string>();
    const args: Node[] = [];

    const walk: SayWalk = {
      bare: (node) => {
        const inner = wrappers.has(node.type) && "expression" in node ? node.expression : null;
        return inner && typeof inner === "object" ? walk.bare(inner) : node;
      },

      stringOf: (raw) => {
        const node = walk.bare(raw);
        if (node.type === "Literal" && typeof node.value === "string") return node.value;

        const quasi = node.type === "TemplateLiteral" && !node.expressions.length && node.quasis[0];
        return quasi ? (quasi.value.cooked ?? quasi.value.raw) : null;
      },

      formsOf: (node) => {
        if (node.type !== "ObjectExpression") return null;

        const forms = new Map(
          node.properties.map((prop) => [
            walk.keyOf(prop),
            prop.type === "Property" ? walk.stringOf(prop.value) : null,
          ]),
        );
        const one = forms.get("one");
        const other = forms.get("other");
        return one != null && other != null ? { one, other } : null;
      },

      textOf: (raw) => walk.stringOf(raw) ?? walk.formsOf(walk.bare(raw)),

      keyOf: (prop) => {
        if (prop.type !== "Property" || prop.computed) return null;

        return prop.key.type === "Identifier" ? prop.key.name : walk.stringOf(prop.key);
      },

      isSay: (callee) => {
        if (callee.type === "Identifier") return sayNames.has(callee.name);

        const member = callee.type === "MemberExpression" && !callee.computed;
        return (
          member && callee.property.type === "Identifier" && sayNames.has(callee.property.name)
        );
      },

      hasEn: (node) => {
        const value = node ? walk.bare(node) : null;
        if (value?.type !== "ObjectExpression") return false;

        return value.properties.some((prop) => walk.keyOf(prop) === "en");
      },

      localeParts: (node) =>
        node.type !== "ObjectExpression"
          ? []
          : node.properties.flatMap((prop) => {
              const locale = locales.find((one) => one === walk.keyOf(prop));
              const value = prop.type === "Property" ? walk.bare(prop.value) : null;
              return locale && value?.type === "ObjectExpression" ? [{ locale, value }] : [];
            }),

      ownTexts: (raw) => {
        const node = walk.bare(raw);
        if (!walk.hasEn(node)) return false;

        for (const { locale, value } of walk.localeParts(node)) {
          for (const prop of value.type === "ObjectExpression" ? value.properties : []) {
            const key = walk.keyOf(prop);
            if (key === null || prop.type !== "Property") continue;
            said.own.push({ key, locale, text: walk.textOf(prop.value), at: prop.key.start });
          }
        }
        return true;
      },

      oneKey: (node) => {
        const key = walk.stringOf(node);
        if (key !== null) said.used.push({ key, at: node.start });
        return key !== null;
      },

      keyList: (node) => {
        if (node.type !== "ArrayExpression") return false;

        for (const element of node.elements) {
          if (element === null) continue;
          if (element.type === "SpreadElement" || !walk.oneKey(element)) walk.loose(element);
        }
        return true;
      },

      importedName: (node) => node.type === "Identifier" && imported.has(node.name),

      namedTexts: (node) => node.type === "Identifier" && walk.hasEn(consts.get(node.name)),

      namedKeys: (node) => {
        const named = node.type === "Identifier" ? consts.get(node.name) : undefined;
        return named !== undefined && walk.keyList(walk.bare(named));
      },

      argument: (raw) => {
        const node = walk.bare(raw);
        const readers = [
          walk.oneKey,
          walk.keyList,
          walk.ownTexts,
          walk.importedName,
          walk.namedTexts,
          walk.namedKeys,
        ];
        if (!readers.some((read) => read(node))) walk.loose(node);
      },

      loose: (node) => {
        const text = source.slice(node.start, node.end).replace(/\s+/g, " ");
        const at = node.start;
        said.loose.push({ text: text.length > 60 ? `${text.slice(0, 57)}...` : text, at });
      },

      begin: (text) => {
        source = text;
        said = { used: [], own: [], loose: [] };
        consts.clear();
        imported.clear();
        args.length = 0;
      },

      visitor: {
        VariableDeclarator: (node) => {
          if (node.type !== "VariableDeclarator" || node.id.type !== "Identifier") return;
          if (node.init) consts.set(node.id.name, node.init);
        },
        ImportSpecifier: (node) => {
          if (node.type === "ImportSpecifier") imported.add(node.local.name);
        },
        ImportDefaultSpecifier: (node) => {
          if (node.type === "ImportDefaultSpecifier") imported.add(node.local.name);
        },
        CallExpression: (node) => {
          if (node.type !== "CallExpression" || !walk.isSay(node.callee)) return;
          const [first] = node.arguments;
          if (first) args.push(first);
        },
      },

      end: () => {
        for (const value of consts.values()) walk.ownTexts(value);
        for (const node of args) walk.argument(node);
        return said;
      },
    };
    return walk;
  },
});

const keyFix =
  'write the text keys as strings in the call, as say(["trial.start", "people.empty"])';

const setLine = z
  .object({ key: z.string(), text: z.custom<Text>().nullable(), locale: z.string() })
  .transform(({ key, text, locale }) => {
    const flag = locale === "en" ? "" : ` --locale ${locale}`;
    if (typeof text === "object" && text !== null) {
      return `easel texts set -f <file.json> with ${JSON.stringify({ [key]: { [locale]: text } })}`;
    }
    return `easel texts set ${key} ${JSON.stringify(text ?? "<text>")}${flag}`;
  });

const sameText = z
  .object({ own: z.custom<Text>().nullable(), team: z.custom<Text>().optional() })
  .transform(({ own, team }) => own !== null && JSON.stringify(own) === JSON.stringify(team));

const usedFindings = operation({
  label: "kit.usedFindings",
  input: z.object({ used: z.custom<UsedKey[]>(), texts: z.custom<TeamTexts>() }),
  run: (_, { input: { used, texts } }) => {
    const seen = new Set<string>();
    return used.flatMap(({ key, at }): Found[] => {
      if (key in texts || seen.has(key)) return [];

      seen.add(key);
      const what = `the text key "${key}" is not in the texts of the team`;
      const fix = `give the team its text: ${setLine.parse({ key, text: null, locale: "en" })}`;
      return [{ at, rule: "copy/text", what, fix }];
    });
  },
});

const ownFindings = operation({
  label: "kit.ownFindings",
  input: z.object({
    own: z.custom<OwnText[]>(),
    texts: z.custom<TeamTexts>(),
    used: z.custom<UsedKey[]>(),
  }),
  run: (_, { input: { own, texts, used } }) => {
    const told = new Set(used.flatMap(({ key }) => (key in texts ? [] : [key])));
    return own.flatMap(({ key, locale, text, at }): Found[] => {
      const team = texts[key];
      const line = setLine.parse({ key, text, locale });
      const found: Found[] = [];
      if (!team && !told.has(key)) {
        told.add(key);
        const what = `the text key "${key}" of the part is not in the texts of the team`;
        const fix = `give the team its text: ${line}; then remove the text from the part`;
        found.push({ at, rule: "copy/text", what, fix });
      }

      const fix = sameText.parse({ own: text, team: team?.[locale] })
        ? "remove the text from the part: the team has the same text"
        : `remove the text from the part, and use the text of the team; to keep this text, ${line}`;
      const what = `the part has its own ${locale} text for "${key}"`;
      return [...found, { at, rule: "copy/own", what, fix }];
    });
  },
});

export const textFindings = operation({
  label: "kit.textFindings",
  input: z.object({
    source: z.string(),
    program: z.custom<Program>(),
    texts: z.custom<TeamTexts>(),
  }),
  depends: { oxc, walk: sayWalk, usedFindings, ownFindings },
  run: ({ oxc, walk, usedFindings, ownFindings }, { input: { source, program, texts } }) => {
    walk.begin(source);
    oxc.visit(walk.visitor, program);
    const { used, own, loose } = walk.end();

    const found: Found[] = [
      ...usedFindings.run({ input: { used, texts } }),
      ...ownFindings.run({ input: { own, texts, used } }),
      ...loose.map(({ text, at }): Found => ({
        at,
        rule: "copy/key",
        what: `say takes ${text}: the check cannot see which text keys it uses`,
        fix: keyFix,
      })),
    ];
    return found.sort((a, b) => a.at - b.at);
  },
});
