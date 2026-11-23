import { accessSync, constants } from "node:fs";

import { chromium } from "playwright";

export function localChromium(): string | null {
  const full = chromium.executablePath();
  const shell = full
    .replace("/chromium-", "/chromium_headless_shell-")
    .replace("chrome-linux64/chrome", "chrome-headless-shell-linux64/chrome-headless-shell");
  for (const path of [shell, full]) {
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {}
  }
  return null;
}
