import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { afterAll, beforeEach, expect, test } from "vite-plus/test";

import { routes } from "~/components/requests/index.server";
import { telemetry } from "~/components/telemetry/index.server";

const sent: { traces: string[]; logs: string[] } = { traces: [], logs: [] };

const collector = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname === "/traces" ? "traces" : "logs";
    sent[path].push(await request.text());
    return new Response(null, { status: 204 });
  },
});

const sends = {
  service: "ingest-test",
  tracesUrl: new URL(`${collector.url}traces`),
  logsUrl: new URL(`${collector.url}logs`),
};

const sinks = {
  server: () => telemetry.server(sends),
  thread: () =>
    telemetry.thread({
      ...sends,
      worker: new URL("../cmds/telemetry-worker.ts", import.meta.url),
    }),
};

const tabLine = { time: Date.now(), level: 30, msg: "tab line", service: "tab", side: "browser" };

beforeEach(() => {
  sent.traces.length = sent.logs.length = 0;
});

afterAll(async () => {
  await collector.stop();
});

for (const [name, make] of Object.entries(sinks)) {
  test(`${name}: a tab batch posted to /api/telemetry makes no server span or log line`, async () => {
    const sink = make();
    const stop = new AbortController();
    const app = await createScope({
      capsules: [
        exits({ file: process.env.TINKER_EXITS }),
        sink,
        routes({ stop: stop.signal, table: { "POST /api/telemetry": sink.route } }),
      ],
    }).ready;
    const post = () =>
      app.resolve(routes).fetch(
        new Request("http://app.example/api/telemetry", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://app.example" },
          body: JSON.stringify({ traces: [], logs: [tabLine] }),
        }),
        app,
      );

    expect((await post())?.status).toBe(202);
    expect((await post())?.status).toBe(202);
    stop.abort();
    await app.close();

    const spans = sent.traces.flatMap((body) =>
      JSON.parse(body).resourceSpans.flatMap(
        (group: { scopeSpans: { spans: { name: string }[] }[] }) =>
          group.scopeSpans.flatMap((scope) => scope.spans.map((span) => span.name)),
      ),
    );
    expect(spans).toEqual([]);
    const groups: {
      resource: { attributes: { key: string; value: { stringValue: string } }[] };
      scopeLogs: { logRecords: { body: { stringValue: string } }[] }[];
    }[] = sent.logs.flatMap((body) => JSON.parse(body).resourceLogs);
    const linesOf = (side: string) =>
      groups
        .filter((group) =>
          group.resource.attributes.some(
            (entry) => entry.key === "tinker.side" && entry.value.stringValue === side,
          ),
        )
        .flatMap((group) => group.scopeLogs.flatMap((scope) => scope.logRecords));
    expect(linesOf("server")).toEqual([]);
    expect(linesOf("browser").filter((line) => line.body.stringValue === "tab line")).toHaveLength(
      2,
    );
  });
}
