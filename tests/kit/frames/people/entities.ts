// The entity of the frame, its data states, its cells and its operations.
import { data, operation, tag } from "@tinkered/core";
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

export const people = data<Array<z.infer<typeof person>>>({ label: "people.list", initial: [] });

export const remove = operation({
  label: "people.remove",
  input: z.string(),
  depends: { people: people.controller },
  run: ({ people }, { input }) => people.update((list) => list.filter((one) => one.id !== input)),
});

/** The names show in capitals: a state of the View that a control of the viewer sets. */
export const capitals = data({ label: "people.capitals", initial: false });

/** A control: a new person at the end of the list, with the first free id. */
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

/** A control: the list has no person. */
export const removeAll = operation({
  label: "people.removeAll",
  depends: { people: people.controller },
  run: ({ people }) => people.set([]),
});

/** A control: the names show in capitals, or not. */
export const setCapitals = operation({
  label: "people.setCapitals",
  input: z.boolean(),
  depends: { capitals: capitals.controller },
  run: ({ capitals }, { input }) => capitals.set(input),
});
