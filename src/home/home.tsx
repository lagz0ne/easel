import { Link } from "@tanstack/react-router";
import { useData, useRun } from "@tinkered/react";
import { z } from "zod";

import { access } from "@/access";
import { authPaths } from "@/access/contract";

import { codesBoard, homeBoard } from "./contract";
import type { HomeRow, WaitingCode } from "./contract";
import { askAgain, askForCode, copyApproveCommand, signInStep, useSignInLink } from "./signin";
import type { OpenLink, Who } from "./signin";

import "./home.css";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const until = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

const signedOut = z.object({ signIn: z.literal(true) });

function AnotherWay() {
  return (
    <p className="e-home-note">
      Or run <code>easel open</code> on a computer where your CLI is signed in.
    </p>
  );
}

function NameStep() {
  const ask = useRun(askForCode);

  return (
    <>
      <form
        className="e-home-form"
        onSubmit={(event) => {
          event.preventDefault();
          const typed = new FormData(event.currentTarget).get("name");
          if (typeof typed === "string" && typed.trim()) {
            ask.run({ input: { name: typed.trim() } });
          }
        }}
      >
        <label htmlFor="e-home-name">Your name</label>
        <input
          id="e-home-name"
          name="name"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <button type="submit" className="e-home-primary" disabled={ask.isPending}>
          Get a code
        </button>
      </form>
      {ask.error ? <p role="alert">No answer. Try again.</p> : null}
      <p className="e-home-note">An owner of the team approves the code.</p>
      <AnotherWay />
    </>
  );
}

function CodeStep({ code, expiresAt }: { code: string; expiresAt: number }) {
  return (
    <div role="status" className="e-home-code">
      <p className="e-home-label">Your code</p>
      <p className="e-home-big">{code}</p>
      <p>Ask an owner to approve it with this command, or on their home page.</p>
      <CopyLine code={code} />
      <p>This page signs in when the owner approves it.</p>
      <p className="e-home-note">The code works until {until.format(expiresAt)}.</p>
      <AnotherWay />
    </div>
  );
}

function CopyLine({ code }: { code: string }) {
  const copy = useRun(copyApproveCommand);

  return (
    <div className="e-home-copy">
      <code>easel users approve {code}</code>
      <button type="button" onClick={() => copy.run({ input: { code } })}>
        {copy.isSuccess ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Again({ text }: { text: string }) {
  const again = useRun(askAgain);

  return (
    <div role="status" className="e-home-code">
      <p>{text}</p>
      <button type="button" className="e-home-primary" onClick={() => again.run()}>
        Get a new code
      </button>
    </div>
  );
}

function Step() {
  const step = useData(signInStep);
  switch (step.kind) {
    case "name":
      return <NameStep />;
    case "code":
      return <CodeStep code={step.code} expiresAt={step.expiresAt} />;
    case "denied":
      return <Again text="An owner denied the code." />;
    case "expired":
      return <Again text="The code ran out." />;
    case "slow":
      return (
        <Again text={`Too many tries. Wait ${Math.ceil(step.retryIn / 1000)} s, then try again.`} />
      );
    case "in":
      return <p role="status">Approved. Signing in.</p>;
  }
}

export function SignIn() {
  return (
    <main className="e-home e-home-narrow">
      <h1>Sign in to easel</h1>
      <Step />
    </main>
  );
}

function BadLink() {
  return (
    <main className="e-home e-home-narrow">
      <h1>This sign-in link does not work</h1>
      <p>
        A link works one time, for 5 minutes. Run <code>easel open</code> again.
      </p>
      <p>
        <Link to="/">Sign in with a code</Link>
      </p>
    </main>
  );
}

type AskProps = { link: string; name: string; now: string | null };

function AskToSignIn({ link, name, now }: AskProps) {
  const use = useRun(useSignInLink);
  if (use.isSuccess) {
    return (
      <main className="e-home e-home-narrow">
        <p role="status">Signing in.</p>
      </main>
    );
  }

  return (
    <main className="e-home e-home-narrow">
      <h1>Sign in as {name}</h1>
      <p>
        This link comes from <code>easel open</code>. Use it only if you ran that command.
      </p>
      {now !== null && now !== name ? (
        <p role="note">
          This browser is signed in as {now}. The button signs it in as {name}.
        </p>
      ) : null}
      <button
        type="button"
        className="e-home-primary"
        disabled={use.isPending}
        onClick={() => use.run({ input: { link } })}
      >
        Sign in as {name}
      </button>
    </main>
  );
}

export function OpenPage({ link }: { link: OpenLink }) {
  switch (link.kind) {
    case "bad":
      return <BadLink />;
    case "slow":
      return (
        <main className="e-home e-home-narrow">
          <p role="status">
            Too many tries. Wait {Math.ceil(link.retryIn / 1000)} s, then open the link again.
          </p>
        </main>
      );
    case "ask":
      return <AskToSignIn link={link.link} name={link.name} now={link.now} />;
  }
}

function Row({ row }: { row: HomeRow }) {
  const frames = `${row.frames} ${row.frames === 1 ? "frame" : "frames"}`;
  const pages = `${row.pages} ${row.pages === 1 ? "page" : "pages"}`;

  return (
    <li>
      <Link className="e-home-row" to="/c/$canvas" params={{ canvas: row.canvas }}>
        <span className="e-home-main">
          <span className="e-home-name">{row.name}</span>
          <span className="e-home-meta">
            {frames} · {pages} · changed {when.format(row.changed)}
          </span>
        </span>
        {row.inbox ? (
          <span className="e-home-inbox">
            <span aria-hidden="true">{row.inbox}</span>
            <span className="e-home-unseen">{row.inbox} wait for you</span>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function CanvasList({ list }: { list: readonly HomeRow[] }) {
  if (!list.length) {
    return (
      <p className="e-home-note">
        No canvases yet. An agent makes one with <code>easel canvas new &lt;name&gt;</code>.
      </p>
    );
  }

  const sorted = list.toSorted(
    (a, b) => Number(b.inbox > 0) - Number(a.inbox > 0) || b.changed - a.changed,
  );
  return (
    <ul className="e-home-list" aria-label="Canvases">
      {sorted.map((row) => (
        <Row key={row.canvas} row={row} />
      ))}
    </ul>
  );
}

function CodeRow({ row, me }: { row: WaitingCode; me: string }) {
  const approve = useRun(access.owner["users.approve"]);
  const deny = useRun(access.owner["users.deny"]);
  const busy = approve.isPending || deny.isPending;
  const theirs = row.user && row.name !== me;

  return (
    <li className="e-home-wait">
      <span className="e-home-main">
        <span className="e-home-name">{row.name}</span>
        <span className="e-home-meta">
          <code>{row.code}</code> · {row.browser ? "a browser" : "the CLI"} · until{" "}
          {until.format(row.expiresAt)}
        </span>
      </span>
      <span className="e-home-acts">
        <button
          type="button"
          disabled={busy}
          aria-label={`Deny ${row.code} of ${row.name}`}
          onClick={() => deny.run({ input: { code: row.code } })}
        >
          Deny
        </button>
        {theirs ? (
          <span className="e-home-meta">Only {row.name} can sign it in</span>
        ) : (
          <button
            type="button"
            className="e-home-primary"
            disabled={busy}
            aria-label={`Approve ${row.code} of ${row.name}`}
            onClick={() => approve.run({ input: { code: row.code, owner: false } })}
          >
            Approve
          </button>
        )}
      </span>
      {approve.error || deny.error ? <p role="alert">No answer. Try again.</p> : null}
    </li>
  );
}

function Codes({ me }: { me: string }) {
  const part = codesBoard.codes.where({});
  const list = useData(part);
  if (!list.length) return null;

  return (
    <section className="e-home-codes" aria-labelledby="e-home-codes">
      <h2 id="e-home-codes">Codes that wait for you</h2>
      <ul className="e-home-list">
        {list.map((row) => (
          <CodeRow key={row.code} row={row} me={me} />
        ))}
      </ul>
    </section>
  );
}

type ListedProps = { list: readonly HomeRow[]; ready: boolean; lost: boolean };

function Listed({ list, ready, lost }: ListedProps) {
  if (ready) return <CanvasList list={list} />;

  return (
    <p role="status" className="e-home-note">
      {lost ? "No answer from easel. It tries again." : "Opening"}
    </p>
  );
}

function Home({ name, owner }: { name: string; owner: boolean }) {
  const part = homeBoard.rows.where({});
  const list = useData(part);
  const state = useData(homeBoard.status(part));
  if (state?.status === "fault" && signedOut.safeParse(state.fault.payload).success) {
    return <SignIn />;
  }

  return (
    <main className="e-home">
      <header className="e-home-head">
        <h1>Canvases</h1>
        <form method="post" action={authPaths.out} className="e-home-out">
          <span className="e-home-meta">{owner ? `${name} (owner)` : name}</span>
          <button type="submit">Sign out</button>
        </form>
      </header>
      {owner ? <Codes me={name} /> : null}
      <Listed list={list} ready={state?.status === "ready"} lost={state?.status === "fault"} />
    </main>
  );
}

export function HomePage({ who }: { who: Who }) {
  switch (who.kind) {
    case "out":
      return <SignIn />;
    case "in":
      return <Home name={who.name} owner={who.owner} />;
  }
}
