// The reader's words for ControlFold.tla: a docked column of controls folds to its tab out of use.
export const title = "kit: a docked column of controls is open only while its frame is in use";

const devices = { mouse: "Mouse", touch: "Touch" };

const inUse = (v) => v.pointer !== "away" || v.focus === "column" || v.marked || v.pressed;

const causes = [
  { holds: (v) => v.pointer === "frame", words: "the pointer is on the frame" },
  { holds: (v) => v.pointer === "column", words: "the pointer is on the column" },
  { holds: (v) => v.focus === "column", words: "the focus is on a control" },
  { holds: (v) => v.pressed, words: "a press on the tab" },
  { holds: (v) => v.marked, words: "the mark of Find" },
];

const why = (v) =>
  causes.find((cause) => cause.holds(v))?.words ?? "the delay after the pointer left";

export const group = (v) => {
  if (inUse(v)) return "open";
  return v.lingering ? "delay" : "folded";
};

export const state = (v) => {
  const head = devices[v.device];
  if (group(v) === "folded") return `${head}: folded to its tab`;
  return `${head}: open, ${why(v)}`;
};

export const colors = { folded: "tan", open: "teal", delay: "yellow" };

const steps = {
  PointTo: (from, to) =>
    to.pointer === "frame"
      ? "the pointer comes onto the frame"
      : "the pointer comes onto the column",
  PointAway: () => "the pointer leaves: the delay starts",
  DelayEnds: () => "the delay ends",
  PressTab: (from, to) => (to.pressed ? "a press on the tab" : "a second press on the tab"),
  PressControl: () => "a press on a control: it runs",
  PressOutside: () => "a press out of the column",
  FocusOn: (from, to) =>
    to.focus === "tab" ? "the focus comes onto the tab" : "the focus comes onto a control",
  FocusOff: () => "the focus leaves",
  Mark: () => "Find marks the frame",
  Unmark: () => "the mark ends",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
