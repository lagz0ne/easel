// The reader's words for ViewerGate.tla: the tab's page, the share link, and the browser.
export const title = "Viewer: open a share link, and the link ends";

const pages = {
  opening: "Opening the link",
  name: "Asks your name",
  password: "Asks the password",
  wait: "Alert: wait a minute",
  ended: "Page: this link has ended",
};

const page = (v) => {
  if (v.page !== "canvas") {
    return pages[v.page];
  }

  return v.conn === "up" ? "Canvas" : "Canvas, status Reconnecting";
};

const links = {
  open: "Link, no password",
  password: "Link with a password",
  unknown: "Unknown link",
  ended: "Link ended",
};

export const state = (v) => ({
  Page: page(v),
  Link: links[v.link],
  Browser: v.nameKept ? "Remembers your name" : "Has no name",
});

const groups = { ended: "ended", canvas: "in" };

export const group = (v) => groups[v.page] ?? "gate";
export const colors = { gate: "yellow", in: "teal", ended: "pink" };

const pressOpen = {
  ended: "you press Open",
  wait: "you press Open [after 5 wrong tries in a minute: slow]",
};

const reconnects = {
  ended: "the socket is back, its read is refused: ended",
  password: "the socket is back, its read is refused: locked",
  opening:
    "the socket is back, its read is refused: ended (your pass was the link's oldest past 1000), so the page opens the link again",
};

const steps = {
  // Opening a password link never answers slow: it shows the password page.
  YouOpenTheLink: () => "you open the link",
  YouGiveYourName: () => "you give your name",
  YouEnterTheRightPassword: (from, to) => pressOpen[to.page] ?? "you enter the right password",
  YouEnterAWrongPassword: (from, to) =>
    pressOpen[to.page] ?? "you enter a wrong password (alert: wrong)",
  AMinutePasses: () => "a minute passes",
  APasswordIsSet: () => "a user sets or changes the password (passes end)",
  TheLinkEnds: () => "a user unshares the canvas",
  // Hidden: it changes nothing the tab shows until its read starts again (on a reconnect).
  ThePassIsTrimmed: () => null,
  TheSocketDrops: () => "the socket drops",
  TheSocketReconnects: (from, to) => reconnects[to.page] ?? "the socket is back",
  // A reload shows only from the connected canvas and the ended page; from a gate page or while
  // reconnecting it is hidden, as it leads to the same "Opening the link".
  YouReload: (from) =>
    (from.page === "canvas" && from.conn === "up") || from.page === "ended" ? "you reload" : null,
};

export const step = (action, from, to) => steps[action](from, to);
