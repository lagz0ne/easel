export const title = "viewer: the pages of a canvas, a frame that moves, and the picks of a tab";

const pages = { p1: "Page 1", p2: "Page 2" };

const detail = (v) => {
  if (v.load === "page") return "loading its frames";
  if (v.load === "frame") return "asks for the picked frame";

  const now = v.behind ? "a move not shown yet" : "each frame of the page";
  if (v.picked === "none") return now;

  return `${now}, ${v.marked ? "the picked frame marked" : "the picked frame not there"}`;
};

export const state = (v) => [pages[v.tabPage], detail(v)];

const groups = { none: "shows the page", page: "loads a page", frame: "asks for a frame" };

export const group = (v) => groups[v.load];

export const colors = {
  "shows the page": "teal",
  "loads a page": "tan",
  "asks for a frame": "yellow",
};

const steps = {
  AnAgentMovesTheFrame: () => "an agent moves m to the other page",
  TheLoadEnds: () => "the answer comes",
  TheTabGetsTheMove: () => "the move reaches the tab",
  APickOfAPage: (_from, to) => `a pick of ${pages[to.tabPage]} in the list`,
  APickOfAFoundFrame: () => "a pick in Find",
  APickOfTheRequest: () => "a pick of the request on m",
  AReload: () => "a reload",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
