// The reader's words for Pictures.tla with PicturesKept.cfg: as Pictures.view.mjs, and a request
// refers to version 1, so the server keeps it (KeptFirst = TRUE).
import * as pictures from "./Pictures.view.mjs";

export const title =
  "frames: a viewer's picture of a kept version while an agent writes, deletes, or ends the link";

export const state = (v) =>
  v.req === "asked" && v.asked === 1 && v.version > 1
    ? "The server gets the kept version's address"
    : pictures.state(v);

export const { group, colors, step } = pictures;
