// The reader's words for ControlLink.tla: a control of an app frame, in its own scope.
export const title = "kit: a control in its own scope reads and calls the frame's capsule";

const seq = (s) => (Array.isArray(s) ? s : Object.values(s ?? {}));
const valueOf = (v) => (Array.isArray(v.value) ? v.value[v.scope - 1] : v.value[v.scope]);
const quiet = (v) => seq(v.toCtl).length === 0 && seq(v.toFrame).length === 0;

const words = {
  none: "the frame has no scope yet",
  linking: "the control waits for a pane link of the scope on screen, or its first value",
  shows: "the control shows the frame's value",
  syncing: "the control is linked; a call or a push is on the way",
};

export const group = (v) => {
  if (v.scope === 0) return "none";
  if (v.link !== v.scope || v.mirror === 2) return "linking";
  return quiet(v) && v.mirror === valueOf(v) ? "shows" : "syncing";
};

export const state = (v) => words[group(v)];

export const colors = { none: "tan", linking: "yellow", shows: "teal", syncing: "blue" };

const steps = {
  Done: () => null,
  Draw: () => "the frame starts a scope: its old pane link closes, and it posts a new one",
  Ask: () => "the control has no pane link of the scope on screen: it asks for one",
  Give: () => "the page gives the pane link to the control: a new scope, which watches the value",
  Arrive: (from) =>
    seq(from.toCtl)[0]?.s === from.link
      ? "a push of the frame reaches the control"
      : "a push on an old pane link: the control does not see it",
  Call: () => "the person uses the control: it calls the frame",
  Serve: (from) =>
    seq(from.toFrame)[0]?.s === from.scope
      ? "the frame runs the call in its scope, and pushes the value"
      : "a call on an old pane link: the frame runs nothing",
  Own: () => "the frame changes the value by itself, and pushes it",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
