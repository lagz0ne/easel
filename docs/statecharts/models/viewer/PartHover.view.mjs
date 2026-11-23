export const title = "viewer: the outline of the part under the pointer, in the request mode";

export const group = (v) => (v.draft === "typing" ? "draft" : v.mode);

const part = { p1: "part 1", p2: "part 2", off: "no part" };

export const state = (v) =>
  [
    v.draft === "typing" ? "A draft is typed" : v.mode === "request" ? "Request mode" : "View mode",
    `pointer on ${part[v.under]}`,
    v.shown === "off" ? "no outline" : `outline on ${part[v.shown]}`,
    v.late.length ? `${v.late.length} answer${v.late.length === 1 ? "" : "s"} on the way` : null,
  ]
    .filter(Boolean)
    .join(", ");

export const colors = { view: "tan", request: "teal", draft: "blue" };

const steps = {
  Move: (from, to) => `the pointer moves onto ${part[to.under]}`,
  Leave: () => "the pointer leaves the frames: the outline goes",
  Answer: (from, to) =>
    to.shown !== from.shown
      ? `the answer comes: the outline shows on ${part[to.shown]}`
      : "a late answer comes: nothing shows",
  Mode: (from) =>
    from.mode === "view"
      ? "the viewer presses Request: request mode"
      : "the viewer presses Request again: view mode",
  Click: () => "a click on the part: a draft opens, and the hover outline goes",
  EndDraft: () => "Send or Escape: the draft ends",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
