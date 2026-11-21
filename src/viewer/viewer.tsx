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

/** The password gate: textbox Password, button Open, and an alert after a wrong one. */
function PasswordGate({
  link,
  alert,
}: {
  link: string;
  alert: Extract<Gate, { page: "password" }>["alert"];
}) {
  const enter = useRun(enterPassword);
  return (
    <main>
      <h1>This link needs a password</h1>
      <p>Ask the person who shared it for the password.</p>
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

/** The link is still opening: the first call, or a call again after a flood `slow`. */
export function Opening() {
  return <p role="status">Opening the link</p>;
}

/** The link's page: opening, the password gate, the canvas, or ended. It asks no name. */
export function Viewer({ link }: { link: string }) {
  const gate = useData(gates.of({ link }));
  switch (gate?.page) {
    case undefined:
      return <Opening />;
    case "password":
      return <PasswordGate link={link} alert={gate.alert} />;
    case "canvas":
      return <Canvas canvas={gate.canvas} opening={<Opening />} />;
    case "ended":
      return <Ended />;
  }
}
