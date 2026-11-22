// The reader's words for KitRuntime.tla: the runtime of a kit version, an update of easel, and an
// accept by the team.
export const title = "kit: a team accepts the runtime of an update of easel";

const seq = (s) => (Array.isArray(s) ? s : Object.values(s ?? {}));
const rt = (v, k) => (k === 0 ? 0 : seq(v.kits)[k - 1]);
const current = (v) => seq(v.kits).at(-1);

const words = {
  none: "no app frame yet",
  same: "the frame shows the runtime of this easel",
  older: "the frame shows an older runtime; the kit keeps it",
  waits: "the kit has the runtime of this easel; the frame waits for a put",
};

export const group = (v) => {
  if (v.frame === 0) return "none";
  if (rt(v, v.frame) === v.easel) return "same";
  return current(v) === v.easel ? "waits" : "older";
};

export const state = (v) => words[group(v)];

export const colors = { none: "tan", same: "teal", older: "yellow", waits: "blue" };

const steps = {
  Update: () => "an update of easel: it runs another runtime",
  Put: (from, to) =>
    to.saved > from.saved
      ? "an agent puts the frame: a new version"
      : "an agent puts the same frame: nothing is written",
  Look: () => "a change of the look: the next kit version keeps the runtime",
  Accept: () => "the team accepts the runtime of this easel: the next kit version",
  AcceptUnchanged: () => "the team accepts: the kit has it already, nothing is written",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
