export const title =
  "The status of an app frame: exploring until it settles its texts and colors, then ready";

const settled = (v) => v.uses.every((k) => v.team.includes(k)) && !v.own && !v.offLook;

const frame = (v) => {
  if (v.status === "none") return "Not made";
  if (v.status === "ready") return "Ready";

  return settled(v) ? "Exploring, settled" : "Exploring, not settled";
};

export const state = (v) => ({ "The frame": frame(v) });

export const group = (v) => v.status;
export const colors = { none: "tan", exploring: "yellow", ready: "teal" };

const labels = {
  AnAgentMarksTheFrameReady: "an agent marks it ready",
  TheMarkIsRefused: "the mark is refused (unsettled)",
  AnAgentExploresAgain: "an agent explores it again",
  AUserAddsAText: "a user adds a text (texts.set)",
  AUserRemovesAText: "a user removes a text key",
  AUserChangesTheLook: "a user changes the look",
  AReadyPutIsRefused: "a put is refused (unsettled)",
};

const named = {
  AnExploringPut: (_from, to) =>
    settled(to)
      ? "a put (settled)"
      : "a put with an own text, a missing text key or a color off the look",
  AReadyPut: (from) => (from.status === "ready" ? "a put, fixed and settled" : "a put with ready"),
};

export const step = (action, from, to) => named[action]?.(from, to) ?? labels[action] ?? action;
