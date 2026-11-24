import { operation } from "@tinkered/core";
import { z } from "zod";

export const maxFixturesBytes = 256 * 1024;

export const fixtureName = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

export const cellLabel = z.string().regex(/^[A-Za-z][\w.-]{0,99}$/);

export const kitFixtures = z.record(cellLabel, z.record(fixtureName, z.unknown()));

export type KitFixtures = z.infer<typeof kitFixtures>;

export const fixturesPatch = z.record(fixtureName, z.unknown());

export const fixtureSwitch = "fixture";

export const initialFixture = "initial";

export const mergeFixtures = operation({
  label: "kit.mergeFixtures",
  input: z.object({ now: kitFixtures, cell: cellLabel, patch: fixturesPatch }),
  run: (_, { input: { now, cell, patch } }): KitFixtures => {
    const kept = Object.entries({ ...now[cell], ...patch }).filter(([, value]) => value !== null);
    const others = Object.fromEntries(Object.entries(now).filter(([label]) => label !== cell));
    return kept.length ? { ...others, [cell]: Object.fromEntries(kept) } : others;
  },
});

export const fixtureNames = operation({
  label: "kit.fixtureNames",
  input: z.object({ fixtures: kitFixtures, cells: z.array(z.string()) }),
  run: (_, { input: { fixtures, cells } }) => [
    ...new Set(cells.flatMap((cell) => Object.keys(fixtures[cell] ?? {}))),
  ],
});
