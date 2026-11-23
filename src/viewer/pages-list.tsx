import { useData, useRun } from "@tinkered/react";

import { pageList, pagesOpen, pickPage, togglePages } from "./pages";

type PageProps = { canvas: string; page: string };

export function PagesButton({ canvas, page }: PageProps) {
  const open = useData(pagesOpen);
  const name = useData(pageList({ canvas })).find((p) => p.key === page)?.name;
  const toggle = useRun(togglePages);

  return (
    <button
      type="button"
      className="e-dock-btn e-dock-page"
      aria-label="Pages"
      aria-haspopup="menu"
      aria-expanded={open}
      title="Pages"
      onClick={() => toggle.run()}
    >
      <svg className="e-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
        <path d="M14 3v6h6" />
      </svg>
      <span className="e-dock-page-name">{name ?? page}</span>
    </button>
  );
}

export function PagesList({ canvas, page }: PageProps) {
  const open = useData(pagesOpen);
  if (!open) return null;

  return <PagesMenu canvas={canvas} page={page} />;
}

function PagesMenu({ canvas, page }: PageProps) {
  const all = useData(pageList({ canvas }));
  const pick = useRun(pickPage);

  return (
    <div className="e-menu e-pages" role="menu" aria-label="Pages">
      {all.map((p) => (
        <button
          key={p.key}
          type="button"
          role="menuitemradio"
          aria-checked={p.key === page}
          aria-label={`${p.name}, ${p.frames} ${p.frames === 1 ? "frame" : "frames"}`}
          onClick={() => pick.run({ input: { canvas, page: p.key, shown: page } })}
        >
          <span className="e-pages-name">{p.name}</span>
          <span className="e-menu-n">{p.frames}</span>
        </button>
      ))}
    </div>
  );
}
