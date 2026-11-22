// A capsule frame in one file (SPEC-kit.md § The capsules, "A capsule frame"): its entity and its
// data states, its texts in each locale, its operation, its View (a resource) and its own capsule
// `frame`, whose config is the data state. The mount draws it in a scope of the kit's capsules.
import { capsule, data, operation, resource, tag } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import { copy, type Texts, ui } from "@easel/kit";
import { z } from "zod";

const person = z.object({ id: z.string(), name: z.string().min(1) });

const samples = {
  empty: [],
  one: [{ id: "a", name: "Ann" }],
  many: [
    { id: "a", name: "Ann" },
    { id: "b", name: "Binh" },
    { id: "c", name: "Chi" },
  ],
  bad: [{ id: "x", name: "" }],
};

const sample = tag({
  label: "people.sample",
  default: "many",
  parse: z.enum(["empty", "one", "many", "bad"]),
});

const people = data<Array<z.infer<typeof person>>>({ label: "people.list", initial: [] });

const remove = operation({
  label: "people.remove",
  input: z.string(),
  depends: { people: people.controller },
  run: ({ people }, { input }) => people.update((list) => list.filter((one) => one.id !== input)),
});

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

const text = resource({
  label: "people.text",
  tags: [copy.texts(texts)],
  depends: { say: copy.say },
  factory: ({ say }) => say(texts),
});

export const View = resource({
  label: "people.View",
  depends: { ui: ui.pieces, t: text },
  factory: ({ ui: { Button, Card, Empty }, t }) =>
    function People() {
      const list = useData(people);
      const drop = useRun(remove);
      return (
        <main className="p-6">
          <Card title={t("people.title")}>
            <p>{t("people.count", { count: list.length })}</p>
            {list.length === 0 ? <Empty /> : null}
            {list.map((one) => (
              <div key={one.id} className="flex items-center gap-2">
                <span>{one.name}</span>
                <Button tone="ghost" small onClick={() => drop.run({ input: one.id })}>
                  {t("people.remove")}
                </Button>
              </div>
            ))}
          </Card>
        </main>
      );
    },
});

export const frame = capsule({
  label: "people",
  config: { sample },
  exports: { View, people, remove },
  hooks: {
    async start({ config, load, raise, next }) {
      const rows = z.array(person).safeParse(samples[config.sample]);
      if (!rows.success) raise("SampleInvalid", { sample: config.sample });

      const setup = { role: "setup" as const, explain: "The rows of the data state" };
      load(people, setup).set(rows.data ?? []);
      await next();
    },
  },
});
