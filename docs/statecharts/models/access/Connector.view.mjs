export const title =
  "A Claude connector: a password from an owner, the sign-in, the tokens, and a revoke";

const easel = (v) => {
  if (v.user === "none") return "No connector user";
  if (v.user === "revoked") return "Revoked, the name is free";
  if (v.user === "waiting") {
    return v.pw === "late" ? "The password ran out" : "A password waits for its sign-in";
  }

  return v.other ? "Someone else signed in" : "The person signed in";
};

const connected = (v) => {
  if (v.grant !== "live") return "Connected, its tokens stopped";
  if (v.held === "prev") return "Connected, refresh answer lost";

  return v.atOk ? "Connected" : "Connected, access token ran out";
};

const claude = (v) => {
  if (v.cl === "out") return "Not connected";
  if (v.cl === "toldNo") return "Told to get a new password";
  if (v.cl === "code") return v.exchanges > 0 ? "Has a code, token answer lost" : "Has a code";

  return connected(v);
};

export const state = (v) => ({
  easel: easel(v),
  "The person's Claude": claude(v),
});

export const group = (v) => ({ in: "in", code: "waiting", out: "out", toldNo: "out" })[v.cl];
export const colors = { waiting: "yellow", in: "teal", out: "tan" };

const labels = {
  AnOwnerMakesAPassword: "an owner makes a password (users.add)",
  ThePasswordRunsOut: "the password runs out (24 hours)",
  ThePersonSignsIn: "the person signs in with the password",
  ThePersonIsToldThePasswordDoesNotWork: "the page says the password does not work now",
  SomeoneElseSignsIn: "someone else signs in with the password",
  TheCodeRunsOut: "the code runs out (60 s)",
  TheClientGetsItsTokens: "the code gives the tokens",
  TheTokenAnswerIsLost: "the code gives the tokens, but the answer is lost",
  TheCodeIsRefused: "the code is refused (invalid_grant)",
  TheAccessTokenRunsOut: "the access token runs out (1 hour)",
  TheClientMakesACall: "Claude makes a tool call",
  TheRefreshIsRefused: "the refresh is refused (invalid_grant)",
  AnOldRefreshTokenIsUsedAgain: "a copy of an old refresh token is used",
  AnOwnerRevokesTheConnector: "an owner revokes the connector",
};

const named = {
  Refresh: (_from, to) =>
    to.held === "cur" ? "Claude refreshes" : "Claude refreshes, but the answer is lost",
};

export const step = (action, from, to) => named[action]?.(from, to) ?? labels[action] ?? action;
