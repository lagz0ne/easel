import { capsule, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { aboutShape } from "./about";

// The copy as a capsule (docs/decisions/kit-capsules.md; E9): the locale is its config. Each part
// (the pieces of the kit, a frame) declares its texts, and its own `text` resource depends on
// `copy.say`: `say(texts)` checks the part (each key has a text in each locale, with the same
// parameters) and gives its `t`. So `t` is a dependency: a component depends on the `text` of a
// part, its keys are typed, and the graph shows which component uses which texts.

export const locales = ["en", "vi"] as const;

const localeShape = z.enum(locales);

export type Locale = z.infer<typeof localeShape>;

/** A text: a string with `{name}` parameters, or a form for one and a form for others (`{count}`). */
const textShape = z.union([z.string(), z.object({ one: z.string(), other: z.string() })]);

export type Text = z.infer<typeof textShape>;

/** The texts of one part, in each locale, by key: each locale has each key, as the type says. */
export type Texts<K extends string = string> = {
  readonly [L in Locale]: Readonly<Record<K, Text>>;
};

/** The `t` of a part: the text of one of its keys in the locale, with its parameters filled. */
export type Say<K extends string> = (
  key: K,
  params?: Readonly<Record<string, string | number>>,
) => string;

const textsShape = z.object({
  en: z.record(z.string(), textShape),
  vi: z.record(z.string(), textShape),
});

const locale = tag<Locale>({ label: "copy.locale", default: "en", parse: localeShape });

const about = tag({ label: "copy.about", parse: aboutShape });

/** The parameters of a text, sorted: `{count} people in {team}` gives `count team`. */
const paramsOf = operation({
  label: "copy.paramsOf",
  input: textShape,
  run: (_, { input }) => {
    const all = typeof input === "string" ? input : `${input.one} ${input.other}`;
    const names = new Set([...all.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ""));
    return [...names].sort((a, b) => a.localeCompare(b)).join(" ");
  },
});

/**
 * The gaps of one part: a key of a locale with no English, a key of English with no text in a
 * locale, or a text whose parameters are not those of its English. The types find the first two
 * in a frame that the agent type-checks; this finds them in each frame.
 */
export const textGaps = operation({
  label: "copy.textGaps",
  input: textsShape,
  depends: { paramsOf },
  run: ({ paramsOf }, { input: part }) => {
    const gaps: Array<{ locale: Locale; key: string; why: string }> = [];
    for (const at of locales) {
      const extra = Object.keys(part[at]).filter((key) => !(key in part.en));
      gaps.push(...extra.map((key) => ({ locale: at, key, why: "no English text" })));
    }

    for (const [key, en] of Object.entries(part.en)) {
      const want = paramsOf.run({ input: en });
      for (const at of locales) {
        const text = part[at][key];
        const why =
          text === undefined
            ? "no text"
            : paramsOf.run({ input: text }) === want
              ? null
              : `the parameters are not {${want}}`;
        if (why) gaps.push({ locale: at, key, why });
      }
    }
    return gaps;
  },
});

/**
 * `say(texts)`: the `t` of a part in the locale, after the check of its texts (`textGaps`); a gap
 * raises `CopyGaps`, so the part's `text` does not build and its frame does not draw. A text with
 * a form for one takes the form that `Intl.PluralRules` picks for `count`.
 */
const say = resource({
  label: "copy.say",
  depends: { locale, textGaps },
  factory: ({ locale, textGaps }, { raise }) => {
    const plural = new Intl.PluralRules(locale);

    return <K extends string>(part: Texts<K>): Say<K> => {
      const gaps = textGaps.run({ input: part });
      if (gaps.length > 0) raise("CopyGaps", { gaps });

      const known = part[locale];
      return (key, params = {}) => {
        const text = known[key];
        const form =
          typeof text === "string"
            ? text
            : plural.select(Number(params.count)) === "one"
              ? text.one
              : text.other;
        return form.replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole));
      };
    };
  },
});

/** Numbers, money and dates in the locale, by `Intl`: `format.money(29, "USD")` is `$29.00` in en. */
const format = resource({
  label: "copy.format",
  depends: { locale },
  factory: ({ locale }) => ({
    number: (n: number) => new Intl.NumberFormat(locale).format(n),
    money: (n: number, currency: string) =>
      new Intl.NumberFormat(locale, { style: "currency", currency }).format(n),
    date: (at: Date) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(at),
  }),
});

export const copy = capsule({
  label: "copy",
  config: { locale },
  tags: [
    about({
      does: "The locale of a scope: the texts of each part and the formats of numbers, money and dates in it.",
      exports: {
        say: "say(texts) gives the t of a part: a part's text resource depends on it. A gap in the texts raises CopyGaps.",
        format: "format.number, format.money and format.date in the locale.",
      },
    }),
  ],
  exports: { say, format },
});
