import { accessSync, constants } from "node:fs";

import { chromium } from "playwright";

/**
 * The Chromium a test draws with: Playwright's headless shell, at the revision of the Chromium
 * Playwright installed for the browser tests, or that Chromium itself. Nothing is downloaded.
 * Null when neither is there.
 */
export function localChromium(): string | null {
  const full = chromium.executablePath();
  const shell = full
    .replace("/chromium-", "/chromium_headless_shell-")
    .replace("chrome-linux64/chrome", "chrome-headless-shell-linux64/chrome-headless-shell");
  for (const path of [shell, full]) {
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      // the next one
    }
  }
  return null;
}
