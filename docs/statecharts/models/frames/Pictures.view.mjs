// The reader's words for Pictures.tla: a viewer's tab asks for a frame's picture while an agent
// writes the frame, deletes it, or ends the link.
export const title = "frames: a viewer's picture while an agent writes, deletes, or ends the link";

const requests = {
  redirected: "Redirected to the current address",
  drawing: "Drawing that version's document",
  sent: "Picture sent, kept by this browser only",
};

const asking = (v) =>
  v.asked < v.version ? "The server gets an old address" : "The server gets the current address";

const resting = (v) => {
  if (!v.live || v.ended) {
    return "Frame deleted or link ended";
  }

  return v.board < v.version ? "The tab holds an old address" : "The tab holds the current address";
};

export const state = (v) => {
  if (v.req === "asked") {
    return asking(v);
  }

  return requests[v.req] ?? resting(v);
};

export const group = (v) => {
  if (v.req !== "idle") {
    return v.req === "sent" ? "sent" : "asking";
  }

  return !v.live || v.ended ? "gone" : "rest";
};

export const colors = { rest: "blue", asking: "yellow", sent: "teal", gone: "purple" };

const notFound = "the server answers 404 [frame deleted or link ended]";

const lookUp = {
  idle: notFound,
  redirected: "the server redirects to the current version",
  drawing: "the server takes that version's document",
};

const steps = {
  BoardCatchesUp: () => "the board shows the current address",
  // Showing this browser's own kept copy stays in one chart state, so it draws no arrow.
  Ask: () => "the tab asks for its address",
  LookUp: (from, to) => lookUp[to.req],
  // Hidden: a redirect to an address this browser already keeps ends where "the tab shows it" ends.
  FollowRedirect: (from, to) => (to.req === "asked" ? "the browser follows it" : null),
  Answer: (from, to) =>
    to.req === "sent" ? "the picture goes out, private and immutable" : notFound,
  Shown: () => "the tab shows it",
  // Hidden while a request is out: the request's own arrows show what a newer version does.
  Write: (from) => (from.req === "idle" ? "an agent writes the frame" : null),
  Delete: () => "an agent deletes the frame",
  EndLink: () => "the link ends (unshare or a new password)",
  // Hidden: a second browser with no copy acts as the first one did before it kept any.
  NewBrowser: () => null,
  Done: () => null,
};

export const step = (action, from, to) => steps[action](from, to);
