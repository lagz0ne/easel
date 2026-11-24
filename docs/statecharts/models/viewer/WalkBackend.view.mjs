export const title = "viewer: the backend of the walk, example answers or a live server";

const servers = {
  none: "live server not set up",
  starting: "live server starting",
  ready: "live server ready",
  failed: "live server failed",
  gone: "live server gone",
};

const backends = { examples: "example answers", live: "live server" };

export const group = (v) => {
  if (v.walk === "off") return "canvas";
  if (v.walk === "held") return "held";
  return v.call === "none" ? "walk" : "call";
};

export const colors = { canvas: "tan", walk: "teal", call: "blue", held: "yellow" };

const screen = (v) => {
  if (v.walk === "off") return "The canvas";
  if (v.walk === "held") return "Walk held: the bar says why, no screen runs";
  const state = v.walk === "first" ? "the first state" : "a later state";
  const on = v.scope === v.backend ? "" : ` (its scope: ${backends[v.scope]})`;
  return `Walk: ${state}${on}`;
};

const calls = {
  none: null,
  examples: "a call waits for the pick of its answer",
  live: "a call waits on the live server",
};

export const state = (v) =>
  [`Switch: ${backends[v.backend]}`, servers[v.server], screen(v), calls[v.call]]
    .filter(Boolean)
    .join(", ");

const steps = {
  StartWalk: () => "a press on Walk",
  Pick: (from, to) => `the person picks ${backends[to.backend]}`,
  Press: () => "a press on the screen makes a call",
  PickAnswer: () => "the person picks the answer",
  ServerAnswers: () => "the live server answers",
  StepBack: () => "Back or Restart",
  Leave: () => "Leave",
  Deploy: (from) => (from.server === "none" ? "the hub sets up the live server" : "a new deploy"),
  ServerReady: () => "the live server is ready",
  ServerFails: () => "the live server fails to start",
  ServerGoes: () => "the live server goes",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
