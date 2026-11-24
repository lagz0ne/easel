const statesOf = (v) => Object.values(v.path);

export const title = "viewer: the person walks a map of the code";

const asks = {
  off: null,
  on: "Comment on",
  open: "a request open on the screen",
};

export const group = (v) => {
  if (v.mode === "canvas") return "canvas";
  return v.ask === "open" ? "request" : "walk";
};

export const colors = { canvas: "tan", walk: "teal", request: "blue" };

export const state = (v) => {
  if (v.mode === "canvas") return "The canvas";
  const path = statesOf(v);
  const shown = path[path.length - 1];
  const steps = path.length > 1 ? ` (steps: ${path.join(", ")})` : " (the first step)";
  return [
    `Walk: state ${shown}${steps}`,
    v.told === "offMap" ? "the bar says the map has no such move" : null,
    asks[v.ask],
  ]
    .filter(Boolean)
    .join(", ");
};

const steps = {
  StartWalk: () => "a press on the mark of the walk frame, or on the map in the list Maps",
  CellChanges: (from, to) =>
    statesOf(to).length > statesOf(from).length
      ? `the code changes the cell: state ${statesOf(to).at(-1)}`
      : "the code changes the cell to a state off the map",
  Back: () => "Back",
  Restart: () => "Restart",
  Leave: () => "Leave",
  Comment: () => "Comment",
  PressToAsk: () => "a press on the screen in the request mode",
  AskForIt: () => "Ask for it",
  Send: () => "Send",
  Escape: (from) =>
    from.ask === "open"
      ? "Escape: the request closes"
      : from.ask === "on"
        ? "Escape: the request mode ends"
        : "Escape: the walk ends",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
