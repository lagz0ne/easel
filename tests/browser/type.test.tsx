import { expect, onTestFinished, test } from "vite-plus/test";

import "@/style.css";
import "@/home/home.css";
import "@/viewer/canvas.css";

function placed(markup: string) {
  const box = document.body.appendChild(document.createElement("div"));
  box.innerHTML = markup;
  onTestFinished(() => box.remove());

  const first = box.firstElementChild;
  if (!(first instanceof HTMLElement)) throw new Error("the markup has no element");

  return first;
}

function part(root: HTMLElement, selector: string) {
  const found = root.querySelector(selector);
  if (!(found instanceof HTMLElement)) throw new Error(`no ${selector}`);

  return getComputedStyle(found);
}

const smoothed = (look: CSSStyleDeclaration) => look.getPropertyValue("-webkit-font-smoothing");

test("the page text with no size of its own is 13 px Inter on 20 px lines, smoothed as in Doop, not the 16 px default of the browser (product#9)", () => {
  const text = placed("<p>An owner of the team approves the code.</p>");
  const look = getComputedStyle(text);

  expect([look.fontSize, look.lineHeight]).toEqual(["13px", "20px"]);
  expect(look.fontFamily).toMatch(/^Inter,/);
  expect(smoothed(look)).toBe("antialiased");
});

test("the home page has 13 px text and a 15 px title, and its code is Geist Mono, the mono of Doop (product#9)", () => {
  const home = placed(
    '<main class="e-home"><h1>Canvases</h1><p>Or run <code>easel open</code>.</p><output class="e-home-big">BCDF-GHJK</output></main>',
  );

  expect(getComputedStyle(home).fontSize).toBe("13px");
  expect(smoothed(getComputedStyle(home))).toBe("antialiased");
  expect(part(home, "h1").fontSize).toBe("15px");
  expect(part(home, "code").fontFamily).toMatch(/^"Geist Mono",/);
  expect(part(home, ".e-home-big").fontFamily).toMatch(/^"Geist Mono",/);
});

test("the canvas text is smoothed as in Doop (product#9)", () => {
  const canvas = placed('<div class="e-canvas"></div>');

  expect(smoothed(getComputedStyle(canvas))).toBe("antialiased");
});
