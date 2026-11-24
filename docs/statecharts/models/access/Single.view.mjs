export const title =
  "One person on a server: a code with no name, a link of easel open, an agent, a rename";

const people = { p: "the person", q: "the person", a: "the agent", x: "bob" };

const users = (v) => {
  const person = v.role.p === "owner" ? "rocky is the person" : "lagz0ne is the person";
  const agent = v.role.a === "member" ? "the agent is a member" : "the agent is revoked";
  const stranger = v.role.x === "member" ? ", bob is a member" : "";

  return `${person}, ${agent}${stranger}`;
};

const linkNames = {
  none: "No link",
  used: "The link is used",
  ended: "The link ran out or ended",
};

const link = (v) =>
  v.link === "live" ? `A live link of ${people[v.linkName]}` : linkNames[v.link];

const phoneNames = {
  out: () => "Shows the sign-in page",
  pending: (name) => `Shows a code for ${people[name]}, it waits`,
  approved: (name) => `Its code for ${people[name]} is approved`,
  in: (name) => `Signed in as ${people[name]}`,
};

const phone = (v) => phoneNames[v.phone](v.phoneName);

const opener = (state, name) => (state === "in" ? `Signed in as ${people[name]}` : "Not signed in");

export const state = (v) => ({
  Users: users(v),
  "The link of easel open": link(v),
  "The phone (a code)": phone(v),
  "The laptop (the link)": opener(v.laptop, v.laptopName),
  "A copy of the link": opener(v.copy, v.copyName),
});

export const group = (v) => {
  if ([v.phone, v.laptop, v.copy].includes("in")) return "in";

  return v.phone === "pending" || v.phone === "approved" ? "waiting" : "out";
};

export const colors = { waiting: "yellow", in: "teal", out: "tan" };

const labels = {
  ThePhoneShowsACode: "the sign-in page shows a code",
  ThePersonApprovesTheCode: "the person approves the code",
  TheCodeEnds: "the person denies the code, or it runs out (10 minutes)",
  ThePhoneSignsIn: "the page uses the approved code",
  TheLinkRunsOut: "the link runs out (5 minutes)",
  TheLaptopOpensTheLink: "the laptop opens the link",
  TheCopyOpensTheLink: "the copy opens the link",
  ThePhoneReads: "the phone reads a canvas",
  TheLaptopReads: "the laptop reads a canvas",
  TheCopyReads: "the copy reads a canvas",
  ThePhoneSessionEnds: "the phone signs out, or its session ends",
  TheLaptopSessionEnds: "the laptop signs out, or its session ends",
  TheCopySessionEnds: "its session ends",
  ThePersonIsRenamed: "easel users rename rocky lagz0ne",
};

const named = {
  TheCliMakesALink: (_from, to) => `${people[to.linkName]} runs easel open`,
  Revoke: (from, to) =>
    from.role.a === to.role.a ? "the person revokes bob" : "the person revokes the agent",
};

export const step = (action, from, to) => named[action]?.(from, to) ?? labels[action] ?? action;
