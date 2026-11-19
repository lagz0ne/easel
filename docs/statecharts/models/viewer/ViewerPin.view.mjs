// The reader's words for ViewerPin.tla (ViewerPinPost.cfg and ViewerPinLink.cfg): one request.
// ViewerPinPost.view.mjs gives the same words under its own title.
export const title =
  "Viewer: ask for a change while the link ends, its password changes, or the frame changes";

const endedTexts = {
  "not sent": ", your text kept: not sent",
  unknown: ", your text kept: not known if it saved",
  none: "",
};

const refusedPages = { ended: "Ended page", password: "Password page" };

const closed = (v) => {
  if (v.closedBy === "send") {
    return v.frame === "there"
      ? "Pin Request #n shows"
      : "Frame gone with its pin, the request stays in the panel";
  }

  return "Request off";
};

const notes = {
  refused: "Textbox kept: not saved (full or slow), Send again",
  gone: "Textbox kept: not saved, the frame is gone",
};

const typing = (v) => notes[v.note] ?? "Textbox open";

const pins = {
  off: closed,
  placing: () => "Request mode: click a frame",
  typing,
  sending: () => "Sending",
  unsure: () => "Textbox kept, no Cancel: not known yet if it saved",
};

export const state = (v) => {
  if (v.page !== "canvas") {
    return refusedPages[v.page] + endedTexts[v.endText];
  }

  const down = v.conn === "down" && v.pin !== "off" && v.pin !== "placing";

  return pins[v.pin](v) + (down ? ", status Reconnecting" : "");
};

const groups = { off: "idle" };

const pageGroups = { ended: "ended", password: "locked" };

export const group = (v) => pageGroups[v.page] ?? groups[v.pin] ?? "draft";
export const colors = { idle: "teal", draft: "blue", ended: "pink", locked: "yellow" };

const refusals = {
  ended: "the call is refused [the link ended]",
  password: "the call is refused [a new password ended the pass]",
};

const pushed = {
  ended: "the pushed refusal arrives [the link ended]",
  password: "the pushed refusal arrives [a new password ended the pass]",
};

const answer = (from, to) => {
  if (to.page !== "canvas") {
    return refusals[to.page];
  }

  if (to.note === "gone") {
    return "Send answers gone [the frame was removed]";
  }

  return from.pin === "unsure"
    ? "the tab sends it again with its key: added"
    : "Send answers added";
};

const steps = {
  YouPressRequest: () => "you press Request",
  YouClickOnTheFrame: () => "you click a place on the frame",
  YouCancel: () => "you press Escape or Cancel",
  YouSend: () => "you press Send",
  TheServerAnswers: answer,
  TheServerAnswersFull: (from) =>
    from.pin === "unsure" ? "the tab sends it again: full or slow" : "Send answers full or slow",
  TheServerFails: () => "the server fails",
  TheServerSavesThenTheSocketDrops: () => "the server saves it, then the socket drops",
  TheSocketDrops: () => "the socket drops",
  TheSocketReconnects: (from, to) =>
    to.page === "canvas" ? "the socket is back" : "the socket is back, its read is refused",
  AgentUpdatesTheFrame: () => "an agent writes the frame",
  AgentDeletesTheFrame: () => "an agent removes the frame",
  TheLinkEnds: () => "a user unshares the canvas",
  APasswordIsSet: () => "a user sets or changes the password",
  TheRefusalArrives: (from, to) => pushed[to.page],
  Ended: () => "nothing more happens",
  Closed: () => "nothing more happens",
};

export const step = (action, from, to) => steps[action](from, to);
