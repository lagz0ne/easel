import { data, operation, resource, tag } from "@tinkered/core";
import { z } from "zod";

import { frames as framesApi } from "@/frames";
import { boardDoc } from "@/frames/contract";
import { boardKit } from "@/kit/cells";
import { firstLocale } from "@/words/frame-words";

import { pageParam } from "./pages";
import { axesPost, offeredAxes, schemeText, themedFrames } from "./stage";

export const switchOffer = z.object({
  name: z.string(),
  values: z.array(z.string()).min(1),
  default: z.string(),
  key: z.string().optional(),
});

export type SwitchOffer = z.infer<typeof switchOffer>;

const switchValues = z.record(z.string(), z.string());

export const switchPicksShape = z.object({
  board: switchValues,
  frames: z.record(z.string(), switchValues),
});

export type SwitchPicks = z.infer<typeof switchPicksShape>;

export const frameParam = "f.";

export const themeSwitch: SwitchOffer = {
  name: "theme",
  values: ["light", "dark"],
  default: "light",
};

export const teamLocales = [firstLocale, "vi"];

export const localeSwitch = "locale";

export const docTakesTheme = operation({
  label: "viewer.docTakesTheme",
  input: z.object({ doc: boardDoc, kit: boardKit.nullable(), names: z.array(z.string()) }),
  run: (_, { input: { doc, kit, names } }) => {
    if (names.includes(themeSwitch.name)) return true;

    const look = kit && (doc.app || doc.css !== null) ? `${kit.look}\n${kit.css}` : "";
    return schemeText.test([doc.html, doc.css ?? "", doc.app?.js ?? "", look].join("\n"));
  },
});

export const picksOf = operation({
  label: "viewer.picksOf",
  input: z.string(),
  run: (_, { input }): SwitchPicks => {
    const board: Record<string, string> = {};
    const frames: Record<string, Record<string, string>> = {};
    for (const [key, value] of new URLSearchParams(input)) {
      if (key === pageParam || value === "") continue;
      if (!key.startsWith(frameParam)) {
        board[key] = value;
        continue;
      }

      const rest = key.slice(frameParam.length);
      const dot = rest.indexOf(".");
      if (dot <= 0 || dot === rest.length - 1) continue;
      const id = rest.slice(0, dot);
      frames[id] = { ...frames[id], [rest.slice(dot + 1)]: value };
    }
    return { board, frames };
  },
});

export const searchWith = operation({
  label: "viewer.searchWith",
  input: z.object({ search: z.string(), picks: switchPicksShape }),
  run: (_, { input: { search, picks } }) => {
    const params = new URLSearchParams(search);
    for (const key of [...params.keys()]) {
      if (key.startsWith(frameParam)) params.delete(key);
    }

    for (const [name, value] of Object.entries(picks.board)) params.set(name, value);
    for (const [id, own] of Object.entries(picks.frames)) {
      for (const [name, value] of Object.entries(own)) {
        params.set(`${frameParam}${id}.${name}`, value);
      }
    }

    const text = params.toString();
    return text === "" ? "" : `?${text}`;
  },
});

export const addressPicks = resource({
  label: "viewer.addressPicks",
  config: {},
  depends: { picksOf },
  factory: ({ picksOf }) => picksOf.run({ input: location.search }),
});

export const switchPicks = data<SwitchPicks | null>({ label: "viewer.switchPicks", initial: null });

export const picksNow = resource({
  label: "viewer.picksNow",
  config: {},
  depends: { picked: switchPicks, asked: addressPicks({}) },
  factory: ({ picked, asked }) => picked ?? asked.get(),
});

export const picksInAddress = resource({
  label: "viewer.picksInAddress",
  config: {},
  depends: { now: picksNow({}), searchWith },
  factory: ({ now, searchWith }) => {
    const search = searchWith.run({ input: { search: location.search, picks: now.get() } });
    if (search === location.search) return search;

    const url = new URL(location.href);
    url.search = search;
    history.replaceState(history.state, "", url);
    return search;
  },
});

export const pickBoard = operation({
  label: "viewer.pickBoard",
  input: z.object({ name: z.string(), value: z.string() }),
  depends: { picked: switchPicks.controller, now: picksNow({}) },
  run: ({ picked, now: shown }, { input: { name, value } }) => {
    const now = shown.get();
    picked.set({ ...now, board: { ...now.board, [name]: value } });
  },
});

export const pickFrame = operation({
  label: "viewer.pickFrame",
  input: z.object({ id: z.string(), name: z.string(), value: z.string().nullable() }),
  depends: { picked: switchPicks.controller, now: picksNow({}) },
  run: ({ picked, now: shown }, { input: { id, name, value } }) => {
    const now = shown.get();
    const own = Object.fromEntries(
      Object.entries(now.frames[id] ?? {}).filter(([n]) => n !== name),
    );
    const next = value === null ? own : { ...own, [name]: value };
    const frames = Object.fromEntries(Object.entries(now.frames).filter(([key]) => key !== id));
    picked.set({ ...now, frames: Object.keys(next).length ? { ...frames, [id]: next } : frames });
  },
});

export const switchValue = operation({
  label: "viewer.switchValue",
  input: z.object({
    offer: switchOffer,
    board: z.string().optional(),
    own: z.string().optional(),
  }),
  run: (_, { input: { offer, board, own } }) => {
    if (own !== undefined && offer.values.includes(own)) return own;
    if (board !== undefined && offer.values.includes(board)) return board;

    return offer.default;
  },
});

export const frameValue = operation({
  label: "viewer.frameValue",
  input: z.object({ id: z.string(), offer: switchOffer, picks: switchPicksShape }),
  depends: { switchValue },
  run: ({ switchValue }, { input: { id, offer, picks } }) => {
    const [board, own] = [picks.board[offer.name], picks.frames[id]?.[offer.name]];
    return switchValue.run({ input: { offer, board, own } });
  },
});

export const appOffers = operation({
  label: "viewer.appOffers",
  input: axesPost.omit({ easel: true }),
  run: (_, { input: { locales, config } }): SwitchOffer[] => {
    const locale = locales.length
      ? [{ name: localeSwitch, values: locales, default: firstLocale }]
      : [];
    const tags = Object.entries(config).flatMap(([key, axis]) => {
      const [first] = axis.values;
      if (first === undefined) return [];

      return [{ name: axis.name ?? key, key, values: axis.values, default: axis.default ?? first }];
    });
    return [...locale, ...tags];
  },
});

export const frameOffers = operation({
  label: "viewer.frameOffers",
  input: z.object({
    app: axesPost.omit({ easel: true }).nullable(),
    themed: z.boolean(),
    translated: z.boolean(),
  }),
  depends: { appOffers },
  run: ({ appOffers }, { input: { app, themed, translated } }): SwitchOffer[] => {
    const own = app ? appOffers.run({ input: app }) : [];
    const words =
      !app && translated ? [{ name: localeSwitch, values: teamLocales, default: firstLocale }] : [];
    const theme = themed && !own.some((o) => o.name === themeSwitch.name) ? [themeSwitch] : [];
    return [...words, ...theme, ...own];
  },
});

export const frameState = z.object({
  offer: switchOffer,
  value: z.string(),
  board: z.string(),
  own: z.boolean(),
});

export type FrameState = z.infer<typeof frameState>;

export const statesOf = operation({
  label: "viewer.statesOf",
  input: z.object({ id: z.string(), offers: z.array(switchOffer), picks: switchPicksShape }),
  depends: { switchValue },
  run: ({ switchValue }, { input: { id, offers, picks } }): FrameState[] =>
    offers.map((offer) => {
      const mine = picks.frames[id]?.[offer.name];
      const own = mine !== undefined && offer.values.includes(mine);
      const board = switchValue.run({ input: { offer, board: picks.board[offer.name] } });
      return { offer, board, own, value: own ? mine : board };
    }),
});

export const joinOffers = operation({
  label: "viewer.joinOffers",
  input: z.array(switchOffer),
  run: (_, { input }): SwitchOffer[] => {
    const joined = new Map<string, SwitchOffer>();
    for (const offer of input) {
      const before = joined.get(offer.name);
      const values = [...new Set([...(before?.values ?? []), ...offer.values])];
      joined.set(offer.name, {
        name: offer.name,
        values,
        default: before?.default ?? offer.default,
      });
    }
    return [...joined.values()];
  },
});

export const boardOffers = resource({
  label: "viewer.boardOffers",
  config: {},
  depends: { offered: offeredAxes, themed: themedFrames, appOffers, joinOffers },
  factory: ({ offered, themed, appOffers, joinOffers }) => {
    const apps = Object.values(offered).flatMap((post) => appOffers.run({ input: post }));
    const theme = Object.keys(themed).length ? [themeSwitch] : [];
    return joinOffers.run({ input: [...theme, ...apps] });
  },
});

const switchFrame = tag<string>({ label: "viewer.switchFrame" });

export const teamTranslated = operation({
  label: "viewer.teamTranslated",
  input: boardKit.nullable(),
  run: (_, { input }) => Object.values(input?.texts ?? {}).some((text) => text.vi !== undefined),
});

export const tagNames = operation({
  label: "viewer.tagNames",
  input: axesPost.shape.config.nullable(),
  run: (_, { input }) => Object.values(input ?? {}).flatMap((axis) => axis.name ?? []),
});

export const docOffers = operation({
  label: "viewer.docOffers",
  input: z.object({
    doc: boardDoc,
    kit: boardKit.nullable(),
    post: axesPost.extend({ version: z.number() }).nullable(),
  }),
  depends: { docTakesTheme, frameOffers, teamTranslated, tagNames },
  run: (units, { input: { doc, kit, post } }) => {
    const app = doc.app && post?.version === doc.version ? post : null;
    if (doc.app && !app) return [];

    const names = units.tagNames.run({ input: app ? app.config : null });
    const themed = units.docTakesTheme.run({ input: { doc, kit, names } });
    const translated = units.teamTranslated.run({ input: kit });
    return units.frameOffers.run({ input: { app, themed, translated } });
  },
});

const statesCanvas = tag<string>({ label: "viewer.statesCanvas" });

export const frameStates = resource({
  label: "viewer.frameStates",
  config: { canvas: statesCanvas.required, id: switchFrame.required },
  depends: (c) => ({
    doc: framesApi.board.docs.of({ canvas: c.canvas, id: c.id }),
    kit: framesApi.board.kit.of({ canvas: c.canvas }),
    offered: offeredAxes,
    picks: picksNow({}),
    docOffers,
    statesOf,
  }),
  factory: (deps, { config: { id } }) => {
    const at = deps.doc.get();
    if (!at) return [];

    const input = { doc: at, kit: deps.kit.get() ?? null, post: deps.offered[id] ?? null };
    const offers = deps.docOffers.run({ input });
    return deps.statesOf.run({ input: { id, offers, picks: deps.picks.get() } });
  },
});
