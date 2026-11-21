// The reader's words for Kit.tla: the look and the kit of one easel, and their kit versions.
export const title = "kit: the look and the kit, their kit versions, and what a viewer saw";

const len = (h) => (Array.isArray(h) ? h.length : Object.keys(h).length);
const first = (h) => (Array.isArray(h) ? h[0] : h[1]);
const isLook = (v) => "U" in v.base;

const tab = (v) =>
  v.shown === 0
    ? "no tab open yet"
    : v.shown < len(v.hist)
      ? "a tab shows an older kit version"
      : "each tab shows it";

const writers = (v) => {
  const bases = Object.values(v.base);
  const rev = isLook(v) ? v.lookRev : v.pieceRev;

  if (bases.some((b) => b !== 0 && b !== rev)) return ", a writer holds an old revision";
  return "";
};

export const state = (v) => {
  const n = len(v.hist);
  const head = n === 1 ? "The first look and kit (kit version 1)" : `Kit version ${n}`;
  const what =
    v.prevLook === "-"
      ? ""
      : v.look === first(v.hist).look
        ? ", the first look again"
        : ", a new look";
  const asked =
    v.asked === 0
      ? ""
      : v.asked < n
        ? "; a request keeps an older kit version"
        : "; a request keeps this kit version";

  return `${head}${what}: ${tab(v)}${writers(v)}${asked}`;
};

export const group = (v) => {
  if (v.asked !== 0) return "asked";
  if (v.shown !== 0 && v.shown < len(v.hist)) return "behind";
  return len(v.hist) === 1 ? "first" : "changed";
};

export const colors = { first: "tan", changed: "blue", behind: "yellow", asked: "teal" };

const steps = {
  Read: () => "a writer reads the current revision",
  PutPiece: () => "an agent changes the piece on the revision it read",
  PutStale: () => "a change on an old revision answers stale, nothing written",
  SetLook: () => "a user changes the look (WCAG AA holds)",
  SetLookUnreadable: () => null,
  Undo: () => "a user goes back one step",
  TabShows: () => "each live frame shows the new kit version, no reload",
  Ask: () => "a viewer asks; the request keeps this kit version",
  Done: () => null,
};

export const step = (action) => steps[action.replace(/\(.*$/, "")]();
