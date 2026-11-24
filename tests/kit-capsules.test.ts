import { exits } from "@tinkered/cli/test";
import { createScope, type Resource, resource } from "@tinkered/core";
import { createElement } from "react";
import { afterAll, beforeAll, expect, expectTypeOf, test } from "vite-plus/test";

import { describeCapsule } from "@/kit/capsules/about";
import {
  copy,
  type Locale,
  locales,
  type Say,
  type SayFrom,
  textGaps,
  type Texts,
} from "@/kit/capsules/copy";
import { look } from "@/kit/capsules/look";
import { renderFrame } from "@/kit/capsules/render.server";
import { ui } from "@/kit/capsules/ui";
import { lookValues } from "@/kit/look.server";
import { seedKitCss, seedLook } from "@/kit/seed.server";
import type { TeamTexts } from "@/kit/texts";

import * as invite from "./kit/capsules/invite";
import { texts as pricingTexts } from "./kit/capsules/pricing/copy";
import { sampleShape } from "./kit/capsules/pricing/entities";
import { pricing } from "./kit/capsules/pricing/index";

const server = createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] });
let seed: Record<string, string> = {};

beforeAll(async () => {
  seed = await server.run(lookValues, { input: await server.run(seedLook) });
});

afterAll(() => server.close());

const kit = (locale: Locale, values: Record<string, string> = seed, team: TeamTexts = {}) => [
  look({ values, css: seedKitCss }),
  copy({ locale, team }),
  ui(),
];

async function drawn(input: Parameters<typeof renderFrame.run>[1]["input"]) {
  const got = await server.run(renderFrame, { input });
  if (got.kind !== "rendered") {
    throw new Error(`refused: ${got.refused} ${JSON.stringify(got.payload)}`);
  }
  return got;
}

test("form 1: a component in a factory draws from the pieces and the copy of each locale", async () => {
  const en = await drawn({ capsules: kit("en"), view: invite.View });
  expect(en.html).toContain("<h2>Invite your team</h2>");
  expect(en.html).toContain("2 people have access");
  expect(en.html).toContain('aria-label="Remove ana@acme.com"');
  expect(en.html).toContain('class="btn btn-ghost btn-sm"');
  expect(en.styles).toContain("--primary: #171717;");

  const vi = await drawn({ capsules: kit("vi"), view: invite.View });
  expect(vi.html).toContain("<h2>Mời nhóm của bạn</h2>");
  expect(vi.html).toContain("2 người có quyền");
});

test("form 2: a capsule draws each locale and each data state, and the same install gives the same HTML", async () => {
  const pages: Record<string, string> = {};
  for (const locale of locales) {
    for (const sample of sampleShape.options) {
      const capsules = [...kit(locale), pricing({ sample })];
      pages[`${locale} ${sample}`] = (await drawn({ capsules, view: pricing.View })).html;
    }
  }

  expect(Object.keys(pages)).toHaveLength(8);
  expect(pages["en empty"]).toContain("Nothing here yet");
  expect(pages["vi empty"]).toContain("Chưa có gì");
  expect(pages["en many"]).toContain("$29.00 a month");
  expect(pages["en many"]).toContain("Choose Team");
  expect(pages["en one"]).toContain("2 features");
  expect(pages["vi many"]).toContain("Chọn Team");
  expect(pages["en long"]).toContain("$12,500.00 a month");
  expect(pages["en long"]).toContain("8 features");

  const again = await drawn({
    capsules: [...kit("en"), pricing({ sample: "many" })],
    view: pricing.View,
  });
  expect(again.html).toBe(pages["en many"]);
});

test("a gap in the texts of a part stops its frame before it draws", async () => {
  const gapped: Texts<string> = {
    en: { "gap.title": "Invite", "gap.access": "{count} have access" },
    vi: { "gap.access": "{n} có quyền" },
  };
  const text = resource({
    label: "gap.text",
    depends: { say: copy.say },
    factory: ({ say }) => say(gapped),
  });
  const view = resource({
    label: "gap.View",
    depends: { t: text },
    factory: ({ t }) =>
      function Gap() {
        return createElement("p", null, t("gap.title"));
      },
  });
  const got = await server.run(renderFrame, { input: { capsules: kit("en"), view } });

  expect(got).toEqual({
    kind: "refused",
    refused: "CopyGaps",
    payload: {
      gaps: [
        { locale: "vi", key: "gap.title", why: "no text" },
        { locale: "vi", key: "gap.access", why: "the parameters are not {count}" },
      ],
    },
  });
});

test("the copy check: a key with no English, a key with no text, and other parameters", async () => {
  const part: Texts<string> = {
    en: { a: "A {name}", b: { one: "{count} b", other: "{count} bs" } },
    vi: { a: "A {name}", b: "{n} b", c: "C" },
  };

  expect(await server.run(textGaps, { input: part })).toEqual([
    { locale: "vi", key: "c", why: "no English text" },
    { locale: "vi", key: "b", why: "the parameters are not {count}" },
  ]);
  expect(await server.run(textGaps, { input: pricingTexts })).toEqual([]);
});

const team: TeamTexts = {
  "trial.start": { en: "Start the trial", vi: "Dùng thử" },
  "people.empty": { en: "No people yet" },
};

const shownBy = <K extends string>(
  label: string,
  text: Resource.Handle<Say<K>>,
  keys: readonly K[],
) =>
  resource({
    label,
    depends: { t: text },
    factory: ({ t }) =>
      function Shown() {
        return createElement("p", null, keys.map((key) => t(key)).join(" | "));
      },
  });

const ownTexts: Texts<"trial.start" | "people.empty" | "own.title"> = {
  en: { "trial.start": "Own start", "people.empty": "Own empty", "own.title": "Own title" },
  vi: { "trial.start": "Bắt đầu", "people.empty": "Trống", "own.title": "Tiêu đề" },
};

const ownText = resource({
  label: "own.text",
  depends: { say: copy.say },
  factory: ({ say }) => say(ownTexts),
});

const teamOnly = resource({
  label: "team.text",
  depends: { say: copy.say },
  factory: ({ say }) => say(["trial.start", "people.empty"]),
});

test("say(texts) gives the text of the team in the locale, else its en text between U+2068 and U+2069 (L13), else the text of the part (L12)", async () => {
  const view = shownBy("own.View", ownText, ["trial.start", "people.empty", "own.title"]);

  const vi = await drawn({ capsules: kit("vi", seed, team), view });
  expect(vi.html).toBe("<p>Dùng thử | \u2068No people yet\u2069 | Tiêu đề</p>");

  const en = await drawn({ capsules: kit("en", seed, team), view });
  expect(en.html).toBe("<p>Start the trial | No people yet | Own title</p>");

  const alone = await drawn({ capsules: kit("vi"), view });
  expect(alone.html).toBe("<p>Bắt đầu | Trống | Tiêu đề</p>");
});

test("say(texts): a gap in the texts of the part for a text key of the team is no gap; a text key with no text anywhere raises CopyGaps", async () => {
  const part: Texts<string> = {
    en: { "trial.start": "Own start", "own.title": "Own title" },
    vi: {},
  };
  const text = resource({
    label: "gapped.text",
    depends: { say: copy.say },
    factory: ({ say }) => say(part),
  });
  const view = shownBy("gapped.View", text, ["trial.start"]);

  expect(
    await server.run(renderFrame, { input: { capsules: kit("vi", seed, team), view } }),
  ).toEqual({
    kind: "refused",
    refused: "CopyGaps",
    payload: { gaps: [{ locale: "vi", key: "own.title", why: "no text" }] },
  });

  const filled = { ...team, "own.title": { en: "Team title" } };
  const shown = await drawn({ capsules: kit("vi", seed, filled), view });
  expect(shown.html).toBe("<p>Dùng thử</p>");
});

test("say([text keys]) gives the t of those text keys from the texts of the team only, an en text in vi between U+2068 and U+2069; a text key that the team does not have raises CopyGaps", async () => {
  const view = shownBy("team.View", teamOnly, ["trial.start", "people.empty"]);

  const vi = await drawn({ capsules: kit("vi", seed, team), view });
  expect(vi.html).toBe("<p>Dùng thử | \u2068No people yet\u2069</p>");

  const changed = { ...team, "trial.start": { en: "Try it free" } };
  const en = await drawn({ capsules: kit("vi", seed, changed), view });
  expect(en.html).toBe("<p>\u2068Try it free\u2069 | \u2068No people yet\u2069</p>");

  const got = await server.run(renderFrame, { input: { capsules: kit("en"), view } });
  expect(got).toEqual({
    kind: "refused",
    refused: "CopyGaps",
    payload: {
      gaps: [
        { locale: "en", key: "trial.start", why: "no text of the team" },
        { locale: "en", key: "people.empty", why: "no text of the team" },
      ],
    },
  });
});

test("the types of say: the text keys of the array are the keys of its t", () => {
  expectTypeOf<SayFrom>().toBeCallableWith(["trial.start"]);
  expectTypeOf(teamOnly).toEqualTypeOf<Resource.Handle<Say<"trial.start" | "people.empty">>>();
  expectTypeOf<"own.title">().not.toExtend<Parameters<Say<"trial.start" | "people.empty">>[0]>();
});

test("a look that fails K8 stops the scope: the pieces do not draw with it", async () => {
  const pale = { ...seed, "--muted-foreground": "#d4d4d4" };
  const got = await server.run(renderFrame, {
    input: { capsules: kit("en", pale), view: invite.View },
  });

  expect(got.kind === "refused" && got.refused).toBe("LookFailsK8");
  const pairs = got.kind === "refused" ? JSON.stringify(got.payload) : "";
  expect(pairs).toContain('"text":"muted-foreground"');
});

test("a frame that needs a capsule the install does not have does not start", async () => {
  const got = await server.run(renderFrame, {
    input: { capsules: [look({ values: seed, css: seedKitCss }), ui()], view: invite.View },
  });

  expect(got).toEqual({
    kind: "refused",
    refused: "CapsuleMissing",
    payload: { unit: "copy.say", capsule: "copy" },
  });
});

test("the types hold the rules: required config, the keys of a part, and a read-only export", () => {
  expectTypeOf({ css: "" }).not.toExtend<Parameters<typeof look>[0]>();
  expectTypeOf({ en: { a: "A" }, vi: {} }).not.toExtend<Texts<"a">>();
  expectTypeOf<"b">().not.toExtend<Parameters<Say<"a">>[0]>();
  expectTypeOf(pricing.plans).not.toHaveProperty("controller");
});

test("the list of capsules: what each does, its config with its schema, and its exports", async () => {
  const got = await drawn({
    capsules: [...kit("vi"), pricing({ sample: "one" })],
    view: pricing.View,
  });
  const handles = { look, copy, ui, pricing };
  const list = await Promise.all(
    got.capsules.map((record) =>
      server.run(describeCapsule, {
        input: { record, handle: Reflect.get(handles, record.label) },
      }),
    ),
  );

  expect(list.map((one) => one.label)).toEqual(["look", "copy", "ui", "pricing"]);
  expect(list[1]?.config).toEqual([
    {
      key: "locale",
      tag: "copy.locale",
      required: false,
      schema: expect.objectContaining({ enum: ["en", "vi"] }),
    },
    {
      key: "team",
      tag: "copy.team",
      required: false,
      schema: expect.objectContaining({ type: "object" }),
    },
  ]);
  expect(list[3]?.config[0]?.schema).toMatchObject({ enum: ["empty", "one", "many", "long"] });
  expect(list[3]?.exports.map((one) => `${one.name} ${one.kind}`)).toEqual([
    "View resource",
    "plans cell",
    "choose operation",
    "text resource",
  ]);
  expect(list[3]?.exports[2]?.input).toMatchObject({ type: "string" });
  expect(got.capsules[1]?.config).toMatchObject({ locale: "vi" });
});
