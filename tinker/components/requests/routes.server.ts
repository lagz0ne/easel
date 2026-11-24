import { capsule, tag, transport } from "@tinkered/core";
import type { Ns, Operation, RunResult, Scope } from "@tinkered/core";

import { backendStop, requestStop } from "./lifetime";

export type Routes = Readonly<Record<`${string} /${string}`, Operation.Handle<any, any>>>;

const request = transport.request;

const reply = tag<(response: Response) => void>({ label: "routes.reply" });

const ns = tag<{ readonly op: Routes[keyof Routes]; readonly ns: Ns }>({ label: "routes.ns" });

const table = tag<Routes>({ label: "routes.table" });

const maxBody = tag<number>({ label: "routes.maxBody" });

const largeTable = tag<Routes>({ label: "routes.large.table" });

const largeMaxBody = tag<number>({ label: "routes.large.maxBody" });

const failures: Readonly<Record<string, number>> = { DataValidationFailed: 400, Cancelled: 503 };

export const routes = capsule({
  label: "routes",
  config: {
    table: table.required,
    stop: backendStop.required,
    ns: ns.all,
    maxBody: maxBody.optional,
  },
  exports: { request, reply, ns, stop: requestStop },
  hooks: {
    async start({ config, next }) {
      await next();

      type Row = {
        method: string;
        pattern: URLPattern;
        op: Routes[keyof Routes];
        ns?: Ns;
        head: string;
      };
      const fixed = new Map<string, Row>();
      const patterned: Row[] = [];
      for (const [key, op] of Object.entries(config.table)) {
        const [method, pathname] = key.split(" ") as [string, string];
        const pattern = new URLPattern({ pathname: pathname.replaceAll(/\{(\w+)\}/g, ":$1") });

        const plain = /^[\w\-.~/]*/.exec(pathname)![0];
        const head = plain === pathname ? plain : plain.slice(0, plain.lastIndexOf("/") + 1);
        const ns = config.ns.find((row) => row.op === op)?.ns;
        const row = { method, pattern, op, ns, head };

        const shadowed = patterned.some((r) => r.method === method && r.pattern.test({ pathname }));
        if (plain === pathname && !shadowed) fixed.set(key, row);
        else patterned.push(row);
      }

      const fetch = async (
        incoming: Request,
        scope: Scope.Handle,
      ): Promise<Response | undefined> => {
        const url = new URL(incoming.url);
        const method = incoming.method;
        let row = fixed.get(`${method} ${url.pathname}`);
        let params: Record<string, string | undefined> = {};
        for (let at = 0; !row && at < patterned.length; at++) {
          const next = patterned[at]!;
          if (next.method !== method || !url.pathname.startsWith(next.head)) continue;
          const match = next.pattern.exec(url);
          if (match) [row, params] = [next, match.pathname.groups];
        }
        if (!row) return undefined;

        const signal = AbortSignal.any([incoming.signal, config.stop]);
        const trace = transport.traceparentOf(incoming.headers.get("traceparent"));
        const early = Promise.withResolvers<Response>();
        let session: Scope.Handle | undefined;
        const settled = Promise.resolve()
          .then(() =>
            (session = scope.createSession({ trace, ns: row.ns })).settle(row.op, {
              rawInput: { ...Object.fromEntries(url.searchParams), ...params },
              signal,
              tags: [request(incoming), requestStop(signal), reply(early.resolve)],
            }),
          )
          .catch((error: unknown): RunResult<never> => ({ status: "failed", error, kind: "error" }))
          .finally(() => session?.close())
          .then((result) => {
            if (result.status === "success") {
              const value: unknown = result.value;
              if (value instanceof Response) return value;
              if (value === undefined) return new Response(null, { status: 204 });
              return Response.json(value, { headers: { "Cache-Control": "no-store" } });
            }
            const kind = result.status === "cancelled" ? "Cancelled" : Object(result.error).kind;
            return new Response(null, { status: failures[kind] ?? 500 });
          });

        const winner = await Promise.race([early.promise, settled]);
        for (const loser of [early.promise, settled]) {
          void loser.then((late) =>
            late === winner ? undefined : late.body?.cancel().catch(() => undefined),
          );
        }
        return winner;
      };
      return config.maxBody.present ? { fetch, maxBody: config.maxBody.value } : { fetch };
    },
  },
});

export const largeRoutes = capsule({
  label: "routes.large",
  config: {
    table: largeTable.required,
    stop: backendStop.required,
    ns: ns.all,
    maxBody: largeMaxBody.optional,
  },
  hooks: routes.hooks,
});
