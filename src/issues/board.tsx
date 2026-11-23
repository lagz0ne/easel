import { Link, useNavigate } from "@tanstack/react-router";
import type { PartState, RemoteFault } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import { memo } from "react";
import { z } from "zod";

import { type Issue, issueApi, issueBoard, states } from "./contract";
import { me as signedAs, signIn } from "./sign-in";

export function IssuesHome() {
  const signedIn = useRun(signIn);
  const navigate = useNavigate();
  const open = useRun(issueApi["team.create"], {
    onSuccess: (_, call) =>
      call.input && void navigate({ to: "/issues/$team", params: { team: call.input.teamId } }),
  });
  const me = useData(signedAs);

  return (
    <main>
      <h1>Issues</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const name = new FormData(event.currentTarget).get("name");
          if (typeof name === "string") signedIn.run({ input: { name } });
        }}
      >
        <input name="name" aria-label="Your name" defaultValue={me} />
        <button type="submit">Sign in</button>
      </form>
      {me && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const teamId = new FormData(event.currentTarget).get("team");
            if (typeof teamId === "string") {
              open.run({ input: { teamId: teamId.trim().toUpperCase() } });
            }
          }}
        >
          <input name="team" aria-label="Team key" placeholder="ENG" />
          <button type="submit">Open team</button>
        </form>
      )}
    </main>
  );
}

const notMember = z.object({ notMember: z.string() });

type Out<K extends "team.add" | "issue.create" | "issue.move" | "comment.add"> = Awaited<
  ReturnType<(typeof issueApi)[K]["run"]>
>;

function Moved({ out }: { out: Out<"issue.move"> | undefined }) {
  switch (out?.kind) {
    case undefined:
    case "moved":
      return null;
    case "stale":
      return <small role="status">Changed by someone else.</small>;
    case "gone":
      return <small role="status">This issue is gone.</small>;
  }
}

function Added({ out }: { out: Out<"team.add" | "issue.create" | "comment.add"> | undefined }) {
  switch (out?.kind) {
    case undefined:
    case "created":
    case "added":
      return null;
    case "gone":
      return <small role="status">That is gone, or you are not in this team.</small>;
  }
}

function NoAnswer({ read, sent }: { read?: boolean; sent?: boolean }) {
  if (read) return <p role="status">Offline. Trying again.</p>;

  return (
    <p role="status">
      {sent === false
        ? "Offline. Nothing was sent. Try again."
        : "No answer. It may be saved. Look, then try again."}
    </p>
  );
}

function Fault({ fault, read }: { fault: RemoteFault; read?: boolean }) {
  const { fault: kind, payload, sent, traceId } = fault;
  if (kind === "link") return <NoAnswer read={read} sent={sent} />;
  if (kind === "missing") return <p role="alert">This page is old. Load it again.</p>;

  const team = notMember.safeParse(payload).data?.notMember;
  if (kind === "refused") {
    return <p role="alert">{team ? `You are not in team ${team}.` : "Sign in first."}</p>;
  }

  return <p role="alert">{`Something broke.${traceId ? ` Ref ${traceId.slice(0, 8)}` : ""}`}</p>;
}

function CallFault({ error }: { error: unknown }) {
  return issueApi.fault.is(error) ? <Fault fault={error} /> : null;
}

function Waiting({ state, again }: { state: PartState | undefined; again: () => void }) {
  if (state?.status !== "fault") return <p role="status">Loading.</p>;

  return (
    <>
      <Fault fault={state.fault} read />
      {state.fault.fault !== "link" && (
        <button type="button" onClick={again}>
          Try again
        </button>
      )}
    </>
  );
}

export function Board({ teamId }: { teamId: string }) {
  const part = issueBoard.issues.where({ teamId });
  const list = useData(part);
  const state = useData(issueBoard.status(part));
  const again = useRun(issueBoard.invalidate);
  const create = useRun(issueApi["issue.create"]);
  const add = useRun(issueApi["team.add"]);
  if (state?.status !== "ready") {
    return (
      <main>
        <Waiting state={state} again={() => again.run({ input: { issues: { teamId } } })} />
      </main>
    );
  }

  return (
    <main>
      <h1>{teamId}</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const title = new FormData(event.currentTarget).get("title");
          if (typeof title === "string") create.run({ input: { teamId, title } });
          event.currentTarget.reset();
        }}
      >
        <input name="title" aria-label="New issue" placeholder="What is wrong?" />
        <button type="submit">Add issue</button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const userId = new FormData(event.currentTarget).get("user");
          if (typeof userId === "string") add.run({ input: { teamId, userId } });
          event.currentTarget.reset();
        }}
      >
        <input name="user" aria-label="Add member" placeholder="name" />
        <button type="submit">Add member</button>
      </form>
      <Added out={create.data} />
      <Added out={add.data} />
      <CallFault error={create.error ?? add.error} />
      <div className="lanes">
        {states.map((state) => (
          <section key={state} aria-label={state}>
            <h2>{state}</h2>
            {list
              .filter((i) => i.state === state)
              .toSorted((a, b) => a.number - b.number)
              .map((i) => (
                <Card key={i.id} issue={i} />
              ))}
          </section>
        ))}
      </div>
    </main>
  );
}

const Card = memo(function Card({ issue }: { issue: Issue }) {
  const move = useRun(issueApi["issue.move"]);
  const { teamId, id } = issue;

  const name = `${teamId}-${issue.number}`;
  return (
    <article>
      <Link to="/issues/$team/$id" params={{ team: teamId, id }}>
        {name}
      </Link>{" "}
      {issue.title}
      <select
        aria-label={`State of ${name}`}
        value={issue.state}
        onChange={(event) => {
          const state = states.find((s) => s === event.target.value);
          if (state) move.run({ input: { teamId, id, version: issue.version, state } });
        }}
      >
        {states.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
      <Moved out={move.data} />
      <CallFault error={move.error} />
    </article>
  );
});

export function Thread({ teamId, issueId }: { teamId: string; issueId: string }) {
  const part = issueBoard.comments.where({ teamId, issueId });
  const thread = useData(part);
  const state = useData(issueBoard.status(part));
  const again = useRun(issueBoard.invalidate);
  const say = useRun(issueApi["comment.add"]);
  if (state?.status !== "ready") {
    return (
      <aside aria-label="Comments">
        <Waiting
          state={state}
          again={() => again.run({ input: { comments: { teamId, issueId } } })}
        />
      </aside>
    );
  }

  return (
    <aside aria-label="Comments">
      {thread.map((c) => (
        <p key={c.id}>{`${c.author}: ${c.text}`}</p>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const text = new FormData(event.currentTarget).get("text");
          if (typeof text === "string") say.run({ input: { teamId, issueId, text } });
          event.currentTarget.reset();
        }}
      >
        <input name="text" aria-label="Comment" />
        <button type="submit">Comment</button>
      </form>
      <Added out={say.data} />
      <CallFault error={say.error} />
    </aside>
  );
}
