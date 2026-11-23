import { resource } from "@tinkered/core";
import { useResource } from "@tinkered/react";

import { maxPicturePixels, picturePrefix } from "@/frames/contract";

export const picRetryMs = [1_000, 2_000, 4_000] as const;

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
