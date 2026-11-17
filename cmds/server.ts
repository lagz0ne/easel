import { serve, ws } from "@tinkered/bun";
import { createScope } from "@tinkered/core";

import { defineMain } from "~/base/main";
import { observeServerPanics } from "~/base/panics.server";
import { health } from "~/components/health";
import { routes } from "~/components/requests/index.server";
import { telemetry } from "~/components/telemetry/index.server";

import { greet } from "@/greet";
import { greetOps } from "@/greet/greet.server";
import { issues } from "@/issues";
import { issueOps, membersOnly, signedIn } from "@/issues/ops.server";
import { release } from "@/release";
import { todo } from "@/todo";
import { todoOps } from "@/todo/ops.server";

import { pages } from "./pages";

/** The env's defaults: the dev port when `PORT` is unset; "dev" when no image set `GIT_SHA`. */
const defaults = { PORT: "4318", GIT_SHA: "dev" };

/** The host starts the server; importing this command opens nothing. */
export default defineMain(async ({ env, args, signal, stdout, stderr, exit }) => {
  if (args.length) {
    stderr.write("Usage: bun cmds/host.ts\n");
    exit(64);
    return { closed: Promise.resolve() };
  }

  // Behind a TLS proxy the request URL is http: calls and tab batches must come from the public
  // origin. Empty (`PUBLIC_ORIGIN=` from a compose file or an env form) counts as unset.
  const origin = env.PUBLIC_ORIGIN || undefined;
  /** A built server sends telemetry from a worker thread; dev and tests keep it on this thread. */
  const sends = {
    service: env.OTEL_SERVICE_NAME,
    tracesUrl: env.VICTORIA_TRACES_URL === undefined ? undefined : new URL(env.VICTORIA_TRACES_URL),
    logsUrl: env.VICTORIA_LOGS_URL === undefined ? undefined : new URL(env.VICTORIA_LOGS_URL),
    console: stdout,
    level: env.LOG_LEVEL === undefined ? undefined : Number(env.LOG_LEVEL),
    history: env.SPAN_HISTORY === undefined ? undefined : Number(env.SPAN_HISTORY),
    origin,
  };
  const sink =
    env.NODE_ENV === "production"
      ? telemetry.thread({ ...sends, worker: new URL("./telemetry-worker.js", import.meta.url) })
      : telemetry.server(sends);

  const socket = ws.server({
    path: "/rpc",
    services: [greet.api, todo.board, todo.api, issues.board, issues.api],
    origin,
  });
  const table = routes({
    stop: signal,
    table: {
      "GET /api/health": health,
      "GET /api/version": release.version,
      "POST /api/telemetry": sink.route,
    },
  });
  const app = createScope({
    signal,
    capsules: [
      serve({
        port: Number({ ...defaults, ...env }.PORT),
        pages,
        websocket: socket,
        handlers: [table],
        development: env.NODE_ENV !== "production",
        stdout,
      }),
      sink,
      // The build that runs: the image sets GIT_SHA.
      release({ commit: { ...defaults, ...env }.GIT_SHA }),
      greet.api({ implement: greetOps }),
      // The todo feature: the server serves the list and is its only writer.
      todo.board({ serve: true }),
      todo.api({ implement: todoOps }),
      // The issue board: each part goes to its team's members; every call needs a viewer.
      issues.board({ serve: true, onStart: [signedIn, membersOnly] }),
      issues.api({ implement: issueOps, onStart: [signedIn] }),
      socket,
      table,
    ],
  });

  const live = await app.ready;
  live.onClose(observeServerPanics(exit.bind(null, 1), app.closed, stderr));
  return app;
});
