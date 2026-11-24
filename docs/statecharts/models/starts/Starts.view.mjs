export const title = "starts: only the person starts the work of an agent, inside the limits";

const holds = {
  none: "",
  agreement: ", shows: waits for the person to agree",
  limit: ", shows: waits for the limit",
  failed: ", shows: the start failed",
  refused: ", shows: the channel refused it",
};

const whose = { none: "", person: "of the person", viewer: "of a viewer" };

const request = (v) => {
  if (v.st === "none") return "Not posted";
  if (v.st === "inWork") return "In work by its agent";
  if (v.st === "out") return "Out of the queue";

  const agreed = v.agreed ? "agreed" : "not agreed";
  return `Waits, ${whose[v.by]}, ${agreed}`;
};

const deliveries = { no: "", sent: ", published", refused: ", refused" };

const old = (v) => (v.stale ? ", an old message waits" : "");

const agents = (v) => {
  if (v.agent !== "running" || v.st === "inWork") return "";
  return ", an agent starts";
};

export const state = (v) => {
  if (v.st === "none" || v.st === "out") return request(v) + agents(v);
  if (v.st === "inWork") return request(v);

  return request(v) + deliveries[v.pub] + old(v) + agents(v) + holds[v.hold];
};

export const group = (v) => {
  if (v.st === "inWork") return "inWork";
  if (v.st === "out") return "out";
  if (v.st === "waiting" && v.hold !== "none") return "held";

  return "waiting";
};

export const colors = { waiting: "blue", held: "orange", inWork: "yellow", out: "teal" };

const steps = {
  Post: (who) => `${who === "person" ? "the person" : "a viewer"} posts it`,
  Write: (who) =>
    `${who === "person" ? "the person" : "a viewer"} edits, answers, adds a note or reopens it`,
  PersonAgrees: () => "the person agrees",
  Publish: () => "the dispatcher publishes it",
  Refused: () => "NATS refuses it 3 times",
  Start: () => "the starter starts an agent",
  StartFromAnOldMessage: () => "the starter starts an agent from an old message",
  StartFails: () => "the start fails; the starter reports it",
  StarterFillsUp: () => "the starter reaches a limit",
  StarterFrees: () => "the starter is under the limits again",
  EaselShowsTheLimit: () => "easel shows the report of the starter",
  Claim: () => "the agent claims it",
  ToldEmpty: () => "the agent is told empty",
  Outcome: () => "the agent resolves, asks or declines",
  Release: () => "a release, or the lease runs out",
};

export const step = (action) => {
  const name = action.replace(/\(.*$/, "");
  const arg = /\("?([a-z]+)"?\)/.exec(action)?.[1];

  return (steps[name] ?? (() => name))(arg);
};
