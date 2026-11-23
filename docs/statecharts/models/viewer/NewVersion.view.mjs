export const title = "viewer: a new version of the page, and Reload";

export const group = (v) => v.bar;

const bars = {
  none: "No bar",
  reload: "Bar: a new version is ready, Reload",
  sendFirst: "Bar: a new version is ready, send your text first",
};

export const state = (v) =>
  [
    bars[v.bar],
    `the tab has build ${v.mine}`,
    `the server gives build ${v.server}`,
    v.read === 0 ? "not read yet" : `the board says build ${v.read}`,
    v.typed ? "text typed" : null,
  ]
    .filter(Boolean)
    .join(", ");

export const colors = { none: "tan", reload: "teal", sendFirst: "blue" };

const steps = {
  Deploy: () => "a deploy: the server gives a new page",
  Read: () => "the tab reads the board (at the start, or when the socket connects again)",
  Type: (from) => (from.typed ? "the viewer sends or clears the text" : "the viewer types a text"),
  Reload: () => "the viewer presses Reload: the tab loads the new page",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
