import { operation } from "@tinkered/core";
import { z } from "zod";

import {
  placeAddress,
  placeLeaving,
  placeName,
  placeNow,
  placeRouter,
  placeSearch,
  placeStack,
} from "./place";
import { placeQueue } from "./queue";

export const placeRead = operation({
  label: "place.read",
  depends: { address: placeAddress.required },
  run: ({ address }): { place: string | null; stack: string[] } => {
    const named = placeSearch.safeParse(
      Object.fromEntries(new URLSearchParams(address.location.search)),
    );
    const state: unknown = address.location.state;
    const held = z
      .array(placeName)
      .safeParse(
        typeof state === "object" && state !== null && "places" in state ? state.places : [],
      );

    return {
      place: named.success ? (named.data.place ?? null) : null,
      stack: held.success ? held.data : [],
    };
  },
});

export const placeWrite = operation({
  label: "place.write",
  input: z.object({ place: placeName.nullable(), stack: z.array(placeName) }),
  depends: { place: placeNow.controller, stack: placeStack.controller },
  run: ({ place, stack }, { input }) => {
    place.set(input.place);
    stack.set(input.stack);
  },
});

export const placeNavigate = operation({
  label: "place.navigate",
  input: z.object({ place: placeName, stack: z.array(placeName), replace: z.boolean() }),
  depends: {
    address: placeAddress.required,
    router: placeRouter.required,
    read: placeRead.controller,
    write: placeWrite.controller,
  },
  run: async ({ address, router, read, write }, { input }) => {
    const state = { ...address.location.state, places: input.stack };

    await router.navigate({
      to: ".",
      search: { place: input.place },
      state,
      replace: input.replace,
    });

    write.run({ input: read.run() });
  },
});

export const placeGo = operation({
  label: "place.go",
  input: placeName,
  depends: {
    place: placeNow.controller,
    stack: placeStack.controller,
    queue: placeQueue,
    open: placeNavigate.controller,
  },
  run: async ({ place, stack, queue, open }, { input }) => {
    await queue.enqueue(async () => {
      if (place.get() === input) return;

      await open.run({ input: { place: input, stack: [...stack.get(), input], replace: false } });
    });
  },
});

export const placeSetView = operation({
  label: "place.setView",
  input: placeName,
  depends: {
    place: placeNow.controller,
    stack: placeStack.controller,
    queue: placeQueue,
    open: placeNavigate.controller,
  },
  run: async ({ place, stack, queue, open }, { input }) => {
    await queue.enqueue(async () => {
      if (place.get() === input) return;

      await open.run({ input: { place: input, stack: [...stack.get()], replace: true } });
    });
  },
});

export const placeLeave = operation({
  label: "place.leave",
  depends: {
    stack: placeStack.controller,
    leaving: placeLeaving.controller,
    address: placeAddress.required,
    read: placeRead.controller,
    write: placeWrite.controller,
    queue: placeQueue,
  },
  run: async ({ stack, leaving, address, read, write, queue }) => {
    await queue.enqueue(async () => {
      const screens = stack.get();

      if (screens.length === 0) return;

      leaving.set(true);
      await queue.pop(() => address.go(-screens.length));

      write.run({ input: read.run() });
    });
  },
});

export const placeMoved = operation({
  label: "place.moved",
  depends: { read: placeRead.controller, write: placeWrite.controller, queue: placeQueue },
  run: ({ read, write, queue }) => {
    queue.moved();
    write.run({ input: read.run() });
  },
});

export const placeClean = operation({
  label: "place.clean",
  input: z.object({ names: z.array(placeName), place: placeName.optional() }),
  depends: {
    address: placeAddress.required,
    read: placeRead.controller,
    write: placeWrite.controller,
  },
  run: ({ address, read, write }, { input }) => {
    const query = new URLSearchParams(address.location.search);
    const held = input.names.filter((name) => query.has(name));

    if (held.length === 0) return;

    for (const name of held) query.delete(name);
    if (input.place !== undefined) query.set("place", input.place);

    const search = query.toString();

    address.replace(
      `${address.location.pathname}${search === "" ? "" : `?${search}`}${address.location.hash}`,
      address.location.state,
    );

    write.run({ input: read.run() });
  },
});
