// Chart queue-two-step (QueueTwoStep.cfg): EXPECTED TO BREAK. next picks, awaits, then
// writes its claim without looking again. The chart follows request 1, where the race is.
export const title =
  "queue, if next picked then wrote in two steps (expected to break): the life of request 1";

const AGENTS = ["A", "B"];
const C = 1;
const CAP = 2; // NeedsPersonAfter in QueueTwoStep.cfg

const live = (v) => v.lease[C] === "live";

const holders = (v) =>
  AGENTS.filter((a) => v.agent[a] === "working" && v.claim[a] === C && v.mine[a] === "live");

const pickers = (v, c) => AGENTS.filter((a) => v.agent[a] === "picked" && v.claim[a] === c);

const staleHolder = (v) =>
  AGENTS.some((a) => v.agent[a] === "working" && v.claim[a] === C && v.mine[a] === "out");

const pastCap = (v, over, under) => (v.tries[C] > CAP ? over : under);

const notHeld = (v) => {
  if (v.tries[C] >= CAP) {
    return v.noOutcome[C] >= CAP ? "Needs a person" : "Needs a person, though one try is live";
  }

  return v.lease[C] === "out" ? "Lease ran out, shows waiting" : "Waiting";
};

const held = (v) => {
  if (holders(v).length > 1) {
    return pastCap(v, "Two agents hold it, past the cap", "Two agents both hold it");
  }

  return live(v) ? pastCap(v, "In work past the cap", "In work") : notHeld(v);
};

const stored = { unposted: "Not posted", out: "Out of the queue" };

const picked = [
  "",
  "an agent picked it, claim not written",
  "both agents picked it, claims not written",
];

export const state = (v) =>
  [
    stored[v.status[C]] ?? held(v),
    picked[pickers(v, C).length],
    staleHolder(v) && "an earlier holder still works on it",
    pickers(v, 3 - C).length > 0 && "an agent picked request 2",
    v.lease[3 - C] === "live" && "request 2 in work",
  ]
    .filter(Boolean)
    .join(", ");

const active = (v) => (live(v) ? "inWork" : "waiting");

export const group = (v) => {
  if (v.status[C] === "out") {
    return "out";
  }

  return v.status[C] === "open" && !live(v) && v.tries[C] >= CAP ? "person" : active(v);
};

export const colors = { waiting: "blue", inWork: "yellow", person: "orange", out: "teal" };

const onOther = (from, to) => {
  const mover = AGENTS.find((a) => from.agent[a] !== to.agent[a]);

  return mover !== undefined && (from.claim[mover] === 3 - C || to.claim[mover] === 3 - C);
};

const either = (other, two, one) => (other ? two : one);

const steps = {
  ViewerPosts: (from, to) =>
    either(to.status[C] === from.status[C], "a viewer posts request 2", "a viewer posts it"),
  AgentPicks: (from, to) =>
    either(onOther(from, to), "an agent finds request 2 oldest", "an agent finds it oldest"),
  AgentWritesPick: (from, to) =>
    either(
      onOther(from, to),
      "that agent writes its claim on request 2",
      "that agent writes its claim",
    ),
  AgentTakes: () => "an agent runs next and gets it",
  LeaseRunsOut: () => "the lease runs out",
  AgentReleases: () => "the holder releases it",
  AgentEndsTheTry: () => "the holder resolves, asks or declines",
  HandleToldWrongState: () => "the earlier holder is told wrongState",
  HandleToldLost: () => "an agent is told lost",
  AgentWaits: () => "an agent finds nothing and waits",
  WaitEndsEmpty: () => "the wait ends: empty",
};

export const step = (action, from, to) => {
  const name = action.replace(/\(.*$/, "");

  return (steps[name] ?? (() => name))(from, to);
};
