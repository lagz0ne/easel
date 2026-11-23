import { useData, useRun } from "@tinkered/react";
import { memo } from "react";

import { type Todo, todoApi, todoBoard } from "./contract";

export function TodoList() {
  const list = useData(todoBoard.todos.where({}));
  const add = useRun(todoApi["todo.add"]);

  return (
    <main>
      <h1>Todo</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const title = new FormData(form).get("title");
          if (typeof title === "string") add.run({ input: { title } });
          form.reset();
        }}
      >
        <input name="title" aria-label="New todo" placeholder="What next?" />
        <button type="submit">Add</button>
      </form>
      <ul>
        {list.map((item) => (
          <TodoRow key={item.id} item={item} />
        ))}
      </ul>
    </main>
  );
}

export const TodoRow = memo(function TodoRow({ item }: { item: Todo }) {
  const toggle = useRun(todoApi["todo.toggle"]);
  const remove = useRun(todoApi["todo.remove"]);
  const { id } = item;

  return (
    <li>
      <label>
        <input type="checkbox" checked={item.done} onChange={() => toggle.run({ input: { id } })} />
        {item.title}
      </label>
      <button type="button" onClick={() => remove.run({ input: { id } })}>
        Remove
      </button>
    </li>
  );
});
