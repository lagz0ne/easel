export const title = "frames: two agents change exact places from what each read";

const agentA = { idle: null, read: "A read", done: "A is done" };
const agentB = { idle: null, read: "B read", done: "B is done" };

const old = (v, who) =>
  v[who] === "read" && v[`${who}Rev`] !== v.rev ? `${who.toUpperCase()} holds an old read` : null;

export const state = (v) => {
  const d = v.wd === 2 ? "d is wide" : "d";
  const e = v.ex === 0 ? "no e" : `e at x ${v.ex}`;
  const touch = v.ex !== 0 && v.ex < v.wd + 1 ? "d touches e" : null;
  return [`${d}, ${e}`, touch, agentA[v.a], old(v, "a"), agentB[v.b], old(v, "b")]
    .filter(Boolean)
    .join("; ");
};

export const group = (v) => {
  if (v.ex !== 0 && v.ex < v.wd + 1) return "touch";
  if (v.a === "done" && v.b === "done") return "done";
  return v.a === "read" || v.b === "read" ? "read" : "start";
};

export const colors = { start: "tan", read: "blue", done: "teal", touch: "pink" };

const steps = {
  ReadA: "A reads the page",
  PutE: (from) => `A puts e at x ${from.aSaw + 1}, right of d as A read it`,
  RefuseA: "the revision changed: A is refused, and reads again",
  ReadB: "B reads the page",
  GrowD: "B makes d wider, clear of e as B read it",
  KeepD: "B reads that a wider d touches e: B keeps d",
  RefuseB: "the revision changed: B is refused, and reads again",
  Done: null,
};

export const step = (action, from, to) => {
  const words = steps[action.replace(/\(.*$/, "")];
  if (words === undefined) throw new Error(`no words for the step ${action}`);
  return typeof words === "function" ? words(from, to) : words;
};
