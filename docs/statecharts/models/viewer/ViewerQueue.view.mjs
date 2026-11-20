// The reader's words for ViewerQueue.tla: one request on the server, and what the panel shows.
export const title =
  "Viewer: one request in the Requests panel while agents and viewers work on it";

// The same derivation as Shows() in the model; 2 is its Cap.
const shows = (status, until, tries, expired) => {
  if (status !== "open") {
    return status;
  }

  if (until === "set" && !expired) {
    return "inWork";
  }

  return tries >= 2 ? "needsPerson" : "waiting";
};

const request = {
  waiting: "Waiting",
  inWork: "In work, lease live",
  needsPerson: "Needs a person: no outcome after 2 tries",
  asking: "Question for a viewer",
  resolved: "Result to check",
  accepted: "Accepted",
  person: "Needs a person: declined",
  closed: "Closed",
};

const panel = {
  waiting: "Shows waiting",
  inWork: "Shows in work, with the agent name",
  needsPerson: "Shows needs a person, counted for a viewer",
  asking: "Shows the question, counted for a viewer",
  resolved: "Shows the result, counted for a viewer",
  accepted: "Shows accepted, in the Done group",
  person: "Shows needs a person, with the reason, counted for a viewer",
  closed: "Shows closed, in the Done group",
};

// While the socket is down the panel may be behind; one label covers what it shows then.
const panelNow = (v) =>
  v.conn === "up"
    ? panel[shows(v.tStatus, v.tUntil, v.tTries, v.expired)]
    : "Status Reconnecting (may be behind)";

export const state = (v) => ({
  Request: request[shows(v.status, v.until, v.tries, v.expired)],
  Panel: panelNow(v),
  Mark: v.seen ? "No mark" : "Marked changed",
});

const outcomes = {
  resolved: "the agent resolves it",
  asking: "the agent asks a question",
  person: "the agent declines it",
};

const steps = {
  AgentClaims: () => "an agent claims it (easel next)",
  // No write: the server's time and the tab's clock capsule pass claimedUntil.
  TheLeaseRunsOut: () => "the lease runs out",
  AgentReleases: () => "the agent releases it",
  Outcome: (from, to) => outcomes[to.status],
  AViewerEdits: () => "a viewer edits it",
  AViewerAnswers: () => "a viewer answers",
  AViewerAccepts: () => "a viewer accepts the result",
  AViewerReopens: () => "a viewer opens it again",
  // In work (a live lease), a close is the viewer who takes the request back (E4.1 N9).
  AViewerCloses: (from) =>
    from.status === "open" && from.until === "set" && !from.expired
      ? "a viewer takes it back"
      : "a viewer closes it",
  YouOpenIt: () => "you open it",
  TheSocketDrops: () => "the socket drops",
  TheSocketReconnects: () => "the socket is back, the board is read",
};

export const step = (action, from, to) => steps[action.replace(/\(.*$/, "")](from, to);
