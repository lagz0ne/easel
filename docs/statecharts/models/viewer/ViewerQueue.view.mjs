// The reader's words for ViewerQueue.tla: one comment on the server, and what the panel shows.
export const title = "Viewer: one comment in the Comments panel while agents work it";

// The same derivation as Shows() in the model; 2 is its MaxClaims.
const shows = (status, until, claims, expired) => {
  if (status === "done") {
    return "done";
  }

  if (until === "set" && !expired) {
    return "claimed";
  }

  return until === "set" && claims >= 2 ? "stuck" : "open";
};

const comment = {
  open: "Open",
  claimed: "Claimed, lease live",
  stuck: "Stuck: its last claim ran out",
  done: "Done",
};

const panel = {
  open: "Shows open",
  claimed: "Shows claimed by the agent",
  stuck: "Shows stuck",
  done: "Shows done, with the reply",
};

// While the socket is down the panel may be behind; one label covers what it shows then.
const panelNow = (v) =>
  v.conn === "up"
    ? panel[shows(v.tStatus, v.tUntil, v.tClaims, v.expired)]
    : "Status Reconnecting (may be behind)";

export const state = (v) => ({
  Comment: comment[shows(v.status, v.until, v.claims, v.expired)],
  Panel: panelNow(v),
});

const steps = {
  AgentClaims: () => "an agent claims it (easel next)",
  // No write: the server's time and the tab's clock capsule pass claimedUntil.
  TheLeaseRunsOut: (from, to) =>
    to.claims >= 2 ? "its last lease runs out" : "the lease runs out",
  AgentResolves: () => "the agent resolves it",
  AgentReleases: () => "the agent gives it back",
  TheSocketDrops: () => "the socket drops",
  TheSocketReconnects: () => "the socket is back, the board is read",
};

export const step = (action, from, to) => steps[action](from, to);
