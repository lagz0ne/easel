import { Menu } from "@base-ui/react/menu";
import { useData, useRun } from "@tinkered/react";

import { openMenu, setMenu } from "./overlays";
import { pageList, pickPage } from "./pages";

type PageProps = { canvas: string; page: string };

export function PagesButton({ canvas, page }: PageProps) {
  const open = useData(openMenu, (m) => m === "pages");
  const name = useData(pageList({ canvas })).find((p) => p.key === page)?.name;
  const set = useRun(setMenu);

  return (
    <Menu.Root
      modal={false}
      open={open}
      onOpenChange={(next) => set.run({ input: { menu: "pages", open: next } })}
    >
      <Menu.Trigger className="e-dock-btn e-dock-page" aria-label="Pages" title="Pages">
        <svg className="e-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6" />
        </svg>
        <span className="e-dock-page-name">{name ?? page}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="e-menu-pos" side="top" sideOffset={8}>
          <PagesMenu canvas={canvas} page={page} />
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function PagesMenu({ canvas, page }: PageProps) {
  const all = useData(pageList({ canvas }));
  const pick = useRun(pickPage);

  return (
    <Menu.Popup className="e-menu e-pages" aria-label="Pages">
      <Menu.RadioGroup value={page}>
        {all.map((p) => (
          <Menu.RadioItem
            key={p.key}
            value={p.key}
            aria-label={`${p.name}, ${p.frames} ${p.frames === 1 ? "frame" : "frames"}`}
            onClick={() => pick.run({ input: { canvas, page: p.key, shown: page } })}
          >
            <span className="e-pages-name">{p.name}</span>
            <span className="e-menu-n">{p.frames}</span>
          </Menu.RadioItem>
        ))}
      </Menu.RadioGroup>
    </Menu.Popup>
  );
}
