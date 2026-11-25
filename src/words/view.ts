import { data } from "@tinkered/core";
import { z } from "zod";

export const textsShow = z.enum(["all", "missing", "unused", "nokey", "unknown"]);

export const textsGroup = z.enum(["none", "prefix", "canvas"]);

export const textsView = z.object({ show: textsShow, group: textsGroup, find: z.string() });

export type TextsView = z.infer<typeof textsView>;

export const textsViewCell = data({
  label: "words.textsView",
  initial: textsView.parse({ show: "all", group: "none", find: "" }),
});
