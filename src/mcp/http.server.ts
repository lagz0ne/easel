import { capsule, operation, tag, transport } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { z } from "zod";

import { userApi } from "@/access/contract";

import { mcpServer } from "./server";

const origin = tag<string | null>({ label: "mcp.origin", default: null });

const mcpScope = tag<Promise<Scope.Handle>>({ label: "mcp.scope" });

const bearer = tag<string>({ label: "mcp.bearer" });

const bearerHeader = z
  .string()
  .regex(/^Bearer \S+$/)
  .transform((header) => header.slice("Bearer ".length));

const signIn = operation({
  label: "mcp.signIn",
  run: () =>
    new Response("sign in: send Authorization: Bearer <token> from `easel login`", {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="easel"' },
    }),
});

export const mcpMeta = operation({
  label: "mcp.meta",
  depends: { bearer: bearer.required },
  run: async ({ bearer }): Promise<Record<string, string>> => ({
    authorization: `Bearer ${bearer}`,
  }),
});

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

export const mcpAnswer = operation({
  label: "mcp.answer",
  input: z.custom<Request>((value) => value instanceof Request),
  depends: { answerSignedIn },
  run: ({ answerSignedIn }, { input: request }) => {
    const token = bearerHeader.parse(request.headers.get("authorization"));

    return answerSignedIn.run({ input: request, tags: [bearer(token)] });
  },
});

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

export const mcpHttp = capsule({
  label: "mcp.http",
  config: { origin, scope: mcpScope.required },
  exports: { route: mcpRoute },
});
