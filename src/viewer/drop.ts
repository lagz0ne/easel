import { data, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { frames } from "@/frames";
import { imageType, maxImageBytes, putOutput } from "@/frames/contract";

import { readBase64 } from "./draft";
import { stage } from "./stage";

export const dropTold = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("refused"), why: z.string() }),
  z.object({ kind: z.literal("wait") }),
  z.object({ kind: z.literal("lost") }),
]);

export type DropTold = z.infer<typeof dropTold>;

export const imageDrop = data<{ over: boolean; going: boolean; told: DropTold }>({
  label: "viewer.imageDrop",
  initial: { over: false, going: false, told: { kind: "none" } },
});

export const notAnImage = "Only a PNG, JPEG or WebP image of 10 MB at most goes on the canvas.";

const badImageWords = {
  type: "The file is not the image that its type says. Only a PNG, JPEG or WebP image goes on the canvas.",
  pixels: "The image is too large: at most 16000 px on a side and 25 million pixels.",
  unreadable: "The image does not open. Save it again as a PNG, JPEG or WebP image.",
} as const;

const refused = z.string().transform((why): DropTold => ({ kind: "refused", why }));

const pageGone = refused.parse("This page is gone. Open another page, and drop it again.");

const told = { none: { kind: "none" }, lost: { kind: "lost" } } as const;

type Written = Exclude<z.infer<typeof putOutput>["kind"], "badImage">;

const toldOfKind = {
  created: told.none,
  updated: told.none,
  unchanged: told.none,
  tooBig: refused.parse(notAnImage),
  offKit: refused.parse(notAnImage),
  unsettled: refused.parse(notAnImage),
  gone: pageGone,
  stale: pageGone,
  changed: told.lost,
  placed: told.lost,
} as const satisfies Record<Written, DropTold>;

const toldOf = putOutput.transform((answer): DropTold =>
  answer.kind === "badImage"
    ? refused.parse(badImageWords[answer.reason])
    : toldOfKind[answer.kind],
);

const placeAt = z.number().transform((n) => Math.min(100_000, Math.max(0, Math.round(n))));

const frameNameOf = z.string().transform(
  (file) =>
    file
      .replace(/\.[^.]*$/, "")
      .trim()
      .slice(0, 200) || "image",
);

export const fileOver = operation({
  label: "viewer.fileOver",
  input: z.boolean(),
  depends: { drop: imageDrop.controller },
  run: ({ drop }, { input: over }) => {
    const now = drop.get();
    if (now.over === over) return;
    drop.set({ ...now, over, told: over ? { kind: "none" } : now.told });
  },
});

export const sendImage = operation({
  label: "viewer.sendImage",
  input: z.object({
    canvas: z.string(),
    page: z.string(),
    file: z.instanceof(Blob),
    name: z.string(),
    at: z.object({ x: z.number(), y: z.number() }),
  }),
  depends: { drop: imageDrop.controller, readBase64, put: frames.api["frame.put"] },
  run: async ({ drop, readBase64, put }, { input: { canvas, page, file, name, at } }) => {
    const now = drop.get();
    if (now.going) return drop.set({ ...now, over: false, told: { kind: "wait" } });
    const type = imageType.safeParse(file.type);
    if (!type.success || file.size > maxImageBytes) {
      return drop.set({ over: false, going: false, told: refused.parse(notAnImage) });
    }

    drop.set({ over: false, going: true, told: told.none });
    const image = { mimeType: type.data, data: await readBase64.run({ input: file }) };
    const place = { page, x: placeAt.parse(at.x), y: placeAt.parse(at.y) };
    const sent = { canvas, image, name: frameNameOf.parse(name), ...place };
    const reply = await put.settle({ input: sent });

    const over = drop.get().over;
    const answer = reply.status === "success" ? toldOf.parse(reply.value) : told.lost;
    return drop.set({ over, going: false, told: answer });
  },
});

const dropCanvas = tag<string>({ label: "viewer.dropCanvas" });

const dropPage = tag<string>({ label: "viewer.dropPage" });

const editable = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export const pasteImages = resource({
  label: "viewer.pasteImages",
  config: { canvas: dropCanvas.required, page: dropPage.required },
  depends: { at: stage, sendImage },
  factory: ({ at, sendImage }, ctx) => {
    const { canvas, page } = ctx.config;
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      const inText = target instanceof Element && target.closest(editable) !== null;
      const file = event.clipboardData?.files[0];
      if (event.defaultPrevented || inText || !file) return;

      event.preventDefault();
      const input = { canvas, page, file, name: file.name, at: at.pasteSpot() };
      void sendImage.run({ input });
    };
    window.addEventListener("paste", onPaste);
    ctx.defer(() => window.removeEventListener("paste", onPaste));

    return { listening: true };
  },
});

const onViewport = z
  .custom<DragEvent>()
  .transform(
    (event) =>
      event.target instanceof Element &&
      event.target.closest(".e-viewport") !== null &&
      (event.dataTransfer?.types.includes("Files") ?? false),
  );

export const dropImages = resource({
  label: "viewer.dropImages",
  config: { canvas: dropCanvas.required, page: dropPage.required },
  depends: { at: stage, sendImage, fileOver },
  factory: ({ at, sendImage, fileOver }, ctx) => {
    const { canvas, page } = ctx.config;
    const onOver = (event: DragEvent) => {
      if (!onViewport.parse(event)) return;

      event.preventDefault();
      fileOver.run({ input: true });
    };
    const onLeave = (event: DragEvent) => {
      const into = event.relatedTarget;
      if (into instanceof Element && into.closest(".e-viewport") !== null) return;

      fileOver.run({ input: false });
    };
    const onDrop = (event: DragEvent) => {
      if (!onViewport.parse(event)) return;

      event.preventDefault();
      const file = event.dataTransfer?.files[0];
      if (!file) return fileOver.run({ input: false });

      const spot = at.worldAt(event.clientX, event.clientY);
      void sendImage.run({ input: { canvas, page, file, name: file.name, at: spot } });
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    ctx.defer(() => {
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    });

    return { listening: true };
  },
});
