import { expect, onTestFinished, test } from "vite-plus/test";

import "@/style.css";
import "@/home/home.css";
import "@/viewer/canvas.css";

const surface = "rgb(255, 255, 255)";

function placed(markup: string) {
  const box = document.body.appendChild(document.createElement("div"));
  box.innerHTML = markup;
  onTestFinished(() => box.remove());

  const first = box.firstElementChild;
  if (!(first instanceof HTMLElement)) throw new Error("the markup has no element");

  return first;
}

test("the back bar over the board keeps its surface, border and shadow with the canvas styles loaded, so the board does not show through its name (product#6)", () => {
  const bar = placed(
    '<nav class="e-back" aria-label="Canvas"><a class="e-back-btn" href="/">back</a><h1 class="e-back-name">Product</h1></nav>',
  );
  const look = getComputedStyle(bar);

  expect(look.backgroundColor).toBe(surface);
  expect(look.borderTopStyle).toBe("solid");
  expect(look.boxShadow).not.toBe("none");
});
