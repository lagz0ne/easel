import { capsule } from "@tinkered/core";

import { framesApi, framesBoard } from "./contract";
import { passApi, shareApi } from "./share";

export const frames = capsule({
  label: "frames",
  exports: { api: framesApi, board: framesBoard, viewer: shareApi, pass: passApi },
});
