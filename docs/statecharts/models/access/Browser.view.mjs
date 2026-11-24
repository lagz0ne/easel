export const title =
  "A browser signs in: a code that an owner approves, a one-time link, a session that ends";

const linkNames = {
  none: "no link",
  live: "a live link",
  used: "its link is used",
  ended: "its link ran out or ended",
};

const easel = (v) =>
  v.user === "revoked" ? `U is revoked, ${linkNames[v.link]}` : `U is a user, ${linkNames[v.link]}`;

const phoneNames = {
  out: "Shows the sign-in page",
  pending: "Shows a code, it waits",
  approved: "Its code is approved",
  in: "Signed in, the home page",
  ended: "Its session ended, it still shows the page",
};

const openerNames = {
  out: "Not signed in",
  checked: "Found the link live, not yet used",
  in: "Signed in, the home page",
  ended: "Its session ended, it still shows the page",
};

export const state = (v) => ({
  easel: easel(v),
  "The phone of U (a code)": phoneNames[v.phone],
  "The laptop of U (easel open)": openerNames[v.laptop],
  "A copy of the link": openerNames[v.copy],
});

export const group = (v) => {
  if ([v.phone, v.laptop, v.copy].includes("in")) return "in";

  return v.phone === "pending" || v.phone === "approved" ? "waiting" : "out";
};

export const colors = { waiting: "yellow", in: "teal", out: "tan" };

const labels = {
  ThePhoneShowsACode: "the sign-in page asks for a code",
  AnOwnerApprovesTheCode: "an owner approves the code",
  AnOwnerDeniesTheCode: "an owner denies the code",
  TheCodeRunsOut: "the code runs out (10 minutes)",
  ThePhoneSignsIn: "the page uses the approved code",
  TheCliMakesALink: "U runs easel open",
  TheLinkRunsOut: "the link runs out (5 minutes)",
  TheLaptopOpensTheLink: "the laptop opens the link",
  TheLaptopChecksTheLink: "the laptop finds the link live",
  TheLaptopUsesTheCheckedLink: "the laptop uses the link it found",
  TheCopyOpensTheLink: "the copy opens the link",
  TheCopyChecksTheLink: "the copy finds the link live",
  TheCopyUsesTheCheckedLink: "the copy uses the link it found",
  ThePhoneReads: "the phone reads a canvas",
  TheLaptopReads: "the laptop reads a canvas",
  TheCopyReads: "the copy reads a canvas",
  ThePhoneSignsOut: "the phone signs out",
  TheLaptopSignsOut: "the laptop signs out",
  ThePhoneSessionEnds: "an owner ends the session, or 30 days with no use",
  TheLaptopSessionEnds: "an owner ends the session, or 30 days with no use",
  TheCopySessionEnds: "an owner ends the session, or 30 days with no use",
  ThePhoneIsRefused: "its next read is refused",
  TheLaptopIsRefused: "its next read is refused",
  TheCopyIsRefused: "its next read is refused",
  AnOwnerRevokesTheUser: "an owner revokes U",
};

export const step = (action) => labels[action] ?? action;
