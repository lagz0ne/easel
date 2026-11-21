import { resource } from "@tinkered/core";
import { useResource } from "@tinkered/react";

import { maxPicturePixels, picturePrefix } from "@/frames/contract";

// A frame's picture (SPEC-viewer.md § Numbers): the shell's card, and the switch of a request's
// popover. The address names the canvas, the frame, the version and its key `k`; the server draws
// the current version, or a kept one (SPEC-frames.md § Pictures).

/** A picture that failed (a busy server answers 503) is asked again after 1, 2 and 4 s, no more. */
export const picRetryMs = [1_000, 2_000, 4_000] as const;

/**
 * The tries of each picture: an img that failed sets its address again after its wait, which
 * asks the server again with no React render. A new address starts its tries over.
 */
const picRetry = resource({
  label: "viewer.picRetry",
  target: "scope",
  factory: (_, ctx) => {
    const tries = new WeakMap<HTMLImageElement, { src: string; n: number }>();

    return {
      failed: (img: HTMLImageElement) => {
        const src = img.getAttribute("src") ?? "";
        const before = tries.get(img);
        const n = before?.src === src ? before.n : 0;
        const wait = picRetryMs[n];
        if (wait === undefined) return;

        tries.set(img, { src, n: n + 1 });
        ctx.clock.sleep(wait, ctx.signal).then(
          () => img.getAttribute("src") === src && img.setAttribute("src", src),
          () => undefined,
        );
      },
    };
  },
});

/** A picture. An img decodes off the main thread, and the card's colour shows until it has. */
function Picture({ src, alt }: { src: string; alt: string }) {
  const retry = useResource(picRetry);

  return (
    <img
      className="e-pic"
      src={src}
      alt={alt}
      decoding="async"
      draggable={false}
      onError={(event) => retry.failed(event.currentTarget)}
    />
  );
}

/**
 * The picture of version `version` of a frame, at half size, or a quarter when half is over 8
 * megapixels. Nothing with no key `k` (pictures are off, or the version is not kept), or for a
 * frame too big even at a quarter: the card under it is plain.
 */
export function FramePicture({
  canvas,
  frame,
  version,
  k,
  alt,
}: {
  canvas: string;
  frame: { id: string; name: string; w: number; h: number };
  version: number;
  k: string | undefined;
  alt?: string;
}) {
  const area = frame.w * frame.h;
  const scale = area / 4 <= maxPicturePixels ? 0.5 : area / 16 <= maxPicturePixels ? 0.25 : null;
  if (k === undefined || scale === null) return null;

  return (
    <Picture
      src={`${picturePrefix}${canvas}/${frame.id}/${version}?s=${scale}&k=${k}`}
      alt={alt ?? frame.name}
    />
  );
}
