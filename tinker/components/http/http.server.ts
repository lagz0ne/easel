import { operation, resource } from "@tinkered/core";
import { z } from "zod";

import { abortReasons } from "~/components/errors";
import type { Errors } from "~/components/errors";
import { backendStop, requestStop } from "~/components/requests";

import { httpBackend } from "./backend";

const requestShape = z
  .strictObject({
    url: z.url({ protocol: /^https?$/ }),
    method: z
      .string()
      .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/)
      .toUpperCase(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
  })
  .brand<"HttpRequest">();

const nameShape = z.string();
const codeShape = z.union([z.string(), z.number()]);

const failureShape = z.object({
  name: z.unknown().optional(),
  code: z.unknown().optional(),
  cause: z.unknown().optional(),
});

export const http = resource({
  label: "http",
  target: "session",
  depends: {
    send: httpBackend,
    backendStop: backendStop.optional,
    requestStop: requestStop.optional,
  },
  factory: ({ send, backendStop, requestStop }, { closing, defer }) => {
    const stop = new AbortController();
    defer(() => stop.abort(abortReasons.closed));
    return {
      async send(url: string, init: RequestInit & { signal: AbortSignal }) {
        const signal = AbortSignal.any([
          init.signal,
          closing,
          stop.signal,
          ...(backendStop.present ? [backendStop.value] : []),
          ...(requestStop.present ? [requestStop.value] : []),
        ]);
        signal.throwIfAborted();
        const response = await send(url, { ...init, signal });
        return {
          status: response.status,
          headers: Object.fromEntries(
            Array.from(response.headers, ([name, value]): [string, string[]] => [
              name,
              name === "set-cookie" ? response.headers.getSetCookie() : [value],
            ]),
          ),
          body: await response.text(),
        };
      },
    };
  },
});

export const httpRequest = operation({
  label: "http.request",
  input: requestShape,
  depends: { http },
  run: ({ http }, { input, obs, signal, raise: coreRaise }) => {
    const raise: Errors.Raise = coreRaise;

    const { url, method, headers, body } = input;
    const path = new URL(url).pathname;
    return obs.child(`http ${method} ${path}`, async (span) => {
      if (span) {
        span.attributes["http.request.method"] = method;
        span.attributes["url.path"] = path;
      }
      try {
        const response = await http.send(url, { method, headers, body, signal: signal });
        if (span) span.attributes["http.response.status_code"] = response.status;
        return response;
      } catch (cause) {
        signal.throwIfAborted();
        const failure = failureShape.safeParse(cause);
        if (!failure.success) {
          return raise("HttpRequestFailed", {
            method,
            path,
          });
        }

        const nested = failureShape.safeParse(failure.data.cause);
        const details = nested.success ? nested.data : failure.data;
        const name = nameShape.optional().catch(undefined);
        const code = codeShape.optional().catch(undefined);

        return raise("HttpRequestFailed", {
          method,
          path,
          cause: {
            name: name.parse(details.name) ?? name.parse(failure.data.name),
            code: code.parse(details.code) ?? code.parse(failure.data.code),
          },
        });
      }
    });
  },
});
