// Chart queue-lease (Queue.cfg): the life of comment 2, behind the older comment 1.
export const title = "queue: the life of comment 2, behind the older comment 1 (agents A and B)";

const AGENTS = ["A", "B"];
const C = 2;
const CAP = 2; // StuckAfter in Queue.cfg

const live = (v) => v.lease[C] === "live";
const stuck = (v) => v.status[C] === "open" && !live(v) && v.attempts[C] >= CAP;

// An agent still works on the comment, but its claim is no longer the live one.
const staleHolder = (v) =>
  AGENTS.some((a) => v.agent[a] === "working" && v.claim[a] === C && v.mine[a] === "out");

const base = (v) => {
  if (v.status[C] === "done") {
    return "Done";
  }

  if (live(v)) {
    return "Claimed";
  }

  if (stuck(v)) {
    return "Stuck";
  }

  return v.lease[C] === "out" ? "Lease ran out, shows open" : "Open";
};

export const state = (v) => {
  if (v.status[C] === "unposted") {
    return "Not posted";
  }

  const earlier = staleHolder(v) ? ", an earlier holder still works on it" : "";
  const kept = v.old === C ? ", its holder keeps an old handle too" : "";

  return base(v) + earlier + kept;
};

const active = (v) => (live(v) ? "claimed" : "open");

export const group = (v) => {
  if (v.status[C] === "done") {
    return "done";
  }

  return stuck(v) ? "stuck" : active(v);
};

export const colors = { open: "blue", claimed: "yellow", stuck: "orange", done: "teal" };

const steps = {
  ViewerPosts: () => "a viewer posts it",
  AgentTakes: (from, to) =>
    from.agent.A === "working" && to.old === C
      ? "the earlier holder runs next again and gets it, keeping its old handle"
      : "an agent runs next and gets it",
  AgentUsesTheOldHandle: () => "its holder uses the old handle: told lost",
  AgentExtends: () => "the holder extends it",
  LeaseRunsOut: (from, to) =>
    to.attempts[C] >= CAP ? "the lease runs out [its 2nd claim]" : "the lease runs out",
  AgentReleases: () => "the holder releases it",
  AgentResolves: () => "the holder resolves it",
  HandleToldDone: () => "the earlier holder is told done",
  HandleToldLost: () => "the earlier holder is told lost",
};

export const step = (action, from, to) => {
  const name = action.replace(/\(.*$/, "");

  return (steps[name] ?? (() => name))(from, to);
};
