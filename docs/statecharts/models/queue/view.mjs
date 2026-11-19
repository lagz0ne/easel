// Chart queue-lease (Queue.cfg): the life of request 2, behind the older request 1.
export const title = "queue: the life of request 2, behind the older request 1 (agents A and B)";

const AGENTS = ["A", "B"];
const R = 2;
const CAP = 2; // NeedsPersonAfter in Queue.cfg

const live = (v) => v.lease[R] === "live";
const person = (v) => v.status[R] === "open" && !live(v) && v.tries[R] >= CAP;

// An agent still works on the request, but its claim is no longer the live one.
const staleHolder = (v) =>
  AGENTS.some((a) => v.agent[a] === "working" && v.claim[a] === R && v.mine[a] === "out");

const base = (v) => {
  if (v.status[R] === "out") {
    return "Out of the queue: a result, a question or a decline";
  }

  if (live(v)) {
    return v.tries[R] > 1 ? "In work, 2nd try" : "In work";
  }

  if (person(v)) {
    return "Needs a person";
  }

  const once = v.tries[R] > 0 ? ", tried once" : "";

  return (v.lease[R] === "out" ? "Lease ran out, shows waiting" : "Waiting") + once;
};

export const state = (v) => {
  if (v.status[R] === "unposted") {
    return "Not posted";
  }

  const earlier = staleHolder(v) ? ", an earlier holder still works on it" : "";
  const kept = v.old === R ? ", its holder keeps an old handle too" : "";

  return base(v) + earlier + kept;
};

const active = (v) => (live(v) ? "inWork" : "waiting");

export const group = (v) => {
  if (v.status[R] === "out") {
    return "out";
  }

  return person(v) ? "person" : active(v);
};

export const colors = { waiting: "blue", inWork: "yellow", person: "orange", out: "teal" };

const steps = {
  ViewerPosts: () => "a viewer posts it",
  AgentTakes: (from, to) =>
    from.agent.A === "working" && to.old === R
      ? "the earlier holder runs next again and gets it, keeping its old handle"
      : "an agent runs next and gets it",
  AgentUsesTheOldHandle: () => "its holder uses the old handle: told lost",
  AgentExtends: () => "the holder extends it",
  LeaseRunsOut: () => "the lease runs out",
  AgentReleases: () => "the holder releases it",
  AgentEndsTheTry: () => "the holder resolves, asks or declines",
  HandleToldWrongState: () => "the earlier holder is told wrongState",
  HandleToldLost: () => "the earlier holder is told lost",
};

export const step = (action, from, to) => {
  const name = action.replace(/\(.*$/, "");

  return (steps[name] ?? (() => name))(from, to);
};
