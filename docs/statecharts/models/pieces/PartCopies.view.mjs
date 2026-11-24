export const title = "pieces: a change of a part reaches each copy";

const part = (v) => {
  const now = v.revAt[v.kit];
  const main = v.main === now ? "the main is published" : "a new main, not yet published";

  return `Kit ${v.kit}, P at revision ${now}, ${main}`;
};

const copy = (v) => {
  const loads = v.loading === 0 ? "" : `, a new document with revision ${v.loading} loads`;

  return `shows P at revision ${v.shown}${loads}`;
};

const request = (v) => {
  if (v.kept === 0) return "no request";

  return `keeps Kit ${v.kept}, which has P at revision ${v.revAt[v.kept]}`;
};

export const state = (v) => ({
  "The design system": part(v),
  "Frame a, with a copy of P": copy(v),
  "Frame o, with no copy": v.other === 0 ? "keeps its document" : "got a new document",
  "A request on frame a": request(v),
});

const steps = {
  AnAgentPutsTheMain: () => "an agent puts a new main of P on design-system",
  ThePartIsPublished: () => "the publish: a new kit version with the next revision of P",
  APersonChangesTheLook: () => "a person changes the look: a new kit version, the same P",
  AnAgentPutsTheCopyFrame: () => "an agent puts a new version of frame a",
  TheNewDocumentDraws: () => "the new iframe draws, the old one goes",
  APersonAsks: () => "a person asks for a change on frame a",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);

  return run(from, to);
};
