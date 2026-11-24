import { data, operation, remoteData, rpc, tag } from "@tinkered/core";
import { z } from "zod";

export const person = z.object({ id: z.string(), name: z.string().min(1) });

export const samples = {
  empty: [],
  one: [{ id: "a", name: "Ann" }],
  many: [
    { id: "a", name: "Ann" },
    { id: "b", name: "Binh" },
    { id: "c", name: "Chi" },
  ],
  bad: [{ id: "x", name: "" }],
};

export const sample = tag({
  label: "people.sample",
  default: "many",
  parse: z.enum(["empty", "one", "many", "bad"]),
});

export const people = data<Array<z.infer<typeof person>>>({
  label: "people.list",
  initial: [],
  parse: z.array(person),
});

export const remove = operation({
  label: "people.remove",
  input: z.string(),
  depends: { people: people.controller },
  run: ({ people }, { input }) => people.update((list) => list.filter((one) => one.id !== input)),
});

export const capitals = data({ label: "people.capitals", initial: false });

export const addPerson = operation({
  label: "people.add",
  depends: { people: people.controller },
  run: ({ people }) =>
    people.update((list) => {
      let n = list.length + 1;
      while (list.some((one) => one.id === `p${n}`)) n += 1;
      return [...list, { id: `p${n}`, name: `Person ${n}` }];
    }),
});

export const removeAll = operation({
  label: "people.removeAll",
  depends: { people: people.controller },
  run: ({ people }) => people.set([]),
});

export const setCapitals = operation({
  label: "people.setCapitals",
  input: z.boolean(),
  depends: { capitals: capitals.controller },
  run: ({ capitals }, { input }) => capitals.set(input),
});

export const addNamed = operation({
  label: "people.addNamed",
  input: z.string().trim().min(1),
  depends: { people: people.controller },
  run: ({ people }, { input }) => {
    const list = people.get();
    let n = list.length + 1;
    while (list.some((one) => one.id === `p${n}`)) n += 1;

    const one = { id: `p${n}`, name: input };
    people.set([...list, one]);
    return one;
  },
});

export const capitalsTo = operation({
  label: "people.capitalsTo",
  input: z.boolean(),
  depends: { capitals: capitals.controller },
  run: ({ capitals }, { input }) => {
    capitals.set(input);
    return input;
  },
});

export const board = remoteData({ people, capitals });

export const api = rpc({
  "people.call.add": { input: addNamed.input, output: person },
  "people.call.capitals": { input: capitalsTo.input, output: z.boolean() },
});
