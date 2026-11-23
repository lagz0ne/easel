// The reader's words for ViewerCard.tla: the card of the Requests, docked at the right edge.
export const title = "viewer: the card of the Requests, docked at the right edge of the view";

const cards = {
  closed: "Card closed",
  list: "Card shows the list",
  thread: "Card shows one request",
};

export const group = (v) => v.card;

const drafts = {
  none: "no draft",
  typing: "a new request is typed by its pin",
};

export const state = (v) =>
  `${cards[v.card]}: ${drafts[v.draft]}, ${v.mode === "request" ? "request mode" : "view mode"}`;

export const colors = { closed: "tan", list: "teal", thread: "blue" };

const steps = {
  Toggle: (from) =>
    from.card === "closed"
      ? "the viewer presses Requests: the card opens"
      : "the viewer presses Requests: the card closes",
  PressPin: () => "the viewer presses a pin: its request opens in the card, and the canvas stays",
  PressRow: () => "the viewer presses a row: its request opens, and the canvas moves to its place",
  Back: () => "the viewer presses Back: the list again",
  Close: () => "the viewer presses Close: the card closes",
  Escape: (from) =>
    from.card === "thread" ? "Escape: the thread goes back to the list" : "Escape: the card closes",
  Pan: () => "the viewer pans or zooms: the canvas moves, and the card stays",
  Mode: (from) =>
    from.mode === "view"
      ? "the viewer presses Request: request mode"
      : "the viewer presses Request again: view mode",
  Place: () => "a click on a place: a draft by its pin",
  Cancel: () => "Escape in the draft: nothing is sent",
  Send: () => "Send: the request is saved, and it opens in the card",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
