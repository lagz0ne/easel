import { capsule } from "@tinkered/core";

import { codesBoard, homeBoard } from "./contract";

export const home = capsule({ label: "home", exports: { board: homeBoard, codes: codesBoard } });
