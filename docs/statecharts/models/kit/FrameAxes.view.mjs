// The reader's words for FrameAxes.tla: the locale and the data state of a canvas's frames.
export const title = "kit: a person picks the locale and the data state of the capsule frames";

/** A TLA+ tuple, as the generator gives it: an array, or an object keyed 1 and 2. */
const pair = (t) => (Array.isArray(t) ? t : Object.values(t));

const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const want = (v) => (v.offered.cap ? [v.locale, v.state] : ["en", "default"]);

const words = {
  away: "the capsule frame is not live",
  starting: "the capsule frame is live and has posted no axes yet",
  shows: "the capsule frame shows the picks",
  behind: "the capsule frame shows other axes than the picks",
};

export const state = (v) => `Version ${v.version}: ${words[group(v)]}`;

export const group = (v) => {
  if (!v.live.cap) return "away";
  if (!v.offered.cap) return "starting";
  return same(pair(v.docAxes.cap), want(v)) ? "shows" : "behind";
};

export const colors = { away: "tan", starting: "yellow", shows: "teal", behind: "blue" };

const name = (f) => (f === "cap" ? "the capsule frame" : "the other frame");

/** The frame whose `live` or document changed in the step. */
const moved = (from, to) =>
  from.live.cap !== to.live.cap || !same(pair(from.docAxes.cap), pair(to.docAxes.cap))
    ? "cap"
    : "plain";

const steps = {
  GoLive: (from, to) =>
    `${name(moved(from, to))} comes into view: the page composes it with the picks`,
  Offer: () => "the capsule frame gets its port and posts its axes",
  PickLocale: (from, to) => `the person picks ${to.locale === "vi" ? "Vietnamese" : "English"}`,
  PickState: (from, to) => `the person picks the data state ${to.state}`,
  Recompose: (from, to) => `the page composes ${name(moved(from, to))} again: a new scope`,
  NewVersion: () => "an agent puts version 2: it has no data state empty",
  Leave: (from, to) => `${name(moved(from, to))} leaves the view`,
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
