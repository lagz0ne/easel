export const title =
  "words: a live HTML frame shows the texts of the team in the pick, with a mark";

const triple = (t) => (Array.isArray(t) ? t : Object.values(t));

const want = (v) => [v.version, v.rev, v.pick];

const same = (a, b) => a.every((x, i) => x === b[i]);

const words = {
  away: "the frame with a text key is not live",
  english: "the frame shows its texts in English, with no mark",
  marked: "the frame shows Vietnamese, and marks the texts with no translation",
  behind: "the frame shows another version or another pick",
  stale: "the frame shows the texts of an older revision",
};

export const group = (v) => {
  if (!v.live.keyed) return "away";
  const doc = triple(v.doc.keyed);
  if (doc[0] !== v.version || doc[2] !== v.pick) return "behind";
  if (doc[1] !== v.rev) return "stale";
  return doc[2] === "vi" ? "marked" : "english";
};

const told = (v) => {
  const marks = [
    ...(Array.isArray(v.marked.keyed) ? v.marked.keyed : Object.values(v.marked.keyed)),
  ];
  return marks.includes("k") ? "the text key and the own text" : "the own text only";
};

export const state = (v) => {
  const head = `Version ${v.version}, texts revision ${v.rev}, ${v.pick === "vi" ? "Vietnamese" : "English"} picked`;
  const g = group(v);
  return g === "marked"
    ? `${head}: the frame shows Vietnamese and marks ${told(v)}`
    : `${head}: ${words[g]}`;
};

export const colors = {
  away: "tan",
  english: "teal",
  marked: "yellow",
  behind: "blue",
  stale: "purple",
};

const name = (f) => (f === "keyed" ? "the frame with a text key" : "the frame with no text key");

const moved = (from, to) =>
  from.live.keyed !== to.live.keyed || !same(triple(from.doc.keyed), triple(to.doc.keyed))
    ? "keyed"
    : "plain";

const steps = {
  GoLive: (from, to) => `${name(moved(from, to))} comes into view: the page composes it`,
  Recompose: (from, to) => `the page composes ${name(moved(from, to))} again`,
  Leave: (from, to) => `${name(moved(from, to))} leaves the view`,
  PickLocale: (_from, to) => `the person picks ${to.pick === "vi" ? "Vietnamese" : "English"}`,
  SetTexts: () => "an agent gives the vi text of the text key (texts.set)",
  NewVersion: () => "an agent puts version 2",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
