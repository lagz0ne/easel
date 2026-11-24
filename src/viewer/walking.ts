import { data } from "@tinkered/core";

import type { Waiting } from "@/map/walk";

export type WalkStep = { state: string; value: unknown };

export type WalkTold = { kind: "none" } | { kind: "offMap"; from: string; to: string };

export type Walk = { map: string; path: WalkStep[]; told: WalkTold; waits: Waiting[] };

export const walking = data<Walk | null>({ label: "viewer.walking", initial: null });

export const walkFit = data({ label: "viewer.walkFit", initial: 1 });
