export const title = "flows: the links of a flow, and the changes that break them";

const causes = {
  none: "whole",
  screen: "broken: the screen is gone",
  page: "broken: the screen is on another page",
  action: "broken: no action send",
};

const linkWords = { send: "send of a to b", next: "next of b to c" };

const toldOf = (v) => Object.values(v.told ?? {});

export const state = (v) => ({
  "The link send of a to b": causes[v.broken.send],
  "The link next of b to c": causes[v.broken.next],
  "The screens": [
    v.hasSend ? "a has send" : "a has no send",
    v.cThere ? `c on page ${v.cPage}` : "c is gone",
  ].join(", "),
  "The answer of the last change": toldOf(v).length
    ? `broken: ${toldOf(v)
        .map((l) => linkWords[l])
        .join(", ")}`
    : "no broken link",
});

const steps = {
  PutA: (from, to) =>
    to.hasSend ? "a put of a with the action send" : "a put of a with no action send",
  MoveC: (from, to) => `a move of c to page ${to.cPage}`,
  DeleteC: () => "a delete of c",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
