import { capsule, operation, tag, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { z } from "zod";

import { userApi } from "@/access/contract";

import { mcpServer } from "./server";

// MCP over HTTP (SPEC-mcp.md § A remote agent adds easel): `POST /mcp` with `Authorization:
// Bearer <token>`. The route checks the origin and that a bearer is there. Then the request goes
// to the scope of MCP, which reaches the server's calls through the protocol, as a socket does,
// with the request's token as each call's meta: each `onStart` guard runs (fact rule 3). One
// server and one transport serve one request, and close after it (judged rule 2).

/** The server's public origin (`PUBLIC_ORIGIN`). None: the origin of the request's URL. */
const origin = tag<string | null>({ label: "mcp.origin", default: null });

/** The scope of MCP, which answers each request: the cmd makes it, on a port to the server. */
const mcpScope = tag<Promise<Scope.Handle>>({ label: "mcp.scope" });

/** The bearer token of the request that a call of the scope of MCP serves. */
const bearer = tag<string>({ label: "mcp.bearer" });

/** `Authorization: Bearer <token>` (RFC 6750). */
const bearerHeader = z
  .string()
  .regex(/^Bearer \S+$/)
  .transform((header) => header.slice("Bearer ".length));

/** A 401, as RFC 6750 § 3 gives it: the client must send a token. */
const signIn = operation({
  label: "mcp.signIn",
  run: () =>
    new Response("sign in: send Authorization: Bearer <token> from `easel login`", {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="easel"' },
    }),
});

/** The meta of each call of the scope of MCP: the bearer of its request. */
export const mcpMeta = operation({
  label: "mcp.meta",
  depends: { bearer: bearer.required },
  run: async ({ bearer }): Promise<Record<string, string>> => ({
    authorization: `Bearer ${bearer}`,
  }),
});

/**
 * One request, with its token bound: `users.me` runs the `user` guard one time, before any tool.
 * A token that is not a live user's is 401, and no MCP server is made.
 */
const answerSignedIn = operation({
  label: "mcp.answerSignedIn",
  input: z.custom<Request>((value) => value instanceof Request),
  depends: { me: userApi["users.me"], mcpServer, signIn },
  run: async ({ me, mcpServer, signIn }, { input: request }) => {
    const who = await me.settle({ input: null });
    if (who.status !== "success") return signIn.run();

    const server = await mcpServer.run();
    const { WebStandardStreamableHTTPServerTransport } =
      await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
    const link = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(link);
    try {
      return await link.handleRequest(request);
    } finally {
      await server.close();
    }
  },
});

/** One request in the scope of MCP: its token is the meta of each call that it makes. */
export const mcpAnswer = operation({
  label: "mcp.answer",
  input: z.custom<Request>((value) => value instanceof Request),
  depends: { answerSignedIn },
  run: ({ answerSignedIn }, { input: request }) => {
    const token = bearerHeader.parse(request.headers.get("authorization"));

    return answerSignedIn.run({ input: request, tags: [bearer(token)] });
  },
});

/**
 * `/mcp` on the server: a foreign `Origin` is 403 (DNS rebinding, MCP's transport spec), and no
 * bearer is 401. Only `POST` serves: this server keeps no session, so it has no stream to `GET`.
 */
export const mcpRoute = operation({
  label: "mcp.route",
  depends: { request: transport.request.required, origin, scope: mcpScope.required, signIn },
  run: async ({ request, origin, scope, signIn }) => {
    const own = origin ?? new URL(request.url).origin;
    const from = request.headers.get("origin");
    if (from !== null && from !== own) return new Response("forbidden origin", { status: 403 });
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
    }
    if (!bearerHeader.safeParse(request.headers.get("authorization")).success) return signIn.run();

    return (await scope).run(mcpAnswer, { input: request });
  },
});

/** MCP over HTTP on the server: the cmd gives the public origin and the scope of MCP. */
export const mcpHttp = capsule({
  label: "mcp.http",
  config: { origin, scope: mcpScope.required },
  exports: { route: mcpRoute },
});
