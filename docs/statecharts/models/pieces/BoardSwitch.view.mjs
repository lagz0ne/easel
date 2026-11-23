export const title = "pieces: the theme switch of the board and of one frame, and a reload";

const shows = (v, f) => (v.own[f] === "none" ? v.board : v.own[f]);

const takes = (v, f) => {
  const value = v.own[f] === "none" ? "the board value" : "its own value";
  const draw = v.pending.includes(f) ? "draws again" : "drawn";

  return `${value} ${shows(v, f)}, ${draw}`;
};

export const state = (v) => ({
  "The board": `Board ${v.board}`,
  "Frame x (y is the same)": takes(v, "x"),
  "Frame z, no switch": v.pending.includes("z") ? "draws again" : "drawn",
});

const steps = {
  ABoardPick: (_from, to) => `a pick of ${to.board} in the dock`,
  AFramePick: () => "a pick in the controls of the frame",
  UseTheBoard: () => "Use the board",
  AFrameDraws: () => "the frame draws in a new scope",
  AReload: () => "a reload",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);

  return run(from, to);
};
