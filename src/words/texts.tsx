import { Link } from "@tanstack/react-router";
import { SessionProvider, useController, useData } from "@tinkered/react";

import { HomePage } from "@/home/home";
import type { Site, Who } from "@/home/signin";
import type { Text } from "@/kit/texts";

import type { TextsUses, TextUse } from "./contract";
import { textsGroup, textsShow, textsViewCell } from "./view";
import type { TextsView } from "./view";

import "@/home/home.css";
import "./texts.css";

const manyUses = 2;

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

type MarkProps = { kind: "missing" | "unused"; note?: string; children: string };

function Mark({ kind, note, children }: MarkProps) {
  return (
    <span className="e-texts-mark" data-mark={kind} title={note}>
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

type Line = {
  id: string;
  kind: "team" | "unknown" | "own";
  is: Record<TextsView["show"], boolean>;
  key?: string;
  en?: Text;
  vi?: Text;
  uses: readonly TextUse[];
};

type Group = { name: string | null; lines: readonly Line[] };

const lastGroups = ["No key", "Not used"];

const showNames = {
  all: "All texts",
  missing: "Vietnamese: not translated",
  unused: "Not used",
  nokey: "No key",
  unknown: "Not in the team",
} satisfies Record<TextsView["show"], string>;

const groupNames = {
  none: "None",
  prefix: "Key prefix",
  canvas: "Canvas",
} satisfies Record<TextsView["group"], string>;

function KeyCell({ line }: { line: Line }) {
  if (line.key === undefined) {
    return (
      <Mark kind="missing" note="A text with no key has no translation. An agent gives it a key.">
        No key
      </Mark>
    );
  }

  return <code>{line.key}</code>;
}

function EnCell({ line }: { line: Line }) {
  if (line.en === undefined) {
    return (
      <Mark kind="missing" note="A frame uses this key, and the texts of the team do not have it.">
        Not in the team
      </Mark>
    );
  }

  return <Shown text={line.en} />;
}

function ViCell({ line }: { line: Line }) {
  if (line.vi !== undefined) return <Shown text={line.vi} />;
  if (line.kind !== "team") return null;

  return <Mark kind="missing">Not translated</Mark>;
}

function TextRow({ line }: { line: Line }) {
  return (
    <tr id={line.kind === "team" ? `text-${line.key}` : undefined}>
      <th scope="row">
        <KeyCell line={line} />
      </th>
      <td lang="en">
        <EnCell line={line} />
      </td>
      <td lang="vi">
        <ViCell line={line} />
      </td>
      <td>
        <Uses uses={line.uses} />
      </td>
    </tr>
  );
}

function GroupBody({ group }: { group: Group }) {
  return (
    <tbody>
      {group.name === null ? null : (
        <tr className="e-texts-group">
          <th colSpan={4} scope="rowgroup">
            {group.name} <span className="e-home-meta">{group.lines.length}</span>
          </th>
        </tr>
      )}
      {group.lines.map((line) => (
        <TextRow key={line.id} line={line} />
      ))}
    </tbody>
  );
}

function Toolbar({ counts }: { counts: Readonly<Record<string, number>> }) {
  const view = useData(textsViewCell);
  const cell = useController(textsViewCell);

  return (
    <div className="e-texts-bar" role="search">
      <input
        type="search"
        aria-label="Find a text"
        placeholder="Find a key or a text"
        value={view.find}
        onChange={(event) => cell.update((was) => ({ ...was, find: event.target.value }))}
      />
      <label>
        Show
        <select
          value={view.show}
          onChange={(event) => {
            const show = textsShow.safeParse(event.target.value);
            if (show.success) cell.update((was) => ({ ...was, show: show.data }));
          }}
        >
          {textsShow.options.map((show) => (
            <option key={show} value={show}>
              {showNames[show]} ({counts[show] ?? 0})
            </option>
          ))}
        </select>
      </label>
      <label>
        Group by
        <select
          value={view.group}
          onChange={(event) => {
            const group = textsGroup.safeParse(event.target.value);
            if (group.success) cell.update((was) => ({ ...was, group: group.data }));
          }}
        >
          {textsGroup.options.map((group) => (
            <option key={group} value={group}>
              {groupNames[group]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function TextsTable({ uses }: { uses: TextsUses }) {
  const view = useData(textsViewCell);
  const lines: Line[] = [
    ...uses.texts.map((text) => ({
      id: `key ${text.key}`,
      kind: "team" as const,
      is: {
        all: true,
        missing: text.vi === undefined,
        unused: text.uses.length === 0,
        nokey: false,
        unknown: false,
      },
      key: text.key,
      en: text.en,
      vi: text.vi,
      uses: text.uses,
    })),
    ...uses.unknown.map((one) => ({
      id: `unknown ${one.key}`,
      kind: "unknown" as const,
      is: { all: true, missing: false, unused: false, nokey: false, unknown: true },
      key: one.key,
      uses: one.uses,
    })),
    ...uses.own.map((one) => ({
      id: `text ${one.text}`,
      kind: "own" as const,
      is: { all: true, missing: false, unused: false, nokey: true, unknown: false },
      en: one.text,
      uses: one.uses,
    })),
  ];
  const counts = Object.fromEntries(
    textsShow.options.map((show) => [show, lines.filter((line) => line.is[show]).length]),
  );
  const find = view.find.trim().toLowerCase();
  const shown = lines.filter(
    (line) =>
      line.is[view.show] &&
      JSON.stringify([line.key, line.en, line.vi]).toLowerCase().includes(find),
  );
  const placed = shown.flatMap((line) => {
    switch (view.group) {
      case "none":
        return [{ name: "", line }];
      case "prefix":
        return [{ name: line.key?.split(".")[0] ?? "No key", line }];
      case "canvas": {
        const canvases = [...new Set(line.uses.map((use) => use.canvas))];
        if (canvases.length === 0) return [{ name: "Not used", line }];
        return canvases.map((canvas) => ({
          name: canvas,
          line: {
            ...line,
            id: `${line.id} ${canvas}`,
            uses: line.uses.filter((use) => use.canvas === canvas),
          },
        }));
      }
    }
  });
  const grouped = Map.groupBy(placed, (one) => one.name);
  const groups: Group[] = [...grouped.keys()]
    .toSorted(
      (a, b) =>
        Number(lastGroups.includes(a)) - Number(lastGroups.includes(b)) || a.localeCompare(b),
    )
    .map((name) => ({
      name: view.group === "none" ? null : name,
      lines: (grouped.get(name) ?? []).map((one) => one.line),
    }));

  return (
    <>
      <Toolbar counts={counts} />
      <table className="e-texts-table" aria-label="Texts">
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">English</th>
            <th scope="col">Vietnamese</th>
            <th scope="col">Used in</th>
          </tr>
        </thead>
        {groups.map((group) => (
          <GroupBody key={group.name ?? "all"} group={group} />
        ))}
        {shown.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={4} className="e-home-meta">
                No text matches.
              </td>
            </tr>
          </tbody>
        ) : null}
      </table>
      <p className="e-home-note">
        Frames read: {uses.frames}. Image frames: {uses.pictures} (easel cannot read their words).
      </p>
    </>
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
        <SessionProvider>
          <TextsTable uses={uses} />
        </SessionProvider>
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
