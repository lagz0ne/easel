import { resource } from "@tinkered/core";

import { placeRead, placeMoved, placeWrite } from "./operations";
import { placeAddress } from "./place";

export const placeOpen = resource({
  label: "place.open",
  target: "session",
  depends: { read: placeRead.controller, write: placeWrite.controller },
  factory: ({ read, write }) => {
    write.run({ input: read.run() });
  },
});

export const placeHistory = resource({
  label: "place.history",
  target: "session",
  depends: { address: placeAddress.required, moved: placeMoved.controller },
  factory: ({ address, moved }, { defer }) => {
    defer(
      address.subscribe(({ action }) => {
        if (action.type === "PUSH" || action.type === "REPLACE") return;

        moved.run();
      }),
    );
  },
});
