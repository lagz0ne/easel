import { operation, resource, tag } from "@tinkered/core";

import { frames } from "@/frames";

const releaseCanvas = tag<string>({ label: "viewer.releaseCanvas" });

const firstClient = resource({
  label: "viewer.firstClient",
  config: { canvas: releaseCanvas.required },
  factory: () => new Map<"first", string>(),
});

export const newPage = resource({
  label: "viewer.newPage",
  config: { canvas: releaseCanvas.required },
  depends: (c) => ({
    read: frames.board.client.of({ canvas: c.canvas }),
    memo: firstClient({ canvas: c.canvas }),
  }),
  factory: ({ read, memo }) => {
    const now = read.get()?.client ?? null;
    if (now === null) return false;

    const seen = memo.get();
    const first = seen.get("first") ?? now;
    seen.set("first", first);
    return now !== first;
  },
});

export const pageReloader = resource({
  label: "viewer.pageReloader",
  factory: () => ({ reload: () => location.reload() }),
});

export const reloadPage = operation({
  label: "viewer.reloadPage",
  depends: { page: pageReloader },
  run: ({ page }) => page.reload(),
});
