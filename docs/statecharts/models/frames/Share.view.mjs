// The reader's words for Share.tla: a share link on one canvas, and one viewer's tab.
export const title = "frames: a share link on one canvas, and a viewer's tab";

const link = (v) => {
  if (v.gen === 0) {
    return "Not shared yet";
  }

  if (!v.live) {
    return "Link ended";
  }

  return v.pw === "none" ? "Shared, no password" : "Shared, with a password";
};

const tabs = {
  none: "No tab open",
  ended: "Page says the link has ended",
  open: "Canvas shows",
  wait: "Password page, alert says to wait",
  password: "Password page",
  wrong: "Password page",
};

export const state = (v) => ({ Link: link(v), "The viewer's tab": tabs[v.tab] });

const groups = { open: "open", ended: "ended", none: "none" };

export const group = (v) => groups[v.tab] ?? "locked";

export const colors = { open: "teal", locked: "yellow", ended: "pink", none: "tan" };

const typedTo = {
  ended: "the viewer types a password, after the link ended",
  wait: "the viewer types any password, after 5 wrong in a minute",
  password: "the viewer types a wrong password",
  wrong: "the viewer types a wrong password",
};

const typedOpen = (from, to) => {
  if (to.tab !== "open") {
    return typedTo[to.tab];
  }

  return "the viewer types the right password";
};

// From the wait alert, only a try after the minute passed gets past it.
const typed = (from, to) => {
  const label = typedOpen(from, to);

  return from.tab === "wait" && to.tab !== "wait" && to.tab !== "ended"
    ? `${label}, a minute later`
    : label;
};

const steps = {
  ShareNew: (from, to) =>
    to.pw === "none"
      ? "a user shares it (a new link)"
      : "a user shares it with a password (a new link)",
  ShareAgain: (from, to) =>
    to.pw === "none"
      ? "a user shares it again with no password (same link)"
      : "a user shares it again with a new password (same link, passes end)",
  Unshare: () => "a user unshares it (open tabs are told at once)",
  ViewerOpensTheLink: () => "the viewer opens the live link",
  ViewerOpensAnEndedLink: () => "the viewer opens the link they had, after it ended",
  ViewerTypesTheRightPassword: typed,
  ViewerTypesAWrongPassword: typed,
  // Hidden: another address's tries change nothing the viewer sees; that is the rule.
  OtherAddressGuessesWrong: () => null,
  // Hidden: a minute passing stays in one chart state.
  AMinutePasses: () => null,
  // Hidden from the password pages: closing there leads where closing the canvas leads.
  ViewerClosesTheTab: (from) =>
    from.tab === "open" || from.tab === "ended" ? "the viewer closes the tab" : null,
  TheModelStops: () => null,
};

export const step = (action, from, to) => steps[action](from, to);
