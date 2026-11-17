// Chart frames-writes-two-step (WritesTwoStep.cfg): EXPECTED TO BREAK. A put checks base and
// document, awaits, then writes without looking again.
export { state, group, colors, step } from "./Writes.view.mjs";

export const title = "frames, if a put checked then wrote in two steps (expected to break)";
