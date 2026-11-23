import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type AnyRouter,
  type RouterHistory,
} from "@tanstack/react-router";

import { placeAddress, placeRouter, placeSearch } from "~/components/place";

export type PlacePage = {
  router: AnyRouter;
  history: RouterHistory;
  loads: () => number;
  close: () => Promise<void>;
};

let reads = 0;

const pageOver = async (history: RouterHistory): Promise<PlacePage> => {
  const root = createRootRoute({ component: () => null });
  const page = createRoute({
    getParentRoute: () => root,
    path: "/p/$project",
    gcTime: 0,
    validateSearch: placeSearch,
    loader: () => {
      reads += 1;

      return { reads };
    },
    component: () => null,
  });

  const router: AnyRouter = createRouter({
    routeTree: root.addChildren([page]),
    history,
    origin: "http://localhost",
    defaultPendingMinMs: 0,
    isServer: false,
  });

  const failed: unknown[] = [];
  const inFlight: Promise<void>[] = [];
  let closed = false;

  const stop = history.subscribe(() => {
    if (closed) return;

    inFlight.push(
      router.load().catch((error: unknown) => {
        failed.push(error);
      }),
    );
  });

  await router.load();

  const close = async () => {
    closed = true;
    stop();
    await Promise.all(inFlight);
    inFlight.length = 0;

    const first = failed[0];

    if (first !== undefined) throw first;
  };

  return { router, history, loads: () => reads, close };
};

export const placePageOpened = async (entries: readonly string[] = ["/p/shop/"]) => {
  reads = 0;
  const history = createMemoryHistory({ initialEntries: [...entries] });

  return pageOver(history);
};

export const placePageReloaded = (history: RouterHistory) => pageOver(history);

export const placeTags = (router: AnyRouter, history: RouterHistory) => [
  placeRouter(router),
  placeAddress(history),
];

export const placeFlush = () => new Promise((resolve) => setTimeout(resolve, 0));
