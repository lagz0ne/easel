// The reader's words for ViewerOverlays.tla: what lies over the canvas, on a phone and on a wide screen.
export const title =
  "viewer: the menus, Find and the card Requests, on a phone and on a wide screen";

const screens = { narrow: "Phone", wide: "Wide" };

const panels = { closed: "no card", list: "the list", card: "a request" };

const menus = { pages: "menu Pages", list: "menu Open or Done", more: "menu More" };

const home = { pages: "any", list: "list", more: "card" };

const menuWords = (v, m) =>
  home[m] === "any" || home[m] === v.panel ? menus[m] : `${menus[m]} kept, not shown`;

const over = (v) => [...v.menu.map((m) => menuWords(v, m)), ...(v.find ? ["Find"] : [])];

export const state = (v) => {
  const more = over(v);
  const head = `${screens[v.screen]}: ${panels[v.panel]}`;
  return more.length ? `${head}, ${more.join(", ")}` : head;
};

export const group = (v) => panels[v.panel];

export const colors = { "no card": "tan", "the list": "teal", "a request": "blue" };

const steps = {
  PressRequests: (from) =>
    from.panel === "closed"
      ? "a press on Requests: the list opens"
      : "a press on Requests: the card closes",
  PressPages: (from) =>
    from.menu.includes("pages")
      ? "a press on Pages: its menu closes"
      : "a press on Pages: its menu opens",
  PressFind: (from) => (from.find ? "a press on Find: Find closes" : "a press on Find: Find opens"),
  PressList: (from) =>
    from.menu.includes("list")
      ? "a press on Open: its menu closes"
      : "a press on Open: its menu opens",
  PressMore: (from) =>
    from.menu.includes("more")
      ? "a press on More: its menu closes"
      : "a press on More: its menu opens",
  PressRow: () => "a press on a row: its request opens",
  PressBack: () => "a press on All requests: the list again",
  PressClose: () => "a press on Close: the card closes",
  Pick: () => "a pick in the menu: it closes",
  PressOutside: () => "a press out of it: it closes",
  Escape: () => "Escape: the top closes",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
