// Two fixers and one error group's claim (SPEC-fixer.md). Fixer 1 claims first.

export const title =
  "easel fixer: two fixers and one group's claim (a lease the wrapper keeps alive)";

const words = {
  idle: "not started",
  claimed: "claimed",
  issueOpened: "has the issue",
  ready: "fixing",
  gating: "shipping, gate runs",
  orphan: "stopped, its ship.sh runs on",
  pushed: "fix pushed",
  waiting: "fix noted, resolving",
  done: "resolved it",
};

const word = (v, f) => {
  if (v.pc[f] === "stopped") {
    return v.holder === f ? "stopped, claim still live" : "stopped";
  }

  return words[v.pc[f]] ?? v.pc[f];
};

const harms = (v) =>
  [
    v.issues === 2 && "2 issues",
    v.ships === 2 && "2 fixes shipped",
    v.rogue && "a fix shipped without the claim",
  ].filter(Boolean);

// What the group's record and GitHub hold: the part the next fixer reads.
const facts = (v) => {
  if (v.ships > 0) {
    return v.fixNoted ? "fix noted" : "fix on main, not noted";
  }

  if (v.issues === 0) {
    return "no issue";
  }

  return v.noted ? "issue noted" : "issue open, not noted";
};

export const state = (v) => {
  const harm = harms(v);
  const s = `Fixer 1 ${word(v, "f1")}, fixer 2 ${word(v, "f2")} (${facts(v)})`;

  return harm.length > 0 ? `${s}: ${harm.join(", ")}` : s;
};

const claims = {
  waiting: " [its fix is noted]",
  pushed: " [its fix is on main, not noted]",
  ready: " [it has an issue]",
};

const answers = (yes, who, what) => `${who}'s ${what} answers ${yes ? "noted" : "lost"}`;

const steps = {
  Claim: (who, from, to) => `${who} claims the group${claims[to.pc[to.holder]] ?? ""}`,
  FindOrOpenIssue: (who, from) =>
    from.issues === 0
      ? `${who} finds no issue by the label, and opens one`
      : `${who} finds the issue by its label`,
  NoteIssue: (who, from, to) => answers(to.noted && !from.noted, who, "note-issue"),
  ShipChecks: (who, from, to) =>
    to.pc[who === "fixer 1" ? "f1" : "f2"] === "gating"
      ? `${who} runs ship.sh --fixer: extend and trailer check pass, the gate runs`
      : `ship.sh --fixer refuses ${who}'s fix`,
  ShipPushes: (who, from, to) =>
    to.ships > from.ships
      ? `${who}'s ship.sh checks again and pushes the fix`
      : `${who}'s ship.sh checks again and refuses`,
  NoteFix: (who, from, to) => answers(to.fixNoted && !from.fixNoted, who, "note-fix"),
  Resolve: (who, from, to) =>
    to.status === from.status
      ? `${who}'s resolve answers lost`
      : `${who}'s resolve answers resolved`,
  Stops: () => "fixer 1 crashes, or its wrapper stops it",
  LeaseRunsOut: () => "the lease runs out",
  Done: () => null,
};

export const step = (action, from, to) => {
  const who = from.pc.f1 === to.pc.f1 ? "fixer 2" : "fixer 1";

  return (steps[action] ?? (() => action))(who, from, to);
};

export const group = (v) => {
  if (v.status === "resolved") {
    return "resolved";
  }

  const w = ["f1", "f2"].filter((f) =>
    ["claimed", "issueOpened", "ready", "gating", "pushed", "waiting"].includes(v.pc[f]),
  ).length;

  return w === 0 ? "nobody" : w === 1 ? "one" : "two";
};

export const colors = { resolved: "teal", nobody: "tan", one: "blue", two: "orange" };
