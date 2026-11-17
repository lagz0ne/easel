// The prod-down probe (SPEC-fixer.md), as the person reading GitHub issues sees it.

export const title = "easel fixer: the prod-down probe and the tick's stamp";

const fixer = (v) => {
  if (!v.tickOk) {
    return v.quiet ? "Tick stopped, silent 30 min" : "Tick stopped";
  }

  return v.work ? "Tick runs, has work" : "Tick runs, nothing to fix";
};

export const state = (v) => ({
  Server: v.ready ? "Ready" : "Not ready",
  Fixer: fixer(v),
  "prod-down": v.issue === "open" ? "Open" : "Closed",
});

const steps = {
  Breaks: () => "a readiness check fails",
  Heals: () => "the checks pass again",
  ErrorsArrive: () => "an error group opens",
  WorkDone: () => "the fixer clears the open groups",
  TickStops: () => "the paseo schedule stops",
  TickResumes: () => "the paseo schedule runs again; its tick stamps",
  ThirtyMinutesPass: () => "30 minutes pass with no tick",
  // Only with StampsEveryTick = FALSE, which Probe.cfg does not check.
  TickFindsWork: () => "a tick finds work and stamps",
  ProbeRuns: (to) => (to.issue === "open" ? "the probe fails" : "the probe passes"),
};

export const step = (action, from, to) => (steps[action] ?? (() => action))(to);
