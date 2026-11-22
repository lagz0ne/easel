// The texts of the frame in each locale, and its `t`.
import { copy, type Texts } from "@easel/kit";
import { resource } from "@tinkered/core";

const texts = {
  en: {
    "people.title": "People",
    "people.count": { one: "{count} person", other: "{count} people" },
    "people.remove": "Remove",
  },
  vi: {
    "people.title": "Mọi người",
    "people.count": { one: "{count} người", other: "{count} người" },
    "people.remove": "Xóa",
  },
} satisfies Texts;

export const text = resource({
  label: "people.text",
  tags: [copy.texts(texts)],
  depends: { say: copy.say },
  factory: ({ say }) => say(texts),
});
