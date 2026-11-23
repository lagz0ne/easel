import { operation } from "@tinkered/core";
import { z } from "zod";

import { todos } from "./contract";

export const addTodo = operation({
  label: "todo.add.do",
  input: z.object({ title: z.string() }),
  depends: { list: todos.controller },
  run: ({ list }, { input, random }) => {
    const id = random.uuid();
    list.set({ id, title: input.title, done: false });
    return { id };
  },
});

export const toggleTodo = operation({
  label: "todo.toggle.do",
  input: z.object({ id: z.string() }),
  depends: { list: todos.controller },
  run: ({ list }, { input }) => {
    const item = list.of({ id: input.id }).get();
    if (!item) return { kind: "gone" as const, id: input.id };
    list.set({ ...item, done: !item.done });
    return { kind: "toggled" as const, done: !item.done };
  },
});

export const removeTodo = operation({
  label: "todo.remove.do",
  input: z.object({ id: z.string() }),
  depends: { list: todos.controller },
  run: ({ list }, { input }) => {
    if (!list.of({ id: input.id }).get()) return { kind: "gone" as const, id: input.id };
    list.delete({ id: input.id });
    return { kind: "removed" as const };
  },
});

export const todoOps = {
  "todo.add": addTodo,
  "todo.toggle": toggleTodo,
  "todo.remove": removeTodo,
} as const;
