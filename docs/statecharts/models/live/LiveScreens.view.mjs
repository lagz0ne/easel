export const title = "live screens: one take on the page Live, after each deploy";

export const group = (v) => v.status;

const words = {
  none: "No take yet",
  new: "Take new: the first After",
  next: "Take next: the After moved to the Before",
  same: "Take same: nothing put",
  differs: "Take differs: nothing put, a finding",
  failed: "Take failed: the last good stays",
};

export const state = (v) =>
  [
    words[v.status],
    `live build ${v.live}`,
    v.after === 0 ? "no After" : `After of build ${v.after}`,
    v.before === 0 ? "no Before" : `Before of build ${v.before}`,
  ].join(", ");

export const colors = {
  none: "tan",
  new: "teal",
  next: "blue",
  same: "teal",
  differs: "orange",
  failed: "pink",
};

const steps = {
  Deploy: () => "a deploy: the site serves the next build",
  TakeNew: () => "the job takes the screen: no After yet, it puts the take as the After",
  TakeNext: () =>
    "the job takes the screen of a newer build: the After goes to the Before, the take is the After",
  TakeSame: () => "the job takes the screen again on the same build: the same pixels",
  TakeDiffers: () => "the job takes the screen again on the same build: other pixels",
  TakeFails: () => "the take fails: the status names the screen and the reason",
};

export const step = (action, from, to) => {
  const run = steps[action.replace(/\(.*$/, "")];
  if (!run) throw new Error(`no words for the step ${action}`);
  return run(from, to);
};
