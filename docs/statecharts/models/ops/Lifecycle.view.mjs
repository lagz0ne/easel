// The reader's words for one error group (SPEC-ops.md, SPEC-fixer.md).

export const title = "easel ops: one error group, from its first error to resolved or a person";

// After a fix, "failing" (resolve saw it on the fix's build) and "regressed" (it came back after
// resolve) lead to the same next step, so they share a label.
const word = (v) => {
  if (v.person) {
    return "Came back after a person had it";
  }

  return v.attempts === 0 ? "Open" : `Fix ${v.attempts} did not hold (failing or regressed)`;
};

const shipped = (v) => {
  if (v.live < v.fix) {
    return "Fix shipped, its build not live yet";
  }

  return v.lastSeen >= v.fix
    ? "Fix live, but the error came back on it"
    : "Fix live, waiting to resolve";
};

// After a person had it, the chart keeps only what the tick acts on: whether an issue is open.
// Dropped at the cap or kept, it comes back the same way, as the fixer's half shows.
const resolved = (v) => {
  if (v.person) {
    return v.issue === "open"
      ? "Resolved by an owner, its issue still open"
      : "Resolved by an owner";
  }

  return v.dropped
    ? `Resolved by fix ${v.attempts}, dropped at the cap, fingerprint kept`
    : `Resolved by fix ${v.attempts}, issue closed`;
};

const server = (v) => {
  if (v.status === "human") {
    if (!v.person) {
      return "A person has it: issue labelled needs-human";
    }

    return v.issue === "open"
      ? "A person has it, its issue open"
      : "A person has it, no issue open";
  }

  if (v.fixer === "shipped") {
    return shipped(v);
  }

  if (v.status === "resolved") {
    return resolved(v);
  }

  return v.fixer === "claimed"
    ? `${word(v)}: a fixer has it, issue open`
    : `${word(v)}: waiting for the tick`;
};

export const state = (v) => {
  const browser = v.side === "browser";

  if (v.status === "none") {
    return browser ? "Browser page: no error yet" : "Server: no error yet";
  }

  return browser ? "Browser-only group: open, unconfirmed" : server(v);
};

const seen = {
  none: "the error happens",
  resolved: "the error happens on the fix's build or later",
};

const steps = {
  Dropped: () => "ops drops the group at the 1000 cap",
  FixerClaims: () => "the tick finds it; a fixer claims it and opens or reopens its issue",
  FixerGivesUp: (from) => {
    if (from.person) {
      return "the fixer gives up [a person had it before]";
    }

    return from.attempts === 2
      ? "the fixer gives up [two fixes shipped]"
      : "the fixer gives up [its last fix shipped]";
  },
  FixerShips: () => "ship.sh --fixer ships and notes a fix",
  FixRefused: () => "ship.sh --fixer refuses the fix, or its gate is red",
  LineStopped: () => "the line is stopped; the fixer lets go",
  OtherShip: () => "another agent ships",
  Deploy: () => "a newer build goes live",
  FixerResolves: (from, to) => `resolve answers resolved; the issue closes [fix ${to.attempts}]`,
  FixerSeesFailing: (from, to) => `resolve answers failing [fix ${to.attempts}]`,
  ErrorSeen: (from) => seen[from.status] ?? "the error happens again",
  OwnerResolves: () => "an owner resolves it [its build is live, and not seen on it]",
  OwnerHandsOff: () => "an owner hands it off",
  TickClosesIssue: () => "the tick closes its issue",
  Done: () => null,
};

export const step = (action, from, to) => (steps[action] ?? (() => action))(from, to);

const groups = { human: "person", resolved: "resolved", none: "quiet" };

export const group = (v) => {
  if (v.status === "human" || v.side !== "browser") {
    return groups[v.status] ?? (v.fixer === "idle" ? "waiting" : "fixer");
  }

  return "browser";
};

export const colors = {
  person: "pink",
  browser: "purple",
  resolved: "teal",
  quiet: "tan",
  waiting: "orange",
  fixer: "blue",
};
