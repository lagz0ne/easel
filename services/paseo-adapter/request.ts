import { z } from "zod";

const key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const requestMessage = z.object({
  canvas: key,
  n: z.number().int().positive(),
  frame: key.nullable(),
  page: key,
  period: z.number().int().nonnegative(),
});

export type DesignRequest = z.infer<typeof requestMessage>;

export type Parsed =
  | { kind: "request"; request: DesignRequest }
  | { kind: "malformed"; cause: string };

export function parseRequest(data: Uint8Array): Parsed {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return { kind: "malformed", cause: "the body is not JSON" };
  }

  const read = requestMessage.safeParse(body);
  if (!read.success) {
    return { kind: "malformed", cause: read.error.issues.map(issueText).join("; ") };
  }
  return { kind: "request", request: read.data };
}

const issueText = (issue: z.core.$ZodIssue) =>
  `${issue.path.join(".") || "body"}: ${issue.message}`;

export const requestRef = (request: DesignRequest) => `${request.canvas}:${request.n}`;

export const agentTitle = (request: DesignRequest) => `design ${request.canvas}#${request.n}`;

export function agentPrompt(request: DesignRequest) {
  const { canvas, n } = request;
  const where = request.frame
    ? `frame ${request.frame} on page ${request.page}`
    : `the canvas, page ${request.page}`;

  return [
    `You are the design agent of easel for request ${canvas}#${n}, on ${where}.`,
    "",
    "You run non-interactive and unattended: no person watches this session. Never ask the user a question, and never wait for a person. A denied action means: do it another way within your rights, or release the request with a reason.",
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
}
