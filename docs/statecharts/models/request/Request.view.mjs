// Chart request-life (Request.cfg): the states of one request, and who moves it.
export const title = "request: from the ask to done, with a person, or closed";

const CAP = 2; // NeedsPersonAfter in Request.cfg

const tried = (v) => (v.tries > 0 ? ", tried once" : "");

const open = (v) => {
  if (v.live) {
    return v.tries > 1 ? "In work, 2nd try" : "In work";
  }

  return v.tries >= CAP ? "Needs a person: no outcome after 2 tries" : `Waiting${tried(v)}`;
};

const words = {
  unposted: "Not asked",
  open,
  asking: "Question for a viewer",
  resolved: (v) => (v.accepted ? "Resolved, accepted" : "Result to check"),
  person: "Needs a person: declined with a reason",
  closed: "Closed",
};

export const state = (v) => {
  const word = words[v.status];

  return typeof word === "function" ? word(v) : word;
};

export const group = (v) => {
  if (v.status === "open") {
    if (v.live) {
      return "inWork";
    }

    return v.tries >= CAP ? "person" : "waiting";
  }

  return {
    unposted: "waiting",
    asking: "viewer",
    resolved: "done",
    person: "person",
    closed: "closed",
  }[v.status];
};

export const colors = {
  waiting: "blue",
  inWork: "yellow",
  viewer: "purple",
  person: "orange",
  done: "teal",
  closed: "tan",
};

const steps = {
  ViewerAdds: "a viewer asks",
  AgentClaims: "an agent claims it",
  LeaseRunsOut: "the lease runs out",
  AgentReleases: "the agent releases it, with a reason",
  ViewerEdits: "a viewer or a user edits it, or a viewer adds a note",
  ViewerNotes: "a viewer adds a note",
  ViewerAnswers: "a viewer answers",
  ViewerAccepts: "a viewer accepts",
  ViewerReopens: "a viewer opens it again, with a note",
  ViewerCloses: "a viewer or a user closes it",
};

// TLC names the three outcomes by the operator they share, Outcome(s).
const outcomes = {
  resolved: "the agent resolves it, with a result",
  asking: "the agent asks a question",
  person: "the agent declines, with a reason",
};

export const step = (action, from, to) => {
  const name = action.replace(/\(.*$/, "");

  if (name === "Outcome") return outcomes[to.status];
  // E4.1 N9: a close while an agent works on it is the viewer who takes the request back.
  if (name === "ViewerCloses" && from.live) return "a viewer takes it back";

  return steps[name] ?? name;
};
