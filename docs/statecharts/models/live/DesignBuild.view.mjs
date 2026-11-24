export const title = "design build: an accepted design starts the change of the app";

export const group = (v) => v.build;

const words = {
  none: "No build request",
  waiting: "The build request waits",
  inWork: "A design agent has the build request",
  resolved: "The build request is resolved",
  person: "The build request needs a person",
  accepted: "The build is accepted",
};

export const state = (v) =>
  [
    words[v.build],
    v.design === "result" ? "the design waits for an accept" : "the design is accepted",
    `live build ${v.live}`,
    v.shipped === 0 ? "no push yet" : `the change is in build ${v.shipped}`,
    v.named === 0 ? null : `the reply names build ${v.named}`,
  ]
    .filter(Boolean)
    .join(", ");

export const colors = {
  none: "tan",
  waiting: "yellow",
  inWork: "blue",
  resolved: "teal",
  person: "orange",
  accepted: "teal",
};

const steps = {
  AcceptDesign: () => "a viewer accepts the design: easel adds one build request",
  Claim: () => "a design agent claims the build request",
  Ship: () => "the agent ships the change of the code: a push makes the next build",
  Deploy: () => "a deploy: the site serves the build with the change",
  Resolve: () => "the agent resolves the build request with its build",
  Release: () => "the agent releases the build request with a reason: it waits again",
  Decline: () => "the agent declines the build request with a reason: it needs a person",
  Edit: () => "the person makes the build request clear: it waits again",
  Rest: () => "nothing is left to do",
  AcceptBuild: () => "a viewer accepts the build: easel adds no other request",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
