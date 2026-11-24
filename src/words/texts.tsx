import { Link } from "@tanstack/react-router";

import { HomePage } from "@/home/home";
import type { Site, Who } from "@/home/signin";
import type { Text } from "@/kit/texts";

import type { OwnText, TextsUses, TextUse, UsedText } from "./contract";

import "@/home/home.css";
import "./texts.css";

const manyUses = 4;

function Shown({ text }: { text: Text }) {
  if (typeof text === "string") return <>{text}</>;

  return (
    <>
      one: {text.one}
      <br />
      other: {text.other}
    </>
  );
}

function Mark({ kind, children }: { kind: "missing" | "unused"; children: string }) {
  return (
    <span className="e-texts-mark" data-mark={kind}>
      {children}
    </span>
  );
}

function UseList({ uses }: { uses: readonly TextUse[] }) {
  return (
    <ul className="e-texts-uses">
      {uses.map((use) => (
        <li key={`${use.canvas} ${use.id}`}>
          <Link to="/c/$canvas" params={{ canvas: use.canvas }} hash={`frame-${use.id}`}>
            {use.name}
          </Link>
          <span className="e-home-meta">{use.canvas}</span>
        </li>
      ))}
    </ul>
  );
}

function Uses({ uses }: { uses: readonly TextUse[] }) {
  if (uses.length === 0) return <Mark kind="unused">Not used</Mark>;
  if (uses.length < manyUses) return <UseList uses={uses} />;

  return (
    <details>
      <summary>{uses.length} frames</summary>
      <UseList uses={uses} />
    </details>
  );
}

function TeamRow({ text }: { text: UsedText }) {
  return (
    <tr id={`text-${text.key}`}>
      <th scope="row">
        <code>{text.key}</code>
      </th>
      <td lang="en">
        <Shown text={text.en} />
      </td>
      <td lang="vi">
        {text.vi === undefined ? (
          <Mark kind="missing">Not translated</Mark>
        ) : (
          <Shown text={text.vi} />
        )}
      </td>
      <td>
        <Uses uses={text.uses} />
      </td>
    </tr>
  );
}

function TeamTable({ texts }: { texts: readonly UsedText[] }) {
  return (
    <table className="e-texts-table">
      <caption>Texts of the team</caption>
      <thead>
        <tr>
          <th scope="col">Text key</th>
          <th scope="col">English</th>
          <th scope="col">Vietnamese</th>
          <th scope="col">Used in</th>
        </tr>
      </thead>
      <tbody>
        {texts.map((text) => (
          <TeamRow key={text.key} text={text} />
        ))}
      </tbody>
    </table>
  );
}

function Missing({ keys }: { keys: readonly string[] }) {
  if (keys.length === 0) {
    return <p className="e-home-note">Each text of the team has a Vietnamese text.</p>;
  }

  return (
    <ul className="e-texts-uses" aria-label="Not translated">
      {keys.map((key) => (
        <li key={key}>
          <a href={`#text-${key}`}>
            <code>{key}</code>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Unknown({ list }: { list: TextsUses["unknown"] }) {
  if (list.length === 0) return null;

  return (
    <section aria-labelledby="e-texts-unknown">
      <h2 id="e-texts-unknown">Text keys that the team does not have</h2>
      <ul className="e-texts-own">
        {list.map((one) => (
          <li key={one.key}>
            <p className="e-texts-text">
              <code>{one.key}</code>
            </p>
            <Uses uses={one.uses} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function OwnList({ list }: { list: readonly OwnText[] }) {
  return (
    <section aria-labelledby="e-texts-own">
      <h2 id="e-texts-own">Texts with no key</h2>
      <p className="e-home-note">
        A text with no key has no translation. An agent gives it a key: data-easel-text in an HTML
        frame, or say in an app frame.
      </p>
      <ul className="e-texts-own" aria-label="Texts with no key">
        {list.map((one) => (
          <li key={one.text}>
            <p className="e-texts-text">{one.text}</p>
            <Uses uses={one.uses} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Counts({ uses }: { uses: TextsUses }) {
  const unused = uses.texts.filter((text) => text.uses.length === 0).length;

  return (
    <ul className="e-texts-counts" aria-label="Counts">
      <li>
        <strong>{uses.texts.length}</strong> texts of the team
      </li>
      <li>
        <strong>{unused}</strong> not used
      </li>
      <li>
        Vietnamese: <strong>{uses.missing.vi.length}</strong> not translated
      </li>
      <li>
        <strong>{uses.own.length}</strong> texts with no key
      </li>
      <li>
        <strong>{uses.frames}</strong> frames read, <strong>{uses.pictures}</strong> images: easel
        cannot read their words
      </li>
    </ul>
  );
}

function Texts({ uses }: { uses: TextsUses | null }) {
  return (
    <main className="e-home e-texts">
      <header className="e-texts-head">
        <h1>Texts</h1>
        <Link to="/">Canvases</Link>
      </header>
      {uses === null ? (
        <p role="alert">No answer from easel. Open the page again.</p>
      ) : (
        <>
          <Counts uses={uses} />
          <section aria-label="Texts of the team">
            <TeamTable texts={uses.texts} />
          </section>
          <section aria-labelledby="e-texts-missing">
            <h2 id="e-texts-missing">Vietnamese: not translated</h2>
            <Missing keys={uses.missing.vi} />
          </section>
          <Unknown list={uses.unknown} />
          <OwnList list={uses.own} />
        </>
      )}
    </main>
  );
}

type PageProps = { who: Who; site: Site; uses: TextsUses | null };

export function TextsPage({ who, site, uses }: PageProps) {
  switch (who.kind) {
    case "out":
      return <HomePage who={who} site={site} />;
    case "in":
      return <Texts uses={uses} />;
  }
}
