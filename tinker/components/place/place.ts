import type { AnyRouter, RouterHistory } from "@tanstack/react-router";
import { data, tag } from "@tinkered/core";
import { z } from "zod";

export const placeSearch = z.object({ place: z.string().min(1).optional().catch(undefined) });

export const placeName = z.string().min(1);

export type PlaceAddress = Pick<RouterHistory, "location" | "replace" | "go" | "subscribe">;

export const placeRouter = tag<AnyRouter>({ label: "place.router" });

export const placeAddress = tag<PlaceAddress>({ label: "place.address" });

export const placeNow = data<string | null>({ label: "place.now", initial: null });

export const placeStack = data<readonly string[]>({ label: "place.stack", initial: [] });

export const placeLeaving = data<boolean>({ label: "place.leaving", initial: false });
