import { operation } from "@tinkered/core";

import { frames } from "@/frames/contract";
import { passApi } from "@/frames/share";

export const frameOnPage = operation({
  label: "test.frameOnPage",
  input: passApi["share.frame"].input,
  depends: { cells: frames.controller },
  run: ({ cells }, { input }) => {
    const [frame] = cells.where(input).get();
    return frame ? { kind: "found" as const, page: frame.page } : { kind: "gone" as const };
  },
});
