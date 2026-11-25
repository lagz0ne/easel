import { operation } from "@tinkered/core";
import { z } from "zod";

const key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const designRequest = z.object({
  canvas: key,
  n: z.number().int().positive(),
  frame: key.nullable(),
  page: key,
  period: z.number().int().nonnegative(),
});

export type DesignRequest = z.infer<typeof designRequest>;

export const parseRequest = operation({
  label: "paseoAdapter.parseRequest",
  input: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
  run: (_, { input: data }) => {
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(data));
    } catch {
      return { kind: "malformed" as const, cause: "the body is not JSON" };
    }

    const read = designRequest.safeParse(body);
    if (!read.success) {
      const cause = read.error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; ");
      return { kind: "malformed" as const, cause };
    }
    return { kind: "request" as const, request: read.data };
  },
});

export const requestTexts = operation({
  label: "paseoAdapter.requestTexts",
  input: designRequest,
  run: (_, { input: request }) => {
    const { canvas, n } = request;
    const where = request.frame
      ? `frame ${request.frame} on page ${request.page}`
      : `the canvas, page ${request.page}`;
    const prompt = [
      `You are the design agent of easel for request ${canvas}#${n}, on ${where}.`,
      "",
      "You run non-interactive and unattended: no person watches this session. Never ask the user a question, and never wait for a person. A denied action means: do it another way within your rights, or release the request with a reason.",
      "Run each wait in the foreground, as a loop of the shell that ends when the wait ends, never as a background task: a session with only a background task shows as idle, so it does not count against the limit of agents that run.",
      "",
      `1. Claim the request: \`easel next --canvas ${canvas} --n ${n}\`. If the answer is not a claim, stop: another agent has it, or it is closed.`,
      "2. Read the request, its messages and its frame.",
      "3. Do the work as AGENTS.md and SPEC-design-loop.md rule 6 say: change the frame (a new version), the code, or both.",
      "4. Keep the claim live with `easel extend <claim>` while you work.",
      "5. Resolve with `easel resolve <claim> --text <what changed>` only when /api/version shows the build with the change. Name the build.",
      "6. If you cannot do it, give it back with `easel release <claim> --reason <why>`.",
      "",
      "Login: the easel CLI and the easel MCP tools act as the member vibea-claude. EASEL_CONFIG_HOME is set for you. Before you claim, run `easel whoami`: if it does not say vibea-claude, do not use the easel CLI, and use only the easel MCP tools. Never use another login, and never change the login files.",
    ].join("\n");

    return { ref: `${canvas}:${n}`, title: `design ${canvas}#${n}`, prompt };
  },
});
