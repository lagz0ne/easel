import { resource } from "@tinkered/core";
import { useResource } from "@tinkered/react";

import { maxPicturePixels, picturePrefix } from "@/frames/contract";

// A frame's picture (SPEC-viewer.md § Numbers): the shell's card, and the switch of a request's
// popover. The address names the canvas, the frame, the version, its key `k` and the kit version;
// the server draws the current version, or a kept one, in that kit version (SPEC-frames.md §
// Pictures). A new kit version gives a new address: the img keeps its last picture until the new
// one has come, so a change of the look shows no white box (SPEC-kit K7).

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

/**
 * A picture of frame version `version`: its address `src`, with the kit version `kit` when the page
 * has it. An img decodes
 * off the main thread, and the card's colour shows until it has. `wide`: the frame is wider than
 * its card, so the card shows all of its width.
 */
function Picture({
  src,
  version,
  kit,
  alt,
  wide,
}: {
  src: string;
  version: number;
  kit: number | null | undefined;
  alt: string;
  wide: boolean;
}) {
  const retry = useResource(picRetry);

  return (
    <img
      className="e-pic"
      data-wide={wide}
      data-version={version}
      src={typeof kit === "number" ? `${src}&kit=${kit}` : src}
      alt={alt}
      decoding="async"
      draggable={false}
      onError={(event) => retry.failed(event.currentTarget)}
    />
  );
}

/**
 * The picture of version `version` of a frame in kit version `kit`, at half size, or a quarter
 * when half is over 8 megapixels. Nothing with no key `k` (pictures are off, or the version is
 * not kept), or for a frame too big even at a quarter: the card under it is plain. With no kit
 * version yet (the kit has not come), the address has none, and the server sends the current one.
 */
export function FramePicture({
  canvas,
  frame,
  version,
  k,
  kit,
  alt,
  card = 0,
}: {
  canvas: string;
  frame: { id: string; name: string; w: number; h: number };
  version: number;
  k: string | undefined;
  kit: number | null | undefined;
  alt?: string;
  /** The width over the height of the card it shows on; 0: the card has the frame's own size. */
  card?: number;
}) {
  const area = frame.w * frame.h;
  const scale = area / 4 <= maxPicturePixels ? 0.5 : area / 16 <= maxPicturePixels ? 0.25 : null;
  if (k === undefined || scale === null) return null;

  return (
    <Picture
      src={`${picturePrefix}${canvas}/${frame.id}/${version}?s=${scale}&k=${k}`}
      version={version}
      kit={kit}
      alt={alt ?? frame.name}
      wide={card > 0 && frame.w / frame.h > card}
    />
  );
}
