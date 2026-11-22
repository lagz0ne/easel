import { createScope } from "@tinkered/core";
import { ScopeProvider } from "@tinkered/react";
import { type ClassValue, clsx } from "clsx";
import { type ComponentType, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { twMerge } from "tailwind-merge";

// `@easel/frame`: easel's helper for an app frame (SPEC-kit.md § App frames; frame-apps decision
// 10). It is in the runtime of each kit version (`runtime.server.ts`), and runs only in a frame's
// sandboxed iframe; no page or server module imports it. It is small on purpose: `frameLogic` (the
// shape of `logic`), `cn` (the `cn` of shadcn/ui) and `mount` (what the composed document runs).

/**
 * The `logic` of a frame: its Tinker cells and operations. The View reads `logic.cells.<name>`
 * (`useData`) and runs `logic.ops.<name>` (`useRun`). In the frame's own scope (build order items
 * 2 to 6) it is the cells and operations as given; the board worker (item 7) will give the same
 * names over its port.
 */
export const frameLogic = <
  const L extends { cells: Record<string, unknown>; ops: Record<string, unknown> },
>(
  logic: L,
): L => logic;

/** The class names of its arguments, as clsx joins them; a later utility wins over an earlier one. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/**
 * Mounts the app of a frame (SPEC-kit.md § App frames, "The runtime", "The hello and the port",
 * "Close before the iframe goes"): it makes the frame's scope and renders `View`
 * into `document.body` in one synchronous step, so the first render is in the document before its
 * `load` event. It says hello to its parent at once and each 50 ms until its parent gives it a
 * port. A kit message replaces the text of the styles `easel-look` and `easel-kit`. On `close` it
 * unmounts the View, closes the scope (each deferred end runs), then posts `closed`. It answers
 * only its parent, and sends only the hello and `closed`.
 */
export const mount = (app: { View: ComponentType }) => {
  let port: MessagePort | null = null;
  let closing = false;
  const root = createRoot(document.body);
  // A scope with no capsules starts at once: the first render needs no wait.
  const scope = createScope();

  const closed = () => {
    if (port) port.postMessage({ easel: "closed" });
    else parent.postMessage({ easel: "closed" }, "*");
  };

  // A message from the page: `{ easel: "kit", look, css }` (K7), or `{ easel: "close" }`.
  const take = (data: unknown) => {
    const field = (key: string): unknown =>
      typeof data === "object" && data !== null ? Reflect.get(data, key) : undefined;
    const [easel, look, css] = [field("easel"), field("look"), field("css")];
    if (easel === "kit" && typeof look === "string" && typeof css === "string") {
      const styles = [document.getElementById("easel-look"), document.getElementById("easel-kit")];
      if (styles[0]) styles[0].textContent = look;
      if (styles[1]) styles[1].textContent = css;
    }
    if (easel !== "close" || closing) return;

    closing = true;
    root.unmount();
    scope.close().then(closed, closed);
  };

  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    // Two hellos can be in flight: each answer has a new port, and the page keeps the newest.
    const given = event.ports[0];
    if (given) {
      port?.close();
      port = given;
      port.addEventListener("message", (on) => take(on.data));
      port.start();
    }
    take(event.data);
  });

  const hello = () => {
    if (port || closing) return;
    parent.postMessage({ easel: "hello" }, "*");
    setTimeout(hello, 50);
  };
  hello();

  const children = createElement(app.View);
  flushSync(() => root.render(createElement(ScopeProvider, { scope, children })));
};
