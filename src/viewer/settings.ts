import { tag } from "@tinkered/core";
import { z } from "zod";

export const dayMs = 24 * 60 * 60_000;

const count = z.number().int().positive();

const waitMs = z.number().int().positive();

const share = z.number().positive();

const margin = z.number().nonnegative();

const pixels = z.number().nonnegative();

export const viewerDefaults = {
  liveCap: 12,
  readZoom: 0.3,
  goLiveMargin: 0.1,
  stayLiveMargin: 0.5,
  showMargin: 0.5,
  hideAtRestMargin: 0.75,
  hideMovingMargin: 1.5,
  restMs: 120,
  paintCapMs: 1_500,
  zoomFactor: 1.25,
  pinchRate: 0.01,
  minZoom: 0.001,
  maxZoom: 4,
  fitEdge: 40,
  labelDrift: 0.1,
  clickSlop: 4,
  popGap: 8,
  dockBand: 64,
  pinSize: 24,
  paneMax: { w: 480, h: 720 },
  closeWaitMs: 200,
  wheelLine: 16,
  showAt: 0.4,
  foldDelayMs: 300,
  noAnswerDays: 3,
  oldMs: 7 * dayMs,
  tickMs: 60_000,
  retryJitter: 1_000,
} as const;

export const liveCap = tag({
  label: "viewer.liveCap",
  default: viewerDefaults.liveCap,
  parse: count,
});

export const readZoom = tag({
  label: "viewer.readZoom",
  default: viewerDefaults.readZoom,
  parse: share,
});

export const goLiveMargin = tag({
  label: "viewer.goLiveMargin",
  default: viewerDefaults.goLiveMargin,
  parse: margin,
});

export const stayLiveMargin = tag({
  label: "viewer.stayLiveMargin",
  default: viewerDefaults.stayLiveMargin,
  parse: margin,
});

export const showMargin = tag({
  label: "viewer.showMargin",
  default: viewerDefaults.showMargin,
  parse: margin,
});

export const hideAtRestMargin = tag({
  label: "viewer.hideAtRestMargin",
  default: viewerDefaults.hideAtRestMargin,
  parse: margin,
});

export const hideMovingMargin = tag({
  label: "viewer.hideMovingMargin",
  default: viewerDefaults.hideMovingMargin,
  parse: margin,
});

export const restMs = tag({
  label: "viewer.restMs",
  default: viewerDefaults.restMs,
  parse: waitMs,
});

export const paintCapMs = tag({
  label: "viewer.paintCapMs",
  default: viewerDefaults.paintCapMs,
  parse: waitMs,
});

export const zoomFactor = tag({
  label: "viewer.zoomFactor",
  default: viewerDefaults.zoomFactor,
  parse: z.number().gt(1),
});

export const pinchRate = tag({
  label: "viewer.pinchRate",
  default: viewerDefaults.pinchRate,
  parse: share,
});

export const minZoom = tag({
  label: "viewer.minZoom",
  default: viewerDefaults.minZoom,
  parse: share,
});

export const maxZoom = tag({
  label: "viewer.maxZoom",
  default: viewerDefaults.maxZoom,
  parse: share,
});

export const fitEdge = tag({
  label: "viewer.fitEdge",
  default: viewerDefaults.fitEdge,
  parse: pixels,
});

export const labelDrift = tag({
  label: "viewer.labelDrift",
  default: viewerDefaults.labelDrift,
  parse: margin,
});

export const clickSlop = tag({
  label: "viewer.clickSlop",
  default: viewerDefaults.clickSlop,
  parse: pixels,
});

export const popGap = tag({
  label: "viewer.popGap",
  default: viewerDefaults.popGap,
  parse: pixels,
});

export const dockBand = tag({
  label: "viewer.dockBand",
  default: viewerDefaults.dockBand,
  parse: pixels,
});

export const pinSize = tag({
  label: "viewer.pinSize",
  default: viewerDefaults.pinSize,
  parse: share,
});

export const paneMax = tag<{ readonly w: number; readonly h: number }>({
  label: "viewer.paneMax",
  default: viewerDefaults.paneMax,
  parse: z.object({ w: share, h: share }),
});

export const closeWaitMs = tag({
  label: "viewer.closeWaitMs",
  default: viewerDefaults.closeWaitMs,
  parse: waitMs,
});

export const wheelLine = tag({
  label: "viewer.wheelLine",
  default: viewerDefaults.wheelLine,
  parse: share,
});

export const showAt = tag({
  label: "viewer.showAt",
  default: viewerDefaults.showAt,
  parse: z.number().min(0).max(1),
});

export const foldDelayMs = tag({
  label: "viewer.foldDelayMs",
  default: viewerDefaults.foldDelayMs,
  parse: waitMs,
});

export const noAnswerDays = tag({
  label: "viewer.noAnswerDays",
  default: viewerDefaults.noAnswerDays,
  parse: count,
});

export const oldMs = tag({
  label: "viewer.oldMs",
  default: viewerDefaults.oldMs,
  parse: waitMs,
});

export const tickMs = tag({
  label: "viewer.tickMs",
  default: viewerDefaults.tickMs,
  parse: waitMs,
});

export const retryJitter = tag({
  label: "viewer.retryJitter",
  default: viewerDefaults.retryJitter,
  parse: z.number().int().nonnegative(),
});
