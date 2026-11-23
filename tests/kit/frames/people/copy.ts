import { copy, type Texts } from "@easel/kit";
import { resource } from "@tinkered/core";

const texts = {
  en: {
    "people.title": "People",
    "people.count": { one: "{count} person", other: "{count} people" },
    "people.remove": "Remove",
    "people.capitals": "Capitals",
    "people.name": "Name",
    "people.add": "Add",
    "people.last": "Last: {name}",
  },
  vi: {
    "people.title": "Mọi người",
    "people.count": { one: "{count} người", other: "{count} người" },
    "people.remove": "Xóa",
    "people.capitals": "Chữ hoa",
    "people.name": "Tên",
    "people.add": "Thêm",
    "people.last": "Mới nhất: {name}",
  },
} satisfies Texts;

export const text = resource({
  label: "people.text",
  tags: [copy.texts(texts)],
  depends: { say: copy.say },
  factory: ({ say }) => say(texts),
});
