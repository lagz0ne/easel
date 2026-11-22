import { exits } from "@tinkered/cli/test";
import { createScope, resource } from "@tinkered/core";
import { createElement } from "react";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { describeCapsule } from "@/kit/capsules/about";
import { copy, type Locale, locales, textGaps, type Texts } from "@/kit/capsules/copy";
import { look } from "@/kit/capsules/look";
import { renderFrame } from "@/kit/capsules/render.server";
import { ui } from "@/kit/capsules/ui";
import { lookValues } from "@/kit/look.server";
import { seedKitCss, seedLook } from "@/kit/seed.server";

import * as invite from "./kit/capsules/invite";
import { sampleShape } from "./kit/capsules/pricing/entities";
import { pricing } from "./kit/capsules/pricing/index";

// The kit as capsules (docs/decisions/kit-capsules.md): the look, the copy and the pieces are
// capsules, and a frame is a component that depends on them (form 1) or a capsule of its own
// (form 2). A frame draws in a new scope of its install list; each start checks what its capsule
// needs, so a frame that draws is a frame whose look, copy and data are whole.

const server = createScope({ capsules: [exits({ file: process.env.TINKER_EXITS })] });
let seed: Record<string, string> = {};

beforeAll(async () => {
  seed = await server.run(lookValues, { input: await server.run(seedLook) });
});

afterAll(() => server.close());

/** The install list of the kit: the seed look, the copy in `locale`, the pieces. */
const kit = (locale: Locale, values: Record<string, string> = seed) => [
  look({ values, css: seedKitCss }),
  copy({ locale }),
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
  // Texts<string> lets any key in: a frame that the agent does not type-check can have gaps.
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
  expect(await server.run(textGaps, { input: pricing.texts })).toEqual([]);
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
  // The pieces need the copy: with no copy capsule, Tinker names the unit and its capsule.
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
  const unused = (say: <K extends string>(part: Texts<K>) => (key: K) => string) => {
    // @ts-expect-error the look needs its values and the kit's CSS: the compiler names the keys.
    createScope({ capsules: [look({ css: "" })] });
    // @ts-expect-error each locale has each key: vi has no text for "a".
    say({ en: { a: "A" }, vi: {} });
    const t = say({ en: { a: "A" }, vi: { a: "Á" } });
    // @ts-expect-error the part has no key "b".
    t("b");
    // @ts-expect-error a frame cannot write the plans of the pricing capsule.
    return pricing.plans.controller;
  };
  expect(typeof unused).toBe("function");
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
  ]);
  // The data states of the frame are in the schema of its config: a tool can draw each one.
  expect(list[3]?.config[0]?.schema).toMatchObject({ enum: ["empty", "one", "many", "long"] });
  expect(list[3]?.exports.map((one) => `${one.name} ${one.kind}`)).toEqual([
    "View resource",
    "plans cell",
    "choose operation",
    "text resource",
    "texts value",
  ]);
  expect(list[3]?.exports[2]?.input).toMatchObject({ type: "string" });
  // The scope's own record: the config as installed.
  expect(got.capsules[1]?.config).toMatchObject({ locale: "vi" });
});
