import { Menu } from "@base-ui/react/menu";
import { operation } from "@tinkered/core";
import { useData, useRun } from "@tinkered/react";
import { z } from "zod";

import { openMenu, setMenu } from "./overlays";
import { dockOffers, frameStates, localeSwitch, pickBoard, pickFrame, picksNow } from "./switches";
import type { FrameState, SwitchOffer } from "./switches";

export const pickSwitch = operation({
  label: "viewer.pickSwitch",
  input: z.object({ name: z.string(), value: z.string() }),
  depends: { pickBoard, menu: openMenu.controller },
  run: ({ pickBoard, menu }, { input }) => {
    menu.set(null);
    pickBoard.run({ input });
  },
});

const statesIcon = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18M12 8h7M12 13h8M12 18h5";

export function StatesPick({ canvas }: { canvas: string }) {
  const offers = useData(dockOffers({ canvas }));
  const { board } = useData(picksNow({}));
  const open = useData(openMenu, (m) => m === "states");
  const set = useRun(setMenu);
  if (offers.length === 0) return null;

  const shown = offers.map((offer) => {
    const picked = board[offer.name];
    const value = picked !== undefined && offer.values.includes(picked) ? picked : offer.default;
    return { offer, value };
  });
  const said = shown.map(({ offer, value }) => `${offer.name} ${value}`).join(", ");

  return (
    <Menu.Root
      modal={false}
      open={open}
      onOpenChange={(next) => set.run({ input: { menu: "states", open: next } })}
    >
      <Menu.Trigger
        className="e-dock-btn e-stick-states"
        aria-label="States"
        title={`States: ${said}`}
      >
        <svg className="e-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d={statesIcon} />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="e-menu-pos" side="bottom" align="end" sideOffset={8}>
          <Menu.Popup className="e-menu e-states" aria-label="States">
            {shown.map(({ offer, value }) =>
              offer.name === localeSwitch ? (
                <LocaleGroup key={offer.name} offer={offer} value={value} />
              ) : (
                <StateGroup key={offer.name} offer={offer} value={value} />
              ),
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function SwitchStick({ canvas }: { canvas: string }) {
  return (
    <div className="e-stick" role="toolbar" aria-label="Switches">
      <StatesPick canvas={canvas} />
    </div>
  );
}

function LocaleGroup({ offer, value }: { offer: SwitchOffer; value: string }) {
  const pick = useRun(pickSwitch);
  const items = offer.values.map((code) => ({
    code,
    name: new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code,
    short: code.split("-")[0]?.toUpperCase(),
  }));
  return (
    <Menu.Group className="e-states-group" aria-label={offer.name}>
      <Menu.GroupLabel className="e-states-name">{offer.name}</Menu.GroupLabel>
      <Menu.RadioGroup value={value}>
        {items.map(({ code, name, short }) => (
          <Menu.RadioItem
            key={code}
            value={code}
            lang={code}
            aria-label={name}
            onClick={() => pick.run({ input: { name: offer.name, value: code } })}
          >
            <span className="e-pages-name">{name}</span>
            <span className="e-menu-n">{short}</span>
          </Menu.RadioItem>
        ))}
      </Menu.RadioGroup>
    </Menu.Group>
  );
}

function StateGroup({ offer, value }: { offer: SwitchOffer; value: string }) {
  const pick = useRun(pickSwitch);
  return (
    <Menu.Group className="e-states-group" aria-label={offer.name}>
      <Menu.GroupLabel className="e-states-name">{offer.name}</Menu.GroupLabel>
      <Menu.RadioGroup value={value}>
        {offer.values.map((one) => (
          <Menu.RadioItem
            key={one}
            value={one}
            aria-label={`${offer.name} ${one}`}
            onClick={() => pick.run({ input: { name: offer.name, value: one } })}
          >
            <span className="e-pages-name">{one}</span>
          </Menu.RadioItem>
        ))}
      </Menu.RadioGroup>
    </Menu.Group>
  );
}

export const useTheBoard = "";

export function FrameStates({ canvas, id, name }: { canvas: string; id: string; name: string }) {
  const states = useData(frameStates({ canvas, id }));
  if (states.length === 0) return null;

  const own = states.filter((one) => one.own).map((one) => one.value);
  const said = states.map((one) => `${one.offer.name} ${one.value}`).join(", ");
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className="e-axis e-frame-states"
        data-own-pointer
        data-own={own.length ? "" : undefined}
        aria-label={`States of ${name}`}
        title={own.length ? `Its own states: ${said}` : `The states of the board: ${said}`}
      >
        <svg className="e-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d={statesIcon} />
        </svg>
        {own.length ? <span className="e-frame-own">{own.join(" · ")}</span> : null}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="e-menu-pos" side="bottom" align="start" sideOffset={4}>
          <Menu.Popup className="e-menu e-states" aria-label={`States of ${name}`}>
            {states.map((one) => (
              <FrameGroup key={one.offer.name} id={id} state={one} />
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function FrameGroup({ id, state }: { id: string; state: FrameState }) {
  const pick = useRun(pickFrame);
  const { offer, board, own, value } = state;
  return (
    <Menu.Group className="e-states-group" aria-label={offer.name}>
      <Menu.GroupLabel className="e-states-name">{offer.name}</Menu.GroupLabel>
      <Menu.RadioGroup value={own ? value : useTheBoard}>
        <Menu.RadioItem
          value={useTheBoard}
          closeOnClick
          aria-label={`${offer.name} Use the board`}
          onClick={() => pick.run({ input: { id, name: offer.name, value: null } })}
        >
          <span className="e-pages-name">Use the board</span>
          <span className="e-menu-n">{board}</span>
        </Menu.RadioItem>
        {offer.values.map((one) => (
          <Menu.RadioItem
            key={one}
            value={one}
            closeOnClick
            aria-label={`${offer.name} ${one}`}
            onClick={() => pick.run({ input: { id, name: offer.name, value: one } })}
          >
            <span className="e-pages-name">{one}</span>
          </Menu.RadioItem>
        ))}
      </Menu.RadioGroup>
    </Menu.Group>
  );
}
