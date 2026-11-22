import { capsule, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { aboutShape } from "./about";

// The copy as a capsule (docs/decisions/kit-capsules.md; E9): the locale and the texts are its
// config; `t` gives the text of a key in that locale. Its start checks the texts first: each key
// has a text in each locale, with the same parameters. A gap stops the scope, so no frame shows a
// missing text or a key in place of a text.

export const locales = ["en", "vi"] as const;

const localeShape = z.enum(locales);

export type Locale = z.infer<typeof localeShape>;

/** A text: a string with `{name}` parameters, or a form for one and a form for others (`{count}`). */
const textShape = z.union([z.string(), z.object({ one: z.string(), other: z.string() })]);

/** The texts of one part (a frame, the pieces of the kit), in each locale, by key. */
export const textsShape = z.object({
  en: z.record(z.string(), textShape),
  vi: z.record(z.string(), textShape),
});

export type Texts = z.infer<typeof textsShape>;

const locale = tag<Locale>({ label: "copy.locale", default: "en", parse: localeShape });

const texts = tag({ label: "copy.texts", parse: z.array(textsShape) });

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

/** The gaps of one part: a key with no English, a key with no text, a text with other parameters. */
const partGaps = operation({
  label: "copy.partGaps",
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

/** Each gap in the texts of each part (`partGaps`), in the order of the parts. */
export const textGaps = operation({
  label: "copy.textGaps",
  input: z.array(textsShape),
  depends: { partGaps },
  run: ({ partGaps }, { input: parts }) => parts.flatMap((part) => partGaps.run({ input: part })),
});

/**
 * `t(key, params)`: the text of `key` in the locale, with its parameters filled. A text with a form
 * for one takes the form that `Intl.PluralRules` picks for `count`. A key that no part has throws:
 * the start checked the texts, so only a key that no part declares can be missing.
 */
const t = resource({
  label: "copy.t",
  depends: { locale, texts },
  factory: ({ locale, texts }) => {
    const all = Object.assign({}, ...texts.map((part) => part[locale]));
    const known = z.record(z.string(), textShape).parse(all);
    const plural = new Intl.PluralRules(locale);

    return (key: string, params: Readonly<Record<string, string | number>> = {}) => {
      const text = known[key];
      if (text === undefined) throw new Error(`copy: no text has the key ${key}`);

      const form =
        typeof text === "string"
          ? text
          : plural.select(Number(params.count)) === "one"
            ? text.one
            : text.other;
      return form.replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole));
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
  config: { locale, texts: texts.required },
  tags: [
    about({
      does: "The texts of the frames and the pieces, in one locale. Its start stops the scope at a gap.",
      exports: {
        t: "t(key, params): the text of a key in the locale, with its parameters.",
        format: "format.number, format.money and format.date in the locale.",
      },
    }),
  ],
  exports: { t, format },
  hooks: {
    async start({ config, run, raise, next }) {
      const explain = "Each key has a text in each locale, with the same parameters";
      const gaps = await run(textGaps, { input: config.texts }, { role: "setup", explain });
      if (gaps.length > 0) raise("CopyGaps", { gaps });
      await next();
    },
  },
});
