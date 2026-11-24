const screensOf = (v) => Object.values(v.path);

export const title = "viewer: the person walks a flow in walk mode";

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
  const path = screensOf(v);
  const shown = path[path.length - 1];
  const steps = path.length > 1 ? ` (steps: ${path.join(", ")})` : " (the first step)";
  return [
    `Walk: screen ${shown}${steps}`,
    v.told === "noScreen" ? `the bar says no screen comes after done` : null,
    asks[v.ask],
  ]
    .filter(Boolean)
    .join(", ");
};

const steps = {
  StartFlow: () => "a press on the mark of the flow, or on the flow in the menu",
  PressLinked: (from, to) => `a press on an action: screen ${screensOf(to).at(-1)}`,
  PressUnlinked: () => "a press on done, which has no link",
  FramePostsScreen: (from, to) => `the frame posts screen ${screensOf(to).at(-1)}`,
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
