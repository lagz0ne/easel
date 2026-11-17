// The reader's words for Login.tla: two regions, who the owners are and what the agent's CLI sees.
export const title = "Logging in to an approve server: the first owner, and an agent that joins";

const ownerNames = {
  "true,true": "Ann and the agent are owners",
  "true,false": "Ann is the owner",
  "false,true": "Only the agent is an owner",
  "false,false": "No owner left",
};

const owners = (v) => {
  if (v.setup === "unused") {
    return v.annCode === "old" ? "No owner yet, Ann's setup code is old" : "No owner yet";
  }

  return ownerNames[`${v.role.ann === "owner"},${v.role.builder === "owner"}`];
};

const waiting = {
  pending: "Waiting, code pending",
  denied: "Waiting, code denied or revoked",
  expired: "Waiting, code ran out",
  approved: "Waiting, code approved",
};

const cliNames = {
  out: "Not signed in",
  slow: "Told to slow down",
  stopped: "Stopped waiting, can resume",
};

const agent = (v) => {
  if (v.cli === "in") {
    return v.tokenLive ? "Signed in" : "Signed in, token revoked";
  }

  if (v.cli === "waiting") {
    return v.lost ? "Waiting, granted answer lost" : waiting[v.req];
  }

  return cliNames[v.cli];
};

export const state = (v) => ({ Owners: owners(v), "The agent": agent(v) });

export const group = (v) => ({ waiting: "waiting", stopped: "waiting", in: "in" })[v.cli] ?? "out";
export const colors = { waiting: "yellow", in: "teal", out: "tan" };

const labels = {
  AnnGivesTheSetupCode: "Ann gives the setup code",
  TheServerRestarts: "the server restarts",
  AnnReadsTheNewSetupCode: "Ann reads the new setup code in the log",
  TheAddressReachesALimit: "logins from the agent's address reach a limit",
  TheLimitClears: "a minute passes, or those codes end",
  TheAgentStopsWaiting: "the agent stops waiting",
  TheAgentResumes: "the agent resumes (login --resume)",
  AnOwnerDeniesItsCode: "an owner denies its code",
  TheCodeRunsOut: "its code runs out (10 minutes)",
  TheAgentIsSignedIn: "the agent is told granted, and is signed in",
  TheGrantedAnswerIsLost: "the server answers granted, but the answer is lost",
  TheAgentIsToldDenied: "the agent is told denied",
  TheAgentIsToldItRanOut: "the agent is told its code ran out",
  TheAgentMakesACall: "the agent makes a call",
  TheAgentsCallIsRefused: "the agent's next call is refused, and it is told to log in again",
};

const ended = (v) => v.req === "denied" || v.req === "expired";

// Hidden: stopping on a code that already ended or whose granted answer was lost,
// and resuming onto a code that already ended. Stopping on a pending or approved
// code, and resuming onto one, are drawn.
const hidden = {
  TheAgentStopsWaiting: (from) => ended(from) || from.lost,
  TheAgentResumes: (_from, to) => ended(to),
};

// TLC names a step by the operator it runs: Approve and Revoke take a parameter.
const named = {
  TheAgentStartsALogin: (_from, to) =>
    to.cli === "slow"
      ? "the agent starts a login and is told to slow down"
      : "the agent starts a login",
  Approve: (_from, to) =>
    to.role.builder === "owner"
      ? "an owner approves its code, as owner"
      : "an owner approves its code",
  Revoke: (from, to) =>
    to.role.ann === "revoked" && from.role.ann !== "revoked"
      ? "an owner revokes Ann"
      : "an owner revokes the agent",
};

export const step = (action, from, to) => {
  if (hidden[action]?.(from, to)) {
    return null;
  }

  return named[action]?.(from, to) ?? labels[action] ?? action;
};
