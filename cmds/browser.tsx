import { createRouter, RouterProvider } from "@tanstack/react-router";
import { ws } from "@tinkered/bun/client";
import { createScope } from "@tinkered/core";
import { ScopeProvider } from "@tinkered/react";
import { createRoot } from "react-dom/client";

import { TinkerError, TinkerNotFound } from "~/base/fallbacks";
import { abortReasons } from "~/components/errors";
import { telemetry } from "~/components/telemetry";

import { access } from "@/access";
import { frames } from "@/frames";
import { greet } from "@/greet";
import { home } from "@/home";
import { issues } from "@/issues";
import { queue } from "@/queue";
import { routeTree } from "@/routes";
import { todo } from "@/todo";
import { tabMeta } from "@/viewer/gate";

const stop = new AbortController();

const app = createScope({
  signal: stop.signal,
  capsules: [
    telemetry.browser({
      service: "easel-web",
      console,
      firstSendMark: "easel:open",
      errors: window,
    }),
    ws.client({ url: `${location.origin.replace(/^http/, "ws")}/rpc`, meta: tabMeta }),
    greet.api({ remote: ws.client }),
    access.browser({ remote: ws.client }),
    access.user({ remote: ws.client }),
    access.owner({ remote: ws.client }),
    home.board({ read: ws.client }),
    home.codes({ read: ws.client }),
    todo.board({ read: ws.client }),
    todo.api({ remote: ws.client }),
    issues.board({ read: ws.client }),
    issues.api({ remote: ws.client }),
    frames.board({ read: ws.client }),
    frames.viewer({ remote: ws.client }),
    frames.pass({ remote: ws.client }),
    queue.viewer({ remote: ws.client }),
  ],
});

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) stop.abort(abortReasons.closed);
});

import.meta.hot?.dispose(async () => {
  stop.abort(abortReasons.closed);
  await app.closed;
});

const live = await app.ready;

const router = createRouter({
  routeTree,
  context: { scope: live },
  scrollRestoration: true,
  defaultErrorComponent: TinkerError,
  defaultNotFoundComponent: TinkerNotFound,
  Wrap: ({ children }) => <ScopeProvider scope={live}>{children}</ScopeProvider>,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("app")!).render(<RouterProvider router={router} />);
