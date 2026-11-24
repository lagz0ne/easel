export const title = "viewer: a person drops or pastes an image on the canvas";

const places = {
  drop: "at the place of the drop",
  paste: "at the place of the paste",
  text: "from the paste in the text field",
};

const says = {
  refused: "says only an image of 10 MB at most goes",
  wait: "says to wait for the image that goes",
  lost: "says the image did not go",
};

export const state = (v) => {
  if (v.who === "viewer") return "A share link: the canvas takes no image";
  return [
    v.going === "none" ? "The canvas" : `An image goes ${places[v.going]}`,
    v.over ? "shows the hint for the drop" : null,
    says[v.told] ?? null,
    v.made === "none" ? null : `a frame ${places[v.made]}`,
  ]
    .filter(Boolean)
    .join(", ");
};

export const group = (v) => {
  if (v.who === "viewer") return "viewer";
  if (v.going === "text" || v.made === "text") return "wrong";
  return v.going === "none" ? "canvas" : "going";
};

export const colors = { viewer: "tan", canvas: "blue", going: "yellow", wrong: "pink" };

const steps = {
  FileIn: "a file comes over the canvas",
  FileOut: "the file goes off the canvas",
  Drop: (from, to) =>
    to.told === "refused" && from.going === "none"
      ? "a drop of another file, or over 10 MB"
      : to.told === "wait"
        ? "a drop while an image goes"
        : "a drop of an image",
  PasteOnCanvas: (from, to) =>
    to.told === "refused" && from.going === "none"
      ? "a paste of another file"
      : to.told === "wait"
        ? "a paste while an image goes"
        : "a paste of an image on the canvas",
  PasteInText: "a paste in a text field: the canvas takes it",
  Created: "put answers created",
  Refused: "put answers badImage or tooBig",
  Lost: "the socket is lost",
  ViewerDrop: null,
};

export const step = (action, from, to) => {
  const words = steps[action.replace(/\(.*$/, "")];
  if (words === undefined) throw new Error(`no words for the step ${action}`);
  return typeof words === "function" ? words(from, to) : words;
};
