import { z } from "zod";

// A test double of GitHub's REST API, as an injected fetch: the server's dispatcher and
// `channel.set` call it in place of api.github.com. It keeps repositories, labels, issues and
// comments, and each call it got. A test makes it fail: a status, no answer (until the call's
// signal aborts), or a fetch that throws. It never reaches the real GitHub.

export type Issue = {
  number: number;
  repo: string;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  comments: string[];
};

/** What the double does with a call before it answers it: nothing (null), or a failure. */
type Fault = { status: number; message: string } | "hang" | "throw" | null;

const issueBody = z.object({ title: z.string(), body: z.string(), labels: z.array(z.string()) });
const commentBody = z.object({ body: z.string() });
const stateBody = z.object({ state: z.enum(["open", "closed"]) });

export function githubDouble(token: string) {
  const repos = new Map<string, { private: boolean; labels: Set<string>; canWrite: boolean }>([
    ["acme/design", { private: true, labels: new Set(), canWrite: true }],
  ]);
  const issues: Issue[] = [];
  const calls: Array<{ method: string; path: string; authorized: boolean }> = [];
  let fault: (method: string, path: string) => Fault = () => null;
  /** Called after each issue or comment, as GitHub starts a run of the agent. */
  let onRun: (issue: Issue) => void = () => undefined;

  const answer = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  type Repo = { private: boolean; labels: Set<string>; canWrite: boolean };
  type Call = { request: Request; method: string; key: string; repo: Repo; num?: string };

  /** The routes of the double: `METHOD part[/sub]`, after `/repos/{owner}/{name}`. */
  const routes: Record<string, (call: Call) => Promise<Response> | Response> = {
    "GET ": ({ key, repo }) => answer(200, { full_name: key, private: repo.private }),
    "POST labels": async ({ request, repo }) => {
      const label = z.object({ name: z.string() }).parse(await request.json()).name;
      if (repo.labels.has(label)) return answer(422, { message: "Validation Failed" });

      repo.labels.add(label);
      return answer(201, { name: label });
    },
    "POST issues": async ({ request, key }) => {
      const made = issueBody.parse(await request.json());
      const number = issues.length + 1;
      const issue: Issue = { number, repo: key, ...made, state: "open", comments: [] };

      issues.push(issue);
      onRun(issue);
      return answer(201, { number });
    },
    "GET issue": ({ key, num }) => {
      const issue = issueAt(key, num);
      return issue ? answer(200, { number: issue.number, state: issue.state }) : notFound();
    },
    "PATCH issue": async ({ request, key, num }) => {
      const issue = issueAt(key, num);
      if (!issue) return notFound();

      issue.state = stateBody.parse(await request.json()).state;
      return answer(200, { number: issue.number, state: issue.state });
    },
    "POST issue/comments": async ({ request, key, num }) => {
      const issue = issueAt(key, num);
      if (!issue) return notFound();

      const said = commentBody.parse(await request.json()).body;
      issue.comments.push(said);
      if (said.startsWith("@")) onRun(issue);
      return answer(201, { id: issue.comments.length });
    },
  };
  const issueAt = (key: string, num?: string) =>
    issues.find((i) => i.repo === key && i.number === Number(num));
  const notFound = () => answer(404, { message: "Not Found" });

  /** What a fault makes of a call: an answer, a fetch that throws or hangs; null for none. */
  const faulted = (request: Request, failing: Fault) => {
    if (failing === "throw") return Promise.reject(new Error(`connect failed for ${token}`));
    if (failing === "hang") {
      return new Promise<Response>((_, reject) =>
        request.signal.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    }
    return failing && answer(failing.status, { message: failing.message });
  };

  /** A path, read: the repository, the issue's number, and the shape of the route. */
  const partsOf = (path: string) => {
    const [, key = "", part = "", num, sub] =
      /^\/repos\/([^/]+\/[^/]+)(?:\/(\w+)(?:\/(\d+)(?:\/(\w+))?)?)?$/.exec(path) ?? [];
    const shape = num === undefined ? part : `issue${sub ? `/${sub}` : ""}`;

    return { key, num, shape };
  };

  const fetch = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const method = request.method;
    const authorized = request.headers.get("authorization") === `Bearer ${token}`;
    calls.push({ method, path, authorized });

    const failed = faulted(request, fault(method, path));
    if (failed) return failed;
    if (!authorized) return answer(401, { message: "Bad credentials" });

    const { key, num, shape } = partsOf(path);
    const repo = repos.get(key);
    if (!repo) return notFound();
    if (!repo.canWrite && method !== "GET") {
      return answer(403, { message: "Resource not accessible by personal access token" });
    }

    const route = routes[`${method} ${shape}`];
    return route ? route({ request, method, key, repo, num }) : notFound();
  };

  return {
    fetch,
    repos,
    issues,
    calls,
    /** The calls that wrote: every one but a GET. */
    writes: () => calls.filter((call) => call.method !== "GET"),
    failWith: (next: (method: string, path: string) => Fault) => {
      fault = next;
    },
    onRun: (next: (issue: Issue) => void) => {
      onRun = next;
    },
  };
}

export type GithubDouble = ReturnType<typeof githubDouble>;
