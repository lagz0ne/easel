import { capsule, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { paramsOf, type TeamTexts, teamText, type Text, textShape } from "@/kit/texts";

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

const team = tag<TeamTexts>({
  label: "copy.team",
  default: {},
  parse: z.record(z.string(), teamText),
});

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

export type SayFrom = {
  <const K extends string>(keys: readonly K[]): Say<K>;
  <K extends string>(part: Texts<K>): Say<K>;
};

const say = resource({
  label: "copy.say",
  depends: { locale, team, textGaps },
  factory: ({ locale, team, textGaps }, { raise }): SayFrom => {
    const plural = new Intl.PluralRules(locale);

    return (given: readonly string[] | Texts) => {
      const gaps =
        "en" in given
          ? textGaps.run({ input: given }).filter((gap) => team[gap.key] === undefined)
          : given
              .filter((key) => team[key] === undefined)
              .map((key) => ({ locale: "en" as const, key, why: "no text of the team" }));
      if (gaps.length > 0) raise("CopyGaps", { gaps });

      const own: Readonly<Record<string, Text>> = "en" in given ? given[locale] : {};
      const shared = Object.entries(team).map(([key, text]): [string, Text] => [
        key,
        text[locale] ?? text.en,
      ]);
      const known: Readonly<Record<string, Text>> = { ...own, ...Object.fromEntries(shared) };
      return (key: string, params: Readonly<Record<string, string | number>> = {}) => {
        const text = known[key];
        if (text === undefined) return key;

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
  config: { locale, team },
  tags: [
    about({
      does: "The locale of a scope: the texts of the team, the texts of each part, and the formats of numbers, money and dates in it.",
      install:
        'easel installs it for each frame: copy({ locale, team }), with each locale of the board ("en", "vi") and the texts of the team of the kit version.',
      exports: {
        say: {
          does: 'say(["<text key>", ...]) gives the t of those text keys from the texts of the team only: the text in the locale, else its en text. A text key that the team does not have raises CopyGaps. say(texts) gives the t of a part: the text of the team in the locale, else its en text, else the text of the part. A gap in the texts of a part, for a text key that the team does not have, raises CopyGaps.',
          use: 'const text = resource({ label: "<part>.text", depends: { say: copy.say }, factory: ({ say }) => say(["trial.start", "people.empty"]) }); // or, with texts of the part: tags: [copy.texts(texts)], factory: ({ say }) => say(texts), with texts = { en: { "<part>.title": "..." }, vi: { ... } } satisfies Texts',
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
