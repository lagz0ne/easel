import { data, remoteData, rpc } from "@tinkered/core";
import { z } from "zod";

const todo = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  by: z.string(),
  at: z.date(),
});

const event = z.object({ who: z.string(), what: z.string(), at: z.date() });
export type Todo = z.infer<typeof todo>;
export type Event = z.infer<typeof event>;
const gone = z.object({ kind: z.literal("gone"), id: z.string() });

export const todos = data({ initial: [] as Todo[], parse: z.array(todo) });
export const people = data({ initial: [] as string[], parse: z.array(z.string()) });
export const activity = data({ initial: [] as Event[], parse: z.array(event) });
export const board = remoteData({ todos, people, activity });

export const api = rpc({
  "todo.add": {
    input: z.object({ title: z.string().min(1) }),
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
  "presence.join": { input: z.null(), output: z.number(), mode: "stream" },
});
