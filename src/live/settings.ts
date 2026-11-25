import { tmpdir } from "node:os";

import { tag } from "@tinkered/core";
import { z } from "zod";

export declare namespace LiveScreens {
  type Output = { write(text: string): unknown };
  type Ask = { n: number; frame: string; text: string; spot: { x: number; y: number } };
  type FixtureFrame = { name: string; size: { w: number; h: number }; html: string };
  type Answer = { n: number; text: string };
}

export const liveOutput = tag<LiveScreens.Output>({ label: "liveScreens.output" });

export const liveBinary = tag({ label: "liveScreens.binary", parse: z.string().min(1) });

export const writerEnv = tag<Readonly<Record<string, string | undefined>>>({
  label: "liveScreens.writerEnv",
  default: {},
});

export const fixtureEnv = tag<Readonly<Record<string, string | undefined>>>({
  label: "liveScreens.fixtureEnv",
  default: {},
});

export const liveCanvas = tag({
  label: "liveScreens.canvas",
  default: "product",
  parse: z.string().min(1),
});

export const keptDir = tag({
  label: "liveScreens.keptDir",
  default: tmpdir(),
  parse: z.string().min(1),
});

export const ciWarnings = tag({ label: "liveScreens.ciWarnings", default: false });

export const fixtureName = tag({
  label: "liveScreens.fixtureName",
  default: "Shop redesign",
  parse: z.string().min(1),
});

export const viewerName = tag({
  label: "liveScreens.viewerName",
  default: "Mai",
  parse: z.string().min(1),
});

export const fixturePins = tag({
  label: "liveScreens.fixturePins",
  default: 3,
  parse: z.number().int().positive(),
});

export const statusSize = tag({
  label: "liveScreens.statusSize",
  default: "1440x900",
  parse: z.string().regex(/^\d+x\d+$/),
});

export const setupViewport = tag({
  label: "liveScreens.setupViewport",
  default: { width: 1440, height: 900 },
});

export const waitDefaults = {
  start: 30_000,
  open: 60_000,
  pin: 10_000,
  pins: 20_000,
  images: 30_000,
  idle: 10_000,
  still: 400,
  step: 5_000,
  retry: 2_000,
  list: 3_000,
  tries: 5,
};

export const liveWaits = tag({ label: "liveScreens.waits", default: waitDefaults });

export const fixtureAsks = tag<readonly LiveScreens.Ask[]>({
  label: "liveScreens.fixtureAsks",
  default: [
    {
      n: 1,
      frame: "Pricing",
      text: "Make the Team plan stand out: it is the one we want people to pick.",
      spot: { x: 0.7, y: 0.35 },
    },
    {
      n: 2,
      frame: "Pricing",
      text: "Use our brand blue on the Starter button, not the default one.",
      spot: { x: 0.25, y: 0.55 },
    },
    {
      n: 3,
      frame: "Checkout, mobile",
      text: "Add the coupon field from the old checkout.",
      spot: { x: 0.5, y: 0.3 },
    },
    {
      n: 4,
      frame: "Sign-up",
      text: "Move the sign-up button above the fold.",
      spot: { x: 0.5, y: 0.4 },
    },
  ],
});

export const fixtureAnswers = tag<readonly LiveScreens.Answer[]>({
  label: "liveScreens.fixtureAnswers",
  default: [
    { n: 1, text: "Done. The Team card has a blue border and a Most popular label." },
    { n: 2, text: "Done. The Starter button uses the brand blue now." },
  ],
});

export const reopenNote = tag({
  label: "liveScreens.reopenNote",
  default: "The label is too loud. Make it grey, please.",
  parse: z.string().min(1),
});

const fixtureMain =
  "font-family:var(--font-sans);padding:32px;display:grid;gap:16px;background:var(--background);color:var(--foreground)";

const planCard = "border:1px solid var(--border);border-radius:var(--radius);padding:16px;flex:1";

export const fixtureFrames = tag<readonly LiveScreens.FixtureFrame[]>({
  label: "liveScreens.fixtureFrames",
  default: [
    {
      name: "Pricing",
      size: { w: 800, h: 500 },
      html: `<main style="${fixtureMain}"><h1 style="margin:0">Plans for every team</h1><div style="display:flex;gap:16px"><section style="${planCard}"><h2 style="margin:0 0 8px">Starter</h2><p style="margin:0 0 16px">$12</p><button>Choose Starter</button></section><section style="${planCard}"><h2 style="margin:0 0 8px">Team</h2><p style="margin:0 0 16px">$48</p><button>Choose Team</button></section></div></main>`,
    },
    {
      name: "Checkout, mobile",
      size: { w: 390, h: 640 },
      html: `<main style="${fixtureMain}"><h1 style="margin:0">Checkout</h1><label>Card number <input></label><button>Pay $48</button></main>`,
    },
    {
      name: "Sign-up",
      size: { w: 640, h: 480 },
      html: `<main style="${fixtureMain}"><h1 style="margin:0">Create your account</h1><label>Email <input></label><button>Sign up</button></main>`,
    },
  ],
});
