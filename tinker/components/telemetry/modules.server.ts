import { resource } from "@tinkered/core";

export const workerThreads = resource({
  label: "module:node:worker_threads",
  target: "scope",
  factory: () => import("node:worker_threads"),
});
