import { exits } from "@tinkered/cli/test";
import { createScope, operation } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { expect, onTestFinished, test } from "vite-plus/test";

import { httpBackend } from "~/components/http";
import { routes } from "~/components/requests/index.server";
import { telemetry as tab } from "~/components/telemetry";
import { telemetryEnv } from "~/components/telemetry/env.server";
import { telemetry } from "~/components/telemetry/index.server";

type Post = { url: string; contentType: string; body: string };
type Attribute = { key: string; value: { stringValue: string } };

type Group = { resource: { attributes: Attribute[] } };

type SpanGroup = Group & {
  scopeSpans: { spans: { name: string; traceId: string; spanId: string }[] }[];
};

type LogGroup = Group & {
  scopeLogs: {
    logRecords: {
      severityNumber: number;
      body: { stringValue: string };
      traceId?: string;
      spanId?: string;
      attributes: Attribute[];
    }[];
  }[];
};

const tracesUrl = new URL("http://store.test/v1/traces");
const logsUrl = new URL("http://store.test/v1/logs");

async function server(
  options: { logsStatus?: number; resource?: [string, string][]; version?: string } = {},
) {
  const clock = makeTestClock({ now: 1_000_000 });
  const posts: Post[] = [];
  const stop = new AbortController();
  const sink = telemetry.server({
    service: "easel-test",
    tracesUrl,
    logsUrl,
    console: null,
    version: options.version,
    resource: options.resource,
  });
  const scope = createScope({
    clock,
    tags: [
      httpBackend(async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        posts.push({
          url,
          contentType: new Headers(init?.headers).get("content-type") ?? "",
          body: typeof init?.body === "string" ? init.body : "",
        });
        const status =
          new URL(url).pathname === logsUrl.pathname ? (options.logsStatus ?? 200) : 200;
        return new Response(null, { status });
      }),
    ],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      sink,
      routes({ stop: stop.signal, table: { "POST /api/telemetry": sink.route } }),
    ],
  });
  onTestFinished(async () => {
    stop.abort();
    await scope.close();
  });
  const live = await scope.ready;

  const wait = async (ms: number) => {
    for (let at = 0; at < ms; at += 1000) {
      clock.advance(1000);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await new Promise((done) => setTimeout(done, 0));
    }
  };
  const spanGroups = () =>
    posts
      .filter((post) => new URL(post.url).pathname === tracesUrl.pathname)
      .flatMap((post): SpanGroup[] => JSON.parse(post.body).resourceSpans);
  const logGroups = () =>
    posts
      .filter((post) => new URL(post.url).pathname === logsUrl.pathname)
      .flatMap((post): LogGroup[] => JSON.parse(post.body).resourceLogs);
  const spans = () =>
    spanGroups().flatMap((group) => group.scopeSpans.flatMap((scope) => scope.spans));
  const logs = () =>
    logGroups().flatMap((group) => group.scopeLogs.flatMap((scope) => scope.logRecords));
  return { live, posts, wait, spans, logs, spanGroups, logGroups };
}

const resourceOf = (group: Group) =>
  Object.fromEntries(
    group.resource.attributes.map((entry) => [entry.key, entry.value.stringValue]),
  );

const work = operation({
  label: "test.work",
  run: (_deps, ctx) => {
    ctx.log.info("work done", { step: 1 });
    return 1;
  },
});

const last = operation({ label: "test.last", run: () => 1 });

test("a logs store that refuses each batch does not hold back the spans: the span after 700 calls still reaches the traces store", async () => {
  const at = await server({ logsStatus: 415 });

  for (let index = 0; index < 700; index++) {
    at.live.run(work);
    await new Promise((done) => setTimeout(done, 0));
  }
  at.live.run(last);
  await at.wait(5000);

  expect(at.spans().map((span) => span.name)).toContain("test.last");
});

test("a log line goes to the logs endpoint as OTLP JSON, with the trace id and span id of its call", async () => {
  const at = await server();

  at.live.run(work);
  await at.wait(2000);

  const sent = at.posts.filter((post) => new URL(post.url).pathname === logsUrl.pathname);
  expect(sent.length).toBeGreaterThan(0);
  expect(sent.every((post) => post.contentType === "application/json")).toBe(true);

  const span = at.spans().find((one) => one.name === "test.work");
  const line = at.logs().find((one) => one.body.stringValue === "work done");
  expect(line).toMatchObject({
    severityNumber: 9,
    traceId: span?.traceId,
    spanId: span?.spanId,
    attributes: [{ key: "step", value: { stringValue: "1" } }],
  });
});

test("the server's spans and logs name the service, its version and each resource attribute", async () => {
  const at = await server({
    version: "abc1234",
    resource: telemetryEnv.parse({
      OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=production, team=design%20tools,bad",
    }).resource,
  });

  at.live.run(work);
  await at.wait(2000);

  const expected = {
    "service.name": "easel-test",
    "service.version": "abc1234",
    "deployment.environment": "production",
    team: "design tools",
  };
  expect(at.spanGroups().map(resourceOf)).toContainEqual(expect.objectContaining(expected));
  expect(at.logGroups().map(resourceOf)).toContainEqual(expect.objectContaining(expected));
});

test("the tab's spans and logs, posted to the server, go out as the service `<service>-web`, with their own trace id", async () => {
  const at = await server({ version: "abc1234" });
  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  const spanId = "00f067aa0ba902b7";

  const batch = {
    traces: [
      {
        side: "browser",
        traceId,
        spanId,
        flags: 1,
        name: "ws.send",
        kind: 1,
        startTimeUnixNano: "1000000000000",
        endTimeUnixNano: "1000000000000",
        attributes: [],
        events: [],
        status: { code: 1 },
      },
    ],
    logs: [
      {
        time: 1_000_000,
        level: 50,
        msg: "tab error",
        service: "tab",
        side: "browser",
        traceId,
        spanId,
      },
    ],
  };
  const reply = await at.live.resolve(routes).fetch(
    new Request("http://app.example/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://app.example" },
      body: JSON.stringify(batch),
    }),
    at.live,
  );
  expect(reply?.status).toBe(202);
  await at.wait(2000);

  const tabSpans = at
    .spanGroups()
    .filter((group) => resourceOf(group)["service.name"] === "easel-test-web");
  expect(tabSpans.flatMap((group) => group.scopeSpans[0]?.spans ?? [])).toMatchObject([
    { name: "ws.send", traceId, spanId },
  ]);
  expect(resourceOf(tabSpans[0] ?? { resource: { attributes: [] } })).toMatchObject({
    "service.version": "abc1234",
  });
  const tabLogs = at
    .logGroups()
    .filter((group) => resourceOf(group)["service.name"] === "easel-test-web");
  expect(tabLogs.flatMap((group) => group.scopeLogs[0]?.logRecords ?? [])).toMatchObject([
    { severityNumber: 17, body: { stringValue: "tab error" }, traceId, spanId },
  ]);
});

const shareSecret = "a90db09138d3295f95f36399f58c2e1d";
const pictureKey = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const leaky = operation({
  label: "test.leaky",
  run: (_deps, ctx) => {
    ctx.log.warn(`open https://easel.example/s/${shareSecret}?page=1`, {
      password: "hunter2-long-enough",
      authorization: "Bearer sk-live-0123456789abcdef",
      url: `/api/pictures/c1/f1/3?key=${pictureKey}`,
      frame: "<main><h1>Private plan</h1></main>",
    });
    throw new Error(`share ${shareSecret} refused for token=opensesame`);
  },
});

test("no span, log line or error text sends a password, a token, a share link secret, a picture key or a frame document", async () => {
  const at = await server();

  await Promise.resolve()
    .then(() => at.live.run(leaky))
    .catch(() => undefined);
  await at.wait(2000);

  const everything = at.posts.map((post) => post.body).join("\n");
  expect(everything).toContain("test.leaky");
  for (const secret of [
    shareSecret,
    pictureKey,
    "hunter2",
    "sk-live",
    "opensesame",
    "Private plan",
    "<main>",
  ]) {
    expect(everything).not.toContain(secret);
  }
});

const broken = operation({
  label: "test.broken",
  run: () => {
    throw new Error("the store is gone");
  },
});

const step = operation({ label: "test.step", run: () => 2 });

const outer = operation({
  label: "test.outer",
  depends: { step },
  run: ({ step }) => step.run() + 1,
});

test("each call that ends well sends one info line with its trace id, span id, time and outcome; its steps send none", async () => {
  const at = await server();

  at.live.run(outer);
  await at.wait(2000);

  const call = at.spans().find((span) => span.name === "test.outer");
  expect(at.spans().map((span) => span.name)).toContain("test.step");
  expect(at.logs()).toEqual([
    {
      timeUnixNano: expect.stringMatching(/^\d+$/),
      severityNumber: 9,
      severityText: "INFO",
      body: { stringValue: "test.outer" },
      traceId: call?.traceId,
      spanId: call?.spanId,
      attributes: [
        { key: "ms", value: { stringValue: "0" } },
        { key: "outcome", value: { stringValue: '"ok"' } },
      ],
    },
  ]);
});

test("a failed call sends one error line with its trace id, and no info line", async () => {
  const at = await server();

  await Promise.resolve()
    .then(() => at.live.run(broken))
    .catch(() => undefined);
  await at.wait(2000);

  const failed = at.spans().find((span) => span.name === "test.broken");
  expect(at.logs()).toEqual([
    expect.objectContaining({
      severityNumber: 17,
      body: { stringValue: "test.broken" },
      traceId: failed?.traceId,
      spanId: failed?.spanId,
    }),
  ]);
});

test("an uncaught error of the tab becomes an error log line of the tab", async () => {
  const sent: string[] = [];
  const page = new EventTarget();
  const clock = makeTestClock({ now: 1_000_000 });
  const scope = createScope({
    clock,
    tags: [
      httpBackend(async (_input, init) => {
        sent.push(typeof init?.body === "string" ? init.body : "");
        return new Response(null, { status: 204 });
      }),
    ],
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      tab.browser({ service: "test-tab", console: null, errors: page }),
    ],
  });
  onTestFinished(async () => {
    await scope.close();
  });
  await scope.ready;

  page.dispatchEvent(
    Object.assign(new Event("error"), { error: new TypeError("x is not a function") }),
  );
  page.dispatchEvent(
    Object.assign(new Event("unhandledrejection"), { reason: new Error("load failed") }),
  );
  clock.advance(1000);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((done) => setTimeout(done, 0));

  const logs = sent.flatMap(
    (body): { level: number; msg: string; attributes?: Record<string, string> }[] =>
      JSON.parse(body).logs,
  );
  expect(logs).toEqual([
    expect.objectContaining({
      level: 50,
      msg: "tab error",
      attributes: { name: '"TypeError"', message: '"x is not a function"' },
    }),
    expect.objectContaining({
      level: 50,
      msg: "tab error",
      attributes: { name: '"Error"', message: '"load failed"' },
    }),
  ]);
});

test("thread: the worker sends the info line of each call and the error line of each failed call, with their trace ids", async () => {
  const bodies: { path: string; body: string }[] = [];
  const store = Bun.serve({
    port: 0,
    fetch: async (request) => {
      bodies.push({ path: new URL(request.url).pathname, body: await request.text() });
      return new Response(null, { status: 200 });
    },
  });
  onTestFinished(async () => {
    await store.stop();
  });
  const scope = createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      telemetry.thread({
        service: "easel-thread-test",
        tracesUrl: new URL(`${store.url}v1/traces`),
        logsUrl: new URL(`${store.url}v1/logs`),
        console: null,
        worker: new URL("../cmds/telemetry-worker.ts", import.meta.url),
      }),
    ],
  });
  const live = await scope.ready;

  live.run(outer);
  await Promise.resolve()
    .then(() => live.run(broken))
    .catch(() => undefined);
  await scope.close();

  const spans = bodies
    .filter((post) => post.path === "/v1/traces")
    .flatMap((post): SpanGroup[] => JSON.parse(post.body).resourceSpans)
    .flatMap((group) => group.scopeSpans.flatMap((one) => one.spans));
  const logs = bodies
    .filter((post) => post.path === "/v1/logs")
    .flatMap((post): LogGroup[] => JSON.parse(post.body).resourceLogs)
    .flatMap((group) => group.scopeLogs.flatMap((one) => one.logRecords));
  const traceOf = (name: string) => spans.find((span) => span.name === name)?.traceId;
  expect(logs.map((line) => [line.severityNumber, line.body.stringValue, line.traceId])).toEqual(
    expect.arrayContaining([
      [9, "test.outer", traceOf("test.outer")],
      [17, "test.broken", traceOf("test.broken")],
    ]),
  );
  expect(logs.filter((line) => line.body.stringValue === "test.step")).toEqual([]);
});
