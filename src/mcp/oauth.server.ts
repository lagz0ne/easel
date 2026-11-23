import { createHash, timingSafeEqual } from "node:crypto";

import { operation, resource, tag, transport } from "@tinkered/core";
import { z } from "zod";

import { digestOf } from "@/access/guards.server";
import { isLoopback, secretBytes, users } from "@/access/store.server";

export const origin = tag<string | null>({ label: "mcp.origin", default: null });

const claudeCallbacks = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

const codeLife = 60_000;

const htmlHeaders = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
};

const ask = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1).max(2000),
  redirect_uri: z.string().max(2000),
  code_challenge: z.string().regex(/^[\w-]{43}$/),
  code_challenge_method: z.literal("S256"),
  state: z.string().max(2000).optional(),
  resource: z.string().max(2000).optional(),
  scope: z.string().max(2000).optional(),
});

const exchange = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string(),
  code_verifier: z.string().regex(/^[\w.~-]{43,128}$/),
  redirect_uri: z.string(),
});

type HeldCode = { token: string; challenge: string; redirect: string; until: number };

const codes = resource({
  label: "oauth.codes",
  target: "scope",
  factory: () => new Map<string, HeldCode>(),
});

export const ownOrigin = operation({
  label: "oauth.ownOrigin",
  depends: { request: transport.request.required, origin },
  run: ({ request, origin }) => origin ?? new URL(request.url).origin,
});

const knownRedirect = operation({
  label: "oauth.knownRedirect",
  input: z.string(),
  depends: { isLoopback },
  run: ({ isLoopback }, { input }) => {
    const url = URL.parse(input);
    const loopback = url?.protocol === "http:" && isLoopback.run({ input: url.hostname });

    return claudeCallbacks.includes(input) || loopback;
  },
});

const tokenOfAUser = operation({
  label: "oauth.tokenOfAUser",
  input: z.string(),
  depends: { all: users.atScope.controller, digestOf },
  run: ({ all, digestOf }, { input }) => {
    const mine = Buffer.from(digestOf.run({ input }));
    let found = false;
    for (const row of all.get()) found = timingSafeEqual(mine, Buffer.from(row.digest)) || found;

    return found && input.length > 0;
  },
});

const htmlPage = operation({
  label: "oauth.htmlPage",
  input: z.object({ status: z.number(), body: z.string() }),
  run: (_, { input }) =>
    new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect to easel</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#1c1917}input{display:block;width:100%;box-sizing:border-box;margin:.5rem 0 1rem;padding:.5rem;font:inherit}button{padding:.5rem 1rem;font:inherit}[role=alert]{color:#b91c1c}@media (prefers-color-scheme:dark){body{background:#1c1917;color:#f5f5f4}}</style></head><body><main>${input.body}</main></body></html>`,
      { status: input.status, headers: htmlHeaders },
    ),
});

const htmlSafe = /[&<>"']/g;

const signInPage = operation({
  label: "oauth.signInPage",
  input: z.object({ status: z.number(), fields: ask, wrong: z.boolean() }),
  depends: { htmlPage },
  run: ({ htmlPage }, { input: { status, fields, wrong } }) => {
    const hidden = Object.entries(fields)
      .flatMap(([key, value]) =>
        value === undefined
          ? []
          : [
              `<input type="hidden" name="${key}" value="${value.replaceAll(htmlSafe, (c) => `&#${c.charCodeAt(0)};`)}">`,
            ],
      )
      .join("");
    const host = new URL(fields.redirect_uri).host.replaceAll(htmlSafe, "");
    const alert = wrong ? '<p role="alert">The token is wrong.</p>' : "";

    return htmlPage.run({
      input: {
        status,
        body: `<h1>Connect to easel</h1><p>The app at <b>${host}</b> asks for the easel tools. It can do what your easel user can do.</p><form method="post" action="/oauth/authorize">${hidden}<label>Your easel token<input name="token" type="password" autocomplete="off" required autofocus></label>${alert}<button type="submit">Connect</button></form><p>An owner of this easel gives you a token. Run <code>easel users revoke &lt;name&gt;</code> to stop it.</p>`,
      },
    });
  },
});

export const protectedResource = operation({
  label: "oauth.protectedResource",
  depends: { own: ownOrigin },
  run: ({ own }) => {
    const at = own.run();

    return Response.json({
      resource: `${at}/mcp`,
      authorization_servers: [at],
      bearer_methods_supported: ["header"],
    });
  },
});

export const authorizationServer = operation({
  label: "oauth.authorizationServer",
  depends: { own: ownOrigin },
  run: ({ own }) => {
    const at = own.run();

    return Response.json({
      issuer: at,
      authorization_endpoint: `${at}/oauth/authorize`,
      token_endpoint: `${at}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  },
});

const giveCode = operation({
  label: "oauth.giveCode",
  input: z.object({ fields: ask, token: z.string() }),
  depends: { own: ownOrigin, tokenOfAUser, signInPage, codes, bytes: secretBytes },
  run: (deps, { input: { fields, token }, clock }) => {
    const { own, tokenOfAUser, signInPage, codes, bytes } = deps;
    if (!tokenOfAUser.run({ input: token })) {
      return signInPage.run({ input: { status: 401, fields, wrong: true } });
    }

    const now = clock.currentTimeMillis();
    for (const [old, held] of codes) if (held.until <= now) codes.delete(old);
    const code = Buffer.from(bytes.run({ input: 32 })).toString("base64url");
    const { code_challenge: challenge, redirect_uri: redirect, state } = fields;
    codes.set(code, { token, challenge, redirect, until: now + codeLife });

    const to = new URL(redirect);
    to.searchParams.set("code", code);
    if (state !== undefined) to.searchParams.set("state", state);
    to.searchParams.set("iss", own.run());

    return new Response(null, {
      status: 302,
      headers: { location: to.href, "cache-control": "no-store" },
    });
  },
});

export const authorize = operation({
  label: "oauth.authorize",
  depends: {
    request: transport.request.required,
    knownRedirect,
    htmlPage,
    signInPage,
    giveCode,
  },
  run: async ({ request, knownRedirect, htmlPage, signInPage, giveCode }) => {
    const posted = request.method === "POST";
    const fields = posted
      ? new URLSearchParams(await request.text())
      : new URL(request.url).searchParams;
    const sent = ask.safeParse(Object.fromEntries(fields));
    if (!sent.success || !knownRedirect.run({ input: sent.data.redirect_uri })) {
      return htmlPage.run({
        input: {
          status: 400,
          body: "<h1>easel does not know this app</h1><p>easel does not send a sign-in to this address. Close this window.</p>",
        },
      });
    }
    if (!posted) return signInPage.run({ input: { status: 200, fields: sent.data, wrong: false } });

    return giveCode.run({ input: { fields: sent.data, token: fields.get("token") ?? "" } });
  },
});

const tokenError = operation({
  label: "oauth.tokenError",
  input: z.enum(["invalid_grant", "unsupported_grant_type"]),
  run: (_, { input: error }) =>
    Response.json({ error }, { status: 400, headers: { "cache-control": "no-store" } }),
});

export const token = operation({
  label: "oauth.token",
  depends: { request: transport.request.required, codes, tokenError },
  run: async ({ request, codes, tokenError }, { clock }) => {
    const fields = Object.fromEntries(new URLSearchParams(await request.text()));
    if (fields.grant_type !== "authorization_code") {
      return tokenError.run({ input: "unsupported_grant_type" });
    }

    const sent = exchange.safeParse(fields);
    const held = sent.success ? codes.get(sent.data.code) : undefined;
    if (!sent.success || !held) return tokenError.run({ input: "invalid_grant" });

    codes.delete(sent.data.code);
    const proof = createHash("sha256").update(sent.data.code_verifier).digest("base64url");
    const late = held.until <= clock.currentTimeMillis();
    if (late || held.redirect !== sent.data.redirect_uri || held.challenge !== proof) {
      return tokenError.run({ input: "invalid_grant" });
    }

    return Response.json(
      { access_token: held.token, token_type: "Bearer" },
      { headers: { "cache-control": "no-store" } },
    );
  },
});
