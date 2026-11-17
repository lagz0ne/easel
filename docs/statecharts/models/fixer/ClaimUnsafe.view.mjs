// Chart fixer-claim-unsafe (ClaimUnsafe.cfg): EXPECTED TO BREAK. The wrapper stops only the
// fixer, not its process group, and ship.sh does not check again before its push.
import { step as claimStep } from "./Claim.view.mjs";

export { state, group, colors } from "./Claim.view.mjs";

export const title = "easel fixer, with no group stop and no re-check (expected to break)";

// With ReCheck off, ship.sh pushes after its gate without checking again.
export const step = (action, from, to) => {
  if (action !== "ShipPushes") {
    return claimStep(action, from, to);
  }

  const who = from.pc.f1 === to.pc.f1 ? "fixer 2" : "fixer 1";

  return `${who}'s ship.sh pushes the fix, without checking again`;
};
