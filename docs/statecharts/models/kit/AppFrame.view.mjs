// The reader's words for AppFrame.tla: the life of one app frame in one tab.
export const title = "kit: an app frame goes live, gets a new look, closes, and goes";

const look = (v) => (v.kit === 1 ? "the first look" : "a new look");

const shows = (v) => {
  if (v.docKit === 0) return "";
  return v.docKit < v.kit ? ", it shows an older look" : ", it shows the look";
};

const port = (v) => (v.port ? "with a port" : "with no port yet");
const loop = (v) => (v.busy === "now" ? "; it runs a long loop" : "");
const page = (v) => (v.listens ? "" : "; the page does not listen yet");

const life = (v) => {
  if (v.frame === "none") return "No iframe yet";
  if (v.frame === "live") return `The app is live, ${port(v)}${shows(v)}`;

  if (v.frame === "closing" && v.app === "closed") return "The app closed and posted closed";
  if (v.frame === "closing") return "The page posted close and waits (200 ms at most)";

  if (v.app === "closed") return "The iframe is gone, after the app closed";
  if (v.busy === "now") return "The iframe is gone after the wait: the app did not answer";
  return "The iframe is gone, and the app's ends did not run";
};

export const state = (v) => `${life(v)} (${look(v)})${loop(v)}${page(v)}`;

/** The iframe went while the app was still mounted and could answer: its ends never ran. */
const lost = (v) => v.frame === "removed" && v.app === "mounted" && v.busy !== "now";

export const group = (v) => {
  if (lost(v)) return "lost";
  if (v.frame === "removed") return "gone";
  if (v.frame === "closing") return "closing";
  return v.frame === "live" ? "live" : "first";
};

export const colors = {
  first: "tan",
  live: "blue",
  closing: "yellow",
  gone: "teal",
  lost: "orange",
};

const steps = {
  PageListens: () => "the page listens for hellos",
  GoLive: () => "the frame goes live: its app mounts and says hello",
  HelloAgain: () => "the app says hello again (50 ms); the page gives it a port and the kit",
  NewLook: () => "a user changes the look; the page sends it on the port",
  Loop: () => "the app starts a long loop",
  LoopEnds: () => "the loop ends",
  Leave: (from, to) =>
    to.frame === "closing"
      ? "the frame leaves the view, is deleted or replaced: the page posts close"
      : "the frame leaves the view: the page removes the iframe at once, with no close",
  AppCloses: () => "the app gets close: scope.close() runs its ends",
  Remove: () => "the page gets closed and removes the iframe",
  WaitEnds: () => "200 ms with no closed: the page removes the iframe",
  Done: () => null,
};

export const step = (action, from, to) => steps[action.replace(/\(.*$/, "")](from, to);
