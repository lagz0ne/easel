// The reader's words for ViewerCanvas.tla: the camera with the frame's place and shell, the frame, and the socket.
export const title = "Viewer: the canvas, one frame, while an agent works";

// The camera with the frame's place, in one region: the place decides whether its shell shows.
const camera = (v) => {
  if (v.gesture === "moving") {
    return v.hidden ? "Moving, shell hidden (far)" : "Moving, shell shows";
  }

  const where = {
    in: "At rest, frame in view",
    small: "At rest, frame in view under 30%",
    far: "At rest, frame far: shell hidden",
  };

  return where[v.zone];
};

const frame = (v) => {
  if (v.shown === "none") {
    return "No frame yet: the page says so";
  }

  if (v.shown === "gone") {
    return "Frame gone: the page says no frames";
  }

  if (v.top === "document") {
    return "Live document";
  }

  return v.live ? "Picture on top, document loading" : "Picture only";
};

// "down" and "reading" share one label: the page shows Reconnecting in both.
const socket = (v) => (v.conn === "up" ? "Connected" : "Status Reconnecting");

export const state = (v) => ({ Camera: camera(v), Frame: frame(v), Socket: socket(v) });

const readArrives = (from, to) => {
  if (to.shown === from.shown) {
    return "the board read arrives";
  }

  if (to.shown === "gone") {
    return "the board read arrives (the frame was deleted)";
  }

  return from.shown === "none"
    ? "the board read arrives (a new frame)"
    : "the board read arrives (a new version)";
};

const steps = {
  YouPanOrZoom: () => "you pan or zoom",
  YouPressFit: () => "you press Fit",
  TheCanvasRests: () => "the canvas rests",
  TheFrameGoesLive: () => "frames in view go live",
  TheFrameStopsBeingLive: () => "frames out of view stop",
  ItPaints: () => "the document paints (or 1.5 s pass)",
  AgentAddsTheFrame: () => "an agent adds the frame",
  AgentWritesTheFrame: () => "an agent writes the frame",
  AgentDeletesTheFrame: () => "an agent deletes the frame",
  TheSocketDrops: () => "the socket drops",
  TheSocketIsBack: () => "the socket is back",
  TheBoardReadArrives: readArrives,
};

export const step = (action, from, to) => steps[action](from, to);
