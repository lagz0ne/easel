export const title =
  "viewer: one screenshot on a request, pasted or taken from a part of its frame";

export const group = (v) =>
  v.draft === "none" ? (v.saved === "no request" ? "idle" : "saved") : "draft";

const shots = { none: "no screenshot", image: "a pasted image", region: "a part of the frame" };

const saved = {
  none: "with no screenshot",
  image: "with the pasted image",
  region: "with the part of the frame",
};

export const state = (v) => {
  if (v.draft === "none") {
    return v.saved === "no request" ? "No textbox" : `Request #n saved, ${saved[v.saved]}`;
  }

  return [
    v.draft === "sending" ? "Sending" : "Textbox open",
    v.onFrame ? "on a frame" : "on the canvas",
    v.picking ? "drag a box on the frame" : null,
    shots[v.shot],
    v.told === "refused" ? "says the screenshot was refused" : null,
  ]
    .filter(Boolean)
    .join(", ");
};

export const colors = { idle: "tan", draft: "blue", saved: "teal" };

const steps = {
  Open: (from, to) => (to.onFrame ? "a click on a frame" : "a click on the canvas"),
  PasteImage: (from) =>
    from.shot === "none"
      ? "a paste of an image"
      : "a paste of an image: it replaces the screenshot",
  PasteRefused: () => "a paste of another file, or an image over 10 MiB: refused",
  StartPick: () => "you press Take a part",
  Pick: (from) =>
    from.shot === "none"
      ? "you drag a box on the frame"
      : "you drag a box: it replaces the screenshot",
  EndPick: () => "you press Escape: the pick ends, the text stays",
  Remove: () => "you remove the screenshot",
  Send: () => "you press Send",
  Added: () => "Send answers added",
  Refused: () => "the server refuses the image: the text stays",
  Cancel: () => "you press Escape or Cancel",
  Done: () => "nothing more",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
