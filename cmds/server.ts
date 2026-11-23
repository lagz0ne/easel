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
import { pictureRoute, picturesServer } from "@/frames/pictures.server";
import { mayName, passOps, shareOps, shareServer } from "@/frames/share.server";
import { framesServer } from "@/frames/store.server";
import { greet } from "@/greet";
import { greetOps } from "@/greet/greet.server";
import { issues } from "@/issues";
import { issueOps, membersOnly, signedIn } from "@/issues/ops.server";
import { kit } from "@/kit";
import { fontRoute } from "@/kit/fonts.server";
import { kitOps } from "@/kit/ops.server";
import { portClient, portServer } from "@/kit/port-link";
import { runtimeRoute } from "@/kit/runtime.server";
import { mcpHttp, mcpMeta } from "@/mcp/http.server";
import { ops } from "@/ops";
import { opsOwnerOps, opsServer, opsUserOps, ready } from "@/ops/ops.server";
import { observePanics } from "@/ops/panic.server";
import { opsTelemetryRoute, opsThreadRoute } from "@/ops/sink.server";
import { queue } from "@/queue";
import { channelOps } from "@/queue/channels.server";
import { dispatchServer } from "@/queue/dispatch.server";
import { mayAct } from "@/queue/guards.server";
import { queueOps, requestOps } from "@/queue/ops.server";
import { queueServer } from "@/queue/store.server";
import { release } from "@/release";
import { todo } from "@/todo";
import { todoOps } from "@/todo/ops.server";

import { pages } from "./pages";
import { runtime } from "./runtime";

const defaults = { PORT: "4318", GIT_SHA: "dev", BUILD: "0" };

export default defineMain(async ({ env, args, signal, stdout, stderr, exit }) => {
  const refused = [
    { code: 64, text: "Usage: bun cmds/host.ts\n", when: args.length > 0 },
    {
      code: 78,
      text: "easel serve: production needs BUILD, a build number above 0; the image sets it\n",
      when: !/^(?!production )|^production [1-9]\d*$/.test(`${env.NODE_ENV} ${env.BUILD}`),
    },
  ].find((check) => check.when);
  if (refused) {
    stderr.write(refused.text);
    exit(refused.code);
    return { closed: Promise.resolve() };
  }

  const origin = env.PUBLIC_ORIGIN || undefined;
  const sends = {
    service: env.OTEL_SERVICE_NAME,
    tracesUrl: env.VICTORIA_TRACES_URL === undefined ? undefined : new URL(env.VICTORIA_TRACES_URL),
    logsUrl: env.VICTORIA_LOGS_URL === undefined ? undefined : new URL(env.VICTORIA_LOGS_URL),
    console: stdout,
    level: env.LOG_LEVEL === undefined ? undefined : Number(env.LOG_LEVEL),
    history: env.SPAN_HISTORY === undefined ? undefined : Number(env.SPAN_HISTORY),
    origin,
  };
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
      frames.viewer,
      frames.pass,
      kit.api,
      queue.api,
      queue.viewer,
      queue.channels,
    ],
    origin,
    maxPayload: socketMaxPayload,
  });
  const door = accessDoor({ inner: socket, loopbackOnly: auth.mode === "open" });
  const mcpServices = [
    access.user,
    access.owner,
    ops.user,
    ops.owner,
    frames.api,
    kit.api,
    queue.api,
  ];
  const mcpChannel = new MessageChannel();
  const mcpScope = createScope({
    signal,
    capsules: [
      portClient({ port: Promise.resolve(mcpChannel.port2), meta: mcpMeta }),
      ...mcpServices.map((api) => api({ remote: portClient })),
    ],
  });
  const table = routes({
    stop: signal,
    table: {
      "GET /api/health": health,
      "GET /api/version": release.version,
      "GET /install.sh": release.install,
      "GET /api/ready": ready,
      "POST /api/telemetry": tabs,
      "GET /api/pictures/{canvas}/{id}/{version}": pictureRoute,
      "GET /api/runtime/{kit}/{sha}/{file}": runtimeRoute,
      "GET /api/fonts/{dir}/{file}": fontRoute,
      "POST /mcp": mcpHttp.route,
      "GET /mcp": mcpHttp.route,
      "DELETE /mcp": mcpHttp.route,
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
        paths: ["/install.sh", "/mcp"],
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
      picturesServer({ chromium: env.EASEL_CHROMIUM, database: auth.file }),
      framesServer({ stdout, runtime }),
      frames.api({ implement: framesOps, onStart: [user] }),
      frames.board({ serve: true, load: framesLoads, onStart: [mayRead] }),
      shareServer(),
      frames.viewer({ implement: shareOps }),
      frames.pass({ implement: passOps, onStart: [mayName] }),
      kit.api({ implement: kitOps, onStart: [user] }),
      queueServer({ stdout }),
      queue.api({ implement: queueOps, onStart: [user] }),
      queue.viewer({ implement: requestOps, onStart: [mayAct] }),
      dispatchServer({ fetch }),
      queue.channels({ implement: channelOps, onStart: [user, owner] }),
      release({ commit: set.GIT_SHA, build: Number(set.BUILD), origin: auth.origin }),
      opsServer({ database: auth.file }),
      ops.user({ implement: opsUserOps, onStart: [user] }),
      ops.owner({ implement: opsOwnerOps, onStart: [user, owner] }),
      greet.api({ implement: greetOps }),
      todo.board({ serve: true }),
      todo.api({ implement: todoOps }),
      issues.board({ serve: true, onStart: [signedIn, membersOnly] }),
      issues.api({ implement: issueOps, onStart: [signedIn] }),
      door,
      socket,
      portServer({ services: mcpServices }),
      mcpHttp({
        origin: auth.origin,
        scope: mcpScope.ready,
      }),
      table,
    ],
  });

  const live = await app.ready;
  const mcpStop = new AbortController();
  const mcpPort = live.run(portServer.accept, {
    input: { port: mcpChannel.port1, stop: AbortSignal.any([signal, mcpStop.signal]) },
  });
  live.onClose(async () => {
    mcpStop.abort();
    await mcpPort;
    await (await mcpScope.ready).close();
  });
  const to = { scope: live, exit, closed: app.closed, stderr };
  live.onClose(live.run(observePanics, { input: to }));
  return app;
});
