import { operation } from "@tinkered/core";

export const baseVersion = "0.29.0";

export const health = operation({
  label: "tinker.health",
  run: () => ({ ok: true, base: baseVersion }),
});
