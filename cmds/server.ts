import { serve, ws } from "@tinkered/bun";
import { bunSqlite } from "@tinkered/bun/sqlite";
import { createScope } from "@tinkered/core";

import { defineMain } from "~/base/main";
import { health } from "~/components/health";
import { routes } from "~/components/requests/index.server";
import { telemetry } from "~/components/telemetry/index.server";

import { access } from "@/access";
import { accessEnv } from "@/access/env.server";
import { accessDoor, owner, user } from "@/access/guards.server";
import { loginOps } from "@/access/login.server";
import { accessServer } from "@/access/store.server";
import { ownerOps, userOps } from "@/access/users.server";
import { frames } from "@/frames";
import { socketMaxPayload } from "@/frames/contract";
import { framesLoads, framesOps, mayRead } from "@/frames/ops.server";
import { framesServer } from "@/frames/store.server";
import { greet } from "@/greet";
import { greetOps } from "@/greet/greet.server";
import { issues } from "@/issues";
import { issueOps, membersOnly, signedIn } from "@/issues/ops.server";
import { ops } from "@/ops";
import { opsOwnerOps, opsServer, opsUserOps, ready } from "@/ops/ops.server";
import { observePanics } from "@/ops/panic.server";
import { opsTelemetryRoute, opsThreadRoute } from "@/ops/sink.server";
import { release } from "@/release";
import { todo } from "@/todo";
import { todoOps } from "@/todo/ops.server";

import { pages } from "./pages";

/**
 * The env's defaults: the dev port when `PORT` is unset; "dev" and build 0 when no image set
 * `GIT_SHA` and `BUILD`. Production refuses to start without `BUILD`.
 */
const defaults = { PORT: "4318", GIT_SHA: "dev", BUILD: "0" };

/** The host starts the server; importing this command opens nothing. */
export default defineMain(async ({ env, args, signal, stdout, stderr, exit }) => {
  // Why the server will not start, if it will not: bad arguments (64), or production without a
  // build. A production server runs a build: with no `BUILD`, `/api/version` and every error
  // group would say build 0, and a resolve could never be checked against the live build
  // (SPEC-ops.md).
  const refused = [
    { code: 64, text: "Usage: bun cmds/host.ts\n", when: args.length > 0 },
    {
      code: 78,
      text: "easel serve: production needs BUILD, a build number above 0; the image sets it\n",
      // Any NODE_ENV but production, or production with a BUILD above 0.
      when: !/^(?!production )|^production [1-9]\d*$/.test(`${env.NODE_ENV} ${env.BUILD}`),
    },
  ].find((check) => check.when);
  if (refused) {
    stderr.write(refused.text);
    exit(refused.code);
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
  // A tab's batch: Tinker's checks, then ops's error sink, then the sink's queue or worker.
  const { sink, tabs } =
    env.NODE_ENV === "production"
      ? {
          sink: telemetry.thread({
            ...sends,
            worker: new URL("./telemetry-worker.js", import.meta.url),
          }),
          tabs: opsThreadRoute,
        }
      : { sink: telemetry.server(sends), tabs: opsTelemetryRoute };

  // Who gets in, and where users are kept: EASEL_AUTH, EASEL_DB, EASEL_TRUSTED_PROXIES.
  const auth = accessEnv.parse(env);
  const set = { ...defaults, ...env };
  const socket = ws.server({
    path: "/rpc",
    services: [
      access.login,
      access.user,
      access.owner,
      greet.api,
      todo.board,
      todo.api,
      issues.board,
      issues.api,
      ops.user,
      ops.owner,
      frames.api,
      frames.board,
    ],
    origin,
    // 2 MiB, above the 1 MiB document: a document a little too big gets `tooBig`, not a closed
    // socket (SPEC-frames § Contract, decision C11). The default is 1 MiB, in both directions.
    maxPayload: socketMaxPayload,
  });
  // The socket's door: it notes each peer's address, and on an `open` server lets in only this
  // machine (SPEC-access judged rule 12; `serve` cannot bind 127.0.0.1 alone).
  const door = accessDoor({ inner: socket, loopbackOnly: auth.mode === "open" });
  const table = routes({
    stop: signal,
    table: {
      "GET /api/health": health,
      "GET /api/version": release.version,
      "GET /api/ready": ready,
      "POST /api/telemetry": tabs,
    },
  });
  const app = createScope({
    signal,
    capsules: [
      serve({
        port: Number(set.PORT),
        pages,
        websocket: door,
        handlers: [table],
        development: env.NODE_ENV !== "production",
        stdout,
      }),
      sink,
      bunSqlite({ file: auth.file }),
      accessServer({
        mode: auth.mode,
        origin: auth.origin,
        stdout,
        trusted: auth.trusted,
        durable: auth.durable,
      }),
      access.login({ implement: loginOps }),
      access.user({ implement: userOps, onStart: [user] }),
      access.owner({ implement: ownerOps, onStart: [user, owner] }),
      // Canvases and frames, in EASEL_DB; any signed-in user writes any canvas (SPEC-frames).
      framesServer({ stdout }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      // The build that runs: the image sets GIT_SHA and BUILD.
      release({ commit: set.GIT_SHA, build: Number(set.BUILD) }),
      // The error groups, readiness and the fixer's stamp, kept in EASEL_DB.
      opsServer({ database: auth.file }),
      ops.user({ implement: opsUserOps, onStart: [user] }),
      ops.owner({ implement: opsOwnerOps, onStart: [user, owner] }),
      greet.api({ implement: greetOps }),
      // The todo feature: the server serves the list and is its only writer.
      todo.board({ serve: true }),
      todo.api({ implement: todoOps }),
      // The issue board: each part goes to its team's members; every call needs a viewer.
      issues.board({ serve: true, onStart: [signedIn, membersOnly] }),
      issues.api({ implement: issueOps, onStart: [signedIn] }),
      // The door wraps the socket, so it starts first and reads the socket once it has started.
      door,
      socket,
      table,
    ],
  });

  const live = await app.ready;
  // A panic: stderr, then the store, then exit 1 (SPEC-ops.md fact rule 5).
  const to = { scope: live, exit, closed: app.closed, stderr };
  live.onClose(live.run(observePanics, { input: to }));
  return app;
});
