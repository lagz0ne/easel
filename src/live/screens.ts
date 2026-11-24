export const takes = [
  { key: "desktop light", width: 1440, height: 900, theme: "light", phone: false },
  { key: "desktop dark", width: 1440, height: 900, theme: "dark", phone: false },
  { key: "phone light", width: 390, height: 844, theme: "light", phone: true },
  { key: "phone dark", width: 390, height: 844, theme: "dark", phone: true },
] as const;

export type Take = (typeof takes)[number];

export type TakeKey = Take["key"];

export const takeKeys = ["desktop light", "desktop dark", "phone light", "phone dark"] as const;

export const screens = [
  {
    key: "requests",
    design: { id: "a679c2c12a09", name: "E4.4 Follow the requests (F1–F3 F6 P3)" },
    open: { kind: "list" },
  },
  {
    key: "accepted",
    design: { id: "52b790a2057e", name: "E4.2 Accepted, proof on After (M12 M17)" },
    open: { kind: "request", n: 1 },
  },
  {
    key: "opened-again",
    design: {
      id: "b172c148226c",
      name: "E4.2 Opened again after an accept, proof on After (M12 M17)",
    },
    open: { kind: "request", n: 2 },
  },
] as const;

export type Screen = (typeof screens)[number];

export const notScreens: Readonly<Record<string, string>> = {
  a99dc2049468: "0 · Read me: the guide of the canvas, not a screen of the app",
};

export const livePage = { key: "live", name: "Live" } as const;

export const statusName = "Live · status";
