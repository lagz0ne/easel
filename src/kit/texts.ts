import { operation } from "@tinkered/core";
import { z } from "zod";

export const maxTextsBytes = 64 * 1024;

export const textKey = z
  .string()
  .max(80, "a text key has 80 characters at most")
  .regex(
    /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/,
    "not a text key: lowercase words with dots between them, as trial.start",
  );

export const textShape = z.union([z.string(), z.object({ one: z.string(), other: z.string() })]);

export type Text = z.infer<typeof textShape>;

export const teamText = z.object({ en: textShape, vi: textShape.optional() });

export type TeamText = z.infer<typeof teamText>;

export const teamTexts = z.record(textKey, teamText);

export type TeamTexts = z.infer<typeof teamTexts>;

export const textsPatch = z.record(
  textKey,
  z.object({ en: textShape.optional(), vi: textShape.optional() }),
);

export type TextsPatch = z.infer<typeof textsPatch>;

export const textFinding = z.object({ key: z.string(), what: z.string(), fix: z.string() });

export type TextFinding = z.infer<typeof textFinding>;

export const paramsOf = operation({
  label: "texts.paramsOf",
  input: textShape,
  run: (_, { input }) => {
    const all = typeof input === "string" ? input : `${input.one} ${input.other}`;
    const names = new Set([...all.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ""));
    return [...names].sort((a, b) => a.localeCompare(b)).join(" ");
  },
});

const formOf = z
  .custom<Text>()
  .transform((text) => (typeof text === "string" ? "a string" : "a plural { one, other }"));

export const textsByKey = operation({
  label: "texts.byKey",
  input: z.object({
    en: z.record(z.string(), textShape),
    vi: z.record(z.string(), textShape),
  }),
  run: (_, { input }): TeamTexts =>
    Object.fromEntries(
      Object.entries(input.en).map(([key, en]) => [key, { en, vi: input.vi[key] }]),
    ),
});

const orderedText = z
  .custom<Text>()
  .transform((text) => (typeof text === "string" ? text : { one: text.one, other: text.other }));

const orderedTeamText = z.custom<TeamText>().transform(({ en, vi }) => ({
  en: orderedText.parse(en),
  vi: vi === undefined ? undefined : orderedText.parse(vi),
}));

export const textsJson = operation({
  label: "texts.json",
  input: teamTexts,
  run: (_, { input }) => {
    const ordered = Object.entries(input)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, text]) => [key, orderedTeamText.parse(text)]);
    return JSON.stringify(Object.fromEntries(ordered));
  },
});

const localeFindings = operation({
  label: "texts.localeFindings",
  input: z.object({ key: z.string(), en: textShape, vi: textShape }),
  depends: { paramsOf },
  run: ({ paramsOf }, { input: { key, en, vi } }) => {
    const findings: TextFinding[] = [];
    const want = paramsOf.run({ input: en });
    const got = paramsOf.run({ input: vi });
    if (want !== got) {
      findings.push({
        key,
        what: `the vi text has the parameters {${got}}, and the en text has {${want}}`,
        fix: `use the parameters {${want}} in each locale`,
      });
    }

    const [enForm, viForm] = [formOf.parse(en), formOf.parse(vi)];
    if (enForm !== viForm) {
      findings.push({
        key,
        what: `the en text is ${enForm}, and the vi text is ${viForm}`,
        fix: "give each locale the same form: a string, or a plural { one, other }",
      });
    }
    return findings;
  },
});

const mergeOne = operation({
  label: "texts.mergeOne",
  input: z.object({
    key: z.string(),
    was: teamText.optional(),
    change: z.object({ en: textShape.optional(), vi: textShape.optional() }),
  }),
  depends: { localeFindings },
  run: ({ localeFindings }, { input: { key, was, change } }) => {
    const en = change.en ?? was?.en;
    const vi = change.vi ?? was?.vi;
    if (en === undefined) {
      const what = "a new text key has no en text";
      const fix = `give its en text: easel texts set ${key} "<text>"`;
      return { text: null, findings: [{ key, what, fix }] };
    }

    if (vi === undefined) return { text: { en }, findings: [] };
    return { text: { en, vi }, findings: localeFindings.run({ input: { key, en, vi } }) };
  },
});

export const mergeTexts = operation({
  label: "texts.merge",
  input: z.object({ now: teamTexts, patch: textsPatch }),
  depends: { mergeOne },
  run: ({ mergeOne }, { input: { now, patch } }) => {
    const findings: TextFinding[] = [];
    const merged: TeamTexts = { ...now };
    for (const [key, change] of Object.entries(patch).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const one = mergeOne.run({ input: { key, was: now[key], change } });
      findings.push(...one.findings);
      if (one.text) merged[key] = one.text;
    }

    if (findings.length > 0) return { kind: "invalid" as const, findings };
    return { kind: "merged" as const, texts: merged };
  },
});
