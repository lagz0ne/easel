import { operation, tag } from "@tinkered/core";
import { z } from "zod";

export const githubFetch = tag<(request: Request) => Promise<Response>>({
  label: "queue.githubFetch",
  default: () => Promise.reject(new Error("no fetch given")),
});

export const githubBase = tag<string>({
  label: "queue.githubBase",
  default: "https://api.github.com",
});

export const githubTimeout = 10_000;

const githubRequest = z.object({
  token: z.string(),
  method: z.enum(["GET", "POST", "PATCH"]),
  path: z.string(),
  body: z.record(z.string(), z.unknown()).optional(),
});

export const scrub = operation({
  label: "queue.scrub",
  input: z.object({ text: z.string(), token: z.string() }),
  run: (_, { input: { text, token } }) => text.replaceAll(token, "[token]").slice(0, 300),
});

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
