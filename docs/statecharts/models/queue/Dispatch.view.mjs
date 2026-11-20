// Chart queue-dispatch (Dispatch.cfg): one request, an agent that asks for work, and GitHub.
export const title = "queue: the dispatcher gets a request to an agent (pull and GitHub both on)";

// Attempts in Dispatch.cfg.
const ATTEMPTS = 2;

const where = (v) => {
  if (v.req === "unposted") {
    return "Not posted";
  }

  if (v.req === "waiting") {
    return v.tries > 0 ? "Waiting again" : "Waiting";
  }

  if (v.req === "inWork") {
    return v.holder === "github" ? "In work by the GitHub run" : "In work by an agent that asked";
  }

  return v.req === "out" ? "Out of the queue" : "Needs a person";
};

const delivery = (v) => {
  if (v.req !== "waiting") {
    return "";
  }

  if (v.sent[v.tries] === 1) {
    return ", delivered";
  }

  if (v.failed >= ATTEMPTS) {
    return ", delivery failed";
  }

  return v.failed > 0 ? ", a delivery failed, tried again" : "";
};

const runs = { none: "", started: ", a GitHub run starts", working: "", ended: "" };
const issues = { none: "", open: ", issue open", closed: ", issue closed" };

export const state = (v) => where(v) + delivery(v) + runs[v.run] + issues[v.issue];

export const group = (v) => {
  if (v.req === "inWork") {
    return "inWork";
  }

  if (v.req === "out") {
    return "out";
  }

  return v.req === "person" ? "person" : "waiting";
};

export const colors = { waiting: "blue", inWork: "yellow", person: "orange", out: "teal" };

const steps = {
  ViewerPosts: () => "a viewer posts it",
  Deliver: () => "the dispatcher delivers it to GitHub",
  DeliveryFails: () => "the delivery fails; the cause is kept",
  PullAgentTakes: () => "an agent that asks takes it",
  GitHubRunTakes: () => "the GitHub run takes it",
  GitHubRunToldEmpty: () => "the GitHub run is told empty",
  HolderEndsTheTry: () => "the holder resolves, asks or declines",
  TryEndsWithNoOutcome: () => "a release, or the lease runs out",
  IssueFollows: () => "the issue closes",
};

export const step = (action) => {
  const name = action.replace(/\(.*$/, "");

  return (steps[name] ?? (() => name))();
};
