import { tag } from "@tinkered/core";
import { z } from "zod";

export declare namespace MapScreens {
  type Output = { write(text: string): unknown };
}

export const screensRoot = tag({ label: "mapScreens.root", parse: z.string().min(1) });

export const screensOutput = tag<MapScreens.Output>({ label: "mapScreens.output" });

export const easelBinary = tag({ label: "mapScreens.easelBinary", parse: z.string().min(1) });

export const easelEnv = tag<Readonly<Record<string, string | undefined>>>({
  label: "mapScreens.easelEnv",
  default: {},
});

export const mapsCanvas = tag({
  label: "mapScreens.canvas",
  default: "product",
  parse: z.string().min(1),
});

export const shotTime = tag({
  label: "mapScreens.shotTime",
  default: "2026-11-24T10:00:00Z",
  parse: z.iso.datetime(),
});

export const shotTimeoutMs = tag({
  label: "mapScreens.shotTimeoutMs",
  default: 20_000,
  parse: z.number().int().positive(),
});

export const rasterNoise = tag({
  label: "mapScreens.rasterNoise",
  default: 8,
  parse: z.number().int().nonnegative(),
});
