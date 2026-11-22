// The reader's words for FrameControls.tla: the controls of an app frame in the viewer's panel.
export const title = "kit: a person changes the state of an app frame with its controls";

const seq = (s) => (Array.isArray(s) ? s : Object.values(s ?? {}));
const quiet = (v) => seq(v.toApp).length === 0 && seq(v.toPage).every((m) => m.doc !== v.doc);
const valueOf = (v) => (Array.isArray(v.value) ? v.value[v.doc - 1] : v.value[v.doc]);

const words = {
  away: "the frame is not live",
  waiting: "the frame is live; its controls are on the way",
  shows: "the panel shows the controls and the value of the app",
  syncing: "the panel shows the controls; a change is on the way",
};

export const group = (v) => {
  if (v.doc === 0) return "away";
  if (v.posted === 0) return "waiting";
  return quiet(v) && v.shown === valueOf(v) ? "shows" : "syncing";
};

export const state = (v) => words[group(v)];

export const colors = { away: "tan", waiting: "yellow", shows: "teal", syncing: "blue" };

const steps = {
  GoLive: () => "the frame comes into view: a new document",
  Replace: () => "a new version or another pick: a new document; the old port closes",
  Leave: () => "the frame leaves the view: its port closes",
  Arrive: (from) =>
    seq(from.toPage)[0]?.doc === from.doc
      ? "a post of the document reaches the panel"
      : "a post of an old document reaches the page: it is ignored",
  Pick: () => "the person sets the value in the panel",
  Act: () => "the person presses an action in the panel",
  Deliver: () => "the document runs the operation, then posts its values",
  AppChange: () => "the app changes the value by itself, then posts its values",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
