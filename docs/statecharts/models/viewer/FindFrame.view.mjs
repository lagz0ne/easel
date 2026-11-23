export const title = "viewer: find a frame by its name, from the dock";

const lists = { closed: "List closed", open: "List open" };

export const group = (v) => v.list;

export const state = (v) =>
  [
    lists[v.list],
    v.list === "open" ? (v.match === "some" ? "names match" : "no name matches") : null,
    v.marked ? "the frame is marked" : null,
    v.view === "found" ? "the canvas shows the frame" : "the canvas shows another place",
  ]
    .filter(Boolean)
    .join(", ");

export const colors = { closed: "tan", open: "teal" };

const steps = {
  Open: () => "the viewer presses Find, or the key /: the list opens with all names",
  Type: (from, to) =>
    to.match === "some"
      ? "the viewer types: some names have the text"
      : "the viewer types: no name has the text",
  Take: () => "Enter, or a click on a name: the canvas shows the frame, and marks it",
  Close: () => "Escape, or Find again: the list closes",
  Pan: () => "the viewer pans or zooms: the mark ends",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
