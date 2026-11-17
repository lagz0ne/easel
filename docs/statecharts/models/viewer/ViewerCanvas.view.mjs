// The reader's words for ViewerCanvas.tla: the gesture, one frame, and the socket.
export const title = "Viewer: the canvas, one frame, while an agent works";

const gesture = (v) => {
  if (v.gesture === "moving") {
    return "Moving";
  }

  return v.inView ? "At rest, frame in view" : "At rest, frame out of view";
};

const frame = (v) => {
  if (v.shown === "gone") {
    return "Frame gone";
  }

  if (v.top === "document") {
    return "Live document";
  }

  return v.live ? "Picture on top, document loading" : "Picture only";
};

// "down" and "reading" share one label: the page shows Reconnecting in both.
const socket = (v) => (v.conn === "up" ? "Connected" : "Status Reconnecting");

export const state = (v) => ({ Gesture: gesture(v), Frame: frame(v), Socket: socket(v) });

const readArrives = (from, to) => {
  if (to.shown === from.shown) {
    return "the board read arrives";
  }

  return to.shown === "gone"
    ? "the board read arrives (the frame was deleted)"
    : "the board read arrives (a new version)";
};

const steps = {
  YouPanOrZoom: () => "you pan or zoom",
  TheCanvasRests: () => "the canvas rests",
  TheFrameGoesLive: () => "frames in view go live",
  TheFrameStopsBeingLive: () => "frames out of view stop",
  ItPaints: () => "the document paints (or 1.5 s pass)",
  AgentWritesTheFrame: () => "an agent writes the frame",
  AgentDeletesTheFrame: () => "an agent deletes the frame",
  TheSocketDrops: () => "the socket drops",
  TheSocketIsBack: () => "the socket is back",
  TheBoardReadArrives: readArrives,
};

export const step = (action, from, to) => steps[action](from, to);
