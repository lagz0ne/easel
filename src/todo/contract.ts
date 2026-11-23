import { data, remoteData, rpc } from "@tinkered/core";
import { z } from "zod";

const todo = z.object({ id: z.string(), title: z.string(), done: z.boolean() });
export type Todo = z.infer<typeof todo>;

const gone = z.object({ kind: z.literal("gone"), id: z.string() });

export const todos = data({
  label: "todo.list",
  mode: "keyed",
  parse: todo,
  key: (t) => ({ id: t.id }),
});

export const todoBoard = remoteData({ todos });

export const todoApi = rpc({
  "todo.add": {
    input: z.object({ title: z.string().trim().min(1) }),
    output: z.object({ id: z.string() }),
  },
  "todo.toggle": {
    input: z.object({ id: z.string() }),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("toggled"), done: z.boolean() }),
      gone,
    ]),
  },
  "todo.remove": {
    input: z.object({ id: z.string() }),
    output: z.discriminatedUnion("kind", [z.object({ kind: z.literal("removed") }), gone]),
  },
});
