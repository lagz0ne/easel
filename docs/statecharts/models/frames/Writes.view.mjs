// The reader's words for Writes.tla: one canvas, one frame, two agents writing it.
export const title = "frames: a canvas, its frame, and two agents writing it";

const AGENTS = ["A", "B"];

const pendingCount = (v) => AGENTS.filter((a) => v.pending[a]).length;

const waiting = (v) => AGENTS.filter((a) => v.wants[a] !== "-").length;

const holdsOld = (v) => AGENTS.some((a) => v.base[a] !== 0 && v.base[a] !== v.version);

const setup = (v) => {
  if (v.canvas === "none") {
    return "No canvas";
  }

  if (v.canvas === "deleted") {
    return "Canvas deleted, with its frames";
  }

  return { none: "Canvas, no frame yet", deleted: "Frame deleted" }[v.frame];
};

const saving = ["", "Saved, the board not yet updated", "Two saves, the board not yet updated"];

export const state = (v) => {
  const before = setup(v);

  if (before) {
    return before;
  }

  const pending = pendingCount(v);
  const rest =
    pending > 0
      ? saving[pending]
      : holdsOld(v)
        ? "Frame live, an agent holds an old version"
        : "Frame live, agents up to date";

  // Only the two-step save (WritesTwoStep.cfg) has a checked put whose write is to come.
  const checked = [
    "",
    ", one put checked, its write to come",
    ", two puts checked, writes to come",
  ];

  return rest + checked[waiting(v)];
};

export const group = (v) => {
  if (v.canvas === "deleted" || v.frame === "deleted") {
    return "gone";
  }

  if (v.canvas === "none" || v.frame === "none") {
    return "setup";
  }

  return pendingCount(v) > 0 || waiting(v) > 0 ? "writing" : "live";
};

export const colors = { setup: "tan", live: "blue", writing: "yellow", gone: "purple" };

// A put that answers gone stays on "Frame deleted", and a put of the same document changes
// nothing, so neither draws an arrow. Done (the end state's step) is hidden.
const steps = {
  MakeCanvas: "an agent makes the canvas",
  MakeFrame: "an agent puts a new frame",
  GetFrame: "the agent gets the frame again",
  PutGone: "a put answers gone, nothing written",
  PutStale: "a put on an old version answers stale, nothing written",
  PutUnchanged: null,
  PutSaves: "a put on the current version saves a new document",
  PutWritesLater: "the checked put writes, without looking again",
  SetCell: "the board shows the stored version",
  DeleteFrame: "an agent deletes the frame",
  DeleteCanvas: "an agent deletes the canvas",
  Done: null,
};

export const step = (action, from, to) => {
  const name = action.replace(/\(.*$/, "");
  const checks = name === "PutSaves" && to.version === from.version;

  return checks ? "a put on the current version checks, its write to come" : steps[name];
};
