// Chart queue-two-step (QueueTwoStep.cfg): EXPECTED TO BREAK. next picks, awaits, then
// writes its claim without looking again. The chart follows comment 1, where the race is.
export const title =
  "queue, if next picked then wrote in two steps (expected to break): the life of comment 1";

const AGENTS = ["A", "B"];
const C = 1;
const CAP = 2; // StuckAfter in QueueTwoStep.cfg

const live = (v) => v.lease[C] === "live";

const holders = (v) =>
  AGENTS.filter((a) => v.agent[a] === "working" && v.claim[a] === C && v.mine[a] === "live");

const pickers = (v, c) => AGENTS.filter((a) => v.agent[a] === "picked" && v.claim[a] === c);

const staleHolder = (v) =>
  AGENTS.some((a) => v.agent[a] === "working" && v.claim[a] === C && v.mine[a] === "out");

const pastCap = (v, over, under) => (v.attempts[C] > CAP ? over : under);

const notHeld = (v) => {
  if (v.attempts[C] >= CAP) {
    return v.ranOut[C] >= CAP ? "Stuck" : "Stuck, though one claim ran out";
  }

  return v.lease[C] === "out" ? "Lease ran out, shows open" : "Open";
};

const held = (v) => {
  if (holders(v).length > 1) {
    return pastCap(v, "Two agents hold it, claimed past the cap", "Two agents both hold it");
  }

  return live(v) ? pastCap(v, "Claimed past the cap", "Claimed") : notHeld(v);
};

const stored = { unposted: "Not posted", done: "Done" };

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
    pickers(v, 3 - C).length > 0 && "an agent picked comment 2",
    v.lease[3 - C] === "live" && "comment 2 claimed",
  ]
    .filter(Boolean)
    .join(", ");

const active = (v) => (live(v) ? "claimed" : "open");

export const group = (v) => {
  if (v.status[C] === "done") {
    return "done";
  }

  return v.status[C] === "open" && !live(v) && v.attempts[C] >= CAP ? "stuck" : active(v);
};

export const colors = { open: "blue", claimed: "yellow", stuck: "orange", done: "teal" };

const onOther = (from, to) => {
  const mover = AGENTS.find((a) => from.agent[a] !== to.agent[a]);

  return mover !== undefined && (from.claim[mover] === 3 - C || to.claim[mover] === 3 - C);
};

const either = (other, two, one) => (other ? two : one);

const steps = {
  ViewerPosts: (from, to) =>
    either(to.status[C] === from.status[C], "a viewer posts comment 2", "a viewer posts it"),
  AgentPicks: (from, to) =>
    either(onOther(from, to), "an agent finds comment 2 oldest", "an agent finds it oldest"),
  AgentWritesPick: (from, to) =>
    either(
      onOther(from, to),
      "that agent writes its claim on comment 2",
      "that agent writes its claim",
    ),
  AgentTakes: () => "an agent runs next and gets it",
  LeaseRunsOut: () => "the lease runs out",
  AgentReleases: () => "the holder releases it",
  AgentResolves: () => "the holder resolves it",
  HandleToldDone: () => "the earlier holder is told done",
  HandleToldLost: () => "an agent is told lost",
  AgentWaits: () => "an agent finds nothing and waits",
  WaitEndsEmpty: () => "the wait ends: empty",
};

export const step = (action, from, to) => {
  const name = action.replace(/\(.*$/, "");

  return (steps[name] ?? (() => name))(from, to);
};
