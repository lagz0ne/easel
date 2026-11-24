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

test("the hover fill of the back button is a 28 px square like the other icon buttons of the canvas, and its hit area stays 36 px, so the button does not grow on hover (product#8)", () => {
  const bar = placed(
    '<nav class="e-back" aria-label="Canvas"><a class="e-back-btn" href="/">back</a><h1 class="e-back-name">Product</h1></nav>',
  );
  const button = bar.querySelector(".e-back-btn");
  if (!(button instanceof HTMLElement)) throw new Error("the bar has no back button");

  const hit = button.getBoundingClientRect();
  const fill = getComputedStyle(button, "::before");

  expect(hit.width).toBe(36);
  expect(hit.height).toBe(36);
  expect(fill.position).toBe("absolute");
  expect(fill.width).toBe("28px");
  expect(fill.height).toBe("28px");
  expect(getComputedStyle(button).backgroundColor).toBe("rgba(0, 0, 0, 0)");
});

test("the bar of the canvas name floats 16 px from the top and the left edge and is 40 px high, as the dock, with the border, radius and shadow of the dock (product#2)", () => {
  const top = placed(
    '<div class="e-top"><nav class="e-back" aria-label="Canvas"><a class="e-back-btn" href="/">back</a><h1 class="e-back-name">Product</h1></nav></div>',
  );
  const holder = top.parentElement;
  if (!(holder instanceof HTMLElement)) throw new Error("the bar has no holder");
  holder.style.position = "relative";
  holder.style.height = "200px";
  const bar = top.querySelector(".e-back");
  if (!(bar instanceof HTMLElement)) throw new Error("the top has no bar");
  const dock = placed('<div class="e-dock" role="toolbar" aria-label="Canvas"></div>');

  const at = bar.getBoundingClientRect();
  const from = holder.getBoundingClientRect();
  const look = getComputedStyle(bar);
  const dockLook = getComputedStyle(dock);

  expect([at.left - from.left, at.top - from.top, at.height]).toEqual([16, 16, 40]);
  expect(look.borderTopColor).toBe(dockLook.borderTopColor);
  expect(look.borderTopLeftRadius).toBe(dockLook.borderTopLeftRadius);
  expect(look.boxShadow).toBe(dockLook.boxShadow);
});
