import { resource, tag } from "@tinkered/core";

import { linkAimed } from "./act";
import { showFrameOf } from "./pages";

export const frameHash = /^frame-([0-9a-f]{12})$/;

const frameLinkCanvas = tag<string>({ label: "viewer.frameLinkCanvas" });

const frameLinkHash = tag<string>({ label: "viewer.frameLinkHash" });

export const frameFromLink = resource({
  label: "viewer.frameFromLink",
  config: { canvas: frameLinkCanvas.required, hash: frameLinkHash.required },
  depends: { aimed: linkAimed.controller, showFrameOf },
  factory: ({ aimed, showFrameOf }, ctx) => {
    const { canvas, hash } = ctx.config;
    const id = frameHash.exec(hash.replace(/^#/, ""))?.[1];
    const key = `${canvas}#frame-${id}`;
    if (id === undefined || aimed.get() === key) return false;

    queueMicrotask(() => {
      aimed.set(key);
      void showFrameOf.run({ input: { canvas, id, spot: null } });
    });
    return true;
  },
});
