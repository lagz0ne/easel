import { capsule } from "@tinkered/core";

import { todoApi, todoBoard } from "./contract";

export const todo = capsule({ label: "todo", exports: { board: todoBoard, api: todoApi } });
