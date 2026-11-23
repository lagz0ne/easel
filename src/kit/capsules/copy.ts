import { capsule, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { paramsOf, type Text, textShape } from "@/kit/texts";

import { aboutShape } from "./about";

export const locales = ["en", "vi"] as const;

const localeShape = z.enum(locales);

export type Locale = z.infer<typeof localeShape>;

export type Texts<K extends string = string> = {
  readonly [L in Locale]: Readonly<Record<K, Text>>;
};

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

const texts = tag<Texts>({ label: "copy.texts", parse: textsShape });

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
      install:
        'easel installs it for each frame: copy({ locale }), with each locale of the board ("en", "vi").',
      exports: {
        say: {
          does: "say(texts) gives the t of a part, after the check of its texts: a gap raises CopyGaps.",
          use: 'const text = resource({ label: "<part>.text", tags: [copy.texts(texts)], depends: { say: copy.say }, factory: ({ say }) => say(texts) }); // texts = { en: { "<part>.title": "..." }, vi: { ... } } satisfies Texts',
        },
        texts: {
          does: "The tag of a part's texts, on its text resource, so a tool can list them.",
          use: "tags: [copy.texts(texts)]",
        },
        format: {
          does: "format.number, format.money and format.date in the locale.",
          use: 'depends: { format: copy.format } // format.money(29, "USD") is "$29.00" in en',
        },
      },
    }),
  ],
  exports: { say, texts, format },
});
