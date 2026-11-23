import { resource } from "@tinkered/core";

import { placeLeaving } from "./place";

const POP_GIVE_UP_MS = 600;

export const placeQueue = resource({
  label: "place.queue",
  target: "session",
  depends: { leaving: placeLeaving.controller },
  factory: ({ leaving }, { defer, clock, signal }) => {
    let tail: Promise<unknown> = Promise.resolve();
    let waiting: (() => void) | null = null;

    const settle = () => {
      const done = waiting;

      waiting = null;
      if (done !== null) done();
    };

    const enqueue = async (task: () => Promise<void>) => {
      tail = tail.then(task, task);
      await tail;
    };

    const pop = async (walk: () => void) => {
      const moved = new Promise<void>((resolve) => {
        waiting = resolve;
      });

      walk();
      await Promise.race([moved, clock.sleep(POP_GIVE_UP_MS, signal).catch(() => undefined)]);
      settle();
      leaving.set(false);
    };

    defer(settle);

    return { enqueue, pop, moved: settle };
  },
});
