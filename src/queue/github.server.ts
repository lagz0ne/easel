import { operation, tag } from "@tinkered/core";
import { z } from "zod";

// The one GitHub client of easel (SPEC-queue.md fact rule 7): only `channel.set` and the
// dispatcher call it. It sends one REST call with the token of a channel, and waits at most 10 s
// for the answer, by the clock of the run. The token goes in the `Authorization` header only. No
// answer, cause or error of this module holds it: `scrub` takes it out of each text from GitHub.

/**
 * How easel reaches GitHub: the cmd gives the global `fetch`; a test gives a double of GitHub.
 * Unset, each call fails, as GitHub out of reach.
 */
export const githubFetch = tag<(request: Request) => Promise<Response>>({
  label: "queue.githubFetch",
  default: () => Promise.reject(new Error("no fetch given")),
});

/** The root of GitHub's REST API: GitHub's own; a test's double has its own. */
export const githubBase = tag<string>({
  label: "queue.githubBase",
  default: "https://api.github.com",
});

/** A call to GitHub that does not answer in this many ms fails with the cause `timeout`. */
export const githubTimeout = 10_000;

/** One REST call: the token, the method, the path under the root, and a JSON body. */
const githubRequest = z.object({
  token: z.string(),
  method: z.enum(["GET", "POST", "PATCH"]),
  path: z.string(),
  body: z.record(z.string(), z.unknown()).optional(),
});

/** A text from GitHub, with each copy of the token taken out, and at most 300 characters. */
export const scrub = operation({
  label: "queue.scrub",
  input: z.object({ text: z.string(), token: z.string() }),
  run: (_, { input: { text, token } }) => text.replaceAll(token, "[token]").slice(0, 300),
});

/** The `message` of GitHub's error body (`{ "message": "Not Found" }`), or the status alone. */
export const githubMessage = operation({
  label: "queue.githubMessage",
  input: z.object({ body: z.unknown(), token: z.string() }),
  depends: { scrub },
  run: ({ scrub }, { input }) => {
    const said = z.object({ message: z.string() }).safeParse(input.body);
    const text = said.success ? said.data.message : "no message";

    return scrub.run({ input: { text, token: input.token } });
  },
});

/**
 * One call to GitHub. It answers `answer` with the status and the JSON body (`null` when the body
 * is not JSON), `timeout` after 10 s with no answer, or `network` when GitHub cannot be reached.
 */
export const githubCall = operation({
  label: "queue.githubCall",
  input: githubRequest,
  depends: { send: githubFetch, base: githubBase },
  run: async ({ send, base }, { input, clock, signal }) => {
    const stop = new AbortController();
    const late = clock.sleep(githubTimeout, AbortSignal.any([signal, stop.signal])).then(
      () => true,
      () => false,
    );
    const request = new Request(`${base}${input.path}`, {
      method: input.method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.token}`,
        "user-agent": "easel",
        "x-github-api-version": "2022-11-28",
        ...(input.body ? { "content-type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: stop.signal,
    });
    const answer = send(request).then(
      async (response) => ({
        kind: "answer" as const,
        status: response.status,
        body: await response.json().catch(() => null),
      }),
      () => ({ kind: "network" as const }),
    );
    const first = await Promise.race([answer, late.then((ran) => (ran ? "late" : "stopped"))]);
    stop.abort();
    if (first === "late") return { kind: "timeout" as const };
    if (first === "stopped") return answer;

    return first;
  },
});
