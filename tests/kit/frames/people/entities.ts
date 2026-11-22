// The entity of the frame, its data states, its cell and its operation.
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
