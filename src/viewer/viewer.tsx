import { useData, useRun } from "@tinkered/react";

import { Canvas } from "./canvas";
import { enterPassword, gates } from "./gate";
import type { Gate } from "./gate";
import { KeptText } from "./request";

// `/s/<link>`: the share link's page (SPEC-viewer.md; the viewer-gate-password chart). No state of
// its own: the gate cell says which page the tab is on, and the canvas reads the live board. The
// canvas's only controls are Zoom in, Zoom out and Fit (the chart's CanvasControls).

/** The page for a link that has ended or is wrong, and nothing else (judged rule 13). One page for both, so it
 * says nothing of which links exist. */
function Ended() {
  return (
    <main>
      <h1>This link does not work</h1>
      <p>It has ended, or it is wrong. Ask the person who shared it for a new link.</p>
      <KeptText />
    </main>
  );
}

/** What the password page's `alert` says. */
const alerts = {
  wrong: "That password is wrong.",
  wait: "Too many wrong passwords. Wait 1 minute, then try again. Until then, no password opens the link.",
} as const;

/**
 * What the password page says: a first open, or a tab whose pass a password set or changed ended
 * (E3 S4, the E3 frame "A new password: the tab asks for it").
 */
const passwordTexts = {
  first: {
    heading: "This link needs a password",
    text: "Ask the person who shared it for the password.",
  },
  changed: {
    heading: "The password of this link changed",
    text: "Enter the new password to see the canvas again. Ask the person who shared it.",
  },
} as const;

type PasswordPage = Extract<Gate, { page: "password" }>;

/** The password gate: textbox Password, button Open, and an alert after a wrong one. */
function PasswordGate({ link, alert, changed }: Omit<PasswordPage, "page">) {
  const enter = useRun(enterPassword);
  const says = passwordTexts[changed ? "changed" : "first"];
  return (
    <main>
      <h1>{says.heading}</h1>
      <p>{says.text}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const password = new FormData(event.currentTarget).get("password");
          if (typeof password === "string" && password) enter.run({ input: { link, password } });
        }}
      >
        <input name="password" type="password" aria-label="Password" required />
        {/* While it says to wait, Open still calls: the link may have ended (the chart's s5 to s3). */}
        <button type="submit" disabled={enter.isPending && alert !== "wait"}>
          Open
        </button>
      </form>
      {alert === "none" ? null : <p role="alert">{alerts[alert]}</p>}
      {enter.error ? <p role="alert">No answer. Try again.</p> : null}
      <KeptText />
    </main>
  );
}

/**
 * The link is still opening: the first call, or a call again after a flood `slow`. The eye sees
 * the empty canvas, as in Figma and Miro; the status is for a screen reader.
 */
export function Opening() {
  return (
    <main className="e-canvas e-light">
      <p role="status" className="e-unseen">
        Opening the link
      </p>
    </main>
  );
}

/** The link's page: opening, the password gate, the canvas, or ended. It asks no name. */
export function Viewer({ link }: { link: string }) {
  const gate = useData(gates.of({ link }));
  switch (gate?.page) {
    case undefined:
      return <Opening />;
    case "password":
      return <PasswordGate link={link} alert={gate.alert} changed={gate.changed} />;
    case "canvas":
      return <Canvas canvas={gate.canvas} opening={<Opening />} />;
    case "ended":
      return <Ended />;
  }
}
