export const title = "pieces: a change of the design system reaches the frames that depend on it";

const puts = (v) => {
  if (v.put === "none") return `Kit ${v.kit}, no design.put`;

  return v.put === v.shape
    ? `Kit ${v.kit}, a design.put that keeps C`
    : `Kit ${v.kit}, a design.put that changes C`;
};

const drawn = (v, f) => {
  if (v.next[f] !== 0) return "a new document loads";

  return v.doc[f] === v.kit ? "draws the current kit" : "draws its last good document";
};

const frame = (v, f) => {
  const typed = v.code[f] === v.shape ? "no type error" : "a type error";

  return `${v.status[f]}, ${typed}, ${drawn(v, f)}`;
};

export const state = (v) => ({
  "The design system": puts(v),
  "Frame r, on C": frame(v, "r"),
  "Frame e, on C": frame(v, "e"),
  "Frame o, not on C": `draws Kit ${v.doc.o}${v.next.o === 0 ? "" : ", a new document loads"}`,
});

const steps = {
  ADesignPutStarts: (_from, to) =>
    to.put === to.shape
      ? "an agent sends a folder that keeps C: easel checks it"
      : "an agent sends a folder that changes C: easel checks it",
  TheDesignPutBreaks: () => "a ready frame has a type error: breaks, nothing is written",
  TheDesignPutChecksAgain: () => "a frame changed after the check: easel checks again",
  TheDesignPutWrites: () => "the write: a new kit version",
  AFramePut: () => "a frame put with no type error",
  AnAgentMarksTheFrameReady: () => "an agent marks the frame ready",
  AnAgentMarksTheFrameExploring: () => "an agent marks the frame exploring",
  TheNewDocumentDraws: () => "the new iframe draws, the old one goes",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);

  return run(from, to);
};
